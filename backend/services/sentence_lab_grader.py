"""Bộ chấm "Kho luyện viết câu IELTS Academic — 45 buổi" (Course 5).

Khác `course_writing_grader` (Course 1) ở chỗ cốt lõi: Course 1 chỉ SOÁT ngữ
pháp/chính tả và trả lại câu đúng. Bài của gói này có ĐỀ (source, instruction,
required) và KHÓA CHẤM riêng (đáp án tham khảo, ý phải giữ, biến thể, giải
thích), và phản hồi theo thang luyện câu 0–10 với hai lượt:

* ``coach`` — lượt nộp đầu: điểm, tối đa 2 lỗi ưu tiên, gợi ý để TỰ SỬA. Không
  được lộ câu sửa hoàn chỉnh ở bất kỳ trường nào.
* ``review`` — sau khi học viên tự viết lại: đánh giá lại và đưa bản sửa tối
  thiểu khi còn lỗi.

Prompt, schema và quy tắc kiểm tra đầu ra lấy NGUYÊN từ gói nội dung
(`assets/sentence_lab/ai_grader_prompt.md`, `feedback.schema.json`,
`feedback_validator.mjs`). Phản hồi không qua kiểm tra thì KHÔNG được hiện như
một kết quả chấm: câu ấy được gọi lại một lần, vẫn hỏng thì trả ``ok=None`` để
tầng gọi giữ nguyên lượt nộp (503) — đúng hợp đồng "chưa chấm được KHÁC HẲN
câu-của-em-đúng" của phần tự luận.

GÓI CÂU. 12 câu một buổi đi thành 2 lượt gọi (6 + 6) chạy song song; lượt sửa
(tối đa 6 câu) là 1 lượt gọi. Câu hỏng được gom vào ĐÚNG MỘT lượt gọi lại, nên
một bài tốn 1–3 lượt gọi model.

Model: `SENTENCE_LAB_MODEL` (OpenAI, mặc định trong `config.py`).
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

from config import settings
from services import ai_usage_logger

logger = logging.getLogger(__name__)

KIND = "sentence_lab_v1"
FEATURE = "sentence_lab"
MAX_ITEMS_PER_CALL = 6
MAX_REVISION_ITEMS = 6
MAX_ANSWER_CHARS = 600
_TIMEOUT_SECONDS = 120.0
_MAX_COMPLETION_TOKENS = 24000

MODES = ("coach", "review")
STATUSES = ("accepted", "revise", "needs_review", "no_attempt")
DIMENSIONS = {"meaning": 3, "grammar": 3, "task": 2, "lexis": 1, "mechanics": 1}
# STYLE có trong từ điển mã lỗi nhưng KHÔNG được vào `errors` (prompt mục 3).
ERROR_CODES = (
    "SENT", "SVA", "COUNT", "ART", "TENSE", "CLAUSE", "REL", "VERBFORM",
    "PASSIVE", "REF", "PARALLEL", "LINK", "COND", "MODAL", "COMP", "DATA",
    "SCOPE", "LEX", "PREP", "WORDORDER", "PUNC", "TASK",
)

_ASSETS = Path(__file__).resolve().parent.parent / "assets" / "sentence_lab"


def is_sentence_lab_bank(bank: dict | None) -> bool:
    meta = (bank or {}).get("meta") or {}
    lab = meta.get("sentence_lab") if isinstance(meta, dict) else None
    return isinstance(lab, dict) and lab.get("kind") == KIND


@lru_cache(maxsize=1)
def _system_prompt() -> str:
    base = (_ASSETS / "ai_grader_prompt.md").read_text(encoding="utf-8")
    codes = json.loads((_ASSETS / "error_codes.json").read_text(encoding="utf-8"))
    catalog = "\n".join(f"- {k}: {v}" for k, v in codes.items() if k != "STYLE")
    return (
        base.strip()
        + "\n\n## Danh mục mã lỗi (metadata)\n\n" + catalog
        + "\n\n## Định dạng lượt chấm này\n\n"
        "Bạn nhận một mảng `items`. Mỗi phần tử có `item` (đề công khai), `key` "
        "(khóa chấm nội bộ), `response` (câu học viên), `attempt`, `mode` và có "
        "thể có `previous_response`. Chấm TỪNG item độc lập, không để item này "
        "ảnh hưởng item khác. Trả đúng một object "
        '{"results": [...]}, mỗi phần tử là một phản hồi theo '
        "feedback.schema.json với `item_id` và `mode` khớp đúng item đã gửi; đủ "
        "một phản hồi cho mỗi item."
    )


# ── Schema gửi cho model (Structured Outputs, strict) ────────────────────────
# Strict mode không nhận if/then/allOf, nên các ràng buộc chéo trường được kiểm
# lại đầy đủ ở `validate_feedback` sau khi parse.
_SCORE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": list(DIMENSIONS),
    "properties": {k: {"type": "integer"} for k in DIMENSIONS},
}
_ERROR_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["code", "dimension", "offending_text", "reason_vi", "hint_vi"],
    "properties": {
        "code": {"type": "string", "enum": list(ERROR_CODES)},
        "dimension": {"type": "string", "enum": list(DIMENSIONS)},
        "offending_text": {"type": "string"},
        "reason_vi": {"type": "string"},
        "hint_vi": {"type": "string"},
    },
}
_FEEDBACK_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "item_id", "mode", "status", "scores", "total", "strength_vi", "errors",
        "has_more_issues", "minimal_correction", "optional_alternative",
        "next_action_vi", "needs_review_reason_vi",
    ],
    "properties": {
        "item_id": {"type": "string"},
        "mode": {"type": "string", "enum": list(MODES)},
        "status": {"type": "string", "enum": list(STATUSES)},
        "scores": {"anyOf": [_SCORE_SCHEMA, {"type": "null"}]},
        "total": {"type": ["integer", "null"]},
        "strength_vi": {"type": "string"},
        "errors": {"type": "array", "items": _ERROR_SCHEMA},
        "has_more_issues": {"type": "boolean"},
        "minimal_correction": {"type": ["string", "null"]},
        "optional_alternative": {"type": ["string", "null"]},
        "next_action_vi": {"type": "string"},
        "needs_review_reason_vi": {"type": ["string", "null"]},
    },
}
BATCH_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["results"],
    "properties": {"results": {"type": "array", "items": _FEEDBACK_SCHEMA}},
}


# ── Kiểm tra đầu ra (port của feedback.schema.json + feedback_validator.mjs) ──
_FULL_SCORES = {"meaning": 3, "grammar": 3, "task": 2, "lexis": 1, "mechanics": 1}
_ZERO_SCORES = {k: 0 for k in DIMENSIONS}
_FREE_TEXT_FIELDS = ("strength_vi", "next_action_vi", "needs_review_reason_vi")


def _norm(text: Any) -> str:
    """So khớp lời giải bị lộ: bỏ dấu câu/hoa thường/khoảng trắng thừa."""
    t = unicodedata.normalize("NFKC", str(text or "")).casefold()
    t = t.replace("’", "'").replace("‘", "'")
    t = re.sub(r"[^\w%'.]+", " ", t)
    t = re.sub(r"(?<!\d)\.(?!\d)", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def _reveals(text: Any, reference: str) -> bool:
    ref = _norm(reference)
    return bool(ref) and len(ref.split()) >= 4 and ref in _norm(text)


def validate_feedback(fb: Any, *, item_id: str, mode: str, response: str,
                      reference_answer: str = "") -> list[str]:
    """Trả danh sách lỗi; rỗng = phản hồi dùng được.

    Gồm: ràng buộc của feedback.schema.json (kể cả if/then theo status/mode),
    các quy tắc của `validateFeedback`, và kiểm tra coach không lộ toàn bộ câu
    sửa trong các trường văn bản tự do (README "Kiểm tra đầu ra AI").
    """
    p: list[str] = []
    if not isinstance(fb, dict):
        return ["Feedback must be an object."]
    if fb.get("item_id") != item_id:
        p.append("Item ID mismatch.")
    if fb.get("mode") != mode:
        p.append("Mode mismatch.")
    status = fb.get("status")
    if status not in STATUSES:
        return p + ["Invalid status."]
    scores, total = fb.get("scores"), fb.get("total")
    errors = fb.get("errors")
    if not isinstance(errors, list):
        return p + ["Errors must be a list."]
    has_more = fb.get("has_more_issues")
    if not isinstance(has_more, bool):
        p.append("has_more_issues must be boolean.")
    mc, alt = fb.get("minimal_correction"), fb.get("optional_alternative")
    nrr = fb.get("needs_review_reason_vi")
    for key in ("strength_vi", "next_action_vi"):
        if not isinstance(fb.get(key), str):
            p.append(f"{key} must be a string.")
    for key, val in (("minimal_correction", mc), ("optional_alternative", alt),
                     ("needs_review_reason_vi", nrr)):
        if val is not None and not isinstance(val, str):
            p.append(f"{key} must be a string or null.")

    if not str(response or "").strip() and status != "no_attempt":
        p.append("An empty response must receive no_attempt.")

    if status == "needs_review":
        if scores is not None or total is not None:
            p.append("Needs-review scores must be null.")
        if not isinstance(nrr, str) or not nrr.strip():
            p.append("Needs-review reason is missing.")
        if errors or has_more or mc is not None or alt is not None:
            p.append("Needs-review feedback must not assert errors or provide "
                     "speculative corrections.")
    else:
        if not isinstance(scores, dict) or set(scores) != set(DIMENSIONS):
            p.append("Numeric scores are required.")
        else:
            s = 0
            for k, mx in DIMENSIONS.items():
                v = scores.get(k)
                if not isinstance(v, int) or isinstance(v, bool) or not 0 <= v <= mx:
                    p.append(f"Invalid score: {k}.")
                else:
                    s += v
            if total != s:
                p.append("Total does not equal the five component scores.")
        if nrr is not None:
            p.append("needs_review_reason_vi must be null unless needs_review.")

    if len(errors) > 2:
        p.append("Errors must contain at most two priority issues.")
    for err in errors:
        if not isinstance(err, dict):
            p.append("Error entry must be an object.")
            continue
        if err.get("code") not in ERROR_CODES:
            p.append("Unknown error code.")
        dim = err.get("dimension")
        if dim not in DIMENSIONS:
            p.append("Unknown error dimension.")
        for key in ("reason_vi", "hint_vi"):
            if not isinstance(err.get(key), str) or not err.get(key).strip():
                p.append(f"Error {key} is missing.")
        ot = err.get("offending_text")
        if not isinstance(ot, str):
            p.append("Error evidence must be a string.")
        elif ot and ot not in str(response or ""):
            p.append("Quoted error evidence was not found in the learner response.")
        if (status == "revise" and isinstance(scores, dict) and dim in DIMENSIONS
                and isinstance(scores.get(dim), int) and scores[dim] >= DIMENSIONS[dim]):
            p.append(f"An error in {dim} needs a deduction in that dimension.")

    if status == "revise" and isinstance(scores, dict) and has_more is False:
        explained = {e.get("dimension") for e in errors if isinstance(e, dict)}
        for dim, mx in DIMENSIONS.items():
            v = scores.get(dim)
            if isinstance(v, int) and v < mx and dim not in explained:
                p.append(f"Unexplained deduction in {dim}.")

    if status == "accepted":
        if scores != _FULL_SCORES or total != 10 or errors or has_more or mc is not None:
            p.append("Accepted status conflicts with remaining errors or scores.")
    if status == "revise":
        if not errors or total == 10 or (isinstance(total, int) and not 0 <= total <= 9):
            p.append("Revise status needs a genuine issue and a score below ten.")
    if status == "no_attempt":
        if (scores != _ZERO_SCORES or total != 0 or errors or has_more
                or mc is not None or alt is not None):
            p.append("No-attempt status conflicts with scores or issues.")

    if mode == "coach":
        if mc is not None or alt is not None:
            p.append("Coach mode must not reveal a full correction or alternative.")
        texts = [fb.get(k) for k in _FREE_TEXT_FIELDS]
        texts += [e.get(k) for e in errors if isinstance(e, dict)
                  for k in ("reason_vi", "hint_vi")]
        if reference_answer and any(_reveals(t, reference_answer) for t in texts):
            p.append("Coach feedback reveals the reference answer.")
    if mode == "review" and status == "revise":
        if not isinstance(mc, str) or not mc.strip():
            p.append("Review with remaining errors needs a nonempty minimal correction.")
    return p


# ── Gọi model ────────────────────────────────────────────────────────────────
def model_name() -> str:
    return (getattr(settings, "SENTENCE_LAB_MODEL", None) or "gpt-5-mini").strip()


def _is_reasoning_model(name: str) -> bool:
    return bool(re.match(r"^(gpt-5|gpt-6|o\d)", name))


def _client():
    from openai import AsyncOpenAI
    key = getattr(settings, "OPENAI_API_KEY", "") or ""
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    return AsyncOpenAI(api_key=key, timeout=_TIMEOUT_SECONDS, max_retries=1)


def _payload(entry: Dict[str, Any], mode: str) -> Dict[str, Any]:
    key = entry.get("key") or {}
    out = {
        "item_id": entry["qid"],
        "mode": mode,
        "attempt": int(entry.get("attempt") or (1 if mode == "coach" else 2)),
        "item": entry.get("item") or {},
        "key": {k: key.get(k) for k in
                ("answer", "meaning", "required", "variants", "explanation", "error_tags")
                if key.get(k) is not None},
        "response": str(entry.get("response") or "")[:MAX_ANSWER_CHARS],
    }
    if entry.get("previous_response") is not None:
        out["previous_response"] = str(entry["previous_response"])[:MAX_ANSWER_CHARS]
    return out


async def _call_model(batch: List[Dict[str, Any]], mode: str, *,
                      usage_user_id: str | None) -> Dict[str, Any]:
    """Một lượt gọi. Trả {qid: feedback-dict}; ném lỗi khi lượt gọi hỏng."""
    name = model_name()
    user = json.dumps({"items": [_payload(e, mode) for e in batch]},
                      ensure_ascii=False)
    kwargs: Dict[str, Any] = {
        "model": name,
        "messages": [
            {"role": "system", "content": _system_prompt()},
            {"role": "user", "content": user},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "sentence_feedback_batch", "strict": True,
                            "schema": BATCH_SCHEMA},
        },
        "max_completion_tokens": _MAX_COMPLETION_TOKENS,
    }
    if _is_reasoning_model(name):
        kwargs["extra_body"] = {"reasoning_effort": settings.SENTENCE_LAB_REASONING_EFFORT
                                or "low"}
    else:
        kwargs["temperature"] = 0
    started = time.monotonic()
    status, error_code, usage = "success", None, None
    try:
        resp = await _client().chat.completions.create(**kwargs)
        usage = getattr(resp, "usage", None)
        choice = resp.choices[0]
        text = choice.message.content or ""
        if getattr(choice.message, "refusal", None):
            raise ValueError("model_refusal")
        if choice.finish_reason == "length":
            raise ValueError("output_truncated")
        data = json.loads(text)
        results = data.get("results") if isinstance(data, dict) else None
        if not isinstance(results, list):
            raise ValueError("missing_results")
        return {r.get("item_id"): r for r in results if isinstance(r, dict)}
    except Exception as exc:
        status = "error"
        error_code = type(exc).__name__ if not isinstance(exc, ValueError) else str(exc)[:60]
        raise
    finally:
        _log_usage(name, usage, status=status, error_code=error_code,
                   latency_ms=int((time.monotonic() - started) * 1000),
                   user_id=usage_user_id, mode=mode, item_count=len(batch))


def _log_usage(name: str, usage: Any, *, status: str, error_code: str | None,
               latency_ms: int, user_id: str | None, mode: str,
               item_count: int) -> None:
    def _n(obj: Any, attr: str) -> int:
        try:
            return max(0, int(getattr(obj, attr, 0) or 0))
        except (TypeError, ValueError):
            return 0
    cached = _n(getattr(usage, "prompt_tokens_details", None), "cached_tokens")
    prompt = _n(usage, "prompt_tokens")
    try:
        ai_usage_logger.schedule_usage_log(ai_usage_logger.log_openai_chat_async(
            user_id=user_id, session_id=None, model=name,
            input_tokens=max(0, prompt - cached),
            cache_read_tokens=cached,
            output_tokens=_n(usage, "completion_tokens"),
            feature=FEATURE, operation=f"grade_{mode}", status=status,
            error_code=error_code, latency_ms=latency_ms,
            metadata={"item_count": item_count},
        ))
    except Exception as exc:  # noqa: BLE001 — logging never fails grading
        logger.warning("[sentence-lab] usage log failed: %s", exc)


def _result_row(entry: Dict[str, Any], mode: str, fb: Dict[str, Any] | None,
                error: str | None = None) -> Dict[str, Any]:
    """Một dòng `items` của course_writing_submissions.

    Giữ các khóa của Course 1 (`qid`, `prompt`, `explain`, `answer`, `ok`,
    `corrected`, `issues`) để mọi mặt đọc sẵn có — bảng giáo viên, chấm lại —
    vẫn đọc được; bản phản hồi đầy đủ nằm ở `feedback`.
    """
    base = {
        "qid": entry["qid"],
        "prompt": entry.get("prompt", ""),
        "explain": entry.get("explain", ""),
        "answer": str(entry.get("response") or ""),
        "mode": mode,
    }
    if fb is None:
        return {**base, "corrected": None, "issues": [], "ok": None,
                "feedback": None, "error": error or "Chưa chấm được câu này."}
    issues = [{
        "type": "grammar" if e["dimension"] in ("grammar", "mechanics") else e["dimension"],
        "code": e["code"],
        "before": e["offending_text"],
        "after": "",
        "note": e["reason_vi"],
    } for e in fb.get("errors") or []]
    return {
        **base,
        "corrected": fb.get("minimal_correction"),
        "issues": issues,
        # Chỉ `accepted` là câu đạt. `needs_review` không phải lỗi của học viên,
        # nhưng cũng chưa được xác nhận đúng — không cộng vào số câu đạt.
        "ok": fb.get("status") == "accepted",
        "status": fb.get("status"),
        "score": fb.get("total"),
        "feedback": fb,
    }


async def grade(entries: List[Dict[str, Any]], *, mode: str,
                usage_user_id: str | None = None) -> tuple[List[Dict[str, Any]], str]:
    """Chấm `entries` theo `mode`; trả (dòng kết quả theo đúng thứ tự, model).

    Mỗi entry: {qid, prompt, explain, item, key, response, attempt?,
    previous_response?}. Câu trống được trả `no_attempt` ngay, không gọi model.
    """
    if mode not in MODES:
        raise ValueError(f"unknown mode {mode!r}")
    name = model_name()
    results: Dict[str, Dict[str, Any]] = {}
    pending: List[Dict[str, Any]] = []
    for e in entries:
        if not str(e.get("response") or "").strip():
            results[e["qid"]] = _result_row(e, mode, {
                "item_id": e["qid"], "mode": mode, "status": "no_attempt",
                "scores": dict(_ZERO_SCORES), "total": 0,
                "strength_vi": "", "errors": [], "has_more_issues": False,
                "minimal_correction": None, "optional_alternative": None,
                "next_action_vi": "Viết một câu tiếng Anh hoàn chỉnh cho bài này.",
                "needs_review_reason_vi": None,
            })
        else:
            pending.append(e)

    def _accept(batch: List[Dict[str, Any]], by_qid: Dict[str, Any]) -> List[Dict[str, Any]]:
        failed = []
        for e in batch:
            fb = by_qid.get(e["qid"])
            problems = validate_feedback(
                fb, item_id=e["qid"], mode=mode, response=str(e.get("response") or ""),
                reference_answer=str((e.get("key") or {}).get("answer") or ""))
            if problems:
                logger.warning("[sentence-lab] invalid feedback qid=%s mode=%s: %s",
                               e["qid"], mode, "; ".join(problems[:4]))
                failed.append(e)
            else:
                results[e["qid"]] = _result_row(e, mode, fb)
        return failed

    async def _run(batch: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        try:
            by_qid = await _call_model(batch, mode, usage_user_id=usage_user_id)
        except Exception as exc:  # noqa: BLE001
            logger.error("[sentence-lab] model call failed (%d items): %s",
                         len(batch), type(exc).__name__)
            return list(batch)
        return _accept(batch, by_qid)

    batches = [pending[i:i + MAX_ITEMS_PER_CALL]
               for i in range(0, len(pending), MAX_ITEMS_PER_CALL)]
    try:
        failed_lists = await asyncio.gather(*(_run(b) for b in batches))
    except Exception:  # pragma: no cover — _run swallows provider errors
        failed_lists = [list(b) for b in batches]
    failed = [e for lst in failed_lists for e in lst]
    # ĐÚNG MỘT lượt gọi lại cho mọi câu hỏng — giữ tổng số lượt gọi ≤ 3.
    if failed:
        still = await _run(failed[:MAX_ITEMS_PER_CALL])
        still += failed[MAX_ITEMS_PER_CALL:]
        for e in still:
            results[e["qid"]] = _result_row(
                e, mode, None, "Bộ chấm chưa trả được phản hồi hợp lệ cho câu này.")
    return [results[e["qid"]] for e in entries], name

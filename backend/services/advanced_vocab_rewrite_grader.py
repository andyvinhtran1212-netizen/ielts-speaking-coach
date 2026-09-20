"""Single-call grammar and style feedback for one Controlled Rewrite unit."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

import google.generativeai as genai

from config import settings
from services import ai_usage_logger

logger = logging.getLogger(__name__)

PROMPT_VERSION = "advanced-vocab-rewrite-v1"
MAX_ANSWER_CHARS = 600
_TIMEOUT_SECONDS = 60.0

_PROMPT = """Bạn là giáo viên tiếng Anh chấm một bài Controlled Rewrite.

Hãy đọc đủ 20 câu trong MỘT lượt và nhận xét ngắn gọn bằng tiếng Việt về:
1. ngữ pháp/chính tả;
2. văn phong và độ tự nhiên;
3. việc dùng đúng từ hoặc cấu trúc được yêu cầu trong đề.

Không cho điểm số. Không bịa lỗi khi câu đã đúng. Không đổi ý của học viên.
Mỗi kết quả phải giữ đúng item_id và có:
- corrected: câu sửa tối thiểu; giữ nguyên nếu đã đúng;
- grammar_notes: tối đa 3 ghi chú ngắn;
- style_note: một ghi chú ngắn;
- target_usage_note: một ghi chú ngắn về từ/cấu trúc mục tiêu;
- ok: true chỉ khi không có lỗi ngữ pháp/chính tả.

Trả duy nhất JSON:
{"results":[{"item_id":"rewrite-01","corrected":"...","grammar_notes":[],"style_note":"...","target_usage_note":"...","ok":true}],"overall":{"strengths":["..."],"focus":["..."]}}

Dữ liệu 20 câu:
"""


def _model():
    name = (getattr(settings, "ADVANCED_VOCAB_REWRITE_MODEL", "")
            or "gemini-3.5-flash-lite")
    return name, genai.GenerativeModel(
        model_name=name,
        generation_config=genai.types.GenerationConfig(
            response_mime_type="application/json",
            temperature=0.0,
            max_output_tokens=8192,
        ),
    )


def _strip_fences(value: str) -> str:
    text = (value or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _failed(items: list[dict[str, str]], message: str) -> dict[str, Any]:
    return {
        "results": [{
            "item_id": item["item_id"],
            "corrected": None,
            "grammar_notes": [],
            "style_note": message,
            "target_usage_note": "",
            "ok": None,
        } for item in items],
        "overall": {"strengths": [], "focus": [message]},
    }


def _bounded_strings(value: Any, *, field: str, limit: int = 3) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ValueError(f"{field} must be a list of strings")
    return [item[:300] for item in value[:limit]]


def _normalize_feedback(
    data: Any, items: list[dict[str, str]],
) -> dict[str, Any]:
    """Validate provider JSON without truthiness/type coercion."""
    if not isinstance(data, dict) or not isinstance(data.get("results"), list):
        raise ValueError("provider results must be a list")

    raw_results = data["results"]
    if any(not isinstance(row, dict) for row in raw_results):
        raise ValueError("each provider result must be an object")
    item_ids = [row.get("item_id") for row in raw_results]
    expected = [item["item_id"] for item in items]
    if len(item_ids) != len(set(item_ids)) or set(item_ids) != set(expected):
        raise ValueError("provider result IDs do not match request")
    by_id = {row["item_id"]: row for row in raw_results}

    results = []
    for item_id in expected:
        row = by_id[item_id]
        corrected = row.get("corrected")
        if not isinstance(corrected, str) or not corrected.strip():
            raise ValueError(f"missing corrected value for {item_id}")
        grammar_notes = _bounded_strings(
            row.get("grammar_notes"), field=f"{item_id}.grammar_notes",
        )
        style_note = row.get("style_note")
        target_usage_note = row.get("target_usage_note")
        ok = row.get("ok")
        if not isinstance(style_note, str) or not isinstance(target_usage_note, str):
            raise ValueError(f"{item_id} notes must be strings")
        if not isinstance(ok, bool):
            raise ValueError(f"{item_id}.ok must be a boolean")
        results.append({
            "item_id": item_id,
            "corrected": corrected.strip()[:MAX_ANSWER_CHARS],
            "grammar_notes": grammar_notes,
            "style_note": style_note[:500],
            "target_usage_note": target_usage_note[:500],
            "ok": ok,
        })

    overall = data.get("overall", {})
    if not isinstance(overall, dict):
        raise ValueError("overall must be an object")
    return {
        "results": results,
        "overall": {
            "strengths": _bounded_strings(
                overall.get("strengths", []), field="overall.strengths",
            ),
            "focus": _bounded_strings(
                overall.get("focus", []), field="overall.focus",
            ),
        },
    }


async def grade_rewrites(
    items: list[dict[str, str]], *, user_id: str | None = None,
) -> tuple[dict[str, Any], str | None, str | None]:
    """Make exactly one provider request for the complete unit."""
    try:
        name, model = _model()
    except Exception as exc:  # noqa: BLE001
        logger.exception("[advanced-vocab-rewrite] cannot create model: %s", exc)
        return _failed(items, "Bộ chấm chưa sẵn sàng; bài của bạn vẫn được lưu."), None, "model_config"

    payload = [{
        "item_id": item["item_id"],
        "prompt": item["prompt"][:500],
        "answer": item["answer"][:MAX_ANSWER_CHARS],
    } for item in items]
    try:
        response = await asyncio.wait_for(
            model.generate_content_async(
                _PROMPT + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
            ),
            timeout=_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        ai_usage_logger.schedule_usage_log(ai_usage_logger.log_unpriced_usage_async(
            service="gemini", model=name, user_id=user_id,
            feature="advanced_vocab_rewrite", operation="grade_unit",
            status="error", error_code="timeout", metadata={"item_count": len(items)},
        ))
        return _failed(items, "Bộ chấm không phản hồi kịp; bài của bạn vẫn được lưu."), name, "timeout"
    except Exception as exc:  # noqa: BLE001
        logger.exception("[advanced-vocab-rewrite] provider failed: %s", exc)
        ai_usage_logger.schedule_usage_log(ai_usage_logger.log_unpriced_usage_async(
            service="gemini", model=name, user_id=user_id,
            feature="advanced_vocab_rewrite", operation="grade_unit",
            status="error", error_code=type(exc).__name__, metadata={"item_count": len(items)},
        ))
        return _failed(items, "Bộ chấm tạm thời không dùng được; bài của bạn vẫn được lưu."), name, "provider"

    try:
        data = json.loads(_strip_fences(response.text))
        feedback = _normalize_feedback(data, items)
    except Exception as exc:  # noqa: BLE001
        logger.error("[advanced-vocab-rewrite] invalid response: %s", exc)
        ai_usage_logger.schedule_usage_log(ai_usage_logger.log_gemini_response_async(
            response, model=name, user_id=user_id,
            feature="advanced_vocab_rewrite", operation="grade_unit",
            status="invalid_response", error_code="invalid_json",
            metadata={"item_count": len(items)},
        ))
        return _failed(items, "Bộ chấm trả về kết quả không đọc được; bài của bạn vẫn được lưu."), name, "invalid_response"

    ai_usage_logger.schedule_usage_log(ai_usage_logger.log_gemini_response_async(
        response, model=name, user_id=user_id,
        feature="advanced_vocab_rewrite", operation="grade_unit",
        status="success", metadata={"item_count": len(items)},
    ))
    return feedback, name, None

"""services/quiz_import.py — Quick-Check quiz bank importer (Pha 1).

Mirrors services/vocab_import.py: a .md bank file = a META block (kind: quiz)
followed by N exercise blocks (one question each), all standard
``---\\n<yaml>\\n---`` documents. We reuse split_word_blocks (the same
YAML-dict-aware fence splitter) so the parser contract matches the spec exactly.

Pipeline: split → parse META + questions → validate (independently; one bad
block never aborts the rest) → commit ALL-OR-NOTHING, upsert by (skill_area,
code): an existing bank's questions are replaced wholesale. `{{audio}}` in a
prompt is resolved at commit to the matching vocab card's audio_headword
(headword == item_key, within the bank's topic). Write path is service-role.
"""

from __future__ import annotations

import logging
from typing import Optional

from database import supabase_admin
from services.content_import_service import _split_frontmatter, FrontmatterError
from services.vocab_import import split_word_blocks

logger = logging.getLogger(__name__)

# META keys copied verbatim into quiz_banks.meta (the frontend reads them to run
# Adaptive Mastery). Anything else in the META block is ignored.
_META_KEYS = (
    "mode", "grading",
    "correct_to_master", "require_distinct_skill", "require_production_to_master",
    "confirm_by_reversal", "provisional_on_single_mcq", "reset_provisional_on_confirm_fail",
    "retention_recheck", "recheck_sample",
    "rotate_on", "rotate_variant_on_wrong", "cooldown", "max_attempts_per_word",
    "target_session_min", "soft_cap_min", "avg_sec_per_item", "carry_over_unmastered",
    "log_per_question", "log_per_word", "log_accuracy", "shuffle_options",
)

# Question types / inputs / skills accepted (spec §1). Validation flags unknowns.
_VALID_TYPES = (
    "mcq", "gap_mcq", "gap_text", "spelling", "missing_letters",
    "stress", "syllable_count", "boolean", "match",
)
_VALID_INPUTS = ("choice", "text", "boolean", "syllable", "match")

# Question text columns copied straight from the frontmatter (same key name).
# qid (← frontmatter `id`) and item_key (← `headword`) are mapped explicitly.
_Q_SCALARS = ("type", "subtype", "input", "skill", "pair",
              "prompt", "mask", "explain", "grammar_article_slug")


def parse_quiz_meta(fm: dict) -> dict:
    """META frontmatter → {code, title, skill_area, source, words_count, meta}."""
    code = str(fm.get("code") or "").strip()
    skill_area = str(fm.get("skill_area") or "vocab").strip() or "vocab"
    meta = {k: fm[k] for k in _META_KEYS if k in fm}
    words_count = fm.get("words_count")
    try:
        words_count = int(words_count) if words_count is not None else 0
    except (TypeError, ValueError):
        words_count = 0
    return {
        "code": code,
        "title": (str(fm.get("title")).strip() if fm.get("title") else None),
        "skill_area": skill_area,
        "source": (str(fm.get("source")).strip() if fm.get("source") else None),
        "words_count": words_count,
        "meta": meta,
    }


def parse_quiz_question(fm: dict) -> dict:
    """One exercise block's frontmatter → a quiz_questions payload (no bank_id /
    audio_url / order yet — added at commit)."""
    q: dict = {}
    for k in _Q_SCALARS:
        v = fm.get(k)
        q[k] = (str(v) if v is not None else None)
    q["qid"] = str(fm.get("id") or "").strip()                       # frontmatter `id`
    # item_key defaults to headword (spec gom pool theo headword).
    q["item_key"] = str(fm.get("item_key") or fm.get("headword") or "").strip()
    q["counts_toward_mastery"] = bool(fm.get("counts_toward_mastery", True))
    q["points"] = _coerce_int(fm.get("points"), default=1)
    q["answer"] = _coerce_int(fm.get("answer"), default=None)
    for list_field in ("options", "accept", "segments", "pairs"):
        val = fm.get(list_field)
        q[list_field] = val if isinstance(val, list) else None
    return q


def _coerce_int(v, *, default):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def validate_question(q: dict) -> list[dict]:
    """Per-question structural validation by input type. [{field,message}]."""
    errors: list[dict] = []

    def err(f, m):
        errors.append({"field": f, "message": m})

    if not q.get("qid"):
        err("id", "Bắt buộc.")
    if not q.get("item_key"):
        err("headword", "Bắt buộc (gom pool theo từ).")
    if not q.get("prompt"):
        err("prompt", "Bắt buộc.")

    qtype = q.get("type")
    qinput = q.get("input")
    if qtype not in _VALID_TYPES:
        err("type", f"Không hợp lệ: {qtype!r}.")
    if qinput not in _VALID_INPUTS:
        err("input", f"Không hợp lệ: {qinput!r}.")
    if not q.get("skill"):
        err("skill", "Bắt buộc.")

    # Per-input required fields (spec §2).
    if qinput == "choice":
        opts = q.get("options")
        if not isinstance(opts, list) or len(opts) < 2:
            err("options", "Cần ≥2 phương án.")
        if not isinstance(q.get("answer"), int):
            err("answer", "Cần chỉ số đáp án (0-based).")
        elif isinstance(opts, list) and not (0 <= q["answer"] < len(opts)):
            err("answer", "Chỉ số đáp án ngoài phạm vi options.")
    elif qinput == "text":
        acc = q.get("accept")
        if not isinstance(acc, list) or not acc:
            err("accept", "Cần danh sách đáp án chấp nhận.")
    elif qinput == "boolean":
        # answer stored as the bool; parse_quiz_question put it in 'answer' only if int.
        # boolean answer comes through raw_frontmatter — handled in caller (see below).
        if q.get("_bool_answer") is None:
            err("answer", "Cần answer true/false.")
    elif qinput == "syllable":
        seg = q.get("segments")
        if not isinstance(seg, list) or not seg:
            err("segments", "Cần segments (các âm tiết).")
        if not isinstance(q.get("answer"), int):
            err("answer", "Cần chỉ số âm nhấn (0-based).")
    elif qinput == "match":
        if not isinstance(q.get("pairs"), list) or not q.get("pairs"):
            err("pairs", "Cần danh sách cặp nối.")
    return errors


def _is_meta_block(fm: dict) -> bool:
    return str(fm.get("kind") or "").strip().lower() == "quiz"


def _resolve_audio_map(topic_id: Optional[str]) -> dict:
    """headword.lower() → audio_headword for the topic's vocab cards, so {{audio}}
    in a prompt can reuse the existing vocab-audio pipeline. Empty on no topic /
    read failure (player just hides the button)."""
    if not topic_id:
        return {}
    try:
        rows = (
            supabase_admin.table("vocab_cards")
            .select("headword, audio_headword")
            .eq("topic_id", topic_id)
            .execute()
        ).data or []
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] audio map read failed: %s", exc)
        return {}
    return {
        str(r["headword"]).strip().lower(): r.get("audio_headword")
        for r in rows if r.get("headword") and r.get("audio_headword")
    }


def import_quiz_file(
    text: str, *, topic_id: Optional[str] = None, dry_run: bool = True,
    import_batch_id: Optional[str] = None,
) -> dict:
    """Parse + validate + (commit) a quiz bank file.

    Returns {dry_run, meta, questions:[{index, qid, item_key, type, skill,
    validation_errors}], validation_errors:[{block, qid, field, message}],
    summary:{words, questions, errors, pools}, committed_bank_id}.
    Commit is all-or-nothing (any block error → nothing written)."""
    chunks = split_word_blocks(text)

    meta_info: Optional[dict] = None
    meta_errors: list[dict] = []
    q_entries: list[dict] = []   # each: {index, qid, item_key, payload, _bool_answer, validation_errors}

    for idx, chunk in enumerate(chunks):
        try:
            fm, _body = _split_frontmatter(chunk)
        except FrontmatterError as exc:
            q_entries.append({"index": idx, "qid": "", "item_key": "",
                              "validation_errors": [{"field": "frontmatter", "message": str(exc)}]})
            continue

        if _is_meta_block(fm):
            meta_info = parse_quiz_meta(fm)
            if not meta_info["code"]:
                meta_errors.append({"field": "code", "message": "META thiếu 'code'."})
            continue

        if "type" not in fm:
            # Not META, not a question (stray block) → flag.
            q_entries.append({"index": idx, "qid": str(fm.get("id") or ""), "item_key": "",
                              "validation_errors": [{"field": "block",
                                                     "message": "Block không có 'type' và không phải META."}]})
            continue

        payload = parse_quiz_question(fm)
        # boolean answer is a real bool in YAML — keep it separately (answer col is int).
        bool_answer = fm.get("answer") if isinstance(fm.get("answer"), bool) else None
        payload["_bool_answer"] = bool_answer
        verrs = validate_question(payload)
        q_entries.append({
            "index": idx, "qid": payload.get("qid") or "", "item_key": payload.get("item_key") or "",
            "payload": payload, "_bool_answer": bool_answer, "validation_errors": verrs,
        })

    if meta_info is None:
        meta_errors.append({"field": "meta", "message": "Thiếu block META (kind: quiz)."})

    # Duplicate qid within the file.
    seen: dict[str, list[int]] = {}
    for e in q_entries:
        if e.get("qid"):
            seen.setdefault(e["qid"], []).append(e["index"])
    for e in q_entries:
        if e.get("qid") and len(seen.get(e["qid"], [])) > 1:
            e["validation_errors"].append({"field": "id", "message": f"Trùng id '{e['qid']}'."})

    pools = sorted({e["item_key"] for e in q_entries if e.get("item_key")})

    # A commit MUST target a topic (FK + per-topic uniqueness). dry-run may omit it.
    if not dry_run and not topic_id:
        meta_errors.append({"field": "topic_id", "message": "Chọn topic trước khi lưu."})

    has_errors = bool(meta_errors) or any(e["validation_errors"] for e in q_entries)

    committed_bank_id: Optional[str] = None
    if not dry_run and not has_errors and meta_info is not None:
        committed_bank_id = _commit_bank(
            meta_info, q_entries, topic_id=topic_id,
            pools=pools, import_batch_id=import_batch_id,
        )

    flat_errors = [{"block": -1, "qid": "", **e} for e in meta_errors] + [
        {"block": e["index"], "qid": e.get("qid", ""), "field": ve["field"], "message": ve["message"]}
        for e in q_entries for ve in e["validation_errors"]
    ]
    pub_questions = [
        {"index": e["index"], "qid": e.get("qid", ""), "item_key": e.get("item_key", ""),
         "type": (e.get("payload") or {}).get("type"), "skill": (e.get("payload") or {}).get("skill"),
         "validation_errors": e["validation_errors"]}
        for e in q_entries
    ]
    return {
        "dry_run": dry_run,
        "meta": meta_info,
        "questions": pub_questions,
        "validation_errors": flat_errors,
        "summary": {
            "words": (meta_info or {}).get("words_count", 0),
            "questions": len(q_entries),
            "errors": len(flat_errors),
            "pools": len(pools),
        },
        "committed_bank_id": committed_bank_id,
    }


def _commit_bank(meta_info, q_entries, *, topic_id, pools, import_batch_id) -> str:
    """Upsert the bank by (skill_area, topic_id, code) and replace its questions.

    Questions are replaced UPSERT-then-PRUNE (never delete-then-insert): the new
    rows are upserted on (bank_id, qid) first, then only the stale qids are
    deleted. So a failed write can never leave a published bank with zero
    questions (the all-or-nothing contract) — the old set survives until the new
    set is in place. Resolves {{audio}} from the topic's vocab cards. Service-role."""
    skill_area = meta_info["skill_area"]
    code = meta_info["code"]
    audio_map = _resolve_audio_map(topic_id)

    bank_payload = {
        "topic_id": topic_id,
        "code": code,
        "title": meta_info["title"],
        "skill_area": skill_area,
        "meta": meta_info["meta"],
        "words_count": meta_info["words_count"] or len(pools),
        "source": meta_info["source"],
        "import_batch_id": import_batch_id,
    }

    # Lookup scoped by topic too — same code under a different topic is a DIFFERENT
    # bank (matches the UNIQUE(skill_area, topic_id, code) constraint).
    existing = (
        supabase_admin.table("quiz_banks").select("id")
        .eq("skill_area", skill_area).eq("topic_id", topic_id).eq("code", code)
        .limit(1).execute()
    ).data
    if existing:
        bank_id = existing[0]["id"]
        created_new = False
        supabase_admin.table("quiz_banks").update(bank_payload).eq("id", bank_id).execute()
    else:
        res = supabase_admin.table("quiz_banks").insert(bank_payload).execute()
        bank_id = res.data[0]["id"]
        created_new = True

    rows = []
    for order, e in enumerate(q_entries):
        p = e["payload"]
        audio_url = None
        if "{{audio}}" in (p.get("prompt") or ""):
            audio_url = audio_map.get((p.get("item_key") or "").strip().lower())
        rows.append({
            "bank_id": bank_id,
            "qid": p["qid"], "item_key": p["item_key"], "type": p["type"],
            "subtype": p.get("subtype"), "input": p["input"], "skill": p["skill"],
            "pair": p.get("pair"),
            "counts_toward_mastery": p["counts_toward_mastery"],
            "prompt": p["prompt"], "options": p.get("options"),
            # boolean answer persists in the int `answer` col as 1/0; choice/syllable as the index.
            "answer": (1 if e["_bool_answer"] else 0) if e["_bool_answer"] is not None else p.get("answer"),
            "accept": p.get("accept"), "segments": p.get("segments"),
            "mask": p.get("mask"), "pairs": p.get("pairs"),
            "explain": p.get("explain"), "points": p["points"],
            "audio_url": audio_url, "grammar_article_slug": p.get("grammar_article_slug"),
            "order": order,
        })

    # Question writes. No DB transaction across PostgREST calls, so on failure we
    # roll back a NEWLY-CREATED bank (don't leave a published bank with no
    # questions — the all-or-nothing contract). An EXISTING bank keeps its prior
    # questions: upsert-then-prune never deletes before the new set is in place.
    try:
        if rows:
            # 1) upsert the new set (insert new qids, overwrite changed ones) — old
            #    rows still present, so the bank is never momentarily empty.
            supabase_admin.table("quiz_questions").upsert(
                rows, on_conflict="bank_id,qid"
            ).execute()
            # 2) prune qids that are no longer in the new set.
            new_qids = [r["qid"] for r in rows]
            (
                supabase_admin.table("quiz_questions").delete()
                .eq("bank_id", bank_id).not_.in_("qid", new_qids).execute()
            )
        else:
            # Bank with no questions → clear any leftovers.
            supabase_admin.table("quiz_questions").delete().eq("bank_id", bank_id).execute()
    except Exception:
        if created_new:
            try:
                supabase_admin.table("quiz_banks").delete().eq("id", bank_id).execute()
            except Exception as cleanup_exc:  # noqa: BLE001
                logger.error("[quiz] rollback of orphan bank %s failed: %s", bank_id, cleanup_exc)
        raise
    return bank_id

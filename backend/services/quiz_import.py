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
    # Indexed answer (choice/syllable) — a YAML bool (answer: true/false) must NOT
    # silently become 1/0 (that would save a wrong index for a boolean typo); the
    # real boolean answer is captured separately as _bool_answer in import_quiz_file.
    q["answer"] = _index_answer(fm.get("answer"))
    for list_field in ("options", "accept", "segments", "pairs"):
        val = fm.get(list_field)
        q[list_field] = val if isinstance(val, list) else None
    return q


def _coerce_int(v, *, default):
    if isinstance(v, bool):          # bool is an int subclass — reject explicitly
        return default
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _index_answer(v):
    """Parse a 0-based index answer. Rejects YAML booleans (→ None) so a boolean
    typo on a choice/syllable question fails validation instead of saving 1/0."""
    if isinstance(v, bool):
        return None
    return _coerce_int(v, default=None)


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
        elif isinstance(seg, list) and not (0 <= q["answer"] < len(seg)):
            err("answer", "Chỉ số âm nhấn ngoài phạm vi segments.")
    elif qinput == "match":
        if not isinstance(q.get("pairs"), list) or not q.get("pairs"):
            err("pairs", "Cần danh sách cặp nối.")
    return errors


# Inputs the player can actually RENDER + GRADE (mirrors SUPPORTED_INPUTS in
# quiz-engine.js). A question the engine never serves (e.g. input:match) can't
# contribute to mastery, so it doesn't count toward a pool being masterable.
_ENGINE_SUPPORTED_INPUTS = ("choice", "text", "boolean", "syllable")


def validate_pool_mastery_contract(meta: dict, q_entries: list[dict]) -> list[dict]:
    """Per-pool (item_key) check that every word CAN reach 'mastered' under THIS
    bank's META — using the exact flags quiz-engine.js reads. Without this a
    well-formed-but-un-masterable word (e.g. a lone MCQ pool under the default
    require_production_to_master) commits silently and then burns max_attempts every
    session, carried-over forever. Fail-loud instead. Returns [{field,message}].

    A pool must, given META (one precise reason is reported per un-masterable pool):
      • have ≥1 ENGINE-servable question (else it's never asked at all);
      • if require_production_to_master (default True): have ≥1 input:text question
        that counts toward mastery (production confirms + flips production_done);
      • be CREDITABLE at all — with provisional_on_single_mcq + confirm_by_reversal
        (both default True), a lone recognition credit needs a DIFFERENT skill or a
        production to confirm, so a no-production single-skill pool never earns a
        credit in EITHER mastery mode (distinct OR count) → carry-over forever;
      • if require_distinct_skill (default True): have ≥ correct_to_master DISTINCT
        mastery-counting skills.
    Only VALID questions (no per-question errors) are considered — an errored bank
    already fails to commit; this adds the precise reason a word can't be mastered."""
    meta = meta or {}
    require_prod = meta.get("require_production_to_master", True) is not False
    require_distinct = meta.get("require_distinct_skill", True) is not False
    provisional_mcq = meta.get("provisional_on_single_mcq", True) is not False
    confirm_reversal = meta.get("confirm_by_reversal", True) is not False
    ctm = _coerce_int(meta.get("correct_to_master"), default=2) or 2

    by_pool: dict[str, list[dict]] = {}
    for e in q_entries:
        p = e.get("payload")
        if not p or e.get("validation_errors"):
            continue
        key = p.get("item_key")
        if key:
            by_pool.setdefault(key, []).append(p)

    errors: list[dict] = []

    def flag(key, message):
        errors.append({"field": f"pool:{key}", "message": f"Từ '{key}': {message}"})

    for key in sorted(by_pool):
        supported = [q for q in by_pool[key] if q.get("input") in _ENGINE_SUPPORTED_INPUTS]
        if not supported:
            flag(key, "không có câu hỏi khả dụng (chỉ input không được hỗ trợ) — sẽ không bao giờ được hỏi.")
            continue
        counting = [q for q in supported if q.get("counts_toward_mastery") is not False]
        if not counting:
            flag(key, "không có câu nào tính mastery (counts_toward_mastery) → không thể 'thuộc'.")
            continue

        has_prod = any(q.get("input") == "text" for q in counting)
        distinct = sorted({q.get("skill") for q in counting if q.get("skill")})

        if require_prod and not has_prod:
            flag(key, "thiếu ≥1 câu production (input:text tính mastery) → không thể 'thuộc' "
                      "(require_production_to_master).")
            continue

        # Creditability applies in BOTH mastery modes: an MCQ-only, single-skill pool
        # under the default provisional/reversal flow never confirms → 0 credits ever.
        if provisional_mcq and confirm_reversal and not has_prod and len(distinct) < 2:
            flag(key, "provisional_on_single_mcq + confirm_by_reversal đang bật nhưng không có câu "
                      "production và chỉ 1 skill → MCQ lẻ không bao giờ ghi điểm. Thêm câu "
                      "production/skill thứ 2, hoặc đặt provisional_on_single_mcq: false.")
            continue

        if require_distinct and len(distinct) < ctm:
            flag(key, f"cần ≥{ctm} skill khác nhau tính mastery, mới có {len(distinct)} ({distinct}).")
    return errors


def _is_meta_block(fm: dict) -> bool:
    return str(fm.get("kind") or "").strip().lower() == "quiz"


def _grammar_slug_exists(slug: str) -> bool:
    """True if `slug` resolves to a live Grammar Wiki article (grammar_service is
    file-backed, loaded in-process). Fail-OPEN on a loader error so a transient
    issue doesn't block imports; a genuinely missing slug returns False → the
    import surfaces it as a validation error (no stale exercise→article links)."""
    try:
        from services.grammar_content import grammar_service
        return slug in grammar_service.articles_by_slug
    except Exception:  # noqa: BLE001
        return True


def _topic_skill_area(topic_id: Optional[str]) -> Optional[str]:
    """The selected topic's skill_area (authoritative). None on missing/blank or
    read failure (the caller then skips the cross-check rather than 500)."""
    if not topic_id:
        return None
    try:
        rows = (
            supabase_admin.table("content_topics").select("skill_area")
            .eq("id", topic_id).limit(1).execute()
        ).data
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quiz] topic skill_area read failed: %s", exc)
        return None
    return rows[0]["skill_area"] if rows else None


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

    # Grammar exercises link to a Wiki article — reject a slug that doesn't resolve
    # (no stale exercise→article links). Applies to any question that sets one.
    for e in q_entries:
        p = e.get("payload")
        slug = p.get("grammar_article_slug") if p else None
        if slug and not _grammar_slug_exists(slug):
            e["validation_errors"].append({
                "field": "grammar_article_slug",
                "message": f"Bài Wiki không tồn tại: '{slug}'.",
            })

    # An empty bank (only META / truncated file) must NOT commit — for an existing
    # bank that would wipe every question and leave it published-but-empty.
    if not q_entries:
        meta_errors.append({"field": "questions", "message": "Bank không có câu hỏi nào."})

    # Duplicate qid within the file.
    seen: dict[str, list[int]] = {}
    for e in q_entries:
        if e.get("qid"):
            seen.setdefault(e["qid"], []).append(e["index"])
    for e in q_entries:
        if e.get("qid") and len(seen.get(e["qid"], [])) > 1:
            e["validation_errors"].append({"field": "id", "message": f"Trùng id '{e['qid']}'."})

    pools = sorted({e["item_key"] for e in q_entries if e.get("item_key")})

    # Mastery-contract gate: every pool must be able to reach 'mastered' under this
    # bank's META (same flags the engine reads) — else a word is asked forever and
    # carried-over every session. Skip when META is missing (already flagged above).
    if meta_info is not None:
        meta_errors.extend(validate_pool_mastery_contract(meta_info["meta"], q_entries))

    # A commit MUST target a topic (FK + per-topic uniqueness). dry-run may omit it.
    if not dry_run and not topic_id:
        meta_errors.append({"field": "topic_id", "message": "Chọn topic trước khi lưu."})

    # The bank's skill_area must match the SELECTED topic's — otherwise a file
    # with skill_area: grammar (or a typo) would commit under a vocab topic and
    # then vanish from the vocab bank list. The topic is authoritative.
    if not dry_run and topic_id and meta_info is not None:
        topic_skill = _topic_skill_area(topic_id)
        if topic_skill and meta_info["skill_area"] != topic_skill:
            meta_errors.append({
                "field": "skill_area",
                "message": f"skill_area '{meta_info['skill_area']}' không khớp topic "
                           f"('{topic_skill}'). Sửa META hoặc chọn đúng topic.",
            })

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
    """Upsert the bank by (skill_area, topic_id, code) and replace its questions
    ATOMICALLY via the quiz_replace_questions RPC (delete-all + insert-all run in
    ONE transaction — no empty-bank window, no new/stale mix on a partial failure).
    For a NEW bank a failed replace rolls the bank row back; for an EXISTING bank
    the metadata UPDATE runs only AFTER the replace succeeds, so a failure leaves
    the old bank fully intact. Resolves {{audio}} from the topic's vocab cards."""
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
    else:
        res = supabase_admin.table("quiz_banks").insert(bank_payload).execute()
        bank_id = res.data[0]["id"]
        created_new = True

    # rows for the RPC — NO bank_id (the function supplies p_bank_id).
    rows = []
    for o, e in enumerate(q_entries):
        p = e["payload"]
        audio_url = None
        if "{{audio}}" in (p.get("prompt") or ""):
            audio_url = audio_map.get((p.get("item_key") or "").strip().lower())
        rows.append({
            "qid": p["qid"], "item_key": p["item_key"], "type": p["type"],
            "subtype": p.get("subtype"), "input": p["input"], "skill": p["skill"],
            "pair": p.get("pair"), "counts_toward_mastery": p["counts_toward_mastery"],
            "prompt": p["prompt"], "options": p.get("options"),
            # boolean answer persists in the int `answer` col as 1/0; choice/syllable as the index.
            "answer": (1 if e["_bool_answer"] else 0) if e["_bool_answer"] is not None else p.get("answer"),
            "accept": p.get("accept"), "segments": p.get("segments"),
            "mask": p.get("mask"), "pairs": p.get("pairs"),
            "explain": p.get("explain"), "points": p["points"],
            "audio_url": audio_url, "grammar_article_slug": p.get("grammar_article_slug"),
            "order": o,
        })

    try:
        supabase_admin.rpc(
            "quiz_replace_questions", {"p_bank_id": bank_id, "p_rows": rows}
        ).execute()
    except Exception:
        if created_new:                     # roll back the orphan bank row
            try:
                supabase_admin.table("quiz_banks").delete().eq("id", bank_id).execute()
            except Exception as cleanup_exc:  # noqa: BLE001
                logger.error("[quiz] rollback of orphan bank %s failed: %s", bank_id, cleanup_exc)
        raise

    # Existing bank: apply new metadata only NOW (questions already replaced), so a
    # failed replace above never leaves stale-questions + new-metadata.
    if not created_new:
        supabase_admin.table("quiz_banks").update(bank_payload).eq("id", bank_id).execute()
    return bank_id

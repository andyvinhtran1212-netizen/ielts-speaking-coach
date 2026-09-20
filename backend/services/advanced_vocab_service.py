"""Assignment-only runtime for the 30 Advanced Vocabulary core lessons.

Lesson JSON stays server-side; this module projects a learner-safe view and
keeps every answer key behind a graded POST. Writing and Speaking are
reference/practice material and never produce a submission or score here.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from services.advanced_vocab_package_validator import (
    _option_identity,
    lesson_content_checksum,
)


_CONTENT_ROOT = Path(__file__).resolve().parent.parent / "content" / "advanced_vocab"
_PUBLIC_ROOT = "/assets/advanced-vocab"
_STAGES = ("vocabulary", "practice_1", "practice_2", "controlled_rewrite")
_REQUIRED_STAGES = (
    "vocabulary", "practice_1", "practice_2", "reading",
    "controlled_rewrite", "listening",
)
_PRACTICE_COUNTS = {"practice_1": 28, "practice_2": 20}
_READING_PUBLIC_FIELDS = {
    "module", "solutions_visibility", "target_band", "test_id", "title",
}
_READING_PASSAGE_FIELDS = {"paragraph", "passage_number", "text", "title"}
_CONTROLLED_REWRITE_PUBLIC_FIELDS = {
    "activity_id", "activity_type", "completion_policy", "grading_policy",
    "interaction_policy", "reveal_policy", "submittable",
}
_PAGE = 1000
_ID_CHUNK = 200
_MAX_REWRITE_ANSWER_CHARS = 600
_REWRITE_PROCESSING_TIMEOUT = timedelta(minutes=5)


def _admin():
    """Load the database client only when a runtime operation needs it.

    Content validation and import dry-runs intentionally work without backend
    environment variables, so importing this module must stay side-effect free.
    """
    from database import supabase_admin

    return supabase_admin


def _assignment_finder(*, review: bool):
    """Defer the quiz service (and its database client) for offline tooling."""
    from services.quiz_service import _assignment_item_for, _assignment_item_for_review

    return _assignment_item_for_review if review else _assignment_item_for


def _paged(table: str, columns: str, apply_filters) -> list[dict]:
    rows: list[dict] = []
    start = 0
    while True:
        page = (apply_filters(_admin().table(table).select(columns))
                .order("id").range(start, start + _PAGE - 1).execute().data) or []
        rows.extend(page)
        if len(page) < _PAGE:
            return rows
        start += _PAGE


def _lesson_path(lesson_id: str, content_checksum: str | None = None) -> Path:
    if not re.fullmatch(r"ADV-T(?:0[1-9]|[12][0-9]|30)", lesson_id or ""):
        raise HTTPException(404, "Không tìm thấy bài học")
    if content_checksum is not None:
        if not re.fullmatch(r"[0-9a-f]{64}", content_checksum, re.IGNORECASE):
            raise HTTPException(409, "Phiên bản bài học không hợp lệ")
        return _CONTENT_ROOT / "versions" / lesson_id / f"{content_checksum}.json"
    return _CONTENT_ROOT / f"{lesson_id}.json"


def load_lesson(lesson_id: str, content_checksum: str | None = None) -> dict:
    path = _lesson_path(lesson_id, content_checksum)
    if content_checksum is not None and not path.is_file():
        # Compatibility for assignments issued before versioned snapshots were
        # introduced. The checksum guard in _assigned_lesson still fails closed
        # if this canonical file no longer represents the frozen version.
        path = _lesson_path(lesson_id)
    if not path.is_file():
        raise HTTPException(404, "Bài học chưa được triển khai")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(500, "Không đọc được nội dung bài học") from exc


def _runtime(bank_id: str) -> tuple[dict, dict]:
    try:
        rows = (_admin().table("quiz_banks")
                .select("id,code,title,skill_area,meta")
                .eq("id", bank_id).limit(1).execute().data) or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, "Không đọc được cấu hình bài học") from exc
    if not rows:
        raise HTTPException(404, "Không tìm thấy bài học")
    bank = rows[0]
    runtime = (bank.get("meta") or {}).get("runtime") or {}
    if bank.get("skill_area") != "course" or runtime.get("kind") != "advanced_vocab":
        raise HTTPException(404, "Không tìm thấy bài học")
    return bank, runtime


def _owned_item(bank_id: str, user_id: str, item_id: str, *, review: bool = False) -> dict:
    finder = _assignment_finder(review=review)
    item = finder(bank_id, user_id, assignment_item_id=item_id)
    if not item or str(item.get("id")) != str(item_id):
        raise HTTPException(404, "Không tìm thấy bài giao còn hiệu lực")
    return item


def _assigned_lesson(*, bank_id: str, user_id: str, item_id: str,
                     review: bool = False) -> tuple[dict, dict, dict]:
    """Resolve content only from the immutable runtime snapshot issued to the learner."""
    item = _owned_item(bank_id, user_id, item_id, review=review)
    config = item.get("content_config") or {}
    frozen = (config.get("runtime") or {})
    lesson_id = str(frozen.get("lesson_id") or "")
    expected_checksum = str(frozen.get("content_checksum") or "")
    if frozen.get("kind") != "advanced_vocab" or not lesson_id or not expected_checksum:
        raise HTTPException(409, "Bài giao thiếu phiên bản nội dung Advanced Vocabulary")
    lesson = load_lesson(lesson_id, expected_checksum)
    declared_checksum = str(
        (lesson.get("provenance") or {}).get("content_checksum") or ""
    )
    actual_checksum = lesson_content_checksum(lesson)
    if declared_checksum != actual_checksum or actual_checksum != expected_checksum:
        raise HTTPException(409, "Phiên bản bài giao không khớp nội dung đã triển khai")
    # The assignment snapshot is the canonical identity after issuance.  A
    # later bank retirement/version switch must not orphan an existing learner
    # review, so no mutable quiz_banks read participates in content resolution.
    bank = {
        "id": bank_id,
        "code": config.get("bank_code"),
        "title": config.get("test_title") or lesson.get("title"),
    }
    return bank, item, lesson


def _choice(item: dict) -> bool:
    return item.get("input") in ("choice", "boolean", "syllable")


def _pick(candidates: list[dict], seed: str) -> dict:
    if not candidates:
        raise ValueError(f"Không có câu phù hợp cho {seed}")
    return min(
        candidates,
        key=lambda row: hashlib.sha256(
            f"{seed}:{row.get('item_id')}".encode("utf-8")
        ).hexdigest(),
    )


def practice_selection(lesson: dict) -> dict[str, list[dict]]:
    """Select one recognition and one production item for each of 24 words."""
    pool = (lesson.get("adaptive_quiz") or {}).get("items") or []
    selected: list[dict] = []
    for word in lesson.get("vocabulary") or []:
        lexeme = word.get("lexeme_id")
        rows = [row for row in pool if row.get("lexeme_id") == lexeme]
        selected.extend([
            _pick([row for row in rows if _choice(row)], f"{lesson['lesson_id']}:{lexeme}:r"),
            _pick(
                [row for row in rows
                 if not _choice(row) and row.get("input") != "match"],
                f"{lesson['lesson_id']}:{lexeme}:p",
            ),
        ])
    if len(selected) != 48 or len({row.get("item_id") for row in selected}) != 48:
        raise ValueError(
            f"Advanced Vocabulary {lesson.get('lesson_id')} cần đúng 48 câu practice duy nhất"
        )
    # ``selected`` is already recognition/production pairs per lexeme. Preserve
    # that alternating order when splitting the 28/20-question stages.
    stage_1 = selected[:28]
    stage_2 = selected[28:]
    return {"practice_1": stage_1, "practice_2": stage_2}


def build_quiz_rows(lesson: dict) -> list[dict]:
    rows: list[dict] = []
    selection = practice_selection(lesson)
    ordered = selection["practice_1"] + selection["practice_2"]
    for order, item in enumerate(ordered, 1):
        raw_answer = item.get("answer_index", item.get("answer"))
        answer = raw_answer if isinstance(raw_answer, int) and not isinstance(raw_answer, bool) else None
        accept = item.get("accept") if isinstance(item.get("accept"), list) else None
        if answer is None and not accept and raw_answer not in (None, ""):
            accept = raw_answer if isinstance(raw_answer, list) else [raw_answer]
        rows.append({
            "qid": item["item_id"],
            "item_key": item.get("lexeme_id") or item.get("headword") or item["item_id"],
            "type": item.get("type") or "mcq",
            "subtype": item.get("subtype"),
            "input": item.get("input") or ("choice" if item.get("options") else "text"),
            "skill": item.get("skill") or "vocabulary",
            "pair": item.get("pair"),
            "counts_toward_mastery": True,
            "prompt": item.get("prompt") or "",
            "hint": item.get("hint"),
            "options": item.get("options"),
            "answer": answer,
            "accept": accept,
            "segments": item.get("segments"),
            "mask": item.get("mask"),
            "pairs": item.get("pairs"),
            "explain": item.get("explain"),
            "why_wrong": item.get("why_wrong"),
            "points": int(item.get("points") or 1),
            "audio_url": None,
            "grammar_article_slug": None,
            "order": order,
        })
    return rows


def _asset_url(lesson_id: str, value: str | None,
               content_checksum: str | None = None) -> str | None:
    if not value:
        return None
    name = Path(value).name
    root = (
        f"{_PUBLIC_ROOT}/versions/{lesson_id}/{content_checksum}"
        if content_checksum else f"{_PUBLIC_ROOT}/{lesson_id}"
    )
    if "vocab-audio" in value:
        return f"{root}/vocab/{name}"
    if name == "full_test.mp3":
        return f"{root}/listening/full_test.mp3"
    if name.endswith((".svg", ".png")):
        return f"{root}/writing/{name}"
    return None


def _listening_figure_url(lesson_id: str, value: str | None,
                          content_checksum: str | None = None) -> str | None:
    if not value or not Path(value).name.lower().endswith((".svg", ".png")):
        return None
    root = (
        f"{_PUBLIC_ROOT}/versions/{lesson_id}/{content_checksum}"
        if content_checksum else f"{_PUBLIC_ROOT}/{lesson_id}"
    )
    return f"{root}/listening/{Path(value).name}"


def _activity(lesson: dict, activity_type: str) -> dict:
    return next((a for a in lesson.get("activities") or []
                 if isinstance(a, dict)
                 and a.get("activity_type") == activity_type), {})


_READING_EDITORIAL_HEADING = re.compile(
    r"^(?:master\s+answer\s+key|answer\s+key|vocabulary\s+profile|"
    r"quality\s+checks?|supplement\b|editorial\b)",
    flags=re.IGNORECASE,
)


def _safe_reading_material(value: object) -> list[str]:
    """Expose only the authored exercise material before editorial appendices."""
    safe: list[str] = []
    for row in value if isinstance(value, list) else []:
        if not isinstance(row, str):
            continue
        text = row
        if _READING_EDITORIAL_HEADING.match(text.strip()):
            break
        safe.append(text)
    return safe


def controlled_rewrite_parts(lesson: dict) -> dict:
    activity = _activity(lesson, "controlled_rewrite")
    content = activity.get("content") or {}
    prompt_blocks = list(content.get("prompts") or [])
    solution_blocks = list(content.get("solutions") or [])
    if not prompt_blocks:
        # Compatibility for frozen assignments created from the original
        # converter, where both halves lived in one solutions array.
        markers = [
            index for index, block in enumerate(solution_blocks)
            if re.match(r"^phần\s+a(?:\b|\s|:|—|-)",
                        str(block.get("text") or "").strip(), flags=re.IGNORECASE)
        ]
        if len(markers) < 2:
            raise HTTPException(500, "Không tách được đề và đáp án controlled rewrite")
        prompt_blocks, solution_blocks = (
            solution_blocks[:markers[1]], solution_blocks[markers[1]:]
        )
    prompt_texts = [
        text for block in prompt_blocks
        if (text := str(block.get("text") or "").strip())
        if re.match(r"^\d+\.\s+", text)
    ]
    prompts = [
        {"item_id": f"rewrite-{index:02d}", "prompt": text}
        for index, text in enumerate(prompt_texts, 1)
    ]
    if len(prompts) != 20:
        raise HTTPException(
            500,
            f"{lesson.get('lesson_id')}: controlled rewrite cần đúng 20 câu",
        )
    public_activity = {
            key: activity.get(key)
            for key in _CONTROLLED_REWRITE_PUBLIC_FIELDS if key in activity
        }
    # Runtime policy supersedes the historical authored self-check metadata.
    public_activity["grading_policy"] = "ai_feedback_once"
    public_activity["submittable"] = True
    return {
        "activity": public_activity,
        "prompts": prompts,
        "solutions": solution_blocks,
    }


def _safe_question(item: dict, *, answered: bool = False,
                   audio_url: str | None = None) -> dict:
    public_fields = {
        "headword", "hint", "input", "item_id", "lexeme_id", "options",
        "prompt", "segments", "skill", "subtype", "type", "question_type",
    }
    safe = {key: item.get(key) for key in public_fields if key in item}
    if "options" in safe:
        safe["options"] = [
            ({key: option.get(key) for key in ("key", "letter", "text") if key in option}
             if isinstance(option, dict) else option)
            for option in safe.get("options") or []
        ]
    if "segments" in safe:
        segments = safe.get("segments")
        if isinstance(segments, list):
            safe["segments"] = [
                segment for segment in segments if isinstance(segment, str)
            ]
        else:
            safe.pop("segments", None)
    prompt = str(safe.get("prompt") or "")
    safe["prompt"] = prompt
    if "{{audio}}" in prompt:
        safe["prompt"] = prompt.replace("{{audio}}", "").strip()
        safe["audio_url"] = audio_url
    if answered:
        safe["locked"] = True
    return safe


def _safe_reading_question(question: dict) -> dict:
    """Expose only fields needed to answer, never source/correction provenance."""
    safe = {
        key: question.get(key)
        for key in ("question_number", "question_type", "stem")
    }
    safe["options"] = [
        {
            key: option.get(key)
            for key in ("key", "letter", "text") if key in option
        }
        for option in question.get("options") or [] if isinstance(option, dict)
    ]
    return safe


def _safe_reading_passage(passage: dict) -> dict:
    """Project passage copy only through the public Reading contract."""
    return {
        key: passage.get(key)
        for key in _READING_PASSAGE_FIELDS if key in passage
    }


def _safe_listening_question(question: dict) -> dict:
    """Project only learner-answerable Listening fields at every nesting level."""
    safe = {
        key: question.get(key)
        for key in ("question_number", "question_type", "stem")
    }
    safe["options"] = [
        {
            key: option.get(key)
            for key in ("key", "letter", "text") if key in option
        }
        for option in question.get("options") or [] if isinstance(option, dict)
    ]
    return safe


def _safe_listening_section(section: dict) -> dict:
    safe = {
        key: section.get(key)
        for key in (
            "audio_intro", "context", "figure", "register", "section_id",
            "section_number", "speakers",
        ) if key in section
    }
    safe["question_blocks"] = [
        {
            **{
                key: block.get(key)
                for key in ("block_id", "question_range", "render", "rubric")
                if key in block
            },
            "questions": [
                _safe_listening_question(question)
                for question in block.get("questions") or []
                if isinstance(question, dict)
            ],
        }
        for block in section.get("question_blocks") or [] if isinstance(block, dict)
    ]
    return safe


def _stage_rows(item_id: str) -> list[dict]:
    return (_admin().table("advanced_vocab_stage_progress")
            .select("stage,status,evidence,completed_at")
            .eq("class_assignment_item_id", item_id).execute().data) or []


def _attempt_rows(item_id: str) -> list[dict]:
    return (_admin().table("advanced_vocab_question_attempts")
            .select("stage,qid,answer_given,is_correct,response_time_ms,created_at")
            .eq("class_assignment_item_id", item_id).order("created_at").execute().data) or []


def _selection_rows(item_id: str) -> list[dict]:
    return (_admin().table("advanced_vocab_practice_selections")
            .select("stage,qids,created_at")
            .eq("class_assignment_item_id", item_id).execute().data) or []


def _selection_qids(item_id: str, stage: str) -> list[str] | None:
    rows = (_admin().table("advanced_vocab_practice_selections")
            .select("qids").eq("class_assignment_item_id", item_id)
            .eq("stage", stage).limit(1).execute().data) or []
    if not rows:
        return None
    qids = rows[0].get("qids")
    if not isinstance(qids, list) or not all(isinstance(qid, str) for qid in qids):
        raise HTTPException(500, "Bộ câu luyện tập đã lưu không hợp lệ")
    return qids


def _section_rows(item_id: str) -> list[dict]:
    return (_admin().table("course_section_submissions")
            .select("section,total,correct,score,duration_sec,submitted_at,"
                    "answers,answer_key,content_snapshot")
            .eq("class_assignment_item_id", item_id).execute().data) or []


def _listening_attempt(item_id: str) -> dict | None:
    rows = (_admin().table("advanced_vocab_listening_attempts").select("*")
            .eq("class_assignment_item_id", item_id).limit(1).execute().data) or []
    return rows[0] if rows else None


def _rewrite_submission_raw(item_id: str) -> dict | None:
    rows = (_admin().table("advanced_vocab_rewrite_submissions").select("*")
            .eq("class_assignment_item_id", item_id).limit(1).execute().data) or []
    return rows[0] if rows else None


def _expire_stale_rewrite_submission(row: dict | None) -> dict | None:
    """Terminate abandoned provider work without reclaiming its model call.

    A provider request has a 60-second application timeout. Five minutes gives
    an in-flight worker ample headroom while ensuring a process crash cannot
    leave the learner polling forever. The guarded update never reclaims the
    one-shot model call; it only records a terminal failure.
    """
    if not row or row.get("status") != "processing":
        return row
    started_value = row.get("provider_started_at") or row.get("created_at")
    try:
        started_at = datetime.fromisoformat(str(started_value).replace("Z", "+00:00"))
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return row
    cutoff = datetime.now(timezone.utc) - _REWRITE_PROCESSING_TIMEOUT
    if started_at > cutoff:
        return row
    now = datetime.now(timezone.utc).isoformat()
    saved = (_admin().table("advanced_vocab_rewrite_submissions")
             .update({
                 "status": "failed", "error_code": "worker_interrupted",
                 "completed_at": now, "updated_at": now,
             })
             .eq("id", row["id"]).eq("status", "processing")
             .lte("provider_started_at", cutoff.isoformat())
             .execute().data) or []
    # A live worker may have completed between the read and guarded update.
    return saved[0] if saved else _rewrite_submission_raw(
        str(row["class_assignment_item_id"]),
    )


def _rewrite_submission(item_id: str) -> dict | None:
    return _expire_stale_rewrite_submission(_rewrite_submission_raw(item_id))


def _safe_rewrite_submission(row: dict | None) -> dict | None:
    if not row:
        return None
    return {key: row.get(key) for key in (
        "answers", "feedback", "status", "model", "prompt_version",
        "error_code", "created_at", "completed_at",
    )}


def _progress(item_id: str) -> dict:
    stages = _stage_rows(item_id)
    selections = _selection_rows(item_id)
    attempts = _attempt_rows(item_id)
    sections = _section_rows(item_id)
    listening_attempt = _listening_attempt(item_id)
    rewrite_submission = _rewrite_submission(item_id)
    complete = {row["stage"] for row in stages if row.get("status") == "completed"}
    complete.update(row["section"] for row in sections)
    safe_sections = []
    for row in sections:
        initial_answers = row.get("answers") or {}
        answer_key = row.get("answer_key") or []
        snapshot = row.get("content_snapshot") or {}
        guided_retry = (snapshot.get("guided_retry") or {}
                        if isinstance(snapshot, dict) else {})
        final_answers = {**initial_answers, **(guided_retry.get("answers") or {})}
        review = {
            "answer_results": _answer_results(final_answers, answer_key),
            "answers": answer_key,
            "assignment": {"completed": True, "pct": None},
        }
        if guided_retry:
            review["initial_answer_results"] = _answer_results(
                initial_answers, answer_key,
            )
            review["guided_retry"] = guided_retry
        safe_sections.append({
            key: row.get(key) for key in (
                "section", "total", "correct", "score", "duration_sec",
                "submitted_at",
            )
        } | {"review": review})
    return {
        "completed_stages": sorted(complete),
        "stages": stages,
        "practice_selections": selections,
        "answers": [{
            "stage": row.get("stage"), "qid": row.get("qid"),
            "answer": row.get("answer_given"), "is_correct": row.get("is_correct"),
        } for row in attempts],
        # A section row exists only after that section's reveal boundary.  The
        # review is reconstructed solely from its frozen submission snapshot,
        # never from the current live lesson (which could have changed).
        "sections": safe_sections,
        "listening_submitted": listening_attempt is not None,
        "controlled_rewrite_submission": _safe_rewrite_submission(rewrite_submission),
        "required_completed": all(stage in complete for stage in _REQUIRED_STAGES),
    }


def _learner_practice_qids(
    *, practice_stage: str, authored_rows: list[dict], progress: dict,
) -> list[str] | None:
    """Resolve the immutable selection, reconstructing only legacy evidence.

    Migration 292 backfills persisted selections for legacy attempts.  This
    application fallback also keeps already-completed/read-only assignments
    reviewable if a historical row was missed.  An untouched stage remains
    hidden until `/practice/start` persists its selection.
    """
    persisted = next((
        row.get("qids")
        for row in progress.get("practice_selections") or []
        if row.get("stage") == practice_stage
    ), None)
    if persisted is None:
        has_evidence = (
            practice_stage in set(progress.get("completed_stages") or [])
            or any(
                row.get("stage") == practice_stage
                for row in progress.get("answers") or []
            )
        )
        if not has_evidence:
            return None
        persisted = [str(row.get("item_id")) for row in authored_rows]

    if (not isinstance(persisted, list)
            or not all(isinstance(qid, str) for qid in persisted)
            or len(persisted) != _PRACTICE_COUNTS[practice_stage]
            or len(set(persisted)) != len(persisted)):
        raise HTTPException(500, "Bộ câu luyện tập đã lưu không hợp lệ")
    return persisted


def learner_lesson(*, user_id: str, bank_id: str, item_id: str) -> dict:
    bank, item, lesson = _assigned_lesson(
        bank_id=bank_id, user_id=user_id, item_id=item_id, review=True,
    )
    progress = _progress(item_id)
    authored_selection = practice_selection(lesson)
    selected: dict[str, list[dict]] = {}
    for practice_stage, authored_rows in authored_selection.items():
        qids = _learner_practice_qids(
            practice_stage=practice_stage,
            authored_rows=authored_rows,
            progress=progress,
        )
        if qids is None:
            selected[practice_stage] = []
            continue
        by_id = {row.get("item_id"): row for row in authored_rows}
        try:
            selected[practice_stage] = [by_id[qid] for qid in qids]
        except KeyError as exc:
            raise HTTPException(
                409, "Bộ câu luyện tập không khớp phiên bản bài đã giao",
            ) from exc
    answered = {row["qid"] for row in progress["answers"]}
    content_checksum = str(
        (lesson.get("provenance") or {}).get("content_checksum") or ""
    ) or None

    vocabulary = []
    for word in lesson.get("vocabulary") or []:
        safe = dict(word)
        safe.pop("audio_provenance", None)
        safe["audio_headword"] = _asset_url(
            lesson["lesson_id"], word.get("audio_headword"), content_checksum,
        )
        safe["audio_example"] = _asset_url(
            lesson["lesson_id"], word.get("audio_example"), content_checksum,
        )
        vocabulary.append(safe)

    activities: dict[str, Any] = {}
    authored_reading = _activity(lesson, "reading_lab").get("content") or {}
    reading = {
        key: authored_reading.get(key)
        for key in _READING_PUBLIC_FIELDS if key in authored_reading
    }
    reading["passages"] = [
        _safe_reading_passage(passage)
        for passage in authored_reading.get("passages") or []
        if isinstance(passage, dict)
    ]
    reading["question_material"] = _safe_reading_material(
        authored_reading.get("question_material")
    )
    reading["questions"] = [
        _safe_reading_question(question)
        for question in authored_reading.get("questions") or []
        if isinstance(question, dict)
    ]
    activities["reading"] = reading
    rewrite = controlled_rewrite_parts(lesson)
    rewrite_completed = "controlled_rewrite" in set(progress["completed_stages"])
    activities["controlled_rewrite"] = {
        **rewrite["activity"],
        "content": {
            "prompts": rewrite["prompts"],
            **({"solutions": rewrite["solutions"]} if rewrite_completed else {}),
            **({"submission": progress.get("controlled_rewrite_submission")}
               if progress.get("controlled_rewrite_submission") else {}),
        },
    }
    authored_listening = _activity(lesson, "listening_lab").get("content") or {}
    listening = {
        key: authored_listening.get(key)
        for key in ("test_id", "title", "target_band_range", "solutions_visibility")
        if key in authored_listening
    }
    listening["questions"] = [
        _safe_listening_question(question)
        for question in authored_listening.get("questions") or []
        if isinstance(question, dict)
    ]
    listening["audio_url"] = _asset_url(
        lesson["lesson_id"], "full_test.mp3", content_checksum,
    )
    listening["sections"] = [
        {
            **_safe_listening_section(section),
            **({"figure_url": figure_url} if (figure_url := _listening_figure_url(
                lesson["lesson_id"], section.get("figure"), content_checksum,
            )) else {}),
        }
        for section in authored_listening.get("sections") or []
        if isinstance(section, dict)
    ]
    if progress["listening_submitted"] and "listening" not in progress["completed_stages"]:
        saved_listening = _listening_attempt(item_id)
        if saved_listening:
            key = saved_listening.get("answer_key") or _answer_rows(
                _activity(lesson, "listening_lab").get("content") or {}
            )
            listening["initial_attempt"] = {
                "total": int(saved_listening.get("total") or len(key)),
                "correct": int(saved_listening.get("correct") or 0),
                "answer_results": _answer_results(saved_listening.get("answers") or {}, key),
            }
    activities["listening"] = listening
    writing = dict(_activity(lesson, "writing_reference"))
    writing_content = writing.get("content") or {}
    writing_tasks = writing_content.get("tasks") or {}
    for task_id, task in writing_tasks.items():
        task["illustrations"] = [
            _asset_url(lesson["lesson_id"], ref, content_checksum)
            for ref in task.get("illustrations") or []
        ]
        if task_id == "task_1":
            task["prompt_analysis"] = [
                row for row in writing_content.get("prompt_analysis") or []
                if str(row.get("heading") or "").startswith(("(g)", "(h)"))
            ]
            task["outline"] = [
                row for row in writing_content.get("outline") or []
                if str(row.get("heading") or "").startswith("(c)")
            ]
        else:
            task["prompt_analysis"] = [
                row for row in writing_content.get("prompt_analysis") or []
                if str(row.get("heading") or "").startswith("(9)")
            ]
            task["outline"] = [
                row for row in writing_content.get("outline") or []
                if str(row.get("heading") or "").startswith("(4)")
            ]
    writing_content.pop("prompt_analysis", None)
    writing_content.pop("outline", None)
    activities["writing"] = writing
    activities["speaking"] = _activity(lesson, "speaking_practice")

    return {
        "bank": {"id": bank["id"], "code": bank.get("code"), "title": bank.get("title")},
        "assignment": {
            "item_id": item_id, "due_at": item.get("due_at"),
            "accepting": bool(item.get("accepting")),
            "submitted_at": item.get("submitted_at"), "passed_at": item.get("passed_at"),
        },
        "lesson": {
            "lesson_id": lesson["lesson_id"], "title": lesson.get("title"),
            "topic_code": lesson.get("topic_code"), "objectives": lesson.get("objectives") or [],
            "vocabulary": vocabulary,
            "practice": {stage: [_safe_question(
                                      row, answered=row["item_id"] in answered,
                                      audio_url=_asset_url(
                                          lesson["lesson_id"],
                                          next((word.get("audio_headword")
                                                for word in lesson.get("vocabulary") or []
                                                if word.get("lexeme_id") == row.get("lexeme_id")), None),
                                          content_checksum,
                                      ),
                                  )
                                  for row in rows]
                         for stage, rows in selected.items()},
            "activities": activities,
        },
        "progress": progress,
    }


def _require_stage(item_id: str, stage: str) -> None:
    rows = (_admin().table("advanced_vocab_stage_progress").select("id")
            .eq("class_assignment_item_id", item_id).eq("stage", stage)
            .eq("status", "completed").limit(1).execute().data) or []
    if not rows:
        raise HTTPException(409, f"Hãy hoàn tất {stage} trước")


def _require_section(item_id: str, section: str) -> None:
    rows = (_admin().table("course_section_submissions").select("id")
            .eq("class_assignment_item_id", item_id).eq("section", section)
            .limit(1).execute().data) or []
    if not rows:
        raise HTTPException(409, f"Hãy hoàn tất {section} trước")


def _upsert_stage(*, bank_id: str, user_id: str, item_id: str,
                  stage: str, evidence: dict) -> dict:
    payload = {
        "bank_id": bank_id, "user_id": user_id,
        "class_assignment_item_id": item_id, "stage": stage,
        "status": "completed", "evidence": evidence,
    }
    try:
        rows = (_admin().table("advanced_vocab_stage_progress")
                .upsert(payload, on_conflict="class_assignment_item_id,stage")
                .execute().data) or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, "Không lưu được tiến độ bài học") from exc
    return rows[0] if rows else payload


def complete_vocabulary(*, user_id: str, bank_id: str, item_id: str,
                        seen_lexeme_ids: list[str]) -> dict:
    _, _, lesson = _assigned_lesson(
        bank_id=bank_id, user_id=user_id, item_id=item_id,
    )
    expected = {row["lexeme_id"] for row in lesson.get("vocabulary") or []}
    seen = {str(value) for value in seen_lexeme_ids}
    missing = sorted(expected - seen)
    if missing:
        raise HTTPException(422, {"message": "Chưa xem đủ thẻ từ", "missing": missing})
    _upsert_stage(bank_id=bank_id, user_id=user_id, item_id=item_id,
                  stage="vocabulary", evidence={"seen_lexeme_ids": sorted(expected)})
    return _progress(item_id)


def start_practice(*, user_id: str, bank_id: str, item_id: str, stage: str) -> dict:
    if stage not in _PRACTICE_COUNTS:
        raise HTTPException(404, "Không tìm thấy phần luyện tập")
    _, _, lesson = _assigned_lesson(
        bank_id=bank_id, user_id=user_id, item_id=item_id,
    )
    _require_stage(item_id, "vocabulary" if stage == "practice_1" else "practice_1")
    authored = practice_selection(lesson)[stage]
    proposed_qids = [str(row["item_id"]) for row in authored]
    try:
        response = _admin().rpc("start_advanced_vocab_practice", {
            "p_item_id": item_id,
            "p_user_id": user_id,
            "p_bank_id": bank_id,
            "p_stage": stage,
            "p_qids": proposed_qids,
        }).execute().data
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        if any(token in message for token in (
            "advanced_vocab_assignment_closed",
            "advanced_vocab_assignment_expired",
            "advanced_vocab_membership_inactive",
            "advanced_vocab_prerequisite_incomplete",
        )):
            raise HTTPException(
                409, "Bài giao không còn nhận tương tác mới. Hãy tải lại tiến độ.",
            ) from exc
        raise HTTPException(500, "Không bắt đầu được phần luyện tập") from exc
    saved = response[0] if isinstance(response, list) and response else response
    saved_qids = (saved or {}).get("qids") if isinstance(saved, dict) else None
    if (not isinstance(saved_qids, list)
            or not all(isinstance(qid, str) for qid in saved_qids)
            or len(saved_qids) != _PRACTICE_COUNTS[stage]
            or len(set(saved_qids)) != len(saved_qids)):
        raise HTTPException(500, "Bộ câu luyện tập đã lưu không hợp lệ")
    by_id = {str(row.get("item_id")): row for row in authored}
    if any(qid not in by_id for qid in saved_qids):
        raise HTTPException(409, "Bộ câu luyện tập không khớp phiên bản bài đã giao")
    content_checksum = str(
        (lesson.get("provenance") or {}).get("content_checksum") or ""
    ) or None
    questions = [
        _safe_question(
            by_id[qid],
            audio_url=_asset_url(
                lesson["lesson_id"],
                next((word.get("audio_headword")
                      for word in lesson.get("vocabulary") or []
                      if word.get("lexeme_id") == by_id[qid].get("lexeme_id")), None),
                content_checksum,
            ),
        )
        for qid in saved_qids
    ]
    return {"stage": stage, "questions": questions, "progress": _progress(item_id)}


def _normal(value: Any, *, case_sensitive: bool = False) -> str:
    # ``False`` is an authored answer in boolean items, not a missing value.
    # Using ``value or ''`` made every expected FALSE impossible to answer.
    text = unicodedata.normalize(
        "NFKC", str(value if value is not None else "")
    ).strip()
    if not case_sensitive:
        text = text.casefold()
    return re.sub(r"[^\w+]+", " ", text, flags=re.UNICODE).strip()


def _correct(item: dict, answer: Any) -> bool:
    case_sensitive = item.get("case_sensitive") is True
    def normalize(value: Any) -> str:
        return _normal(value, case_sensitive=case_sensitive)

    expected = item.get("answer", item.get("answer_index"))
    if isinstance(expected, int) and not isinstance(expected, bool):
        options = item.get("options")
        if isinstance(options, list):
            if not 0 <= expected < len(options):
                return False
            expected_option = options[expected]
            if isinstance(expected_option, dict):
                option_identity = _option_identity(expected_option, expected)
                return bool(
                    normalize(answer)
                    and normalize(answer) == normalize(option_identity)
                )
        try:
            return int(answer) == expected
        except (TypeError, ValueError):
            return False
    accepted = item.get("accept") if isinstance(item.get("accept"), list) else None
    if not accepted:
        accepted = expected if isinstance(expected, list) else [expected]
    return bool(
        normalize(answer)
        and any(normalize(answer) == normalize(value) for value in accepted)
    )


def answer_practice(*, user_id: str, bank_id: str, item_id: str, stage: str,
                    qid: str, answer: Any, response_time_ms: int | None = None) -> dict:
    _, _, lesson = _assigned_lesson(
        bank_id=bank_id, user_id=user_id, item_id=item_id,
    )
    prerequisite = "vocabulary" if stage == "practice_1" else "practice_1"
    if stage not in _PRACTICE_COUNTS:
        raise HTTPException(404, "Không tìm thấy phần luyện tập")
    _require_stage(item_id, prerequisite)
    authored = practice_selection(lesson)[stage]
    persisted_qids = _selection_qids(item_id, stage)
    if persisted_qids is None:
        raise HTTPException(409, "Hãy bắt đầu phần luyện tập trước")
    authored_by_id = {str(row.get("item_id")): row for row in authored}
    if any(selected_qid not in authored_by_id for selected_qid in persisted_qids):
        raise HTTPException(409, "Bộ câu luyện tập không khớp phiên bản bài đã giao")
    selected = [authored_by_id[selected_qid] for selected_qid in persisted_qids]
    item = next((row for row in selected if row.get("item_id") == qid), None)
    if not item:
        raise HTTPException(404, "Câu hỏi không thuộc phần luyện tập này")
    if not _normal(answer, case_sensitive=item.get("case_sensitive") is True):
        raise HTTPException(422, "Hãy nhập hoặc chọn câu trả lời trước khi kiểm tra")
    is_correct = _correct(item, answer)
    payload = {
        "bank_id": bank_id, "user_id": user_id,
        "class_assignment_item_id": item_id, "stage": stage, "qid": qid,
        "answer_given": answer,
        "is_correct": is_correct,
        "response_time_ms": max(0, min(int(response_time_ms or 0), 12 * 60 * 60 * 1000)),
    }
    try:
        existing = (_admin().table("advanced_vocab_question_attempts")
                    .select("*").eq("class_assignment_item_id", item_id)
                    .eq("qid", qid).limit(1).execute().data) or []
        if existing:
            if existing[0].get("answer_given") != answer:
                raise HTTPException(409, "Câu này đã được trả lời")
            saved = existing[0]
        else:
            saved_rows = (_admin().table("advanced_vocab_question_attempts")
                          .insert(payload).execute().data) or []
            saved = saved_rows[0] if saved_rows else payload
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        if "23505" in str(exc) or "duplicate key" in str(exc).lower():
            raced = (_admin().table("advanced_vocab_question_attempts")
                     .select("*").eq("class_assignment_item_id", item_id)
                     .eq("qid", qid).limit(1).execute().data) or []
            if raced and raced[0].get("answer_given") == answer:
                saved = raced[0]
            else:
                raise HTTPException(409, "Câu này đã được trả lời ở nơi khác") from exc
        else:
            raise HTTPException(500, "Không lưu được câu trả lời") from exc

    count_rows = (_admin().table("advanced_vocab_question_attempts")
                  .select("qid").eq("class_assignment_item_id", item_id)
                  .eq("stage", stage).execute().data) or []
    completed = len({row.get("qid") for row in count_rows}) == len(selected)
    if completed:
        _upsert_stage(bank_id=bank_id, user_id=user_id, item_id=item_id,
                      stage=stage, evidence={"question_count": len(selected)})
    return {
        "qid": qid, "answer": saved.get("answer_given"),
        "is_correct": bool(saved.get("is_correct")),
        "explanation": item.get("explain"), "note": item.get("note"),
        "completed": completed, "progress": _progress(item_id),
    }


async def complete_controlled_rewrite(*, user_id: str, bank_id: str, item_id: str,
                                      answers: dict[str, str]) -> dict:
    _, _, lesson = _assigned_lesson(
        bank_id=bank_id, user_id=user_id, item_id=item_id,
    )
    _require_section(item_id, "reading")
    parts = controlled_rewrite_parts(lesson)
    expected = {row["item_id"] for row in parts["prompts"]}
    normalized = {
        str(key): str(value).strip() for key, value in answers.items()
        if str(value).strip()
    }
    missing = sorted(expected - set(normalized))
    if missing or set(normalized) - expected:
        raise HTTPException(422, {
            "message": "Hãy hoàn thành đủ 20 câu trước khi gửi chấm",
            "missing": missing,
        })
    if any(len(value) > _MAX_REWRITE_ANSWER_CHARS
           for value in normalized.values()):
        raise HTTPException(422, "Mỗi câu trả lời tối đa 600 ký tự")

    prompt_by_id = {row["item_id"]: row["prompt"] for row in parts["prompts"]}
    snapshot = {
        "lesson_id": lesson["lesson_id"],
        "content_checksum": (lesson.get("provenance") or {}).get("content_checksum"),
        "prompts": parts["prompts"],
    }
    try:
        claim = _admin().rpc("claim_advanced_vocab_rewrite_submission", {
            "p_item_id": item_id, "p_user_id": user_id, "p_bank_id": bank_id,
            "p_answers": normalized, "p_content_snapshot": snapshot,
            "p_prompt_version": "advanced-vocab-rewrite-v1",
        }).execute().data or {}
    except Exception as exc:  # noqa: BLE001
        if "23505" in str(exc) or "already_submitted" in str(exc):
            raise HTTPException(
                409, "Phần Controlled Rewrite này đã được gửi chấm một lần",
            ) from exc
        raise HTTPException(500, "Không lưu được bài Controlled Rewrite") from exc
    if isinstance(claim, list):
        claim = claim[0] if claim else {}
    submission = claim.get("submission") or {}
    if not claim.get("should_grade"):
        submission = _rewrite_submission(item_id) or submission
        return {
            "solutions": parts["solutions"],
            "submission": _safe_rewrite_submission(submission),
            "progress": _progress(item_id),
        }
    grading_items = [{
        "item_id": item_id_value,
        "prompt": prompt_by_id[item_id_value],
        "answer": normalized[item_id_value],
    } for item_id_value in sorted(expected)]
    from services import advanced_vocab_rewrite_grader

    feedback, model, error_code = await advanced_vocab_rewrite_grader.grade_rewrites(
        grading_items, user_id=user_id,
    )
    now = datetime.now(timezone.utc).isoformat()
    status = "failed" if error_code else "completed"
    update = {
        "feedback": feedback, "model": model, "status": status,
        "error_code": error_code, "completed_at": now, "updated_at": now,
    }
    try:
        saved = (_admin().table("advanced_vocab_rewrite_submissions")
                 .update(update).eq("class_assignment_item_id", item_id)
                 .eq("status", "processing").execute().data) or []
        if saved:
            submission = saved[0]
        else:
            submission = _rewrite_submission(item_id) or {**submission, **update}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            503, "Bài đã được lưu nhưng chưa lưu được phản hồi chấm; vui lòng tải lại",
        ) from exc
    return {
        "solutions": parts["solutions"],
        "submission": _safe_rewrite_submission(submission),
        "progress": _progress(item_id),
    }


def _answer_rows(content: dict) -> list[dict]:
    solutions = content.get("solutions") or {}
    rows = []
    for question in content.get("questions") or []:
        qid = str(question.get("question_number") or question.get("id") or "")
        solution = solutions.get(qid) or {}
        rows.append({**solution, "id": qid})
    if not rows or any(not row.get("id") or row.get("answer") in (None, "") for row in rows):
        raise HTTPException(500, "Nội dung đáp án của bài chưa hoàn chỉnh")
    return rows


def _answer_results(answers: dict, key: list[dict]) -> list[dict]:
    def accepted_values(row: dict) -> list[Any]:
        values: list[Any] = []
        for field in ("answer", "answer_code", "answer_label", "accepted", "alternatives"):
            value = row.get(field)
            candidates = value if isinstance(value, list) else [value]
            for candidate in candidates:
                if candidate in (None, ""):
                    continue
                values.append(candidate)
                if isinstance(candidate, str):
                    for variant in candidate.split("/"):
                        variant = variant.strip()
                        if not variant:
                            continue
                        values.append(variant)
                        parenthesized_or = re.fullmatch(
                            r"(.+?)\s*\(\s*OR\s+(.+?)\s*\)",
                            variant,
                            flags=re.IGNORECASE,
                        )
                        if parenthesized_or:
                            values.extend(
                                part.strip() for part in parenthesized_or.groups()
                            )
                            continue
                        optional = re.fullmatch(r"(.+?)\s*\(([^)]+)\)", variant)
                        if optional:
                            base, optional_words = (
                                part.strip() for part in optional.groups()
                            )
                            values.extend([base, f"{base} {optional_words}"])
        return values

    return [{
        "id": row["id"], "submitted_answer": str(answers.get(row["id"], "")),
        "is_correct": _normal(answers.get(row["id"])) in {
            _normal(value) for value in accepted_values(row)
        },
    } for row in key]


def _admin_answer_evidence(row: dict) -> dict:
    """Attach canonical per-question results to an admin report row."""
    answers = row.get("answers") or {}
    answer_key = row.get("answer_key") or []
    snapshot = row.get("content_snapshot") or {}
    guided_retry = (
        snapshot.get("guided_retry") or {} if isinstance(snapshot, dict) else {}
    )
    final_answers = {**answers, **(guided_retry.get("answers") or {})}
    evidence = dict(row)
    evidence["answer_results"] = _answer_results(final_answers, answer_key)
    if guided_retry:
        evidence["initial_answer_results"] = _answer_results(answers, answer_key)
    return evidence


def _submit_section(*, user_id: str, bank_id: str, item_id: str,
                    section: str, answers: dict, duration_sec: int, content: dict) -> dict:
    key = _answer_rows(content)
    expected = [row["id"] for row in key]
    submitted = {qid: str(answers.get(qid, "")).strip() for qid in expected}
    missing = [qid for qid, value in submitted.items() if not value]
    if missing:
        raise HTTPException(422, {"message": f"Còn {len(missing)} câu chưa trả lời", "missing": missing})
    existing = (_admin().table("course_section_submissions").select("*")
                .eq("class_assignment_item_id", item_id).eq("section", section)
                .limit(1).execute().data) or []
    if existing:
        if (existing[0].get("answers") or {}) != submitted:
            raise HTTPException(409, f"Phần {section} đã nộp rồi")
        saved = existing[0]
    else:
        results = _answer_results(submitted, key)
        correct = sum(1 for row in results if row["is_correct"])
        payload = {
            "bank_id": bank_id, "user_id": user_id,
            "class_assignment_item_id": item_id, "section": section,
            "attempt_no": 1, "answers": submitted, "answer_key": key,
            "content_snapshot": content, "total": len(key), "correct": correct,
            "score": round(correct / len(key) * 100, 2),
            "duration_sec": max(0, min(int(duration_sec or 0), 12 * 60 * 60)),
        }
        try:
            rows = (_admin().table("course_section_submissions")
                    .insert(payload).execute().data) or []
            saved = rows[0] if rows else payload
        except Exception as exc:  # noqa: BLE001
            if "23505" not in str(exc) and "duplicate key" not in str(exc).lower():
                raise HTTPException(500, f"Không lưu được phần {section}") from exc
            raced = (_admin().table("course_section_submissions").select("*")
                     .eq("class_assignment_item_id", item_id).eq("section", section)
                     .limit(1).execute().data) or []
            if not raced or (raced[0].get("answers") or {}) != submitted:
                raise HTTPException(409, f"Phần {section} đã được nộp ở nơi khác") from exc
            saved = raced[0]
    result_rows = _answer_results(saved.get("answers") or submitted, saved.get("answer_key") or key)
    return {
        "section": section, "total": int(saved.get("total") or len(key)),
        "correct": int(saved.get("correct") or 0), "pct": float(saved.get("score") or 0),
        "submitted_at": saved.get("submitted_at") or saved.get("created_at"),
        "answer_results": result_rows, "answers": saved.get("answer_key") or key,
    }


def submit_reading(*, user_id: str, bank_id: str, item_id: str,
                   answers: dict, duration_sec: int = 0) -> dict:
    _, _, lesson = _assigned_lesson(
        bank_id=bank_id, user_id=user_id, item_id=item_id,
    )
    _require_stage(item_id, "practice_2")
    content = _activity(lesson, "reading_lab").get("content") or {}
    return _submit_section(user_id=user_id, bank_id=bank_id, item_id=item_id,
                           section="reading", answers=answers,
                           duration_sec=duration_sec, content=content)


def submit_listening(*, user_id: str, bank_id: str, item_id: str,
                     answers: dict, duration_sec: int = 0) -> dict:
    _, _, lesson = _assigned_lesson(
        bank_id=bank_id, user_id=user_id, item_id=item_id,
    )
    _require_stage(item_id, "controlled_rewrite")
    activity = _activity(lesson, "listening_lab")
    content = activity.get("content") or {}
    if activity.get("reveal_policy") != "after_guided_retry":
        result = _submit_section(
            user_id=user_id, bank_id=bank_id, item_id=item_id,
            section="listening", answers=answers,
            duration_sec=duration_sec, content=content,
        )
        result["progress"] = _progress(item_id)
        return result
    key = _answer_rows(content)
    expected = [row["id"] for row in key]
    submitted = {qid: str(answers.get(qid, "")).strip() for qid in expected}
    missing = [qid for qid, value in submitted.items() if not value]
    if missing:
        raise HTTPException(422, {
            "message": f"Còn {len(missing)} câu chưa trả lời", "missing": missing,
        })
    existing = _listening_attempt(item_id)
    if existing:
        if (existing.get("answers") or {}) != submitted:
            raise HTTPException(409, "Listening đã nộp lần đầu rồi")
        saved = existing
    else:
        results = _answer_results(submitted, key)
        correct = sum(1 for row in results if row["is_correct"])
        payload = {
            "bank_id": bank_id, "user_id": user_id,
            "class_assignment_item_id": item_id, "answers": submitted,
            "answer_key": key, "content_snapshot": content,
            "total": len(key), "correct": correct,
            "score": round(correct / len(key) * 100, 2),
            "duration_sec": max(0, min(int(duration_sec or 0), 12 * 60 * 60)),
        }
        try:
            rows = (_admin().table("advanced_vocab_listening_attempts")
                    .insert(payload).execute().data) or []
            saved = rows[0] if rows else payload
        except Exception as exc:  # noqa: BLE001
            if "23505" not in str(exc) and "duplicate key" not in str(exc).lower():
                raise HTTPException(500, "Không lưu được Listening lần đầu") from exc
            raced = _listening_attempt(item_id)
            if not raced or (raced.get("answers") or {}) != submitted:
                raise HTTPException(409, "Listening đã được nộp ở nơi khác") from exc
            saved = raced
    result = {
        "section": "listening", "total": int(saved.get("total") or len(key)),
        "correct": int(saved.get("correct") or 0), "pct": float(saved.get("score") or 0),
        "submitted_at": saved.get("submitted_at") or saved.get("created_at"),
        "answer_results": _answer_results(saved.get("answers") or submitted,
                                          saved.get("answer_key") or key),
        "requires_guided_retry": activity.get("reveal_policy") == "after_guided_retry",
    }
    result["assignment"] = {"completed": False, "pct": None}
    result["progress"] = _progress(item_id)
    return result


def complete_listening_guided_retry(*, user_id: str, bank_id: str, item_id: str,
                                    answers: dict) -> dict:
    _, _, lesson = _assigned_lesson(
        bank_id=bank_id, user_id=user_id, item_id=item_id,
    )
    activity = _activity(lesson, "listening_lab")
    if activity.get("reveal_policy") != "after_guided_retry":
        raise HTTPException(409, "Bài nghe này không có bước sửa có hướng dẫn")
    saved = _listening_attempt(item_id)
    if not saved:
        raise HTTPException(409, "Hãy nộp Listening lần đầu trước")
    key = saved.get("answer_key") or _answer_rows(activity.get("content") or {})
    initial_results = _answer_results(saved.get("answers") or {}, key)
    wrong_ids = {row["id"] for row in initial_results if not row["is_correct"]}
    corrected = {qid: str(answers.get(qid, "")).strip() for qid in wrong_ids}
    missing = sorted(qid for qid, value in corrected.items() if not value)
    if missing:
        raise HTTPException(422, {
            "message": "Hãy sửa đủ các câu chưa đúng trước khi xem đáp án",
            "missing": missing,
        })
    correction_key = [row for row in key if row["id"] in wrong_ids]
    correction_results = _answer_results(corrected, correction_key)
    retry_evidence = {
        "initial_wrong_ids": sorted(wrong_ids),
        "answers": corrected,
        "answer_results": correction_results,
    }
    payload = {
        "bank_id": bank_id, "user_id": user_id,
        "class_assignment_item_id": item_id, "section": "listening",
        "attempt_no": 1, "answers": saved.get("answers") or {},
        "answer_key": key,
        "content_snapshot": {
            **(saved.get("content_snapshot") or activity.get("content") or {}),
            "guided_retry": retry_evidence,
        },
        "total": int(saved.get("total") or len(key)),
        "correct": int(saved.get("correct") or 0),
        "score": float(saved.get("score") or 0),
        "duration_sec": int(saved.get("duration_sec") or 0),
    }
    canonical: dict | None = None
    try:
        existing = (_admin().table("course_section_submissions").select("*")
                    .eq("class_assignment_item_id", item_id)
                    .eq("section", "listening").limit(1).execute().data) or []
        if existing:
            canonical = existing[0]
            evidence = (canonical.get("content_snapshot") or {}).get("guided_retry") or {}
            if (evidence.get("answers") or {}) != corrected:
                raise HTTPException(409, "Bước sửa Listening đã hoàn tất")
        else:
            rows = (_admin().table("course_section_submissions")
                    .insert(payload).execute().data) or []
            canonical = rows[0] if rows else payload
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        if "23505" not in str(exc) and "duplicate key" not in str(exc).lower():
            raise HTTPException(500, "Không lưu được bước sửa Listening") from exc
        raced = (_admin().table("course_section_submissions").select("*")
                 .eq("class_assignment_item_id", item_id)
                 .eq("section", "listening").limit(1).execute().data) or []
        if not raced:
            raise HTTPException(409, "Bước sửa Listening đã hoàn tất ở nơi khác") from exc
        canonical = raced[0]
        evidence = (canonical.get("content_snapshot") or {}).get("guided_retry") or {}
        if (evidence.get("answers") or {}) != corrected:
            raise HTTPException(409, "Bước sửa Listening đã hoàn tất ở nơi khác") from exc
    canonical_retry = ((canonical or {}).get("content_snapshot") or {}).get(
        "guided_retry",
    ) or retry_evidence
    final_answers = {
        **(saved.get("answers") or {}), **(canonical_retry.get("answers") or {}),
    }
    progress = _progress(item_id)
    return {
        "section": "listening", "guided_retry_completed": True,
        "answer_results": _answer_results(final_answers, key),
        "initial_answer_results": initial_results,
        "guided_retry": canonical_retry, "answers": key,
        "assignment": {"completed": progress["required_completed"], "pct": None},
        "progress": progress,
    }


def assignment_results(*, assignment_id: str) -> dict:
    assignments = (_admin().table("class_assignments")
                   .select("id,skill,content_id,title,content_config")
                   .eq("id", assignment_id).limit(1).execute().data) or []
    if not assignments:
        raise HTTPException(404, "Không tìm thấy bài giao")
    assignment = assignments[0]
    if assignment.get("skill") != "course":
        raise HTTPException(404, "Không tìm thấy bài giao Advanced Vocabulary")
    bank_id = str(assignment.get("content_id") or "")
    config = assignment.get("content_config") or {}
    runtime = config.get("runtime") or {}
    if runtime.get("kind") != "advanced_vocab":
        raise HTTPException(404, "Không tìm thấy bài giao Advanced Vocabulary")
    bank = {
        "id": bank_id,
        "code": config.get("bank_code"),
        "title": config.get("test_title") or assignment.get("title"),
    }
    items = _paged(
        "class_assignment_items",
        "id,student_id,state,opened_at,submitted_at,passed_at,score,mastery",
        lambda q: q.eq("assignment_id", assignment_id),
    )
    item_ids = [row["id"] for row in items]
    student_ids = [row["student_id"] for row in items if row.get("student_id")]
    students: dict[str, dict] = {}
    for offset in range(0, len(student_ids), _ID_CHUNK):
        chunk = student_ids[offset:offset + _ID_CHUNK]
        for row in _paged("students", "id,user_id,full_name,student_code",
                          lambda q, ids=chunk: q.in_("id", ids)):
            students[row["id"]] = row
    stages: list[dict] = []
    attempts: list[dict] = []
    sections: list[dict] = []
    listening_attempts: list[dict] = []
    rewrite_submissions: list[dict] = []
    for offset in range(0, len(item_ids), _ID_CHUNK):
        chunk = item_ids[offset:offset + _ID_CHUNK]
        stages += _paged("advanced_vocab_stage_progress", "*",
                         lambda q, ids=chunk: q.in_("class_assignment_item_id", ids))
        attempts += _paged("advanced_vocab_question_attempts", "*",
                           lambda q, ids=chunk: q.in_("class_assignment_item_id", ids))
        sections += _paged("course_section_submissions", "*",
                           lambda q, ids=chunk: q.in_("class_assignment_item_id", ids)
                           .in_("section", ["reading", "listening"]))
        listening_attempts += _paged(
            "advanced_vocab_listening_attempts", "*",
            lambda q, ids=chunk: q.in_("class_assignment_item_id", ids),
        )
        rewrite_submissions += _paged(
            "advanced_vocab_rewrite_submissions", "*",
            lambda q, ids=chunk: q.in_("class_assignment_item_id", ids),
        )
    by_stage: dict[str, list] = {}
    by_attempt: dict[str, list] = {}
    by_section: dict[str, list] = {}
    by_listening_attempt: dict[str, list] = {}
    by_rewrite_submission: dict[str, list] = {}
    for row in stages:
        by_stage.setdefault(row["class_assignment_item_id"], []).append(row)
    for row in attempts:
        by_attempt.setdefault(row["class_assignment_item_id"], []).append(row)
    for row in sections:
        by_section.setdefault(row["class_assignment_item_id"], []).append(row)
    for row in listening_attempts:
        by_listening_attempt.setdefault(row["class_assignment_item_id"], []).append(row)
    for row in rewrite_submissions:
        row = _expire_stale_rewrite_submission(row) or row
        by_rewrite_submission.setdefault(row["class_assignment_item_id"], []).append(row)
    result_rows = []
    for item in items:
        iid = item["id"]
        student = students.get(item.get("student_id")) or {}
        result_rows.append({
            "item": item,
            "student": {key: student.get(key) for key in ("id", "user_id", "full_name", "student_code")},
            "stages": by_stage.get(iid, []),
            "practice_attempts": by_attempt.get(iid, []),
            "sections": [
                _admin_answer_evidence(row) for row in by_section.get(iid, [])
            ],
            "listening_attempts": [
                _admin_answer_evidence(row)
                for row in by_listening_attempt.get(iid, [])
            ],
            "controlled_rewrite_submissions": by_rewrite_submission.get(iid, []),
        })
    return {
        "kind": "advanced_vocab", "assignment": assignment,
        "bank": {"id": bank["id"], "code": bank.get("code"), "title": bank.get("title")},
        "lesson_id": runtime.get("lesson_id"), "score_policy": "none",
        "required_stages": list(_REQUIRED_STAGES),
        "reference_only": ["writing", "speaking"], "students": result_rows,
    }

#!/usr/bin/env python3
"""Regrade submitted Reading attempts affected by grouped Cambridge MCQs.

Cambridge choose-TWO/THREE tasks are stored as consecutive ``mcq_single``
rows. Before the grouped-set grader, a correct set in the opposite DB slot
order could persist a wrong score, band, per-question verdict, and skill
rollup. This rerunnable backfill rebuilds the canonical key with the same
grader used by submit and only writes rows whose persisted result differs.

Dry-run is the default::

    venv/bin/python -m scripts.regrade_reading_grouped_mcq_attempts
    venv/bin/python -m scripts.regrade_reading_grouped_mcq_attempts --test CAM17-T3
    venv/bin/python -m scripts.regrade_reading_grouped_mcq_attempts --attempt UUID

Add ``--commit`` to write. Status, answers, submitted_at, examiner-confirmed
``final_bands``, and question content are never changed. For mock sittings,
only ``ai_draft.reading`` is refreshed so the review suggestion matches the
canonical attempt; other skills and confirmed bands are preserved.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import supabase_admin  # noqa: E402
from services import reading_test_grader as grader  # noqa: E402
from services.mock_review_workflow import _merge_review_ai_draft  # noqa: E402


_ATTEMPT_COLS = (
    "id,user_id,test_id,status,score,band_estimate,answers,sitting_id,"
    "grading_details,skill_breakdown"
)
_QUESTION_COLS = (
    "q_num,question_type,prompt,payload,answer,skill_tag,explanation,passage_id"
)
_PAGE_SIZE = 1000
_IN_FILTER_BATCH = 200


def _answer_key(test_uuid: str) -> list[dict]:
    passages = (
        supabase_admin.table("reading_passages")
        .select("id,passage_order")
        .eq("test_id", test_uuid)
        .eq("library", "l3_test")
        .execute()
    )
    passage_order_by_id = {
        row["id"]: row.get("passage_order") for row in (passages.data or [])
    }
    if not passage_order_by_id:
        raise RuntimeError(f"đề {test_uuid} thiếu passage l3_test — dừng, không đoán")
    questions = (
        supabase_admin.table("reading_questions")
        .select(_QUESTION_COLS)
        .in_("passage_id", list(passage_order_by_id))
        .execute()
    )
    return grader.collect_answer_key(questions.data or [], passage_order_by_id)


def _has_grouped_mcq(answer_key: list[dict]) -> bool:
    return any(row.get("group_type") == "grouped_mcq_single" for row in answer_key)


def _test_row(identifier: str) -> dict:
    for column in ("test_id", "id"):
        result = (
            supabase_admin.table("reading_tests")
            .select("id,test_id,module")
            .eq(column, identifier)
            .limit(1)
            .execute()
        )
        if result.data:
            return result.data[0]
    raise SystemExit(f"không thấy đề Reading {identifier!r}")


def _attempts_for_test(test_uuid: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        result = (
            supabase_admin.table("reading_test_attempts")
            .select(_ATTEMPT_COLS)
            .eq("test_id", test_uuid)
            .eq("status", "submitted")
            .order("id")
            .range(offset, offset + _PAGE_SIZE - 1)
            .execute()
        )
        page = result.data or []
        rows.extend(page)
        if len(page) < _PAGE_SIZE:
            return rows
        offset += _PAGE_SIZE


def _batches(values: list[str], size: int = _IN_FILTER_BATCH):
    for index in range(0, len(values), size):
        yield values[index:index + size]


def _review_drafts(sitting_ids: list[str]) -> dict[str, dict | None]:
    ids = sorted({str(value) for value in sitting_ids if value})
    rows: list[dict] = []
    for batch in _batches(ids):
        result = (
            supabase_admin.table("mock_exam_reviews")
            .select("sitting_id,ai_draft")
            .in_("sitting_id", batch)
            .execute()
        )
        rows.extend(result.data or [])
    return {
        str(row["sitting_id"]): (row.get("ai_draft") or {}).get("reading")
        for row in rows
    }


def _confirmed_reading_bands(sitting_ids: list[str]) -> list[str]:
    ids = sorted({str(value) for value in sitting_ids if value})
    rows: list[dict] = []
    for batch in _batches(ids):
        result = (
            supabase_admin.table("mock_exam_reviews")
            .select("sitting_id,final_bands")
            .in_("sitting_id", batch)
            .execute()
        )
        rows.extend(result.data or [])
    return [
        str(row["sitting_id"])
        for row in rows
        if (row.get("final_bands") or {}).get("reading") is not None
    ]


def _result_changed(attempt: dict, result: dict, drafts: dict[str, dict | None]) -> bool:
    persisted_changed = any((
        attempt.get("score") != result["score"],
        attempt.get("band_estimate") != result["band_estimate"],
        (attempt.get("grading_details") or []) != result["per_question"],
        (attempt.get("skill_breakdown") or {}) != result["skill_breakdown"],
    ))
    sitting_id = str(attempt.get("sitting_id") or "")
    draft_changed = sitting_id in drafts and drafts[sitting_id] != {
        "raw": result["score"],
        "band": result["band_estimate"],
    }
    return persisted_changed or draft_changed


def _apply_regrade(attempt: dict, result: dict) -> None:
    (
        supabase_admin.table("reading_test_attempts")
        .update({
            "score": result["score"],
            "grading_details": result["per_question"],
            "skill_breakdown": result["skill_breakdown"],
            "band_estimate": result["band_estimate"],
        })
        .eq("id", attempt["id"])
        .execute()
    )
    if attempt.get("sitting_id"):
        _merge_review_ai_draft(attempt["sitting_id"], {
            "reading": {
                "raw": result["score"],
                "band": result["band_estimate"],
            },
        })


def _targets(args: argparse.Namespace) -> tuple[list[dict], dict[str, list[dict]], dict[str, str]]:
    if args.attempt:
        result = (
            supabase_admin.table("reading_test_attempts")
            .select(_ATTEMPT_COLS)
            .eq("id", args.attempt)
            .limit(1)
            .execute()
        )
        attempts = result.data or []
        if not attempts:
            raise SystemExit(f"không thấy attempt {args.attempt}")
        if attempts[0].get("status") != "submitted":
            raise SystemExit("chỉ chấm lại attempt đã submitted")
        test_result = (
            supabase_admin.table("reading_tests")
            .select("id,test_id,module")
            .eq("id", attempts[0]["test_id"])
            .limit(1)
            .execute()
        )
        if not test_result.data:
            raise SystemExit(f"attempt {args.attempt} trỏ tới Reading test đã mất")
        test_rows = [test_result.data[0]]
    elif args.test:
        test_rows = [_test_row(args.test)]
        attempts = _attempts_for_test(test_rows[0]["id"])
    else:
        test_rows = (
            supabase_admin.table("reading_tests")
            .select("id,test_id,module")
            .execute()
            .data or []
        )
        attempts = []

    keys: dict[str, list[dict]] = {}
    modules: dict[str, str] = {}
    affected_ids: set[str] = set()
    for test in test_rows:
        key = _answer_key(test["id"])
        if not _has_grouped_mcq(key):
            continue
        keys[test["id"]] = key
        modules[test["id"]] = test.get("module") or "academic"
        affected_ids.add(test["id"])
        if not args.attempt and not args.test:
            attempts.extend(_attempts_for_test(test["id"]))

    attempts = [row for row in attempts if row.get("test_id") in affected_ids]
    return attempts, keys, modules


def main() -> int:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--test", help="test_id or UUID; default scans all affected tests")
    group.add_argument("--attempt", help="one submitted reading attempt UUID")
    parser.add_argument("--commit", action="store_true", help="write changes (default: dry-run)")
    args = parser.parse_args()

    attempts, keys, modules = _targets(args)
    if not attempts:
        print("không có attempt submitted nào thuộc đề grouped MCQ — không làm gì.")
        return 0

    drafts = _review_drafts([row.get("sitting_id") for row in attempts])
    changed: list[tuple[dict, dict]] = []
    for attempt in attempts:
        result = grader.grade_attempt(
            attempt.get("answers") or [],
            keys[attempt["test_id"]],
            module=modules[attempt["test_id"]],
        )
        if _result_changed(attempt, result, drafts):
            changed.append((attempt, result))
        print(
            f"{attempt['id'][:8]}  score {attempt.get('score')} → {result['score']}  "
            f"band {attempt.get('band_estimate')} → {result['band_estimate']}"
        )

    print(f"\ncần sửa: {len(changed)} · đã đúng: {len(attempts) - len(changed)} · tổng: {len(attempts)}")
    if not changed:
        return 0
    confirmed = _confirmed_reading_bands([
        attempt.get("sitting_id") for attempt, _result in changed
    ])
    if confirmed:
        print(
            f"⚠ {len(confirmed)} mock review đã có final_bands.reading: "
            "attempt + ai_draft sẽ được sửa, band giám khảo đã chốt được giữ nguyên."
        )
    if not args.commit:
        print("(chỉ xem thử — thêm --commit để ghi)")
        return 0

    for attempt, result in changed:
        _apply_regrade(attempt, result)
        print(f"đã ghi {attempt['id'][:8]}")
    print(f"xong: đã cập nhật {len(changed)} attempt; final_bands không bị đụng.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

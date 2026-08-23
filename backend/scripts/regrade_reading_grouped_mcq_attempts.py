#!/usr/bin/env python3
"""Regrade submitted Reading attempts affected by grouped Cambridge MCQs.

Cambridge choose-TWO/THREE tasks are stored as consecutive ``mcq_single``
rows. Before the grouped-set grader, a correct set in the opposite DB slot
order could persist a wrong score, band, per-question verdict, and skill
rollup. This rerunnable backfill applies unordered matching to the immutable
submission snapshot and only writes rows whose persisted result differs.

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
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import supabase_admin  # noqa: E402
from services import reading_test_grader as grader  # noqa: E402
from services.mock_review_workflow import _merge_review_ai_draft  # noqa: E402


_ATTEMPT_COLS = (
    "id,user_id,test_id,status,score,band_estimate,answers,sitting_id,started_at,"
    "grading_details,skill_breakdown"
)
_PAGE_SIZE = 1000
_IN_FILTER_BATCH = 200
_VERIFIED_GROUP_MANIFESTS = {
    # Cam 17 Test 3 was imported/updated at 02:03:51Z; the live sitting began
    # at 02:47Z. This static manifest proves q21–22 were already a choose-TWO
    # group (B/C) before every in-scope submission instead of inferring history
    # from mutable reading_questions rows.
    "c3b2b054-0a21-4587-a787-d67a2518136f": {
        "effective_from": "2026-08-23T02:03:51.881949+00:00",
        # Exclusive upper bound verified from the one live cohort: all 13
        # attempts began between 02:47:53.054214Z and 02:48:06.259367Z.
        # Future imports/attempts can therefore never enter this backfill.
        "effective_until": "2026-08-23T02:48:07+00:00",
        "groups": (
            {"q_nums": (21, 22), "expected": ("B", "C")},
        ),
    },
}


def _manifest_answer_key(test_uuid: str) -> list[dict]:
    manifest = _VERIFIED_GROUP_MANIFESTS.get(test_uuid)
    if not manifest:
        return []
    rows: list[dict] = []
    for group_index, group in enumerate(manifest["groups"], start=1):
        q_nums = group["q_nums"]
        expected = group["expected"]
        if len(q_nums) != len(expected):
            raise RuntimeError(f"manifest {test_uuid} group {group_index} không cân — dừng")
        for q_num, answer in zip(q_nums, expected):
            rows.append({
                "q_num": q_num,
                "answer": answer,
                "group_type": "grouped_mcq_single",
                "group_key": f"verified-{test_uuid}-{group_index}",
                "_manifest_effective_from": manifest["effective_from"],
                "_manifest_effective_until": manifest["effective_until"],
            })
    return rows


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


def _submission_module(attempt: dict) -> str:
    """Infer the immutable band table from the persisted score/band pair."""
    score = attempt.get("score")
    persisted_band = attempt.get("band_estimate")
    if (
        isinstance(score, int)
        and not isinstance(score, bool)
        and persisted_band is not None
        and grader.band_estimate(score, module="academic") == persisted_band
    ):
        return "academic"
    raise RuntimeError(
        f"attempt {attempt.get('id')} không suy ra chắc chắn bảng band lúc submitted — dừng"
    )


def _merge_grouped_result(
    attempt: dict,
    answer_key: list[dict],
) -> dict:
    """Fix grouped ordering using only the immutable submitted snapshot."""
    groups: dict[str, list[int]] = {}
    manifest_rows_by_group: dict[str, list[dict]] = {}
    for row in answer_key:
        if row.get("group_type") != "grouped_mcq_single":
            continue
        group_key = row.get("group_key")
        q_num = row.get("q_num")
        if not group_key or not isinstance(q_num, int):
            raise RuntimeError("answer key grouped MCQ thiếu group_key/q_num — dừng")
        groups.setdefault(str(group_key), []).append(q_num)
        manifest_rows_by_group.setdefault(str(group_key), []).append(row)
    grouped_q_nums = {q_num for q_nums in groups.values() for q_num in q_nums}
    persisted = attempt.get("grading_details")
    if not isinstance(persisted, list) or not persisted:
        raise RuntimeError(
            f"attempt {attempt.get('id')} thiếu grading_details lịch sử — dừng, không chấm lại toàn đề"
        )
    if any(
        not isinstance(row, dict) or not isinstance(row.get("q_num"), int)
        for row in persisted
    ):
        raise RuntimeError(
            f"attempt {attempt.get('id')} có grading_details không hợp lệ — dừng"
        )

    persisted_q_nums = {row["q_num"] for row in persisted}
    if len(persisted_q_nums) != len(persisted):
        raise RuntimeError(
            f"attempt {attempt.get('id')} có q_num lịch sử trùng nhau — dừng"
        )
    missing = grouped_q_nums - persisted_q_nums
    if missing:
        raise RuntimeError(
            f"attempt {attempt.get('id')} thiếu snapshot grouped q_num {sorted(missing)} — dừng"
        )

    effective_windows = {
        (
            row.get("_manifest_effective_from"),
            row.get("_manifest_effective_until"),
        )
        for rows in manifest_rows_by_group.values()
        for row in rows
    }
    if len(effective_windows) != 1 or any(
        value is None for value in next(iter(effective_windows), ())
    ):
        raise RuntimeError("verified group manifest thiếu version window duy nhất — dừng")
    try:
        started_at = datetime.fromisoformat(str(attempt.get("started_at") or ""))
        effective_from_raw, effective_until_raw = next(iter(effective_windows))
        effective_from = datetime.fromisoformat(str(effective_from_raw))
        effective_until = datetime.fromisoformat(str(effective_until_raw))
        if any(
            value.tzinfo is None or value.utcoffset() is None
            for value in (started_at, effective_from, effective_until)
        ):
            raise ValueError("timezone required")
    except (TypeError, ValueError) as error:
        raise RuntimeError(
            f"attempt {attempt.get('id')} thiếu started_at hợp lệ — dừng"
        ) from error
    if started_at < effective_from:
        raise RuntimeError(
            f"attempt {attempt.get('id')} có trước verified grouped manifest — dừng"
        )
    if started_at >= effective_until:
        raise RuntimeError(
            f"attempt {attempt.get('id')} có sau verified grouped manifest — dừng"
        )

    persisted_by_q = {row["q_num"]: row for row in persisted}
    replacements: dict[int, dict] = {}
    for group_key, q_nums in groups.items():
        historical = [persisted_by_q[q_num] for q_num in sorted(q_nums)]
        historical_expected = {
            grader.normalize_answer(token)
            for row in historical
            for token in str(row.get("expected") or "").split(",")
            if grader.normalize_answer(token)
        }
        manifest_expected = {
            grader.normalize_answer(str(row.get("answer") or ""))
            for row in manifest_rows_by_group[group_key]
            if grader.normalize_answer(str(row.get("answer") or ""))
        }
        if historical_expected != manifest_expected:
            raise RuntimeError(
                f"attempt {attempt.get('id')} expected snapshot không khớp verified group — dừng"
            )
        already_grouped = [
            row.get("group") == "grouped_mcq_single" for row in historical
        ]
        if all(already_grouped):
            replacements.update({row["q_num"]: row for row in historical})
            continue
        if any(already_grouped):
            raise RuntimeError(
                f"attempt {attempt.get('id')} có snapshot grouped dở dang — dừng"
            )

        remaining_by_answer: dict[str, list[dict]] = {}
        for row in historical:
            expected = str(row.get("expected") or "").strip()
            normalized = grader.normalize_answer(expected)
            if not normalized or "," in expected:
                raise RuntimeError(
                    f"attempt {attempt.get('id')} thiếu expected lịch sử đơn trị ở q{row['q_num']} — dừng"
                )
            remaining_by_answer.setdefault(normalized, []).append(row)

        expected_display = ", ".join(sorted(
            {str(row.get("expected")).strip() for row in historical},
            key=grader.normalize_answer,
        ))
        group_explanation = "\n\n".join(
            f"{row.get('expected')}: {row.get('explanation')}"
            for row in historical
            if row.get("explanation")
        ) or None

        matched_by_q_num: dict[int, dict | None] = {}
        for display_row in historical:
            pick = grader.normalize_answer(str(display_row.get("user_answer") or ""))
            matched_rows = remaining_by_answer.get(pick) or []
            matched_by_q_num[display_row["q_num"]] = (
                matched_rows.pop(0) if pick and matched_rows else None
            )

        unclaimed = sorted(
            (row for rows in remaining_by_answer.values() for row in rows),
            key=lambda row: row.get("q_num") or 0,
        )
        rationale_by_q_num: dict[int, dict | None] = {}
        for display_row in historical:
            matched_row = matched_by_q_num[display_row["q_num"]]
            rationale_by_q_num[display_row["q_num"]] = (
                matched_row if matched_row is not None
                else (unclaimed.pop(0) if unclaimed else None)
            )

        for display_row in historical:
            matched_row = matched_by_q_num[display_row["q_num"]]
            rationale_row = rationale_by_q_num[display_row["q_num"]]
            replacement = {
                **display_row,
                "correct": matched_row is not None,
                "expected": expected_display,
                "group": "grouped_mcq_single",
                "rationale_q_num": (
                    rationale_row.get("q_num") if rationale_row else None
                ),
                "explanation": (
                    rationale_row.get("explanation")
                    if rationale_row else group_explanation
                ),
            }
            if rationale_row:
                replacement["alternatives"] = rationale_row.get("alternatives") or []
                replacement["skill_tag"] = rationale_row.get("skill_tag")
            replacements[display_row["q_num"]] = replacement

    merged = [replacements.get(row["q_num"], row) for row in persisted]
    merged.sort(key=lambda row: row.get("q_num") or 0)
    score = sum(1 for row in merged if row.get("correct"))
    if score == attempt.get("score"):
        next_band = attempt.get("band_estimate")
    elif score < 4 and attempt.get("band_estimate") is None:
        # Every currently implemented module is unbanded below raw 4, so a
        # low-score correction that stays below the floor needs no module
        # inference and must not abort the rest of a batch.
        next_band = None
    else:
        submission_module = _submission_module(attempt)
        next_band = grader.band_estimate(score, module=submission_module)
    return {
        "score": score,
        "max_score": len(merged),
        "band_estimate": next_band,
        "per_question": merged,
        "skill_breakdown": grader.rollup_skill_breakdown(merged),
        "by_part": grader.by_part_breakdown(merged),
    }


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


def _targets(args: argparse.Namespace) -> tuple[list[dict], dict[str, list[dict]]]:
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
        test_rows = [_test_row(test_uuid) for test_uuid in _VERIFIED_GROUP_MANIFESTS]
        attempts = []

    keys: dict[str, list[dict]] = {}
    affected_ids: set[str] = set()
    for test in test_rows:
        key = _manifest_answer_key(test["id"])
        if not key:
            if args.attempt or args.test:
                raise SystemExit(
                    f"đề {test['id']} chưa có verified grouped manifest — không chấm lại"
                )
            continue
        keys[test["id"]] = key
        affected_ids.add(test["id"])
        if not args.attempt and not args.test:
            attempts.extend(_attempts_for_test(test["id"]))

    attempts = [row for row in attempts if row.get("test_id") in affected_ids]
    return attempts, keys


def main() -> int:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--test", help="test_id or UUID; default scans all affected tests")
    group.add_argument("--attempt", help="one submitted reading attempt UUID")
    parser.add_argument("--commit", action="store_true", help="write changes (default: dry-run)")
    args = parser.parse_args()

    attempts, keys = _targets(args)
    if not attempts:
        print("không có attempt submitted nào thuộc đề grouped MCQ — không làm gì.")
        return 0

    drafts = _review_drafts([row.get("sitting_id") for row in attempts])
    changed: list[tuple[dict, dict]] = []
    skipped: list[tuple[str, str]] = []
    for attempt in attempts:
        try:
            result = _merge_grouped_result(
                attempt,
                keys[attempt["test_id"]],
            )
        except RuntimeError as error:
            skipped.append((str(attempt.get("id") or "?"), str(error)))
            print(f"{str(attempt.get('id') or '?')[:8]}  BỎ QUA  {error}")
            continue
        if _result_changed(attempt, result, drafts):
            changed.append((attempt, result))
        print(
            f"{attempt['id'][:8]}  score {attempt.get('score')} → {result['score']}  "
            f"band {attempt.get('band_estimate')} → {result['band_estimate']}"
        )

    unchanged = len(attempts) - len(changed) - len(skipped)
    print(
        f"\ncần sửa: {len(changed)} · đã đúng: {unchanged} · "
        f"bỏ qua: {len(skipped)} · tổng: {len(attempts)}"
    )
    if not changed:
        return 1 if skipped else 0
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
        return 1 if skipped else 0

    for attempt, result in changed:
        _apply_regrade(attempt, result)
        print(f"đã ghi {attempt['id'][:8]}")
    print(f"xong: đã cập nhật {len(changed)} attempt; final_bands không bị đụng.")
    return 1 if skipped else 0


if __name__ == "__main__":
    sys.exit(main())

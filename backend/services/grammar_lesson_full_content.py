"""Project exact senior-approved original JSONL banks into the lesson contract.

The source records are retained in each frozen question. The approved v2 notes
are reused independently; original questions are never substituted by v2 MCQs.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any


FULL_VERSION = "v3"
EXPECTED_LESSONS = {f"M30-B{n:02d}" for n in range(1, 31)}


def _sha(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode()).hexdigest()


def _file(root: Path, name: str) -> Path:
    # Manifest paths are local, bounded release files, never arbitrary paths.
    if not isinstance(name, str) or not name:
        raise ValueError("Invalid full-bank content file")
    path = root / name
    if not path.resolve().is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError("Invalid full-bank content file")
    return path


def _text(row: dict, key: str) -> str:
    value = row.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Missing original full-bank field: {row.get('id')}:{key}")
    return value


def _project(row: dict) -> dict:
    if not isinstance(row, dict):
        raise ValueError("Original bank record must be an object")
    qid = _text(row, "id")
    code = _text(row, "dang")
    result = {
        "id": qid, "prompt": _text(row, "de"), "format_code": code,
        "explanation": _text(row, "giai_thich"), "source_record": row,
        "supplementary": bool(row.get("backport_from_tm20")),
    }
    if re.fullmatch(r"E[123]", code):
        variants = row.get("bien_the_chap_nhan")
        if (not isinstance(variants, list)
                or not all(isinstance(v, str) and v.strip() for v in variants)):
            raise ValueError(f"Invalid original writing variants: {qid}")
        result.update({
            "type": "writing", "options": [],
            "output_requirements": _text(row, "yeu_cau_dau_ra"),
            "model_answer": _text(row, "dap_an_mau"),
            "accepted_variants": variants,
            "rubric": _text(row, "tieu_chi"),
            "detailed_rubric": _text(row, "tieu_chi_chi_tiet"),
            "writing_skill": _text(row, "nang_luc_viet"),
        })
    else:
        options, correct, traps = row.get("pa"), row.get("dap_an"), row.get("bay")
        if (not re.fullmatch(r"[A-D][1-4]", code)
                or not isinstance(options, list) or len(options) != 4
                or not all(isinstance(v, str) and v.strip() for v in options)
                or len({v.strip().casefold() for v in options}) != 4
                or type(correct) is not int or not 0 <= correct < 4
                or not isinstance(traps, list) or len(traps) != 4
                or not all(isinstance(v, str) for v in traps)
                or any(not v.strip() for i, v in enumerate(traps) if i != correct)):
            raise ValueError(f"Invalid original MCQ: {qid}")
        if result["supplementary"]:
            raise ValueError("Only source writing backports may be supplementary")
        result.update(type="mcq", options=options, correct_index=correct,
                      distractor_explanations=traps)
    return result


def question_counts(lesson: dict, answers: dict | None = None) -> dict[str, int]:
    questions = lesson.get("questions") or []
    writing = [q for q in questions if q.get("type") == "writing"]
    extra = sum(bool(q.get("supplementary")) for q in questions)
    saved = answers or {}
    return {
        "objective_count": len(questions) - len(writing),
        "writing_count": len(writing),
        "writing_answered_count": sum(q["id"] in saved for q in writing),
        "core_count": len(questions) - extra,
        "supplementary_count": extra,
    }


def _review_full_read(approval: dict, item_count: int, written_count: int) -> bool:
    """Read both exact evidence schemas emitted by the independent reviewer.

    Preserve the approval bytes. If either schema is present it must be complete;
    contradictory or partial parallel evidence cannot borrow the other schema.
    """
    coverage = approval.get("read_coverage")
    if not isinstance(coverage, dict):
        return False
    schemas = (
        ("ids_and_order_preserved", ("prompt", "mcq_all_four_options_key_and_why_wrong",
                                     "written_model_variants_rubric_output")),
        ("original_ids_and_order_preserved", ("full_corrected_records_read",
          "all_four_options_keys_and_wrong_feedback_read",
          "all_written_models_variants_explanations_rubrics_and_output_read")),
    )
    declared = False
    for identity, fields in schemas:
        if identity in approval or any(field in coverage for field in fields):
            declared = True
            if (approval.get(identity) is not True
                    or tuple(coverage.get(field) for field in fields) != (item_count, 90, written_count)):
                return False
    return declared


def load_full_package(root: Path, teaching: dict) -> dict:
    manifest = json.loads((root / "v3.json").read_text(encoding="utf-8"))
    review = json.loads((root / "v3-review.json").read_text(encoding="utf-8"))
    if (manifest.get("version") != FULL_VERSION
            or set(manifest.get("lessons", {})) != EXPECTED_LESSONS
            or review.get("version") != FULL_VERSION
            or review.get("decision") != "approved"
            or review.get("reviewer_role") != "senior_content_gate"
            or set(review.get("lessons", {})) != EXPECTED_LESSONS):
        raise ValueError("All thirty original banks need independent exact senior approval")
    mapping = manifest.get("exposure_map") or {}
    mapping_bytes = _file(root, mapping.get("file", "")).read_bytes()
    if hashlib.sha256(mapping_bytes).hexdigest() != mapping.get("sha256"):
        raise ValueError("Full original-bank exposure mapping changed")
    exposure = json.loads(mapping_bytes)
    if (exposure.get("schema") != "master30-source-exposure-v1"
            or not re.fullmatch(r"[0-9a-f]{64}", exposure.get("qmatrix_sha256", ""))
            or not isinstance(exposure.get("items"), dict)):
        raise ValueError("Full original-bank exposure mapping is invalid")
    result, seen = {}, set()
    for lesson_id in sorted(EXPECTED_LESSONS):
        identity = manifest["lessons"][lesson_id]
        approval = review["lessons"][lesson_id]
        raw = _file(root, identity.get("source_file", "")).read_bytes()
        file_sha = hashlib.sha256(raw).hexdigest()
        rows = [json.loads(line) for line in raw.decode("utf-8").splitlines() if line.strip()]
        if (approval.get("decision") != "approved"
                or file_sha != identity.get("corrected_sha256")
                or file_sha != approval.get("corrected_file_sha256")
                or _sha(rows) != approval.get("canonical_records_sha256")
                or identity.get("original_sha256") != approval.get("original_file_sha256")
                or approval.get("unresolved_findings") != []
                or not re.fullmatch(r"[0-9a-f]{64}", identity.get("original_sha256", ""))):
            raise ValueError(f"Exact original-bank senior approval does not match {lesson_id}")
        questions = [_project(row) for row in rows]
        qids = [q["id"] for q in questions]
        if (len(set(qids)) != len(qids) or seen.intersection(qids)
                or _sha(qids) != identity.get("original_ids_sha256")
                or any(not qid.startswith(lesson_id[4:] + "-") for qid in qids)):
            raise ValueError(f"Original bank question identities are invalid: {lesson_id}")
        seen.update(qids)
        notes = teaching["lessons"][lesson_id]
        lesson = {
            "title": notes["title"], "focus": notes["focus"],
            "lesson_notes": notes["lesson_notes"],
            "learning_objectives": notes["learning_objectives"],
            "article": notes.get("article"), "questions": questions,
            "source_kind": "master30-original-full-bank",
            "source_provenance": identity,
        }
        counts = question_counts(lesson)
        if (counts["objective_count"] != 90 or counts["core_count"] != 100
                or not 10 <= counts["writing_count"] <= 30
                or counts["supplementary_count"] != len(questions) - 100
                or approval.get("item_count") != len(questions)
                or approval.get("mcq_count") != 90
                or approval.get("core_count") != 100
                or approval.get("written_count") != counts["writing_count"]
                or approval.get("extra_count") != counts["supplementary_count"]
                or not _review_full_read(approval, len(questions), counts["writing_count"])):
            raise ValueError(f"Original 90+10 core/additional counts changed: {lesson_id}")
        aggregate = {"item_ids": set(), "stimulus_families": set(), "parallel_set_ids": set()}
        for question in questions:
            mapped = exposure["items"].get(question["id"])
            if not isinstance(mapped, dict):
                raise ValueError(f"Missing original-ID exposure mapping: {question['id']}")
            for key, values in aggregate.items():
                declared = mapped.get(key)
                if (not isinstance(declared, list)
                        or not all(isinstance(v, str) and v for v in declared)):
                    raise ValueError(f"Incomplete original-bank exposure mapping: {question['id']}")
                values.update(declared)
            if question["id"] not in mapped["item_ids"]:
                raise ValueError("Source exposure closure lost its original question ID")
            if question["type"] == "mcq" and not mapped["stimulus_families"]:
                raise ValueError("Original MCQ lost its stimulus family")
        lesson["practice_exposure"] = {
            **{key: sorted(values) for key, values in aggregate.items()},
            "mapping_sha256": mapping["sha256"],
        }
        result[lesson_id] = lesson
    if len(seen) != 3100:
        raise ValueError("Full original-bank release must preserve all 3100 items")
    return {"version": FULL_VERSION, "lessons": result}

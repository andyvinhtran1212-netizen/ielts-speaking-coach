#!/usr/bin/env python3
"""Validate, normalize and import Cambridge 13–21 web explanations.

Dry-run is the default. ``--commit`` is deliberately explicit because the
destination is a versioned production-facing content table. Source question
rows and historical attempts are never modified.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

EXPECTED_OBJECTS = 9 * 4 * 2 * 40
OBJECT_RE = re.compile(
    r"^cambridge-(?P<book>1[3-9]|20|21)-test-(?P<test>[1-4])-"
    r"(?P<skill>reading|listening)-q(?P<question>\d{2})$"
)
PATH_FIELDS = (
    "canonical_package_path",
    "authored_solution_path",
    "semantic_audit_path",
    "timings_path",
    "deterministic_preflight_path",
)

# These are candidate labels only. Mapping does not confirm a learner weakness;
# the imported object remains PROPOSED until runtime evidence supports it.
READING_SUBTYPE_MAP = {
    "answer_form": "R11-COPY_ERROR",
    "author_view_vs_fact": "R07-MISSING_PROOF",
    "contradiction_vs_absence": "R07-FALSE_VS_NG",
    "detail_as_main_idea": "R06-DETAIL_AS_GIST",
    "diagram_reference": "R05-WEAK_ANCHOR",
    "distractor_capture": "R09-MENTION",
    "grammar_fit": "R11-GRAMMAR_FIT",
    "grammar_fit_only": "R11-GRAMMAR_FIT",
    "keyword_matching": "R06-KEYWORD_HEADING",
    "logic_relationship": "R08-SEQUENCE",
    "mentioned_not_answer": "R09-MENTION",
    "option_load": "R09-PARTIAL",
    "over_inference": "R07-OVER_INFERENCE",
    "paragraph_function": "R06-WRONG_FUNCTION",
    "paraphrase_miss": "R02-SYN",
    "partial_match": "R09-PARTIAL",
    "partial_set": "R09-PARTIAL",
    "partial_truth": "R09-PARTIAL",
    "plural_or_number_agreement": "R11-PLURAL",
    "polarity_flip": "R09-REVERSE",
    "position_tracking": "R05-SEARCH_SLOW",
    "reference_chain": "R04-REFERENCE_CHAIN",
    "repeated_information": "R05-REPEATED_INFO",
    "scope_or_modifier": "R09-SCOPE",
    "sequence_tracking": "R08-SEQUENCE",
    "speaker_attribution": "R09-SPEAKER",
    "spelling": "R11-SPELLING",
    "word_limit": "R11-WORD_LIMIT",
    "wrong_attribution": "R09-SPEAKER",
    "wrong_search_zone": "R05-WRONG_SEARCH_ZONE",
}
LISTENING_SUBTYPE_MAP = {
    "answer_form": "L13-GRAMMAR_FIT",
    "distractor_capture": "L07-PARTIAL_MATCH",
    "first_mention": "L07-FIRST_MENTION",
    "grammar_fit": "L13-GRAMMAR_FIT",
    "mentioned_not_answer": "L07-PARTIAL_MATCH",
    "missed_self_correction": "L07-MISSED_CORRECTION",
    "number_or_name_decoding": "L12-NAME_SPELLING",
    "option_load": "L09-OPTION_OVERLOAD",
    "orientation_loss": "L11-ORIENTATION",
    "paraphrase_miss": "L06-LEXICAL",
    "partial_match": "L07-PARTIAL_MATCH",
    "partial_set": "L07-PARTIAL_MATCH",
    "partial_truth": "L07-PARTIAL_MATCH",
    "plural_or_number_agreement": "L13-FINAL_S",
    "polarity_flip": "L07-POLARITY_FLIP",
    "position_tracking": "L08-LOST_POSITION",
    "repeated_information": "L08-LOST_POSITION",
    "scope_or_modifier": "L07-PARTIAL_MATCH",
    "sequence_tracking": "L11-PATH_SEQUENCE",
    "sound_decoding": "L01-WORD_NOT_RECOGNISED",
    "spatial_language": "L11-DIRECTION",
    "spatial_orientation": "L11-ORIENTATION",
    "speaker_attribution": "L10-SPEAKER_ATTRIBUTION",
    "spelling": "L13-SPELLING",
    "word_boundary": "L02-WORD_BOUNDARY",
    "word_limit": "L13-WORD_LIMIT",
    "wrong_attribution": "L10-SPEAKER_ATTRIBUTION",
}


class ImportValidationError(RuntimeError):
    pass


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _json_hash(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return _sha256_bytes(encoded.encode("utf-8"))


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ImportValidationError(f"Không đọc được JSON {path}: {exc}") from exc


def _all_event_names(contract: dict) -> set[str]:
    return {
        name
        for group in (contract.get("event_groups") or {}).values()
        for name in group
    }


def _taxonomy_subtypes(taxonomy: dict) -> set[str]:
    out: set[str] = set()
    for group in ("reading", "listening", "metacognition"):
        for family in taxonomy.get(group) or []:
            out.update(family.get("subtypes") or [])
    return out


def _portable_provenance(item: dict, collection_root: Path) -> None:
    source = item.get("source") or {}
    source_test_key = str(source.get("test_id") or "")
    hashes: dict[str, str] = {}
    for field in PATH_FIELDS:
        raw = source.get(field)
        if not raw:
            continue
        basename = Path(str(raw)).name
        relative = Path(source_test_key) / basename
        local = collection_root / relative
        if not local.exists():
            raise ImportValidationError(
                f"{item.get('object_id')}: provenance {field} không resolve được: {relative}"
            )
        source[field] = relative.as_posix()
        hashes[field] = _sha256_bytes(local.read_bytes())
    source["provenance_hashes"] = hashes
    item["source"] = source


def _canonicalize_subtypes(item: dict, canonical_subtypes: set[str]) -> None:
    remediation = item.get("remediation") or {}
    original = list(remediation.get("candidate_error_subtypes") or [])
    skill = (item.get("source") or {}).get("paper")
    mapping = READING_SUBTYPE_MAP if skill == "reading" else LISTENING_SUBTYPE_MAP
    # A source tag can be too broad for this skill (for example
    # ``spatial_orientation`` was stamped on many non-map Reading items). Do not
    # invent a precise taxonomy diagnosis from it. Preserve it for editorial
    # audit, but only expose codes we can map conservatively.
    unknown = sorted({tag for tag in original if tag not in mapping})
    canonical = list(dict.fromkeys(mapping[tag] for tag in original if tag in mapping))
    invalid = sorted(set(canonical) - canonical_subtypes)
    if invalid:
        raise ImportValidationError(
            f"{item.get('object_id')}: taxonomy code không tồn tại: {', '.join(invalid)}"
        )
    remediation["candidate_error_tags_original"] = original
    remediation["unmapped_candidate_error_tags"] = unknown
    remediation["candidate_error_subtypes"] = canonical
    item["remediation"] = remediation


def _canonicalize_telemetry(item: dict, event_contract: dict, event_names: set[str]) -> None:
    telemetry = item.get("telemetry") or {}
    required = ["paper_submitted" if name == "attempt_submitted" else name
                for name in telemetry.get("required_events") or []]
    missing = sorted(set(required) - event_names)
    if missing:
        raise ImportValidationError(
            f"{item.get('object_id')}: telemetry event ngoài contract: {', '.join(missing)}"
        )
    telemetry["required_events"] = list(dict.fromkeys(required))
    telemetry["minimum_event_payload"] = list(event_contract.get("envelope_required") or [])
    item["telemetry"] = telemetry


def _apply_override(item: dict, override: dict | None) -> None:
    if not override:
        return
    if "answer" in override:
        item.setdefault("item", {})["answer"] = copy.deepcopy(override["answer"])
    if "serving_status" in override:
        item.setdefault("rights_and_release", {})["item_serving_status"] = override["serving_status"]
    item.setdefault("audit", {})["release_adjudication"] = {
        "override_version": "cambridge-release-overrides/1.0",
        "reason": override.get("adjudication"),
    }


def normalize_collection(
    collection_root: Path,
    spec_root: Path,
    overrides_path: Path,
) -> tuple[list[dict], dict]:
    contract = _load_json(spec_root / "runtime-event-contract-v1.json")
    taxonomy = _load_json(spec_root / "error-taxonomy-v1.json")
    overrides_doc = _load_json(overrides_path)
    overrides = overrides_doc.get("items") or {}
    content_version = str(overrides_doc.get("content_version") or "").strip()
    if not content_version:
        raise ImportValidationError("Override manifest thiếu content_version")

    event_names = _all_event_names(contract)
    canonical_subtypes = _taxonomy_subtypes(taxonomy)
    files = sorted(collection_root.glob("cambridge-*-web-explanations/objects/*.json"))
    if len(files) != 72:
        raise ImportValidationError(f"Cần đúng 72 paper object files, tìm thấy {len(files)}")

    seen: set[str] = set()
    rows: list[dict] = []
    type_counts: Counter[str] = Counter()
    serving_counts: Counter[str] = Counter()
    for path in files:
        document = _load_json(path)
        items = document.get("items") or []
        if len(items) != 40:
            raise ImportValidationError(f"{path}: cần 40 items, tìm thấy {len(items)}")
        for source_item in items:
            item = copy.deepcopy(source_item)
            object_id = str(item.get("object_id") or "")
            match = OBJECT_RE.fullmatch(object_id)
            if not match:
                raise ImportValidationError(f"object_id không hợp lệ: {object_id!r}")
            if object_id in seen:
                raise ImportValidationError(f"object_id bị trùng: {object_id}")
            seen.add(object_id)
            skill = match.group("skill")
            source = item.get("source") or {}
            if source.get("paper") != skill or int(source.get("question_number") or 0) != int(match.group("question")):
                raise ImportValidationError(f"{object_id}: source identity không khớp object_id")
            if (item.get("audit") or {}).get("verdict") != "CONFIRMED":
                raise ImportValidationError(f"{object_id}: audit verdict chưa CONFIRMED")
            explanation = item.get("explanation") or {}
            if not explanation.get("answer_summary") or not explanation.get("why_correct"):
                raise ImportValidationError(f"{object_id}: explanation bắt buộc bị thiếu")

            _apply_override(item, overrides.get(object_id))
            _portable_provenance(item, collection_root)
            _canonicalize_subtypes(item, canonical_subtypes)
            _canonicalize_telemetry(item, contract, event_names)

            answer = (item.get("item") or {}).get("answer") or {}
            if answer.get("requires_normalization_review"):
                status = (item.get("rights_and_release") or {}).get("item_serving_status")
                if status not in {
                    "MATCHER_REVIEW_REQUIRED",
                    "EXCLUDE_FROM_AUTO_SCORING_PENDING_MATCHER_REVIEW",
                    "EXCLUDE_FROM_SCORED_MOCK_PENDING_SOURCE_REPAIR",
                }:
                    raise ImportValidationError(
                        f"{object_id}: matcher chưa duyệt nhưng serving_status={status}"
                    )

            rights = item.get("rights_and_release") or {}
            serving = str(rights.get("item_serving_status") or "")
            type_counts[str((item.get("item") or {}).get("question_type") or "unknown")] += 1
            serving_counts[serving] += 1
            rows.append({
                "object_id": object_id,
                "content_version": content_version,
                "source_test_key": source.get("test_id"),
                "skill": skill,
                "book_number": int(match.group("book")),
                "test_number": int(match.group("test")),
                "question_number": int(match.group("question")),
                "payload": item,
                "source_hash": _json_hash(item),
                "audit_verdict": (item.get("audit") or {}).get("verdict"),
                "rights_status": rights.get("publication_status"),
                "editorial_status": rights.get("editorial_status"),
                "serving_status": serving,
                "is_current": False,
            })

    missing_overrides = sorted(set(overrides) - seen)
    if missing_overrides:
        raise ImportValidationError(
            "Override object không tồn tại: " + ", ".join(missing_overrides)
        )
    if len(rows) != EXPECTED_OBJECTS:
        raise ImportValidationError(f"Cần {EXPECTED_OBJECTS} objects, tìm thấy {len(rows)}")
    report = {
        "content_version": content_version,
        "files": len(files),
        "objects": len(rows),
        "question_type_counts": dict(sorted(type_counts.items())),
        "serving_status_counts": dict(sorted(serving_counts.items())),
        "override_count": len(overrides),
    }
    return rows, report


def _chunks(rows: list[dict], size: int = 100) -> Iterable[list[dict]]:
    for start in range(0, len(rows), size):
        yield rows[start:start + size]


def _bind_test_ids(rows: list[dict], db, *, allow_unbound_internal_qa: bool = False) -> None:
    visibility_columns = (
        "id,test_id,status,exam_only,public_practice_enabled,web_explanation_mode"
    )
    reading = db.table("reading_tests").select(visibility_columns).execute().data or []
    listening = db.table("listening_tests").select(visibility_columns).execute().data or []
    by_skill = {
        "reading": {str(row.get("test_id")): row for row in reading},
        "listening": {str(row.get("test_id")): row for row in listening},
    }
    missing: set[str] = set()
    for row in rows:
        prefix = "ILR-RDG-CAM" if row["skill"] == "reading" else "ILR-LIS-CAM"
        expected = f"{prefix}-B{row['book_number']}-T{row['test_number']}"
        parent = by_skill[row["skill"]].get(expected)
        if not parent:
            missing.add(expected)
            if allow_unbound_internal_qa:
                row["binding_status"] = "UNBOUND_INTERNAL_QA"
                row["serving_status"] = "INTERNAL_QA_UNBOUND"
            continue
        visibility = {
            "status": parent.get("status"),
            "exam_only": parent.get("exam_only"),
            "public_practice_enabled": parent.get("public_practice_enabled"),
            "web_explanation_mode": parent.get("web_explanation_mode"),
        }
        expected_visibility = {
            "status": "draft",
            "exam_only": True,
            "public_practice_enabled": False,
            "web_explanation_mode": "disabled",
        }
        if visibility != expected_visibility:
            raise ImportValidationError(
                f"{expected}: parent không còn bị khóa an toàn: {visibility}"
            )
        row[f"{row['skill']}_test_id"] = parent["id"]
        row["binding_status"] = "BOUND"
    if missing and not allow_unbound_internal_qa:
        raise ImportValidationError(
            "Không map được test production: " + ", ".join(sorted(missing))
        )
    if missing:
        print(
            f"INTERNAL QA — {len(missing)} paper chưa có canonical row; "
            "objects sẽ UNBOUND và không thể serve.",
            file=sys.stderr,
        )


def commit_rows(
    rows: list[dict],
    imported_by: str | None = None,
    *,
    allow_unbound_internal_qa: bool = False,
    allow_production_hidden: bool = False,
    confirmed_ref: str = "",
) -> None:
    from config import settings
    from database import supabase_admin

    if os.getenv("ENVIRONMENT", "").strip().lower() == "production" and not allow_production_hidden:
        raise ImportValidationError(
            "Production commit cần --allow-production-hidden; importer vẫn kiểm tra "
            "exam_only=true, public_practice_enabled=false và web_explanation_mode=disabled."
        )
    hostname = (urlparse(settings.SUPABASE_URL).hostname or "").lower()
    actual_ref = hostname.split(".", 1)[0]
    if not confirmed_ref or actual_ref != confirmed_ref.lower():
        raise ImportValidationError(
            f"Destination confirmation mismatch: URL ref={actual_ref!r}, "
            f"--confirm-supabase-ref={confirmed_ref!r}"
        )

    _bind_test_ids(
        rows, supabase_admin,
        allow_unbound_internal_qa=allow_unbound_internal_qa,
    )
    if imported_by:
        for row in rows:
            row["imported_by"] = imported_by

    version = rows[0]["content_version"]
    existing: list[dict] = []
    start = 0
    while True:
        page = (
            supabase_admin.table("web_explanation_objects")
            .select("object_id,source_hash,binding_status,is_current")
            .eq("content_version", version)
            .range(start, start + 999)
            .execute().data or []
        )
        existing.extend(page)
        if len(page) < 1000:
            break
        start += 1000
    existing_hash = {row["object_id"]: row["source_hash"] for row in existing}
    drift = [row["object_id"] for row in rows
             if row["object_id"] in existing_hash
             and existing_hash[row["object_id"]] != row["source_hash"]]
    if drift:
        raise ImportValidationError(
            "Content version đã tồn tại nhưng hash khác; tạo version mới: "
            + ", ".join(drift[:10])
        )

    # Re-running after canonical papers arrive upgrades QA inventory rows from
    # unbound to bound without mutating the versioned explanation payload.
    incoming_by_id = {row["object_id"]: row for row in rows}
    upgrades: list[dict] = []
    for existing_row in existing:
        incoming = incoming_by_id.get(existing_row["object_id"])
        if (incoming and existing_row.get("binding_status") == "UNBOUND_INTERNAL_QA"
                and incoming.get("binding_status") == "BOUND"):
            # Preserve active-version state throughout a resume.  Upserting the
            # complete, hash-verified row in batches avoids 2,880 sequential
            # PATCH round-trips while retaining the composite identity.
            incoming["is_current"] = bool(existing_row.get("is_current"))
            upgrades.append(incoming)
    for batch in _chunks(upgrades):
        supabase_admin.table("web_explanation_objects").upsert(
            batch, on_conflict="object_id,content_version",
        ).execute()

    missing = [row for row in rows if row["object_id"] not in existing_hash]
    for batch in _chunks(missing):
        supabase_admin.table("web_explanation_objects").insert(batch).execute()
    supabase_admin.rpc("fn_activate_web_explanation_version", {
        "p_content_version": version,
        "p_expected_count": EXPECTED_OBJECTS,
    }).execute()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True,
                        help="Path to _FINAL_BY_TEST")
    parser.add_argument("--spec-root", type=Path, required=True,
                        help="Path containing runtime-event-contract-v1.json and error-taxonomy-v1.json")
    parser.add_argument(
        "--overrides",
        type=Path,
        default=BACKEND / "content_mock_correction" / "cambridge_release_overrides_v1.json",
    )
    parser.add_argument("--commit", action="store_true",
                        help="Write the validated version to Supabase")
    parser.add_argument(
        "--allow-production-hidden",
        action="store_true",
        help=("Allow a production commit only when every canonical parent is "
              "exam-only, non-public and has web explanations disabled."),
    )
    parser.add_argument(
        "--confirm-supabase-ref",
        default="",
        help="Required on commit; must exactly match the destination Supabase project ref.",
    )
    parser.add_argument(
        "--allow-unbound-internal-qa",
        action="store_true",
        help=("Allow inventory-only import when canonical papers are absent. "
              "Rows are marked UNBOUND_INTERNAL_QA and cannot be served."),
    )
    parser.add_argument("--imported-by", default=None,
                        help="Optional admin user UUID for provenance")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    rows, report = normalize_collection(args.root.resolve(), args.spec_root.resolve(), args.overrides.resolve())
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not args.commit:
        print("DRY RUN — không ghi database. Dùng --commit sau khi migration 245 đã được áp dụng.")
        return 0
    commit_rows(
        rows, args.imported_by,
        allow_unbound_internal_qa=args.allow_unbound_internal_qa,
        allow_production_hidden=args.allow_production_hidden,
        confirmed_ref=args.confirm_supabase_ref,
    )
    print(f"Đã import và kích hoạt version {report['content_version']} ({len(rows)} objects).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

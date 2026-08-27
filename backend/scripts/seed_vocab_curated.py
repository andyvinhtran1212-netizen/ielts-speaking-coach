"""Validate or seed the curated Vocab Wiki pilot.

Safe default: validation only, no database writes.

Examples:
    cd backend
    python -m scripts.seed_vocab_curated
    python -m scripts.seed_vocab_curated --apply --admin-id <uuid>
    python -m scripts.seed_vocab_curated --apply --publish --admin-id <uuid> \
        --language-reviewer <uuid> --pedagogy-reviewer <uuid> \
        --assessment-reviewer <uuid>

Publishing requires three distinct reviewer IDs. The script uses the same
service publish gate as the admin API; it cannot bypass validation or reviews.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from services import vocab_unit_rules

CONTENT_FILE = Path(__file__).parent.parent / "content_vocab_curated" / "pilot_v1.json"
SIGNAL_CODE_RE = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")
SPEAKING_ISSUE_TYPES = {
    "meaning", "word_choice", "preposition", "verb_frame", "parallelism",
}


def load_pilot(path: Path = CONTENT_FILE) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_pilot(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    units = payload.get("units")
    pathways = payload.get("pathways")
    if not isinstance(units, list) or not units:
        return ["units phải là một mảng không rỗng"]
    if not isinstance(pathways, list):
        errors.append("pathways phải là một mảng")
        pathways = []

    slugs: set[str] = set()
    identities: set[tuple[str, str, str, str]] = set()
    signal_codes: set[str] = set()
    for index, unit in enumerate(units, start=1):
        if not isinstance(unit, dict):
            errors.append(f"units[{index}] phải là object")
            continue
        slug = str(unit.get("unit_slug") or "")
        if not slug:
            errors.append(f"units[{index}].unit_slug là bắt buộc")
        elif slug in slugs:
            errors.append(f"unit_slug bị trùng: {slug}")
        slugs.add(slug)
        identity = tuple(str(unit.get(key) or "") for key in (
            "sense_key", "construction_key", "communicative_function", "context_key",
        ))
        if "" in identity:
            errors.append(f"{slug}: identity bốn phần chưa đầy đủ")
        elif identity in identities:
            errors.append(f"{slug}: identity bốn phần bị trùng")
        identities.add(identity)

        signals = unit.get("speaking_signals")
        if not isinstance(signals, list) or not signals:
            errors.append(f"{slug}: speaking_signals phải là mảng không rỗng")
            signals = []
        for signal_index, signal in enumerate(signals, start=1):
            if not isinstance(signal, dict):
                errors.append(f"{slug}: speaking_signals[{signal_index}] phải là object")
                continue
            code = str(signal.get("signal_code") or "")
            if not (3 <= len(code) <= 120) or not SIGNAL_CODE_RE.fullmatch(code):
                errors.append(f"{slug}: signal_code không hợp lệ: {code!r}")
            elif code in signal_codes:
                errors.append(f"signal_code bị trùng: {code}")
            signal_codes.add(code)
            if signal.get("status", "active") not in {"active", "inactive"}:
                errors.append(
                    f"{slug}: speaking_signals[{signal_index}].status không hợp lệ"
                )
            for field in (
                "trigger_description", "exclusion_description", "reason_vi",
            ):
                value = str(signal.get(field) or "").strip()
                if not (20 <= len(value) <= 500):
                    errors.append(
                        f"{slug}: speaking_signals[{signal_index}].{field} "
                        "phải dài 20–500 ký tự"
                    )
            spec = signal.get("match_spec")
            if not isinstance(spec, dict):
                errors.append(
                    f"{slug}: speaking_signals[{signal_index}].match_spec phải là object"
                )
            else:
                if spec.get("issue_type") not in SPEAKING_ISSUE_TYPES:
                    errors.append(
                        f"{slug}: speaking_signals[{signal_index}] issue_type không hợp lệ"
                    )
                for pattern_field in ("original_pattern", "corrected_pattern"):
                    pattern = str(spec.get(pattern_field) or "")
                    if not (1 <= len(pattern) <= 240):
                        errors.append(
                            f"{slug}: speaking_signals[{signal_index}].{pattern_field} "
                            "phải dài 1–240 ký tự"
                        )
                        continue
                    try:
                        re.compile(pattern, re.I)
                    except re.error as exc:
                        errors.append(
                            f"{slug}: speaking_signals[{signal_index}].{pattern_field} "
                            f"không compile được: {exc}"
                        )
                if "require_distinct_match" in spec and not isinstance(
                    spec["require_distinct_match"], bool,
                ):
                    errors.append(
                        f"{slug}: speaking_signals[{signal_index}]."
                        "require_distinct_match phải là boolean"
                    )

        for reference in unit.get("reference_cards") or []:
            if not isinstance(reference, dict):
                errors.append(f"{slug}: reference_cards phải chứa object")
                continue
            category = str(reference.get("category") or "")
            card_slug = str(reference.get("slug") or "")
            card_path = CONTENT_FILE.parent.parent / "content_vocab" / category / f"{card_slug}.md"
            if not card_path.exists():
                errors.append(f"{slug}: reference card không tồn tại: {category}/{card_slug}")

        tasks = unit.get("tasks") if isinstance(unit.get("tasks"), list) else []
        editorial_tasks = [dict(task, status="active") for task in tasks if isinstance(task, dict)]
        unit_errors = vocab_unit_rules.validate_for_publish(
            unit.get("content") if isinstance(unit.get("content"), dict) else {},
            unit.get("sources") if isinstance(unit.get("sources"), list) else [],
            editorial_tasks,
        )
        errors.extend(f"{slug}: {error}" for error in unit_errors)

        for task_index, task in enumerate(tasks, start=1):
            if not isinstance(task, dict):
                continue
            key = task.get("answer_key") if isinstance(task.get("answer_key"), dict) else {}
            sample = key.get("model_answer")
            if not sample:
                accepted = key.get("accepted") if isinstance(key.get("accepted"), list) else []
                sample = accepted[0] if accepted else None
            if not isinstance(sample, str):
                errors.append(f"{slug}: task {task_index} thiếu đáp án mẫu để QA")
                continue
            try:
                result = vocab_unit_rules.grade_response(task, {"answer": sample})
            except vocab_unit_rules.VocabUnitRuleError as exc:
                errors.append(f"{slug}: task {task_index} không chấm được: {exc}")
            else:
                if result["correct"] is not True:
                    errors.append(
                        f"{slug}: task {task_index} tự chấm sai model_answer "
                        f"(score={result['score']})"
                    )

    for path_index, pathway in enumerate(pathways, start=1):
        if not isinstance(pathway, dict):
            errors.append(f"pathways[{path_index}] phải là object")
            continue
        path_slug = pathway.get("pathway_slug") or f"#{path_index}"
        refs = pathway.get("units") if isinstance(pathway.get("units"), list) else []
        if not refs:
            errors.append(f"{path_slug}: pathway chưa có unit")
        missing = [slug for slug in refs if slug not in slugs]
        if missing:
            errors.append(f"{path_slug}: unit refs không tồn tại: {missing}")
        if len(refs) != len(set(refs)):
            errors.append(f"{path_slug}: unit refs bị trùng")
    return errors


def _one(result: Any) -> dict[str, Any] | None:
    data = getattr(result, "data", None)
    if isinstance(data, list):
        return data[0] if data else None
    return data if isinstance(data, dict) else None


def _ensure_unit(unit: dict[str, Any], admin_id: str) -> dict[str, Any]:
    from database import supabase_admin
    from services import vocab_units

    existing = _one(
        supabase_admin.table("vocab_learning_units")
        .select("id,unit_slug")
        .eq("unit_slug", unit["unit_slug"])
        .limit(1)
        .execute()
    )
    if existing:
        return existing
    fields = {
        key: unit[key]
        for key in (
            "unit_slug", "display_headword", "unit_type", "sense_key",
            "construction_key", "communicative_function", "context_key", "target_level",
        )
    }
    fields["problem_tags"] = unit.get("problem_tags") or []
    fields["learner_tags"] = unit.get("learner_tags") or []
    return vocab_units.create_unit(fields, admin_id)


def _ensure_version(unit_id: str, unit: dict[str, Any], admin_id: str) -> dict[str, Any]:
    from database import supabase_admin
    from services import vocab_units

    content_hash = vocab_unit_rules.canonical_version_hash(
        unit["content"], unit["sources"], unit["tasks"],
    )
    existing = _one(
        supabase_admin.table("vocab_unit_versions")
        .select("id,unit_id,version_number,status,content_hash")
        .eq("unit_id", unit_id)
        .eq("content_hash", content_hash)
        .limit(1)
        .execute()
    )
    if existing:
        return existing
    created = vocab_units.create_version(
        unit_id,
        content=unit["content"],
        sources=unit["sources"],
        tasks=unit["tasks"],
        change_note="Curated pilot V1",
        admin_id=admin_id,
    )
    version = created.get("version")
    if not isinstance(version, dict):
        raise RuntimeError(f"Không tạo được version cho {unit['unit_slug']}")
    return version


def _map_reference_cards(unit_id: str, references: list[dict[str, Any]]) -> None:
    from database import supabase_admin

    for ref in references:
        card = _one(
            supabase_admin.table("vocab_cards")
            .select("id")
            .eq("category", ref["category"])
            .eq("slug", ref["slug"])
            .limit(1)
            .execute()
        )
        if not card:
            print(f"WARN reference card chưa tồn tại: {ref['category']}/{ref['slug']}")
            continue
        supabase_admin.table("vocab_card_unit_map").upsert({
            "card_id": card["id"], "unit_id": unit_id, "relation": "reference",
        }, on_conflict="card_id,unit_id,relation").execute()


def _seed_speaking_signals(
    unit_id: str,
    signals: list[dict[str, Any]],
    admin_id: str,
) -> None:
    """Replace one pilot unit's active signal catalog without reassigning codes."""
    from database import supabase_admin

    existing_for_unit = supabase_admin.table("vocab_speaking_signal_maps").select(
        "id,signal_code,unit_id"
    ).eq("unit_id", unit_id).execute()
    existing_rows = getattr(existing_for_unit, "data", None) or []
    desired_codes = {str(signal["signal_code"]) for signal in signals}

    for signal in signals:
        code = str(signal["signal_code"])
        existing = _one(
            supabase_admin.table("vocab_speaking_signal_maps")
            .select("id,signal_code,unit_id,created_by")
            .eq("signal_code", code)
            .limit(1)
            .execute()
        )
        if existing and str(existing.get("unit_id")) != str(unit_id):
            raise RuntimeError(
                f"signal_code {code} đã thuộc unit khác; không tự động chuyển identity"
            )
        row = {
            "signal_code": code,
            "unit_id": unit_id,
            "trigger_description": signal["trigger_description"],
            "exclusion_description": signal["exclusion_description"],
            "match_spec": signal["match_spec"],
            "reason_vi": signal["reason_vi"],
            "priority": int(signal.get("priority") or 100),
            "status": signal.get("status", "active"),
        }
        if existing:
            stored = _one(
                supabase_admin.table("vocab_speaking_signal_maps")
                .update(row)
                .eq("id", existing["id"])
                .execute()
            )
        else:
            row["created_by"] = admin_id
            stored = _one(
                supabase_admin.table("vocab_speaking_signal_maps").insert(row).execute()
            )
        if not stored:
            raise RuntimeError(f"Không seed được speaking signal {code}")

    for existing in existing_rows:
        if str(existing.get("signal_code")) not in desired_codes:
            supabase_admin.table("vocab_speaking_signal_maps").update({
                "status": "inactive",
            }).eq("id", existing["id"]).execute()


def _seed_pathways(
    pathways: list[dict[str, Any]],
    units_by_slug: dict[str, dict[str, Any]],
    admin_id: str,
    *,
    publish: bool,
) -> None:
    from database import supabase_admin

    for pathway in pathways:
        existing = _one(
            supabase_admin.table("vocab_pathways")
            .select("id,created_by")
            .eq("pathway_slug", pathway["pathway_slug"])
            .limit(1)
            .execute()
        )
        row = {
            "pathway_slug": pathway["pathway_slug"],
            "title_vi": pathway["title_vi"],
            "description_vi": pathway["description_vi"],
            "target_level": pathway["target_level"],
            "learner_tags": pathway.get("learner_tags") or [],
        }
        # Authorship is immutable attribution: stamp new pathways, but never
        # transfer an existing pathway to whichever admin refreshes the seed.
        if not existing:
            row["created_by"] = admin_id
        # A safe draft refresh must never unpublish a live pathway. Omit status
        # on the upsert unless this invocation explicitly publishes; new rows
        # still receive the table's default `draft` status.
        if publish:
            row["status"] = "published"
        stored = _one(
            supabase_admin.table("vocab_pathways").upsert(
                row, on_conflict="pathway_slug",
            ).execute()
        )
        if not stored:
            raise RuntimeError(f"Không seed được pathway {pathway['pathway_slug']}")
        links = [{
            "unit_id": units_by_slug[slug]["id"],
            "sequence": sequence,
            "rationale_vi": "Tiếp nối có chủ đích trong pathway pilot.",
        } for sequence, slug in enumerate(pathway["units"], start=1)]
        replaced = _one(
            supabase_admin.rpc("fn_replace_vocab_pathway_units", {
                "p_pathway": stored["id"], "p_links": links,
            }).execute()
        )
        if not replaced or int(replaced.get("count", -1)) != len(links):
            raise RuntimeError(
                f"Không đồng bộ được pathway units cho {pathway['pathway_slug']}",
            )


def apply_pilot(
    payload: dict[str, Any],
    *,
    admin_id: str,
    publish: bool,
    reviewers: dict[str, str],
) -> None:
    from services import vocab_units

    if publish and (set(reviewers) != set(vocab_unit_rules.REVIEW_TYPES)
                    or len(set(reviewers.values())) != 3):
        raise ValueError("Publish cần đủ ba reviewer ID khác nhau")
    units_by_slug: dict[str, dict[str, Any]] = {}
    for unit in payload["units"]:
        stored_unit = _ensure_unit(unit, admin_id)
        units_by_slug[unit["unit_slug"]] = stored_unit
        version = _ensure_version(stored_unit["id"], unit, admin_id)
        _map_reference_cards(stored_unit["id"], unit.get("reference_cards") or [])
        _seed_speaking_signals(
            stored_unit["id"], unit.get("speaking_signals") or [], admin_id,
        )
        if publish and version.get("status") != "published":
            for review_type in vocab_unit_rules.REVIEW_TYPES:
                vocab_units.review_version(
                    version["id"], review_type=review_type, decision="approved",
                    notes="Pilot V1 editorial gate", admin_id=reviewers[review_type],
                )
            vocab_units.publish_version(version["id"], admin_id)
        print(f"OK {unit['unit_slug']} version={version.get('version_number')}")
    _seed_pathways(
        payload.get("pathways") or [], units_by_slug, admin_id, publish=publish,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--content", type=Path, default=CONTENT_FILE)
    parser.add_argument("--apply", action="store_true", help="Ghi draft vào database")
    parser.add_argument("--publish", action="store_true", help="Publish sau ba review gate")
    parser.add_argument("--admin-id")
    parser.add_argument("--language-reviewer")
    parser.add_argument("--pedagogy-reviewer")
    parser.add_argument("--assessment-reviewer")
    args = parser.parse_args()
    if args.publish and not args.apply:
        parser.error("--publish yêu cầu --apply")
    payload = load_pilot(args.content)
    errors = validate_pilot(payload)
    if errors:
        print("INVALID curated pilot")
        for error in errors:
            print(f"- {error}")
        return 1
    print(
        f"VALID {len(payload['units'])} units / "
        f"{sum(len(unit['tasks']) for unit in payload['units'])} tasks / "
        f"{len(payload.get('pathways') or [])} pathways"
    )
    if not args.apply:
        return 0
    if not args.admin_id:
        parser.error("--apply yêu cầu --admin-id")
    reviewers = {
        "language": args.language_reviewer,
        "pedagogy": args.pedagogy_reviewer,
        "assessment": args.assessment_reviewer,
    }
    apply_pilot(
        payload, admin_id=args.admin_id, publish=args.publish,
        reviewers={key: value for key, value in reviewers.items() if value},
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Validate and stage one approved MASTER30 web-upload package.

Usage (from backend/):
  ../backend/venv/bin/python scripts/import_master30_grammar.py \
      --package /path/to/MASTER30-DIAGNOSTIC/web-upload --apply --promote

Validation completes before the first database mutation. A failed or partial
import remains non-active, so runtime traffic can never observe it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

supabase_admin = None

APPROVED_MANIFEST_SHA256 = "86a55dc1c3a8e5221eef9daa4772404f358ebb8f87c1284224e5197f58dbe531"
APPROVED_COUNTS = {
    "lessons": 30,
    "combined_inventory": 3338,
    "unique_runtime_items": 733,
    "productive_tasks": 19,
    "remediation_routes": 16,
    "misconceptions": 14,
    "pool_operational": 280,
    "pool_entry": 213,
    "pool_confirmation": 231,
    "pool_holdout": 222,
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: top-level JSON must be an object")
    return value


def _chunks(rows: list[dict[str, Any]], size: int = 150) -> Iterable[list[dict[str, Any]]]:
    for index in range(0, len(rows), size):
        yield rows[index:index + size]


def _lesson_refs(item: dict[str, Any], qrow: dict[str, Any]) -> list[str]:
    """Return ordered curriculum references; the first is the item's owner.

    New diagnostic sidecars may intentionally draw on two adjacent lessons and
    encode them as ``M30-B13;M30-B14``.  The full provenance remains in the
    q-matrix metadata while the normalized item FK uses the first source.
    """
    raw = str(item.get("lesson_id") or qrow.get("bank_id") or "")
    return [value.strip() for value in raw.replace(",", ";").split(";") if value.strip()]


def _enforce_approved_release(
    *,
    manifest_sha256: str,
    checks: dict[str, int],
    route_count: int,
    misconception_count: int,
    pool_counts: dict[str, int],
) -> None:
    """Reject any self-consistent package that is not the owner-approved release."""
    if manifest_sha256 != APPROVED_MANIFEST_SHA256:
        raise ValueError(
            "unapproved MASTER30 manifest: "
            f"{manifest_sha256} != {APPROVED_MANIFEST_SHA256}"
        )
    observed = {
        **checks,
        "remediation_routes": route_count,
        "misconceptions": misconception_count,
        **pool_counts,
    }
    mismatches = {
        key: (observed.get(key), expected)
        for key, expected in APPROVED_COUNTS.items()
        if observed.get(key) != expected
    }
    if mismatches:
        raise ValueError(f"approved MASTER30 count mismatch: {mismatches}")


def validate_package(root: Path) -> dict[str, Any]:
    manifest_path = root / "upload-manifest.json"
    manifest = _json(manifest_path)
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise ValueError("manifest.files is missing or empty")

    parsed: dict[str, dict[str, Any]] = {}
    for record in files:
        relative = str(record.get("path") or "")
        if not relative or relative.startswith("/") or ".." in Path(relative).parts:
            raise ValueError(f"unsafe manifest path: {relative!r}")
        path = root / relative
        if not path.is_file():
            raise ValueError(f"missing manifest file: {relative}")
        if path.stat().st_size != int(record.get("bytes", -1)):
            raise ValueError(f"byte-size mismatch: {relative}")
        if _sha256(path) != record.get("sha256"):
            raise ValueError(f"sha256 mismatch: {relative}")
        if path.suffix == ".json":
            parsed[relative] = _json(path)

    required = {
        "diagnostic/runtime-bank.json",
        "diagnostic/q-matrix.json",
        "diagnostic/curriculum-map.json",
        "diagnostic/productive-tasks.json",
        "diagnostic/remediation-routes.json",
        "diagnostic/misconception-catalog.json",
    }
    missing = required - parsed.keys()
    if missing:
        raise ValueError(f"manifest is missing required JSON: {sorted(missing)}")

    runtime = parsed["diagnostic/runtime-bank.json"]
    qmatrix = parsed["diagnostic/q-matrix.json"]
    curriculum = parsed["diagnostic/curriculum-map.json"]
    productive = parsed["diagnostic/productive-tasks.json"]
    routes = parsed["diagnostic/remediation-routes.json"]
    misconceptions = parsed["diagnostic/misconception-catalog.json"]
    expected = manifest.get("counts") or {}

    checks = {
        "lessons": len(curriculum.get("lessons") or []),
        "combined_inventory": len(qmatrix.get("items") or []),
        "unique_runtime_items": len(runtime.get("items") or []),
        "productive_tasks": len(productive.get("items") or []),
    }
    for key in ("lessons", "combined_inventory", "unique_runtime_items"):
        if checks[key] != int(expected.get(key, -1)):
            raise ValueError(f"count mismatch for {key}: {checks[key]} != {expected.get(key)}")
    if checks["productive_tasks"] != 19:
        raise ValueError("productive task registry must contain 19 tasks")

    runtime_items = runtime.get("items") or []
    qmatrix_items = qmatrix.get("items") or []
    qmatrix_ids = [str(row.get("item_id") or "") for row in qmatrix_items]
    if not all(qmatrix_ids) or len(qmatrix_ids) != len(set(qmatrix_ids)):
        raise ValueError("q-matrix item IDs are missing or duplicated")
    qindex = {str(row["item_id"]): row for row in qmatrix_items}
    lesson_ids = {str(row.get("master_id") or "") for row in (curriculum.get("lessons") or [])}
    ids = [str(item.get("id") or "") for item in runtime_items]
    if not all(ids) or len(ids) != len(set(ids)):
        raise ValueError("runtime item IDs are missing or duplicated")

    role_sets = {role: set() for role in ("operational", "entry", "confirmation", "holdout")}
    family_roles: dict[str, set[str]] = {}
    parallel_roles: dict[str, set[str]] = {}
    for item in runtime_items:
        qrow = qindex.get(str(item["id"]))
        if not qrow:
            raise ValueError(f"{item.get('id')}: missing q-matrix row")
        refs = _lesson_refs(item, qrow)
        if not refs or any(lesson_id not in lesson_ids for lesson_id in refs):
            raise ValueError(f"{item.get('id')}: invalid lesson mapping {refs!r}")
        response = item.get("response") or {}
        options = response.get("options") or []
        correct = response.get("correct_index")
        if not isinstance(options, list) or len(options) < 2:
            raise ValueError(f"{item.get('id')}: invalid options")
        if not isinstance(correct, int) or not 0 <= correct < len(options):
            raise ValueError(f"{item.get('id')}: invalid answer key")
        runtime_meta = item.get("runtime") or {}
        roles = set(runtime_meta.get("pools") or [])
        for role in roles:
            if role in role_sets:
                role_sets[role].add(item["id"])
        primary_roles = roles & {"operational", "confirmation", "holdout"}
        if len(primary_roles) != 1:
            raise ValueError(f"{item.get('id')}: must have exactly one primary pool role")
        role = next(iter(primary_roles))
        family_roles.setdefault(str(runtime_meta.get("stimulus_family") or ""), set()).add(role)
        parallel = str(runtime_meta.get("parallel_set_id") or "")
        if parallel:
            parallel_roles.setdefault(parallel, set()).add(role)

    if not role_sets["entry"].issubset(role_sets["operational"]):
        raise ValueError("Entry pool is not a subset of Operational")
    for label, index in (("stimulus family", family_roles), ("parallel set", parallel_roles)):
        leaked = [key for key, roles in index.items() if key and len(roles) > 1]
        if leaked:
            raise ValueError(f"{label} leaks across primary pools: {leaked[:5]}")

    pool_expected = {
        "operational": "pool_operational", "entry": "pool_entry",
        "confirmation": "pool_confirmation", "holdout": "pool_holdout",
    }
    for role, key in pool_expected.items():
        if len(role_sets[role]) != int(expected.get(key, -1)):
            raise ValueError(f"count mismatch for {role}")

    manifest_sha = _sha256(manifest_path)
    _enforce_approved_release(
        manifest_sha256=manifest_sha,
        checks=checks,
        route_count=len(routes.get("items") or []),
        misconception_count=len(misconceptions.get("items") or []),
        pool_counts={
            f"pool_{role}": len(values) for role, values in role_sets.items()
        },
    )
    return {
        "manifest": manifest,
        "manifest_sha256": manifest_sha,
        "release_key": f"master30-{manifest_sha[:16]}",
        "runtime": runtime_items,
        "qmatrix": qmatrix_items,
        "lessons": curriculum.get("lessons") or [],
        "productive": productive.get("items") or [],
        "routes": routes.get("items") or [],
        "misconceptions": misconceptions.get("items") or [],
        "checks": checks,
    }


def _delete_release_children(release_id: str) -> None:
    for table in (
        "grammar_diagnostic_reports", "grammar_diagnostic_responses",
        "grammar_exposure_events", "grammar_diagnostic_sessions",
        "grammar_misconceptions", "grammar_remediation_routes",
        "grammar_productive_tasks", "grammar_item_qmatrix", "grammar_items",
        "grammar_lessons",
    ):
        supabase_admin.table(table).delete().eq("release_id", release_id).execute()


def import_package(payload: dict[str, Any], promote: bool) -> dict[str, Any]:
    global supabase_admin
    if supabase_admin is None:
        from database import supabase_admin as client
        supabase_admin = client
    existing = (
        supabase_admin.table("grammar_content_releases").select("*")
        .eq("manifest_sha256", payload["manifest_sha256"]).limit(1).execute().data
    ) or []
    if existing and existing[0].get("status") in {"validated", "active", "retired"}:
        stored = existing[0]
        # Validated content is already immutable. Re-importing its bytes is
        # unnecessary; validated and retired releases are both promotable.
        if promote and stored.get("status") in {"validated", "retired"}:
            promoted = supabase_admin.rpc(
                "promote_grammar_content_release", {"p_release_id": stored["id"]}
            ).execute().data
            stored = promoted[0] if isinstance(promoted, list) and promoted else promoted or stored
        return {"release": stored, "idempotent": True}

    if existing:
        release = existing[0]
        _delete_release_children(release["id"])
        supabase_admin.table("grammar_content_releases").update({
            "status": "staging", "validation": {}, "validated_at": None,
        }).eq("id", release["id"]).execute()
    else:
        rows = supabase_admin.table("grammar_content_releases").insert({
            "release_key": payload["release_key"],
            "manifest_sha256": payload["manifest_sha256"],
            "manifest": payload["manifest"],
            "live_calibrated_ready": False,
        }).execute().data or []
        if not rows:
            raise RuntimeError("could not create grammar content release")
        release = rows[0]
    release_id = release["id"]

    qindex = {str(row.get("item_id") or ""): row for row in payload["qmatrix"]}
    lesson_rows = []
    for row in payload["lessons"]:
        lesson_id = str(row.get("master_id") or "")
        lesson_rows.append({
            "release_id": release_id, "lesson_id": lesson_id,
            "lesson_no": int(row.get("lesson_no")),
            "title": str(row.get("title") or lesson_id), "metadata": row,
        })
    item_rows = []
    for item in payload["runtime"]:
        meta = item["runtime"]
        response = item["response"]
        qrow = qindex.get(item["id"]) or {}
        lesson_id = _lesson_refs(item, qrow)[0]
        item_rows.append({
            "release_id": release_id, "item_id": item["id"],
            "lesson_id": lesson_id, "prompt": item["prompt"],
            "options": response["options"], "correct_index": response["correct_index"],
            "explanation": item.get("explanation"),
            "distractor_explanations": response.get("distractor_explanations") or [],
            "translation_source": item.get("translation_source"),
            "translation_vi": item.get("translation_vi"),
            "attribute_id": meta["attribute_primary"],
            "process_facet": meta["process_facet"],
            "subdomain": meta["subdomain"], "module": meta.get("module") or "ALL",
            "diagnostic_status": meta["diagnostic_status"],
            "entry_safe": "entry" in (meta.get("pools") or []),
            "stimulus_family": meta["stimulus_family"],
            "parallel_set_id": meta.get("parallel_set_id"),
            "governance": {
                "editorial_level": item.get("editorial_level"),
                "format_code": item.get("format_code"),
                "course_specific_level": qrow.get("course_specific_level"),
                "remediation_route_id": qrow.get("remediation_route_id"),
            },
        })
    table_rows = {
        "grammar_lessons": lesson_rows,
        "grammar_items": item_rows,
        "grammar_item_qmatrix": [{"release_id": release_id, "item_id": row["item_id"], "metadata": row} for row in payload["qmatrix"]],
        "grammar_productive_tasks": [{"release_id": release_id, "task_id": row["task_id"], "task": row, "auto_scoring_enabled": False} for row in payload["productive"]],
        "grammar_remediation_routes": [{"release_id": release_id, "route_id": row["route_id"], "attribute_id": row["attribute_id"], "route": row} for row in payload["routes"]],
        "grammar_misconceptions": [{"release_id": release_id, "attribute_id": row["attribute_id"], "learner_copy": row} for row in payload["misconceptions"]],
    }
    for table, rows in table_rows.items():
        for chunk in _chunks(rows):
            supabase_admin.table(table).insert(chunk).execute()

    validation = {
        "passed": True,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "counts": {
            **payload["checks"],
            "remediation_routes": len(payload["routes"]),
            "misconceptions": len(payload["misconceptions"]),
        },
        "structural_alpha_ready": True,
        "live_calibrated_ready": False,
    }
    stored = (supabase_admin.table("grammar_content_releases").update({
        "status": "validated", "validation": validation,
        "validated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", release_id).execute().data or [{}])[0]
    if promote:
        promoted = supabase_admin.rpc(
            "promote_grammar_content_release", {"p_release_id": release_id}
        ).execute().data
        stored = promoted[0] if isinstance(promoted, list) and promoted else promoted or stored
    return {"release": stored, "idempotent": False}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", required=True, type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--promote", action="store_true")
    args = parser.parse_args()
    if args.promote and not args.apply:
        parser.error("--promote requires --apply")
    payload = validate_package(args.package.resolve())
    if not args.apply:
        print(json.dumps({
            "valid": True, "release_key": payload["release_key"],
            "manifest_sha256": payload["manifest_sha256"],
            "checks": payload["checks"],
        }, ensure_ascii=False, indent=2))
        return
    result = import_package(payload, args.promote)
    release = result["release"]
    print(json.dumps({
        "release_id": release.get("id"), "status": release.get("status"),
        "idempotent": result["idempotent"],
        "live_calibrated_ready": bool(release.get("live_calibrated_ready")),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

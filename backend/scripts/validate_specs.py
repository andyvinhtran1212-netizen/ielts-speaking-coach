#!/usr/bin/env python3
"""Validate Aver Learning's lean spec-driven development artifacts.

The validator is deliberately dependency-light (PyYAML is already part of the
backend runtime/test tree) and read-only. It validates canonical feature specs
on every run and, for pull_request events, enforces the machine-readable change
classification fields in the PR template.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
FEATURE_DIR_RE = re.compile(r"^(?P<number>\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*$")
SPEC_ID_RE = re.compile(r"^[A-Z][A-Z0-9]*-(?P<number>\d{4})$")
REQUIREMENT_DECLARATION_RE = re.compile(
    r"^\s*-\s+\*\*(FR-\d{3}):\*\*\s+\S",
    re.MULTILINE,
)
EVIDENCE_ROW_RE = re.compile(
    r"^\|\s*(FR-\d{3})\s*\|\s*(\S(?:.*\S)?)\s*\|\s*([A-Za-z]+)\s*\|\s*$",
    re.MULTILINE,
)
ALLOWED_STATUSES = {
    "draft",
    "approved",
    "implementing",
    "verified",
    "shipped",
    "superseded",
}
ALLOWED_RISKS = {"low", "medium", "high", "critical"}
ALLOWED_CHANGE_CLASSES = {"hotfix", "small", "content", "feature", "high-risk"}
FINAL_STATUSES = {"verified", "shipped"}
IMPLEMENTABLE_SPEC_STATUSES = {"approved", "implementing", "verified", "shipped"}
REQUIRED_FEATURE_FILES = ("spec.md", "plan.md", "tasks.md", "verification.md")
LEGACY_SPEC_DIRS = {"general"}
REQUIRED_FOUNDATION_FILES = (
    "README.md",
    "_meta/constitution.md",
    "_templates/spec.md",
    "_templates/plan.md",
    "_templates/tasks.md",
    "_templates/verification.md",
    "_templates/ui-states.md",
    "_templates/rollout.md",
)
REQUIRED_SECTIONS = {
    "spec.md": (
        "Problem",
        "Scope",
        "Non-goals",
        "Requirements",
        "Acceptance scenarios",
        "Success criteria",
    ),
    "plan.md": (
        "Architecture impact",
        "Data and contracts",
        "Rollout and rollback",
        "Verification strategy",
    ),
    "verification.md": ("Requirement coverage",),
}


def _read(path: Path, errors: list[str]) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        errors.append(f"{path}: cannot read UTF-8 text ({exc})")
        return ""


def _frontmatter(path: Path, text: str, errors: list[str]) -> dict[str, Any]:
    if not text.startswith("---\n"):
        errors.append(f"{path}: spec.md must start with YAML frontmatter")
        return {}
    try:
        _, raw, _ = text.split("---", 2)
        parsed = yaml.safe_load(raw)
    except (ValueError, yaml.YAMLError) as exc:
        errors.append(f"{path}: invalid YAML frontmatter ({exc})")
        return {}
    if not isinstance(parsed, dict):
        errors.append(f"{path}: YAML frontmatter must be a mapping")
        return {}
    return parsed


def _has_heading(text: str, heading: str) -> bool:
    return bool(re.search(rf"^##\s+{re.escape(heading)}\s*$", text, re.MULTILINE | re.IGNORECASE))


def _section(text: str, heading: str) -> str:
    match = re.search(
        rf"^##\s+{re.escape(heading)}\s*$\n(?P<body>.*?)(?=^##\s+|\Z)",
        text,
        re.MULTILINE | re.DOTALL | re.IGNORECASE,
    )
    return match.group("body") if match else ""


def validate_repository(root: Path) -> tuple[list[str], dict[str, Path]]:
    errors: list[str] = []
    specs = root / "specs"
    if not specs.is_dir():
        return [f"{specs}: canonical specs directory is missing"], {}

    for relative in REQUIRED_FOUNDATION_FILES:
        if not (specs / relative).is_file():
            errors.append(f"{specs / relative}: required SDD foundation file is missing")

    index = _read(specs / "README.md", errors)
    seen_ids: dict[str, Path] = {}
    feature_dirs = sorted(
        path
        for path in specs.iterdir()
        if path.is_dir()
        and not path.name.startswith("_")
        and path.name not in LEGACY_SPEC_DIRS
    )
    if not feature_dirs:
        errors.append(f"{specs}: at least one dogfood or product feature directory is required")

    for feature in feature_dirs:
        match = FEATURE_DIR_RE.fullmatch(feature.name)
        if not match:
            errors.append(
                f"{feature}: feature directory must use NNNN-kebab-case (reserved directories start with _ )"
            )
            continue

        for filename in REQUIRED_FEATURE_FILES:
            if not (feature / filename).is_file():
                errors.append(f"{feature / filename}: required feature artifact is missing")

        spec_path = feature / "spec.md"
        if not spec_path.is_file():
            continue
        texts: dict[str, str] = {}
        for filename in REQUIRED_FEATURE_FILES:
            path = feature / filename
            if path.is_file():
                texts[filename] = _read(path, errors)

        metadata = _frontmatter(spec_path, texts.get("spec.md", ""), errors)
        for field in ("id", "title", "status", "risk", "owner"):
            if not metadata.get(field):
                errors.append(f"{spec_path}: missing required frontmatter field '{field}'")

        spec_id = metadata.get("id")
        if isinstance(spec_id, str):
            id_match = SPEC_ID_RE.fullmatch(spec_id)
            if not id_match:
                errors.append(f"{spec_path}: id must use PREFIX-NNNN")
            elif id_match.group("number") != match.group("number"):
                errors.append(
                    f"{spec_path}: id suffix {id_match.group('number')} must match directory prefix {match.group('number')}"
                )
            if spec_id in seen_ids:
                errors.append(f"{spec_path}: duplicate id {spec_id}; first declared by {seen_ids[spec_id]}")
            else:
                seen_ids[spec_id] = feature
            if spec_id not in index:
                errors.append(f"{specs / 'README.md'}: active index does not mention {spec_id}")

        status = metadata.get("status")
        if status not in ALLOWED_STATUSES:
            errors.append(f"{spec_path}: status must be one of {sorted(ALLOWED_STATUSES)}")
        risk = metadata.get("risk")
        if risk not in ALLOWED_RISKS:
            errors.append(f"{spec_path}: risk must be one of {sorted(ALLOWED_RISKS)}")

        for filename, headings in REQUIRED_SECTIONS.items():
            text = texts.get(filename, "")
            for heading in headings:
                if not _has_heading(text, heading):
                    errors.append(f"{feature / filename}: missing '## {heading}' section")

        requirement_section = _section(texts.get("spec.md", ""), "Requirements")
        requirements = REQUIREMENT_DECLARATION_RE.findall(requirement_section)
        unique_requirements = sorted(set(requirements))
        if not unique_requirements:
            errors.append(
                f"{spec_path}: declare at least one requirement as '- **FR-NNN:** ...'"
            )
        if len(requirements) != len(unique_requirements):
            errors.append(f"{spec_path}: functional requirement declarations must be unique")

        verification = texts.get("verification.md", "")
        evidence_rows = EVIDENCE_ROW_RE.findall(verification)
        evidence_ids = [requirement for requirement, _, _ in evidence_rows]
        verification_ids = set(evidence_ids)
        for requirement in unique_requirements:
            matching_results = [
                result
                for evidence_id, _, result in evidence_rows
                if evidence_id == requirement
            ]
            if not matching_results:
                errors.append(f"{feature / 'verification.md'}: no evidence row for {requirement}")
            elif len(matching_results) > 1:
                errors.append(
                    f"{feature / 'verification.md'}: duplicate evidence rows for {requirement}"
                )
            elif status in FINAL_STATUSES and matching_results[0].upper() not in {
                "PASS",
                "MANUAL",
            }:
                errors.append(
                    f"{feature / 'verification.md'}: final feature requires PASS or MANUAL evidence for {requirement}"
                )
        for unknown in sorted(verification_ids - set(unique_requirements)):
            errors.append(f"{feature / 'verification.md'}: evidence references unknown {unknown}")

        tasks = texts.get("tasks.md", "")
        if tasks and not re.search(r"^- \[[ xX]\] ", tasks, re.MULTILINE):
            errors.append(f"{feature / 'tasks.md'}: declare at least one checkbox task")
        if status in FINAL_STATUSES and re.search(r"^- \[ \] ", tasks, re.MULTILINE):
            errors.append(f"{feature / 'tasks.md'}: final feature still has incomplete required tasks")

    return errors, seen_ids


def _body_field(body: str, field: str) -> str | None:
    match = re.search(rf"^{re.escape(field)}:\s*(.*?)\s*$", body, re.MULTILINE | re.IGNORECASE)
    if not match:
        return None
    value = re.sub(r"<!--.*?-->", "", match.group(1)).strip().strip("`")
    return value or None


def validate_pull_request(event: dict[str, Any], known_specs: dict[str, Path]) -> list[str]:
    pull = event.get("pull_request")
    if not isinstance(pull, dict):
        return []

    base = str((pull.get("base") or {}).get("ref") or "")
    head = str((pull.get("head") or {}).get("ref") or "")
    if base == "main" and head == "staging":
        return []

    body = str(pull.get("body") or "")
    change_class = (_body_field(body, "Change class") or "").lower()
    spec_id = (_body_field(body, "Spec") or "").upper()
    errors: list[str] = []
    if change_class not in ALLOWED_CHANGE_CLASSES:
        errors.append(
            "pull request: 'Change class:' must be one of "
            + ", ".join(sorted(ALLOWED_CHANGE_CLASSES))
        )
    if not spec_id:
        errors.append("pull request: add 'Spec: N/A' or an existing spec ID")
        return errors

    requires_spec = change_class in {"feature", "high-risk"}
    if requires_spec and spec_id == "N/A":
        errors.append(f"pull request: change class '{change_class}' requires an approved spec ID")
    if spec_id != "N/A":
        feature = known_specs.get(spec_id)
        if feature is None:
            errors.append(f"pull request: Spec '{spec_id}' does not exist in specs/")
        else:
            metadata_text = (feature / "spec.md").read_text(encoding="utf-8")
            metadata = yaml.safe_load(metadata_text.split("---", 2)[1]) or {}
            if requires_spec and metadata.get("status") not in IMPLEMENTABLE_SPEC_STATUSES:
                errors.append(
                    f"pull request: Spec '{spec_id}' must be approved and not superseded"
                )
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=REPO_ROOT)
    parser.add_argument("--github-event", type=Path)
    args = parser.parse_args()

    root = args.root.resolve()
    errors, known_specs = validate_repository(root)
    if args.github_event and args.github_event.is_file():
        try:
            event = json.loads(args.github_event.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            errors.append(f"{args.github_event}: cannot parse GitHub event ({exc})")
        else:
            errors.extend(validate_pull_request(event, known_specs))

    if errors:
        print("Spec governance failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"Spec governance passed: {len(known_specs)} feature spec(s) validated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

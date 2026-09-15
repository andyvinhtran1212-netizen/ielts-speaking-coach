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
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
FEATURE_DIR_RE = re.compile(r"^(?P<number>\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*$")
SPEC_ID_RE = re.compile(r"^[A-Z][A-Z0-9]*-(?P<number>\d{4})$")
REQUIREMENT_MARKER_RE = re.compile(
    r"^\s*-\s+\*\*(FR-[^\s:*]+):\*\*(?:[ \t]*(.*))?$",
    re.MULTILINE,
)
REQUIREMENT_WITH_TEXT_RE = re.compile(
    r"^\s*-\s+\*\*(FR-[^\s:*]+):\*\*\s+(\S.*?)(?=^\s*-\s+\*\*FR-[^\s:*]+:\*\*|\Z)",
    re.MULTILINE | re.DOTALL,
)
VALID_REQUIREMENT_ID_RE = re.compile(r"^FR-\d{3}$")
EVIDENCE_ROW_RE = re.compile(
    r"^\|\s*(FR-\d{3})\s*\|\s*(\S(?:.*\S)?)\s*\|\s*([A-Za-z/]+)\s*\|\s*$",
    re.MULTILINE,
)
INDEX_ROW_RE = re.compile(
    r"^\|\s*([A-Z][A-Z0-9]*-\d{4})\s*\|\s*([^|]+?)\s*\|\s*([a-z]+)\s*\|\s*([a-z]+)\s*\|\s*\[[^]]+]\(([^)]+)\)\s*\|\s*$",
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
ALLOWED_EVIDENCE_RESULTS = {"PENDING", "PASS", "MANUAL", "N/A"}
REQUIRED_FEATURE_FILES = ("spec.md", "plan.md", "tasks.md", "verification.md")
HIGH_RISK_REQUIRED_FILES = ("ui-states.md", "rollout.md")
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
HIGH_RISK_REQUIRED_SECTIONS = {
    "rollout.md": (
        "Preconditions",
        "Staging",
        "Production",
        "Rollback and repair",
        "Observability",
    ),
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


def _declared_requirements(spec_text: str) -> dict[str, str]:
    return {
        requirement: re.sub(r"\s+", " ", description).strip()
        for requirement, description in REQUIREMENT_WITH_TEXT_RE.findall(
            _section(spec_text, "Requirements")
        )
        if VALID_REQUIREMENT_ID_RE.fullmatch(requirement)
    }


def _structured_evidence(evidence: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for item in evidence.split(";"):
        key, separator, value = item.partition("=")
        if separator and key.strip() and value.strip():
            fields[key.strip().lower()] = value.strip()
    return fields


def _evidence_detail_error(result: str, evidence: str) -> str | None:
    normalized = result.upper()
    if normalized == "MANUAL":
        fields = _structured_evidence(evidence)
        required = {"reviewer", "environment", "date", "observed"}
        if not required <= fields.keys() or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}", fields.get("date", "")
        ):
            return (
                "MANUAL evidence must use reviewer=...; environment=...; "
                "date=YYYY-MM-DD; observed=..."
            )
    elif normalized == "N/A":
        fields = _structured_evidence(evidence)
        if len(fields.get("rationale", "")) < 12:
            return "N/A evidence must use rationale=<specific reason>"
    return None


def validate_repository(root: Path) -> tuple[list[str], dict[str, Path]]:
    errors: list[str] = []
    specs = root / "specs"
    if not specs.is_dir():
        return [f"{specs}: canonical specs directory is missing"], {}

    for relative in REQUIRED_FOUNDATION_FILES:
        if not (specs / relative).is_file():
            errors.append(f"{specs / relative}: required SDD foundation file is missing")

    index = _read(specs / "README.md", errors)
    index_rows: dict[str, tuple[str, str, str]] = {}
    for index_id, _, index_status, index_risk, index_path in INDEX_ROW_RE.findall(index):
        if index_id in index_rows:
            errors.append(f"{specs / 'README.md'}: duplicate active-index row for {index_id}")
            continue
        index_rows[index_id] = (index_status, index_risk, index_path.removeprefix("./"))
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
            value = metadata.get(field)
            if not isinstance(value, str) or not value.strip():
                errors.append(
                    f"{spec_path}: frontmatter field '{field}' must be a non-empty string"
                )

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
            index_row = index_rows.get(spec_id)
            if index_row is None:
                errors.append(f"{specs / 'README.md'}: active index has no exact row for {spec_id}")
            else:
                index_status, index_risk, index_path = index_row
                expected_path = f"{feature.name}/spec.md"
                if index_status != metadata.get("status"):
                    errors.append(
                        f"{specs / 'README.md'}: {spec_id} status is {index_status!r}, expected {metadata.get('status')!r}"
                    )
                if index_risk != metadata.get("risk"):
                    errors.append(
                        f"{specs / 'README.md'}: {spec_id} risk is {index_risk!r}, expected {metadata.get('risk')!r}"
                    )
                if index_path != expected_path:
                    errors.append(
                        f"{specs / 'README.md'}: {spec_id} path is {index_path!r}, expected {expected_path!r}"
                    )

        status = metadata.get("status")
        if status not in ALLOWED_STATUSES:
            errors.append(f"{spec_path}: status must be one of {sorted(ALLOWED_STATUSES)}")
        risk = metadata.get("risk")
        if risk not in ALLOWED_RISKS:
            errors.append(f"{spec_path}: risk must be one of {sorted(ALLOWED_RISKS)}")

        if risk in {"high", "critical"}:
            for filename in HIGH_RISK_REQUIRED_FILES:
                path = feature / filename
                if not path.is_file():
                    errors.append(f"{path}: high-risk feature artifact is required")
                    continue
                texts[filename] = _read(path, errors)
            for filename, headings in HIGH_RISK_REQUIRED_SECTIONS.items():
                text = texts.get(filename, "")
                for heading in headings:
                    if not _has_heading(text, heading):
                        errors.append(f"{feature / filename}: missing '## {heading}' section")
            if "| Surface | Loading |" not in texts.get("ui-states.md", ""):
                errors.append(
                    f"{feature / 'ui-states.md'}: high-risk UI state matrix is missing"
                )

        for filename, headings in REQUIRED_SECTIONS.items():
            text = texts.get(filename, "")
            for heading in headings:
                if not _has_heading(text, heading):
                    errors.append(f"{feature / filename}: missing '## {heading}' section")

        requirement_section = _section(texts.get("spec.md", ""), "Requirements")
        requirement_markers = REQUIREMENT_MARKER_RE.findall(requirement_section)
        requirements: list[str] = []
        malformed_requirements = sorted(
            requirement
            for requirement, _ in set(requirement_markers)
            if not VALID_REQUIREMENT_ID_RE.fullmatch(requirement)
        )
        for requirement in malformed_requirements:
            errors.append(
                f"{spec_path}: malformed functional requirement {requirement!r}; use FR-NNN"
            )
        for requirement, description in requirement_markers:
            if VALID_REQUIREMENT_ID_RE.fullmatch(requirement):
                requirements.append(requirement)
                if not description.strip():
                    errors.append(
                        f"{spec_path}: functional requirement {requirement} must have an inline description"
                    )
        unique_requirements = sorted(set(requirements))
        if not unique_requirements:
            errors.append(
                f"{spec_path}: declare at least one requirement as '- **FR-NNN:** ...'"
            )
        if len(requirements) != len(unique_requirements):
            errors.append(f"{spec_path}: functional requirement declarations must be unique")

        verification = texts.get("verification.md", "")
        coverage_section = re.sub(
            r"<!--.*?-->",
            "",
            _section(verification, "Requirement coverage"),
            flags=re.DOTALL,
        )
        evidence_rows = EVIDENCE_ROW_RE.findall(coverage_section)
        evidence_ids = [requirement for requirement, _, _ in evidence_rows]
        verification_ids = set(evidence_ids)
        for evidence_id, evidence, result in evidence_rows:
            if result.upper() not in ALLOWED_EVIDENCE_RESULTS:
                errors.append(
                    f"{feature / 'verification.md'}: {evidence_id} result must be one of {sorted(ALLOWED_EVIDENCE_RESULTS)}"
                )
            elif detail_error := _evidence_detail_error(result, evidence):
                errors.append(
                    f"{feature / 'verification.md'}: {evidence_id} {detail_error}"
                )
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
            elif status in FINAL_STATUSES and matching_results[0].upper() not in ALLOWED_EVIDENCE_RESULTS - {"PENDING"}:
                errors.append(
                    f"{feature / 'verification.md'}: final feature requires PASS, MANUAL, or reasoned N/A evidence for {requirement}"
                )
        for unknown in sorted(verification_ids - set(unique_requirements)):
            errors.append(f"{feature / 'verification.md'}: evidence references unknown {unknown}")

        tasks = texts.get("tasks.md", "")
        if not re.search(r"^\s*-\s+\[[ xX]\]\s+", tasks, re.MULTILINE):
            errors.append(f"{feature / 'tasks.md'}: declare at least one checkbox task")
        if status in FINAL_STATUSES and re.search(r"^\s*-\s+\[ \]\s+", tasks, re.MULTILINE):
            errors.append(f"{feature / 'tasks.md'}: final feature still has incomplete required tasks")

    for orphan_id in sorted(set(index_rows) - set(seen_ids)):
        errors.append(
            f"{specs / 'README.md'}: active index references missing spec {orphan_id}"
        )

    return errors, seen_ids


def _body_field(body: str, field: str) -> str | None:
    match = re.search(rf"^{re.escape(field)}:\s*(.*?)\s*$", body, re.MULTILINE | re.IGNORECASE)
    if not match:
        return None
    value = re.sub(r"<!--.*?-->", "", match.group(1)).strip().strip("`")
    return value or None


def _git_show(root: Path, revision: str, path: str) -> tuple[bool, str | None]:
    """Return whether the revision exists and text at path when it exists."""
    revision_check = subprocess.run(
        ["git", "-C", str(root), "cat-file", "-e", f"{revision}^{{commit}}"],
        capture_output=True,
        text=True,
        check=False,
    )
    if revision_check.returncode != 0:
        return False, None
    result = subprocess.run(
        ["git", "-C", str(root), "show", f"{revision}:{path}"],
        capture_output=True,
        text=True,
        check=False,
    )
    return True, result.stdout if result.returncode == 0 else None


def _requirement_coverage(body: str) -> list[tuple[str, str]]:
    section = _section(body, "Requirement coverage")
    return re.findall(
        r"^\s*[-*]\s+(FR-\d{3})(?!\d)\s*(?:->|:)\s*(.*?)\s*$",
        section,
        re.MULTILINE,
    )


def _meaningful_section(body: str, heading: str) -> bool:
    section = re.sub(r"<!--.*?-->", "", _section(body, heading), flags=re.DOTALL)
    section = re.sub(r"^\s*-\s*\[[ xX]\].*$", "", section, flags=re.MULTILINE)
    return bool(section.strip())


def validate_pull_request(
    event: dict[str, Any], known_specs: dict[str, Path], root: Path = REPO_ROOT
) -> list[str]:
    pull = event.get("pull_request")
    if not isinstance(pull, dict):
        return []

    base = str((pull.get("base") or {}).get("ref") or "")
    base_sha = str((pull.get("base") or {}).get("sha") or "")
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
    if change_class in {"hotfix", "small", "content"}:
        for heading in ("Problem", "Expected behavior", "Scope", "Verification"):
            if not _meaningful_section(body, heading):
                errors.append(
                    f"pull request: change class '{change_class}' requires a non-empty '## {heading}' section"
                )
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
            if change_class == "high-risk" and metadata.get("risk") not in {
                "high",
                "critical",
            }:
                errors.append(
                    f"pull request: high-risk change requires a high or critical risk spec; {spec_id} is {metadata.get('risk')!r}"
                )
            if requires_spec:
                approved_requirements: dict[str, str] | None = None
                bootstrap = False
                if not base_sha:
                    errors.append("pull request: base SHA is required to verify prior spec approval")
                else:
                    revision_exists, base_spec_text = _git_show(
                        root,
                        base_sha,
                        str((feature / "spec.md").relative_to(root)),
                    )
                    _, base_constitution = _git_show(
                        root, base_sha, "specs/_meta/constitution.md"
                    )
                    bootstrap = spec_id == "SDD-0000" and base_constitution is None
                    if not revision_exists:
                        errors.append(
                            "pull request: cannot resolve base SHA to verify prior spec approval"
                        )
                    elif base_spec_text is None and not bootstrap:
                        errors.append(
                            f"pull request: Spec '{spec_id}' must be approved in the base revision before implementation"
                        )
                    elif base_spec_text is not None:
                        approved_requirements = _declared_requirements(base_spec_text)
                        try:
                            base_metadata = yaml.safe_load(
                                base_spec_text.split("---", 2)[1]
                            ) or {}
                        except (IndexError, yaml.YAMLError):
                            base_metadata = {}
                        if base_metadata.get("status") not in IMPLEMENTABLE_SPEC_STATUSES:
                            errors.append(
                                f"pull request: Spec '{spec_id}' was not approved in the base revision"
                            )
                        if change_class == "high-risk" and base_metadata.get(
                            "risk"
                        ) not in {"high", "critical"}:
                            errors.append(
                                f"pull request: {spec_id} was not approved as high or critical risk in the base revision"
                            )

                coverage_rows = _requirement_coverage(body)
                coverage = [requirement for requirement, _ in coverage_rows]
                current_requirements = _declared_requirements(metadata_text)
                if bootstrap:
                    approved_requirements = current_requirements
                if approved_requirements is not None:
                    for requirement in sorted(
                        current_requirements.keys() - approved_requirements.keys()
                    ):
                        errors.append(
                            f"pull request: {requirement} was not approved in the base revision for {spec_id}"
                        )
                    for requirement in sorted(
                        approved_requirements.keys() - current_requirements.keys()
                    ):
                        errors.append(
                            f"pull request: {requirement} was removed after base approval for {spec_id}"
                        )
                    for requirement in sorted(
                        current_requirements.keys() & approved_requirements.keys()
                    ):
                        if (
                            current_requirements[requirement]
                            != approved_requirements[requirement]
                        ):
                            errors.append(
                                f"pull request: {requirement} definition changed after base approval for {spec_id}"
                            )
                if not coverage:
                    errors.append(
                        "pull request: '## Requirement coverage' must list at least one exact FR-NNN"
                    )
                for requirement, evidence in coverage_rows:
                    if not evidence:
                        errors.append(
                            f"pull request: requirement coverage for {requirement} must include evidence after the arrow"
                        )
                for duplicate in sorted(
                    requirement
                    for requirement in set(coverage)
                    if coverage.count(requirement) > 1
                ):
                    errors.append(
                        f"pull request: duplicate requirement coverage entry for {duplicate}"
                    )
                for requirement in coverage:
                    if requirement not in current_requirements:
                        errors.append(
                            f"pull request: requirement coverage references unknown {requirement} for {spec_id}"
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
            errors.extend(validate_pull_request(event, known_specs, root))

    if errors:
        print("Spec governance failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"Spec governance passed: {len(known_specs)} feature spec(s) validated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

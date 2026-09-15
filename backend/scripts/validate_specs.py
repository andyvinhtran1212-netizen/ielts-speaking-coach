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
from datetime import date as calendar_date
from pathlib import Path
from typing import Any

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
FEATURE_DIR_RE = re.compile(r"^(?P<number>\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*$")
SPEC_ID_RE = re.compile(r"^[A-Z][A-Z0-9]*-(?P<number>\d{4})$")
REQUIREMENT_MARKER_RE = re.compile(
    r"^ {0,3}-\s+\*\*(FR-[^\s:*]+):\*\*(?:[ \t]*(.*))?$",
    re.MULTILINE,
)
REQUIREMENT_WITH_TEXT_RE = re.compile(
    r"^ {0,3}-\s+\*\*(FR-[^\s:*]+):\*\*\s+(\S.*?)(?=^ {0,3}-\s+\*\*FR-[^\s:*]+:\*\*|\Z)",
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
HIGH_RISK_PATH_RE = re.compile(r"^(?:backend|supabase)/migrations/.*\.sql$")
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
CONSTITUTION_SECTIONS = (
    "1. Canonical system boundaries",
    "2. Proportional specification",
    "3. Executable contracts",
    "4. Data and migration safety",
    "5. Complete user states",
    "6. AI quality is behavioral, not only structural",
    "7. Traceability and convergence",
    "8. Scoped parallel work",
    "9. Staging-first release",
    "10. Documentation lifecycle",
)
TEMPLATE_SECTIONS = {
    "_templates/spec.md": (
        "Problem",
        "Scope",
        "Non-goals",
        "Requirements",
        "Acceptance scenarios",
        "Success criteria",
    ),
    "_templates/plan.md": (
        "Architecture impact",
        "Data and contracts",
        "Rollout and rollback",
        "Verification strategy",
    ),
    "_templates/verification.md": ("Requirement coverage",),
    "_templates/rollout.md": (
        "Preconditions",
        "Staging",
        "Production",
        "Rollback and repair",
        "Observability",
    ),
}
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


def _frontmatter_mapping(text: str) -> dict[str, Any]:
    try:
        if not text.startswith("---\n"):
            return {}
        parsed = yaml.safe_load(text.split("---", 2)[1])
    except (IndexError, yaml.YAMLError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _semver(value: Any) -> tuple[int, int, int] | None:
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", value)
    return tuple(map(int, match.groups())) if match else None


def _visible_markdown(text: str) -> str:
    without_comments = re.sub(r"<!--.*?(?:-->|\Z)", "", text, flags=re.DOTALL)
    visible: list[str] = []
    fence_character: str | None = None
    minimum_closing_length = 0
    for line in without_comments.splitlines(keepends=True):
        stripped_line = line.rstrip("\r\n")
        if fence_character is None:
            opener = re.match(r"^ {0,3}(?P<fence>`{3,}|~{3,})", stripped_line)
            if opener:
                fence = opener.group("fence")
                fence_character = fence[0]
                minimum_closing_length = len(fence)
                continue
            visible.append(line)
            continue

        closer = re.fullmatch(r" {0,3}(?P<fence>`{3,}|~{3,})[ \t]*", stripped_line)
        if closer:
            fence = closer.group("fence")
            if fence[0] == fence_character and len(fence) >= minimum_closing_length:
                fence_character = None
                minimum_closing_length = 0

    return "".join(visible)


def _has_heading(text: str, heading: str) -> bool:
    return bool(
        re.search(
            rf"^##\s+{re.escape(heading)}\s*$",
            _visible_markdown(text),
            re.MULTILINE | re.IGNORECASE,
        )
    )


def _section(text: str, heading: str) -> str:
    text = _visible_markdown(text)
    match = re.search(
        rf"^##\s+{re.escape(heading)}\s*$\n(?P<body>.*?)(?=^##\s+|\Z)",
        text,
        re.MULTILINE | re.DOTALL | re.IGNORECASE,
    )
    return match.group("body") if match else ""


def _meaningful_section(text: str, heading: str) -> bool:
    section = _section(text, heading)
    section = re.sub(r"^ {0,3}-\s*\[[ xX]\].*$", "", section, flags=re.MULTILINE)
    lines = [
        line.strip()
        for line in section.splitlines()
        if line.strip() and not re.match(r"^(?: {4}|\t)", line)
    ]
    return any(
        not _placeholder_value(re.sub(r"^(?:[-*>]\s*)+", "", line).strip())
        for line in lines
    )


def _validate_foundation(specs: Path, errors: list[str]) -> None:
    constitution_path = specs / "_meta/constitution.md"
    if constitution_path.is_file():
        constitution = _read(constitution_path, errors)
        metadata = _frontmatter(constitution_path, constitution, errors)
        if _semver(metadata.get("version")) is None:
            errors.append(f"{constitution_path}: version must be semantic X.Y.Z")
        ratified = metadata.get("ratified")
        if isinstance(ratified, calendar_date):
            valid_ratified = ratified <= calendar_date.today()
        else:
            valid_ratified = isinstance(ratified, str) and _valid_iso_date(ratified)
        if not valid_ratified:
            errors.append(
                f"{constitution_path}: ratified must be a real non-future YYYY-MM-DD date"
            )
        for heading in CONSTITUTION_SECTIONS:
            if not _meaningful_section(constitution, heading):
                errors.append(
                    f"{constitution_path}: missing or empty '## {heading}' section"
                )

    for relative, headings in TEMPLATE_SECTIONS.items():
        path = specs / relative
        if not path.is_file():
            continue
        text = _read(path, errors)
        for heading in headings:
            if not _meaningful_section(text, heading):
                errors.append(f"{path}: missing or empty '## {heading}' template section")

    tasks_path = specs / "_templates/tasks.md"
    if tasks_path.is_file() and not re.search(
        r"^ {0,3}-\s+\[[ xX]\]\s+",
        _visible_markdown(_read(tasks_path, errors)),
        re.MULTILINE,
    ):
        errors.append(f"{tasks_path}: template must contain at least one checkbox task")

    ui_path = specs / "_templates/ui-states.md"
    if ui_path.is_file():
        ui_text = _visible_markdown(_read(ui_path, errors))
        if not re.search(
            r"^ {0,3}\| Surface \| Loading \| Empty \| Success \| Error/retry \| Permission \| Responsive/theme/a11y \|\s*$",
            ui_text,
            re.MULTILINE,
        ):
            errors.append(f"{ui_path}: template must contain the complete UI-state header")


def _constitutional_obligations(text: str) -> set[str]:
    visible = _visible_markdown(text)
    obligations: set[str] = set()
    list_matches = list(
        re.finditer(
            r"^-\s+(?P<body>\S.*?(?:\n {2,}\S.*?)*)\s*(?=\n-\s+|\n##\s+|\Z)",
            visible,
            re.MULTILINE,
        )
    )
    for match in list_matches:
        obligation = re.sub(r"\s+", " ", match.group("body")).strip()
        obligations.add(obligation)

    # Constitution prose is allowed, but normative paragraphs must participate
    # in semantic-version classification just like list-item obligations.
    prose = list(visible)
    for match in list_matches:
        prose[match.start() : match.end()] = " " * (match.end() - match.start())
    for paragraph in re.split(r"\n[ \t]*\n", "".join(prose)):
        normalized = re.sub(r"\s+", " ", paragraph).strip()
        modal_context = re.sub(r"(?P<ticks>`+).*?(?P=ticks)", "", normalized)
        quoted_modal = r"(?:MUST(?: NOT)?|SHOULD(?: NOT)?|MAY(?: NOT)?)"
        modal_context = re.sub(
            rf'(?:"\s*{quoted_modal}\s*"|“\s*{quoted_modal}\s*”|‘\s*{quoted_modal}\s*’)',
            "",
            modal_context,
        )
        if re.search(
            r"\b(?:MUST(?: NOT)?|SHOULD(?: NOT)?|MAY(?: NOT)?)\b",
            modal_context,
        ):
            obligations.add(normalized)
    return obligations


def _is_appended_clarification(old: str, new: str) -> bool:
    normalize = lambda value: re.sub(r"[.!?]+$", "", value.casefold()).strip()
    old_normalized = normalize(old)
    new_normalized = normalize(new)
    modal_pattern = r"\b(?:must not|must|should not|should|may not|may)\b"
    suffix = new_normalized[len(old_normalized) :].lstrip(" .:—-")
    clarification = re.fullmatch(r"clarification:\s+(\S.*)", suffix)
    contradictory = bool(
        clarification
        and re.search(
            r"\b(?:no longer|does not apply|do not apply|not applicable|except|unless|waiv\w*|overrid\w*|replac\w*|remov\w*)\b",
            clarification.group(1),
        )
    )
    return (
        len(new_normalized) > len(old_normalized)
        and new_normalized.startswith(old_normalized)
        and re.findall(modal_pattern, old_normalized)
        == re.findall(modal_pattern, new_normalized)
        and clarification is not None
        and not contradictory
    )


def _all_appended_clarifications(removed: set[str], added: set[str]) -> bool:
    if not removed or len(removed) != len(added):
        return False
    unmatched = set(added)
    for old in sorted(removed):
        matches = [new for new in unmatched if _is_appended_clarification(old, new)]
        if not matches:
            return False
        unmatched.remove(min(matches, key=len))
    return not unmatched


def _expected_constitution_version(
    base_text: str, head_text: str
) -> tuple[tuple[int, int, int] | None, tuple[int, int, int] | None, tuple[int, int, int] | None, str]:
    base_version = _semver(_frontmatter_mapping(base_text).get("version"))
    head_version = _semver(_frontmatter_mapping(head_text).get("version"))
    if base_version is None:
        return base_version, head_version, None, "invalid base"
    removed = _constitutional_obligations(base_text) - _constitutional_obligations(head_text)
    added = _constitutional_obligations(head_text) - _constitutional_obligations(base_text)
    clarification = _all_appended_clarifications(removed, added)
    if removed and not clarification:
        expected = (base_version[0] + 1, 0, 0)
        bump = "major"
    elif added and not clarification:
        expected = (base_version[0], base_version[1] + 1, 0)
        bump = "minor"
    else:
        expected = (base_version[0], base_version[1], base_version[2] + 1)
        bump = "patch"
    return base_version, head_version, expected, bump


def _placeholder_value(value: str) -> bool:
    normalized = value.strip()
    return not normalized or bool(
        re.fullmatch(
            r"(?:<[^>\n]+>|placeholder|tbd|todo|n/?a|test, query, screenshot, or manual journey)",
            normalized,
            re.IGNORECASE,
        )
    )


def _normalized_template_content(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().casefold()


def _reject_implementable_template_scaffolding(
    specs: Path,
    feature: Path,
    texts: dict[str, str],
    metadata: dict[str, Any],
    errors: list[str],
) -> None:
    if metadata.get("status") not in IMPLEMENTABLE_SPEC_STATUSES:
        return

    template_spec = _read(specs / "_templates/spec.md", errors)
    template_metadata = _frontmatter_mapping(template_spec)
    if _normalized_template_content(str(metadata.get("title") or "")) == (
        _normalized_template_content(str(template_metadata.get("title") or ""))
    ):
        errors.append(
            f"{feature / 'spec.md'}: implementable spec still uses the template title"
        )

    for filename in (*REQUIRED_FEATURE_FILES, *HIGH_RISK_REQUIRED_FILES):
        feature_text = texts.get(filename)
        template_path = specs / "_templates" / filename
        if feature_text is None or not template_path.is_file():
            continue
        template_text = _read(template_path, errors)
        headings = re.findall(
            r"^##\s+(.+?)\s*$", _visible_markdown(template_text), re.MULTILINE
        )
        for heading in headings:
            template_section = _normalized_template_content(
                _section(template_text, heading)
            )
            feature_section = _normalized_template_content(
                _section(feature_text, heading)
            )
            if template_section and feature_section == template_section:
                errors.append(
                    f"{feature / filename}: implementable spec still uses template scaffolding in '## {heading}'"
                )

    template_tasks = {
        _normalized_template_content(item)
        for item in re.findall(
            r"^ {0,3}-\s+\[[ xX]\]\s+(\S.*?)\s*$",
            _visible_markdown(_read(specs / "_templates/tasks.md", errors)),
            re.MULTILINE,
        )
    }
    feature_tasks = {
        _normalized_template_content(item)
        for item in re.findall(
            r"^ {0,3}-\s+\[[ xX]\]\s+(\S.*?)\s*$",
            _visible_markdown(texts.get("tasks.md", "")),
            re.MULTILINE,
        )
    }
    if template_tasks & feature_tasks:
        errors.append(
            f"{feature / 'tasks.md'}: implementable spec still uses template task scaffolding"
        )


def _concrete_pass_evidence(evidence: str, root: Path) -> bool:
    if _placeholder_value(evidence):
        return False
    fields = _structured_evidence(evidence)
    if {"kind", "ref"} <= fields.keys():
        return fields["kind"].lower() in {
            "assertion",
            "check",
            "command",
            "journey",
            "query",
            "report",
            "screenshot",
            "test",
        } and _concrete_locator(fields["ref"], root)
    return _concrete_locator(evidence, root)


def _concrete_locator(value: str, root: Path) -> bool:
    locator = value.strip().strip("`")
    if _placeholder_value(locator) or "<" in locator or ">" in locator:
        return False
    if re.search(r"https?://\S+", locator, re.IGNORECASE):
        return True
    if re.fullmatch(
        r"(?:report|screenshot|journey):[a-z0-9][\w.-]+",
        locator,
        re.IGNORECASE,
    ):
        return True
    if re.match(r"^(?:pytest|npm|node|npx|psql|curl|gh|git)\s+\S+", locator):
        return True
    if re.match(
        r"^(?:\S*/)?python(?:3(?:\.\d+)*)?\s+(?:-m\s+\S+|\S+\.py(?:\s|$))",
        locator,
    ):
        return True

    path_token = locator.split(maxsplit=1)[0].strip("`").split("::", 1)[0]
    if Path(path_token).is_absolute():
        return False
    candidate = (root / path_token).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return False
    if not candidate.is_file():
        return False
    relative = candidate.relative_to(root.resolve()).as_posix()
    if relative == ".git" or relative.startswith(".git/"):
        return False
    tracked = subprocess.run(
        ["git", "-C", str(root), "cat-file", "-e", f"HEAD:{relative}"],
        capture_output=True,
        text=True,
        check=False,
    )
    return tracked.returncode == 0


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


def _valid_iso_date(value: str) -> bool:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        parsed = calendar_date.fromisoformat(value)
    except ValueError:
        return False
    return parsed <= calendar_date.today()


def _has_populated_ui_state_matrix(text: str) -> bool:
    expected_header = [
        "surface",
        "loading",
        "empty",
        "success",
        "error/retry",
        "permission",
        "responsive/theme/a11y",
    ]
    rows: list[list[str]] = []
    for line in _visible_markdown(text).splitlines():
        if re.match(r"^(?: {4}|\t)", line):
            continue
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            rows.append([cell.strip() for cell in stripped.strip("|").split("|")])
    try:
        header_index = next(
            index
            for index, cells in enumerate(rows)
            if [cell.lower() for cell in cells] == expected_header
        )
    except StopIteration:
        return False
    placeholders = {"replace surface", "expected behavior", "evidence"}
    for cells in rows[header_index + 1 :]:
        if len(cells) != len(expected_header):
            continue
        if all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            continue
        normalized = [cell.lower() for cell in cells]
        if (
            all(cells)
            and not any(cell in placeholders or _placeholder_value(cell) for cell in normalized)
            and not all(cell in {"n/a", "na"} for cell in normalized[1:])
        ):
            return True
    return False


def _ui_states_not_applicable(text: str) -> bool:
    match = re.search(
        r"^UI impact:\s*N/A\s*(?:[-—:]\s*)(.+?)\s*$",
        _visible_markdown(text),
        re.MULTILINE | re.IGNORECASE,
    )
    if not match:
        return False
    rationale = match.group(1).strip()
    return len(rationale) >= 12 and not _placeholder_value(rationale)


def _evidence_detail_error(result: str, evidence: str, root: Path) -> str | None:
    normalized = result.upper()
    if normalized == "MANUAL":
        fields = _structured_evidence(evidence)
        required = {"reviewer", "environment", "date", "observed"}
        if (
            not required <= fields.keys()
            or any(_placeholder_value(fields.get(field, "")) for field in required)
            or fields.get("environment", "").lower()
            not in {"preview", "staging", "production"}
            or not _valid_iso_date(fields.get("date", ""))
        ):
            return (
                "MANUAL evidence must use reviewer=...; "
                "environment=preview|staging|production; "
                "date=YYYY-MM-DD; observed=..."
            )
    elif normalized == "PASS" and not _concrete_pass_evidence(evidence, root):
        return "PASS evidence must identify a concrete test, query, screenshot, or journey"
    elif normalized == "N/A":
        fields = _structured_evidence(evidence)
        rationale = fields.get("rationale", "")
        if len(rationale) < 12 or _placeholder_value(rationale):
            return "N/A evidence must use rationale=<specific reason>"
    return None


def _concrete_requirement_evidence(evidence: str, root: Path) -> bool:
    fields = _structured_evidence(evidence)
    kind = fields.get("kind", "").lower()
    if kind == "manual" or {"reviewer", "environment", "date", "observed"} & fields.keys():
        return _evidence_detail_error("MANUAL", evidence, root) is None
    if kind in {"n/a", "na"} or "rationale" in fields:
        return _evidence_detail_error("N/A", evidence, root) is None
    return _concrete_pass_evidence(evidence, root)


def validate_repository(root: Path) -> tuple[list[str], dict[str, Path]]:
    errors: list[str] = []
    specs = root / "specs"
    if not specs.is_dir():
        return [f"{specs}: canonical specs directory is missing"], {}

    for relative in REQUIRED_FOUNDATION_FILES:
        if not (specs / relative).is_file():
            errors.append(f"{specs / relative}: required SDD foundation file is missing")
    _validate_foundation(specs, errors)

    index = _read(specs / "README.md", errors)
    index_rows: dict[str, tuple[str, str, str, str]] = {}
    for index_id, index_title, index_status, index_risk, index_path in INDEX_ROW_RE.findall(
        _visible_markdown(index)
    ):
        if index_id in index_rows:
            errors.append(f"{specs / 'README.md'}: duplicate active-index row for {index_id}")
            continue
        index_rows[index_id] = (
            index_title.strip(),
            index_status,
            index_risk,
            index_path.removeprefix("./"),
        )
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
                index_title, index_status, index_risk, index_path = index_row
                expected_path = f"{feature.name}/spec.md"
                if index_title != metadata.get("title"):
                    errors.append(
                        f"{specs / 'README.md'}: {spec_id} title is {index_title!r}, expected {metadata.get('title')!r}"
                    )
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
                    elif not _meaningful_section(text, heading):
                        errors.append(
                            f"{feature / filename}: '## {heading}' section must contain meaningful content"
                        )
            ui_states = texts.get("ui-states.md", "")
            if not (
                _has_populated_ui_state_matrix(ui_states)
                or _ui_states_not_applicable(ui_states)
            ):
                errors.append(
                    f"{feature / 'ui-states.md'}: high-risk UI state matrix needs a complete surface row or explicit UI impact N/A rationale"
                )

        _reject_implementable_template_scaffolding(
            specs, feature, texts, metadata, errors
        )

        for filename, headings in REQUIRED_SECTIONS.items():
            text = texts.get(filename, "")
            for heading in headings:
                if not _has_heading(text, heading):
                    errors.append(f"{feature / filename}: missing '## {heading}' section")
                elif not _meaningful_section(text, heading):
                    errors.append(
                        f"{feature / filename}: '## {heading}' section must contain meaningful content"
                    )

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
                if _placeholder_value(description.strip()):
                    errors.append(
                        f"{spec_path}: functional requirement {requirement} must have an inline description with concrete behavior"
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
            elif detail_error := _evidence_detail_error(result, evidence, root):
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

        tasks = _visible_markdown(texts.get("tasks.md", ""))
        if not re.search(r"^ {0,3}-\s+\[[ xX]\]\s+", tasks, re.MULTILINE):
            errors.append(f"{feature / 'tasks.md'}: declare at least one checkbox task")
        if status in FINAL_STATUSES and re.search(r"^ {0,3}-\s+\[ \]\s+", tasks, re.MULTILINE):
            errors.append(f"{feature / 'tasks.md'}: final feature still has incomplete required tasks")

    for orphan_id in sorted(set(index_rows) - set(seen_ids)):
        errors.append(
            f"{specs / 'README.md'}: active index references missing spec {orphan_id}"
        )

    return errors, seen_ids


def _body_field(body: str, field: str) -> str | None:
    visible_body = _visible_markdown(body)
    match = re.search(
        rf"^{re.escape(field)}:\s*(.*?)\s*$",
        visible_body,
        re.MULTILINE | re.IGNORECASE,
    )
    if not match:
        return None
    value = match.group(1).strip().strip("`")
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


def _git_changed_paths(
    root: Path, base_sha: str, head_sha: str
) -> tuple[bool, str, list[str]]:
    for revision in (base_sha, head_sha):
        check = subprocess.run(
            ["git", "-C", str(root), "cat-file", "-e", f"{revision}^{{commit}}"],
            capture_output=True,
            text=True,
            check=False,
        )
        if check.returncode != 0:
            return False, "", []
    merge_base = subprocess.run(
        ["git", "-C", str(root), "merge-base", base_sha, head_sha],
        capture_output=True,
        text=True,
        check=False,
    )
    if merge_base.returncode != 0 or not merge_base.stdout.strip():
        return False, "", []
    merge_base_sha = merge_base.stdout.strip()
    result = subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "diff",
            "--no-renames",
            "--name-only",
            merge_base_sha,
            head_sha,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return False, "", []
    return True, merge_base_sha, [path for path in result.stdout.splitlines() if path]


def _git_requirement_approval_commit(
    root: Path,
    base_sha: str,
    spec_path: str,
    spec_id: str,
    requirement: str,
    description: str,
    risk: str,
) -> str | None:
    history = subprocess.run(
        ["git", "-C", str(root), "log", "--format=%H", "--reverse", base_sha, "--", spec_path],
        capture_output=True,
        text=True,
        check=False,
    )
    if history.returncode != 0:
        return None
    for revision in history.stdout.splitlines():
        _, text = _git_show(root, revision, spec_path)
        if text is None:
            continue
        try:
            metadata = yaml.safe_load(text.split("---", 2)[1]) or {}
        except (IndexError, yaml.YAMLError):
            continue
        if (
            metadata.get("id") == spec_id
            and metadata.get("status") in IMPLEMENTABLE_SPEC_STATUSES
            and metadata.get("risk") == risk
            and _declared_requirements(text).get(requirement) == description
        ):
            return revision
    return None


def _implementation_units(
    evidence: str,
    revision_paths: list[tuple[str, set[str]]],
) -> tuple[bool, set[tuple[str, str]]]:
    fields = _structured_evidence(evidence)
    raw_units = [
        unit.strip().strip("`")
        for unit in fields.get("implementation", "").split(",")
        if unit.strip()
    ]
    if not raw_units:
        return False, set()
    topic_revisions = [revision for revision, _ in revision_paths]
    mapped_units: set[tuple[str, str]] = set()
    for raw_unit in raw_units:
        revision_ref, separator, raw_path = raw_unit.partition(":")
        revision_ref = revision_ref.strip()
        path = raw_path.removeprefix("./")
        if (
            not separator
            or not re.fullmatch(r"[0-9a-fA-F]{7,40}", revision_ref)
            or not path
            or Path(path).is_absolute()
            or ".." in Path(path).parts
            or path == "specs"
            or path.startswith("specs/")
        ):
            return False, set()
        matching_revisions = [
            revision
            for revision in topic_revisions
            if revision.startswith(revision_ref.lower())
        ]
        if len(matching_revisions) != 1:
            return False, set()
        mapped_units.add((matching_revisions[0], path))
    return True, mapped_units


def _topic_revision_paths(
    root: Path,
    base_sha: str,
    head_sha: str,
) -> tuple[bool, list[tuple[str, set[str]]]]:
    topic_history = subprocess.run(
        ["git", "-C", str(root), "rev-list", "--reverse", head_sha, "--not", base_sha],
        capture_output=True,
        text=True,
        check=False,
    )
    if topic_history.returncode != 0:
        return False, []
    revision_paths: list[tuple[str, set[str]]] = []
    for revision in topic_history.stdout.splitlines():
        paths = subprocess.run(
            [
                "git",
                "-C",
                str(root),
                "diff-tree",
                "--no-commit-id",
                "--name-only",
                "-r",
                revision,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if paths.returncode != 0:
            return False, []
        changed_paths = {
            path
            for path in paths.stdout.splitlines()
            if path and not path.startswith("specs/")
        }
        if changed_paths:
            revision_paths.append((revision, changed_paths))
    return True, revision_paths


def _topic_implementation_before_approval(
    root: Path,
    approval_commit: str,
    mapped_units: set[tuple[str, str]],
) -> tuple[bool, list[str]]:
    offenders: list[str] = []
    for revision in sorted({revision for revision, _ in mapped_units}):
        ancestry = subprocess.run(
            [
                "git",
                "-C",
                str(root),
                "merge-base",
                "--is-ancestor",
                approval_commit,
                revision,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if ancestry.returncode == 1:
            offenders.append(revision)
        elif ancestry.returncode != 0:
            return False, []
    return True, offenders


def _requirement_coverage(body: str) -> list[tuple[str, str]]:
    section = re.sub(
        r"<!--.*?-->",
        "",
        _section(body, "Requirement coverage"),
        flags=re.DOTALL,
    )
    return re.findall(
        r"^ {0,3}[-*]\s+(FR-\d{3})(?!\d)\s*(?:->|:)\s*(.*?)\s*$",
        section,
        re.MULTILINE,
    )


def validate_pull_request(
    event: dict[str, Any], known_specs: dict[str, Path], root: Path = REPO_ROOT
) -> list[str]:
    pull = event.get("pull_request")
    if not isinstance(pull, dict):
        return []

    base = str((pull.get("base") or {}).get("ref") or "")
    base_sha = str((pull.get("base") or {}).get("sha") or "")
    head = str((pull.get("head") or {}).get("ref") or "")
    head_sha = str((pull.get("head") or {}).get("sha") or "")
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

    merge_base_sha = ""
    changed_paths: list[str] = []
    if not base_sha or not head_sha:
        errors.append("pull request: base and head SHAs are required to classify changed paths")
    else:
        diff_resolved, merge_base_sha, changed_paths = _git_changed_paths(
            root, base_sha, head_sha
        )
        if not diff_resolved:
            errors.append("pull request: cannot resolve base/head SHAs to classify changed paths")
        else:
            high_risk_paths = sorted(path for path in changed_paths if HIGH_RISK_PATH_RE.fullmatch(path))
            if high_risk_paths and change_class != "high-risk":
                errors.append(
                    "pull request: migration paths require change class 'high-risk': "
                    + ", ".join(high_risk_paths)
                )

    constitution_path = "specs/_meta/constitution.md"
    if constitution_path in changed_paths:
        _, base_constitution = _git_show(root, base_sha, constitution_path)
        _, head_constitution = _git_show(root, head_sha, constitution_path)
        if base_constitution is not None:
            if head_constitution is None:
                errors.append("pull request: the engineering constitution cannot be removed")
            else:
                base_version, head_version, expected, bump = _expected_constitution_version(
                    base_constitution, head_constitution
                )
                if base_version is None or head_version is None or expected is None:
                    errors.append(
                        "pull request: constitution amendments require valid semantic versions"
                    )
                elif head_version != expected:
                    errors.append(
                        "pull request: constitution amendment requires "
                        f"a {bump} version bump to {'.'.join(map(str, expected))}; "
                        f"found {'.'.join(map(str, head_version))}"
                    )
                amendment = _section(body, "Constitution amendment")
                amendment_class = (
                    _body_field(amendment, "Amendment class") or ""
                ).lower()
                if amendment_class not in {"major", "minor", "patch"}:
                    errors.append(
                        "pull request: constitution amendments require "
                        "'Amendment class: major|minor|patch'"
                    )
                elif amendment_class != bump:
                    errors.append(
                        "pull request: constitution amendment class "
                        f"must be '{bump}', found '{amendment_class}'"
                    )
                rationale = re.sub(
                    r"^\s*Amendment class\s*:.*$", "", amendment, flags=re.MULTILINE | re.IGNORECASE
                )
                if not any(
                    not _placeholder_value(re.sub(r"^(?:[-*>]\s*)+", "", line).strip())
                    for line in rationale.splitlines()
                    if line.strip()
                ):
                    errors.append(
                        "pull request: constitution amendments require a non-empty '## Constitution amendment' rationale"
                    )

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
            if (
                metadata.get("risk") in {"high", "critical"}
                and change_class != "high-risk"
            ):
                errors.append(
                    f"pull request: Spec '{spec_id}' risk {metadata.get('risk')!r} requires change class 'high-risk'"
                )
            if requires_spec:
                coverage_rows = _requirement_coverage(body)
                coverage = [requirement for requirement, _ in coverage_rows]
                coverage_evidence = dict(coverage_rows)
                spec_path = str((feature / "spec.md").relative_to(root))
                checkout = subprocess.run(
                    ["git", "-C", str(root), "rev-parse", "HEAD"],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if checkout.returncode == 0 and checkout.stdout.strip() == head_sha:
                    topic_spec_text = metadata_text
                else:
                    _, head_spec_text = _git_show(root, head_sha, spec_path)
                    topic_spec_text = head_spec_text or ""
                current_requirements = _declared_requirements(topic_spec_text)
                topic_metadata = _frontmatter_mapping(topic_spec_text)
                approved_requirements: dict[str, str] | None = None
                bootstrap = False
                if not merge_base_sha:
                    errors.append(
                        "pull request: merge base is required to verify prior spec approval"
                    )
                else:
                    revision_exists, base_spec_text = _git_show(
                        root,
                        merge_base_sha,
                        str((feature / "spec.md").relative_to(root)),
                    )
                    _, target_constitution = _git_show(
                        root, base_sha, "specs/_meta/constitution.md"
                    )
                    bootstrap = spec_id == "SDD-0000" and target_constitution is None
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
                        if base_metadata.get("id") != spec_id:
                            errors.append(
                                f"pull request: Spec '{spec_id}' identity changed after base approval ({base_metadata.get('id')!r} -> {spec_id!r})"
                            )
                        if topic_metadata.get("risk") != base_metadata.get("risk"):
                            errors.append(
                                f"pull request: Spec '{spec_id}' risk changed after base approval ({base_metadata.get('risk')!r} -> {topic_metadata.get('risk')!r})"
                            )
                        if change_class == "high-risk" and base_metadata.get(
                            "risk"
                        ) not in {"high", "critical"}:
                            errors.append(
                                f"pull request: {spec_id} was not approved as high or critical risk in the base revision"
                            )
                        if not bootstrap:
                            history_resolved, revision_paths = _topic_revision_paths(
                                root, base_sha, head_sha
                            )
                            implementation_units: dict[
                                str, set[tuple[str, str]]
                            ] = {}
                            if not history_resolved:
                                errors.append(
                                    f"pull request: cannot resolve topic implementation history for {spec_id}"
                                )
                            else:
                                topic_units = {
                                    (revision, path)
                                    for revision, paths in revision_paths
                                    for path in paths
                                }
                                for requirement in sorted(set(coverage)):
                                    mapping_valid, mapped_units = _implementation_units(
                                        coverage_evidence.get(requirement, ""),
                                        revision_paths,
                                    )
                                    if topic_units and not mapping_valid:
                                        errors.append(
                                            f"pull request: requirement coverage for {requirement} must declare valid implementation=commit:path/to/code,commit:path/to/test ownership"
                                        )
                                        continue
                                    unmatched_units = mapped_units - topic_units
                                    if unmatched_units:
                                        errors.append(
                                            f"pull request: implementation ownership for {requirement} references unchanged commit/path units: "
                                            + ", ".join(
                                                f"{revision[:12]}:{path}"
                                                for revision, path in sorted(
                                                    unmatched_units
                                                )
                                            )
                                        )
                                    implementation_units[requirement] = (
                                        mapped_units & topic_units
                                    )
                                owned_units = (
                                    set().union(*implementation_units.values())
                                    if implementation_units
                                    else set()
                                )
                                unowned_units = topic_units - owned_units
                                if unowned_units:
                                    errors.append(
                                        "pull request: topic commit/path units lack requirement ownership: "
                                        + ", ".join(
                                            f"{revision[:12]}:{path}"
                                            for revision, path in sorted(unowned_units)
                                        )
                                    )

                            for requirement in sorted(set(coverage)):
                                description = current_requirements.get(requirement)
                                if description is None:
                                    continue
                                approval_commit = _git_requirement_approval_commit(
                                    root,
                                    base_sha,
                                    spec_path,
                                    spec_id,
                                    requirement,
                                    description,
                                    str(topic_metadata.get("risk") or ""),
                                )
                                if approval_commit is None:
                                    errors.append(
                                        f"pull request: cannot find durable approval commit for {spec_id} {requirement}"
                                    )
                                    continue
                                mapped_units = implementation_units.get(
                                    requirement, set()
                                )
                                if not history_resolved or not mapped_units:
                                    continue
                                ancestry_resolved, offenders = (
                                    _topic_implementation_before_approval(
                                        root,
                                        approval_commit,
                                        mapped_units,
                                    )
                                )
                                if not ancestry_resolved:
                                    errors.append(
                                        f"pull request: cannot verify approval ancestry for {spec_id} {requirement}"
                                    )
                                elif offenders:
                                    errors.append(
                                        f"pull request: implementation commits predate approved {spec_id} {requirement}: "
                                        + ", ".join(revision[:12] for revision in offenders)
                                    )

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
                    elif not _concrete_requirement_evidence(evidence, root):
                        errors.append(
                            f"pull request: requirement coverage for {requirement} must identify a concrete test, query, file, command, or recorded journey"
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

from __future__ import annotations

import importlib.util
import json
import re
import subprocess
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "validate_specs.py"
REPO_ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("validate_specs", SCRIPT)
assert SPEC and SPEC.loader
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)


def _write(path: Path, text: str = "placeholder\n") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _valid_repo(
    tmp_path: Path, *, status: str = "verified", risk: str = "medium"
) -> Path:
    root = tmp_path / "repo"
    specs = root / "specs"
    for relative in validator.REQUIRED_FOUNDATION_FILES:
        _write(
            specs / relative,
            (REPO_ROOT / "specs" / relative).read_text(encoding="utf-8"),
        )
    feature = specs / "0001-example-feature"
    _write(
        feature / "spec.md",
        f"""---
id: FEAT-0001
title: Example
status: {status}
risk: {risk}
owner: product
---

## Problem
Problem.
## Scope
Scope.
## Non-goals
None.
## Requirements
- **FR-001:** Works.
## Acceptance scenarios
Scenario.
## Success criteria
Measured.
""",
    )
    _write(
        feature / "plan.md",
        """## Architecture impact
None.
## Data and contracts
None.
## Rollout and rollback
Revert.
## Verification strategy
Test.
""",
    )
    _write(feature / "tasks.md", "# Tasks\n\n- [x] T001 Complete.\n")
    _write(
        feature / "verification.md",
        "# Verification\n\n## Requirement coverage\n\n"
        "| FR-001 | backend/tests/test_example.py::test_works | PASS |\n",
    )
    _write(root / "backend/tests/test_example.py", "def test_works():\n    assert True\n")
    if risk in {"high", "critical"}:
        _write(
            feature / "ui-states.md",
            "# UI state matrix\n\n"
            "| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |\n"
            "| --- | --- | --- | --- | --- | --- | --- |\n"
            "| Admin workflow | Skeleton | No records | Canonical data | Retry notice | Admin only | Desktop/mobile, light/dark, keyboard |\n",
        )
        _write(
            feature / "rollout.md",
            "## Preconditions\nReady.\n"
            "## Staging\nVerify.\n"
            "## Production\nPromote.\n"
            "## Rollback and repair\nRevert.\n"
            "## Observability\nMonitor.\n",
        )
    _write(
        specs / "README.md",
        "# Index\n\n"
        "| ID | Feature | Status | Risk | Spec |\n"
        "| --- | --- | --- | --- | --- |\n"
        f"| FEAT-0001 | Example | {status} | {risk} | [spec](0001-example-feature/spec.md) |\n",
    )
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.email", "tests@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Spec Tests"], cwd=root, check=True)
    subprocess.run(["git", "add", "."], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "base"], cwd=root, check=True)
    return root


def _event(
    *,
    root: Path,
    change_class: str,
    spec: str,
    base: str = "staging",
    head: str = "topic",
    coverage: str = "- FR-001 -> backend/tests/test_example.py::test_works",
    include_na_details: bool = True,
    base_sha: str | None = None,
    head_sha: str | None = None,
) -> dict:
    current_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    base_sha = base_sha or current_sha
    head_sha = head_sha or current_sha
    details = ""
    if include_na_details:
        details = (
            "\n## Problem\n\nCurrent behavior is wrong.\n"
            "\n## Expected behavior\n\nExpected behavior is explicit.\n"
            "\n## Scope\n\nOne focused flow.\n"
            "\n## Verification\n\nAutomated test passed.\n"
        )
    return {
        "pull_request": {
            "base": {"ref": base, "sha": base_sha},
            "head": {"ref": head, "sha": head_sha},
            "body": (
                f"Change class: {change_class}\nSpec: {spec}\n\n"
                f"## Requirement coverage\n\n{coverage}\n"
                f"{details}"
            ),
        }
    }


def test_repository_accepts_complete_verified_feature(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    errors, specs = validator.validate_repository(root)
    assert errors == []
    assert set(specs) == {"FEAT-0001"}


def test_repository_rejects_empty_or_placeholder_foundation(tmp_path: Path) -> None:
    constitution_root = _valid_repo(tmp_path / "constitution")
    constitution = constitution_root / "specs/_meta/constitution.md"
    constitution.write_text("", encoding="utf-8")
    constitution_errors, _ = validator.validate_repository(constitution_root)
    assert any(
        "constitution.md" in error and "semantic X.Y.Z" in error
        for error in constitution_errors
    )
    assert any(
        "constitution.md" in error and "Canonical system boundaries" in error
        for error in constitution_errors
    )

    template_root = _valid_repo(tmp_path / "template")
    plan_template = template_root / "specs/_templates/plan.md"
    plan_template.write_text("placeholder\n", encoding="utf-8")
    template_errors, _ = validator.validate_repository(template_root)
    assert any(
        "_templates/plan.md" in error and "Architecture impact" in error
        for error in template_errors
    )


def test_repository_ignores_declared_legacy_spec_directory(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    _write(root / "specs/general/UI-IMPROVEMENTS.md", "# Historical notes\n")
    errors, specs = validator.validate_repository(root)
    assert errors == []
    assert set(specs) == {"FEAT-0001"}


def test_repository_rejects_unchecked_task_in_verified_feature(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    (root / "specs/0001-example-feature/tasks.md").write_text("- [ ] T001 Pending.\n")
    errors, _ = validator.validate_repository(root)
    assert any("incomplete required tasks" in error for error in errors)


def test_repository_rejects_indented_unchecked_task_in_verified_feature(tmp_path: Path) -> None:
    for index, indent in enumerate(("  ", "    ")):
        root = _valid_repo(tmp_path / f"indent-{index}")
        (root / "specs/0001-example-feature/tasks.md").write_text(
            f"- [x] T001 Complete.\n{indent}- [ ] T002 Pending.\n",
            encoding="utf-8",
        )
        errors, _ = validator.validate_repository(root)
        assert any("incomplete required tasks" in error for error in errors)


def test_repository_rejects_code_indented_only_task_but_accepts_nested_task(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path)
    tasks = root / "specs/0001-example-feature/tasks.md"
    tasks.write_text("    - [x] T001 Hidden in code.\n", encoding="utf-8")
    code_errors, _ = validator.validate_repository(root)
    assert any("declare at least one checkbox task" in error for error in code_errors)

    tasks.write_text(
        "- [x] T001 Visible parent.\n    - [x] T002 Visible nested task.\n",
        encoding="utf-8",
    )
    nested_errors, _ = validator.validate_repository(root)
    assert nested_errors == []


def test_repository_rejects_missing_requirement_evidence(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    (root / "specs/0001-example-feature/verification.md").write_text(
        "## Requirement coverage\n\nNo evidence yet.\n"
    )
    errors, _ = validator.validate_repository(root)
    assert any("no evidence row for FR-001" in error for error in errors)


def test_repository_ignores_evidence_outside_coverage_section_or_in_comment(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path)
    verification = root / "specs/0001-example-feature/verification.md"
    verification.write_text(
        "## Requirement coverage\n\nNo evidence.\n\n"
        "## Contract evidence\n\n| FR-001 | contract test | PASS |\n",
        encoding="utf-8",
    )
    outside_errors, _ = validator.validate_repository(root)
    assert any("no evidence row for FR-001" in error for error in outside_errors)
    verification.write_text(
        "## Requirement coverage\n\n<!--\n| FR-001 | hidden test | PASS |\n-->\n",
        encoding="utf-8",
    )
    comment_errors, _ = validator.validate_repository(root)
    assert any("no evidence row for FR-001" in error for error in comment_errors)
    verification.write_text(
        "<!--\n## Requirement coverage\n\n"
        "| FR-001 | backend/tests/test_example.py::test_works | PASS |\n-->\n",
        encoding="utf-8",
    )
    wrapped_section_errors, _ = validator.validate_repository(root)
    assert any(
        "no evidence row for FR-001" in error for error in wrapped_section_errors
    )


def test_repository_ignores_structural_markdown_in_fenced_code(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    verification = root / "specs/0001-example-feature/verification.md"
    verification.write_text(
        "```markdown\n## Requirement coverage\n\n"
        "| FR-001 | backend/tests/test_example.py::test_works | PASS |\n```\n",
        encoding="utf-8",
    )
    evidence_errors, _ = validator.validate_repository(root)
    assert any("no evidence row for FR-001" in error for error in evidence_errors)

    spec = root / "specs/0001-example-feature/spec.md"
    spec.write_text(
        spec.read_text(encoding="utf-8").replace(
            "## Problem\nProblem.",
            "```markdown\n## Problem\nProblem.\n```",
        ),
        encoding="utf-8",
    )
    heading_errors, _ = validator.validate_repository(root)
    assert any("missing '## Problem'" in error for error in heading_errors)


def test_visible_markdown_accepts_longer_closing_fence() -> None:
    markdown = (
        "Before.\n"
        "```text\n"
        "Change class: high-risk\n"
        "````\n"
        "Change class: small\n"
    )
    assert validator._visible_markdown(markdown) == "Before.\n\nChange class: small\n"

    indented_code = "    ```text\n    hidden code, not a fence\n    ```\nAfter.\n"
    assert validator._visible_markdown(indented_code) == indented_code


def test_repository_rejects_empty_required_artifact(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    (root / "specs/0001-example-feature/plan.md").write_text("", encoding="utf-8")
    errors, _ = validator.validate_repository(root)
    assert any("plan.md" in error and "missing '## Architecture impact'" in error for error in errors)


def test_repository_rejects_empty_required_sections(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    plan = root / "specs/0001-example-feature/plan.md"
    plan.write_text(
        "## Architecture impact\n\n"
        "## Data and contracts\n\nNone.\n"
        "## Rollout and rollback\n\nRevert.\n"
        "## Verification strategy\n\nTest.\n",
        encoding="utf-8",
    )
    spec = root / "specs/0001-example-feature/spec.md"
    spec.write_text(
        spec.read_text(encoding="utf-8").replace("## Problem\nProblem.", "## Problem\n<!-- describe the problem -->"),
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert any("plan.md" in error and "Architecture impact" in error and "meaningful content" in error for error in errors)
    assert any("spec.md" in error and "Problem" in error and "meaningful content" in error for error in errors)

    spec.write_text(
        spec.read_text(encoding="utf-8").replace(
            "## Problem\n<!-- describe the problem -->",
            "## Problem\n    Hidden indented code.",
        ),
        encoding="utf-8",
    )
    code_errors, _ = validator.validate_repository(root)
    assert any(
        "spec.md" in error and "Problem" in error and "meaningful content" in error
        for error in code_errors
    )


def test_repository_rejects_empty_tasks_artifact(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    (root / "specs/0001-example-feature/tasks.md").write_text("", encoding="utf-8")
    errors, _ = validator.validate_repository(root)
    assert any("tasks.md" in error and "checkbox task" in error for error in errors)


def test_repository_ignores_commented_tasks(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    tasks = root / "specs/0001-example-feature/tasks.md"
    tasks.write_text("<!-- - [x] T001 Hidden placeholder. -->\n", encoding="utf-8")
    hidden_errors, _ = validator.validate_repository(root)
    assert any("declare at least one checkbox task" in error for error in hidden_errors)

    tasks.write_text(
        "- [x] T001 Complete.\n<!-- - [ ] T000 Historical task. -->\n",
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert errors == []


def test_requirement_may_be_referenced_outside_declaration(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    spec = root / "specs/0001-example-feature/spec.md"
    spec.write_text(
        spec.read_text(encoding="utf-8")
        .replace("Scenario.\n", "Scenario verifies FR-001.\n"),
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert errors == []


def test_repository_rejects_malformed_requirement_alongside_valid_one(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    spec = root / "specs/0001-example-feature/spec.md"
    spec.write_text(
        spec.read_text(encoding="utf-8").replace(
            "- **FR-001:** Works.\n",
            "- **FR-001:** Works.\n- **FR-1000:** Malformed.\n",
        ),
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert any("malformed functional requirement 'FR-1000'" in error for error in errors)


def test_repository_rejects_empty_requirement_alongside_valid_one(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    spec = root / "specs/0001-example-feature/spec.md"
    spec.write_text(
        spec.read_text(encoding="utf-8").replace(
            "- **FR-001:** Works.\n",
            "- **FR-001:** Works.\n- **FR-002:**\n",
        ),
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert any("FR-002 must have an inline description" in error for error in errors)


def test_repository_rejects_indented_code_requirement(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    spec = root / "specs/0001-example-feature/spec.md"
    spec.write_text(
        spec.read_text(encoding="utf-8").replace(
            "- **FR-001:** Works.", "    - **FR-001:** Hidden in a code block."
        ),
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert any("declare at least one requirement" in error for error in errors)


def test_repository_rejects_placeholder_requirement_descriptions(
    tmp_path: Path,
) -> None:
    for index, placeholder in enumerate(("TODO", "TBD", "<behavior>")):
        root = _valid_repo(tmp_path / str(index))
        spec = root / "specs/0001-example-feature/spec.md"
        spec.write_text(
            spec.read_text(encoding="utf-8").replace(
                "- **FR-001:** Works.", f"- **FR-001:** {placeholder}"
            ),
            encoding="utf-8",
        )
        errors, _ = validator.validate_repository(root)
        assert any(
            "FR-001 must have an inline description with concrete behavior" in error
            for error in errors
        )


def test_repository_rejects_approved_stock_template_scaffolding(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path, status="approved")
    feature = root / "specs/0001-example-feature"
    template_spec = (root / "specs/_templates/spec.md").read_text(encoding="utf-8")
    (feature / "spec.md").write_text(
        template_spec.replace("id: FEAT-0000", "id: FEAT-0001").replace(
            "status: draft", "status: approved"
        ),
        encoding="utf-8",
    )
    for filename in ("plan.md", "tasks.md", "verification.md"):
        (feature / filename).write_text(
            (root / "specs/_templates" / filename).read_text(encoding="utf-8"),
            encoding="utf-8",
        )
    (root / "specs/README.md").write_text(
        "# Index\n\n"
        "| ID | Feature | Status | Risk | Spec |\n"
        "| --- | --- | --- | --- | --- |\n"
        "| FEAT-0001 | Replace with a user-centered title | approved | medium | "
        "[spec](0001-example-feature/spec.md) |\n",
        encoding="utf-8",
    )

    errors, _ = validator.validate_repository(root)

    assert any("still uses the template title" in error for error in errors)
    assert any("template scaffolding in '## Problem'" in error for error in errors)
    assert any("template task scaffolding" in error for error in errors)


def test_final_evidence_requires_a_final_result_cell(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    (root / "specs/0001-example-feature/verification.md").write_text(
        "## Requirement coverage\n\n| FR-001 | not PASS yet | PENDING |\n",
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert any("requires PASS, MANUAL, or reasoned N/A evidence" in error for error in errors)


def test_evidence_id_must_be_in_requirement_column(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    spec = root / "specs/0001-example-feature/spec.md"
    spec.write_text(
        spec.read_text(encoding="utf-8")
        .replace("- **FR-001:** Works.\n", "- **FR-001:** Works.\n- **FR-002:** Also works.\n"),
        encoding="utf-8",
    )
    (root / "specs/0001-example-feature/verification.md").write_text(
        "## Requirement coverage\n\n| FR-002 | exercises FR-001 | PASS |\n",
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert any("no evidence row for FR-001" in error for error in errors)


def test_repository_rejects_duplicate_evidence_rows(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    (root / "specs/0001-example-feature/verification.md").write_text(
        "## Requirement coverage\n\n"
        "| FR-001 | unit | PASS |\n"
        "| FR-001 | browser | MANUAL |\n",
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert any("duplicate evidence rows for FR-001" in error for error in errors)


def test_repository_rejects_empty_evidence_cell(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    (root / "specs/0001-example-feature/verification.md").write_text(
        "## Requirement coverage\n\n| FR-001 | | PASS |\n",
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert any("no evidence row for FR-001" in error for error in errors)


def test_repository_accepts_reasoned_non_applicable_evidence(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    (root / "specs/0001-example-feature/verification.md").write_text(
        "## Requirement coverage\n\n"
        "| FR-001 | rationale=No UI surface changes, so browser evidence is not applicable. | N/A |\n",
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert errors == []


def test_repository_rejects_non_applicable_without_rationale(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    (root / "specs/0001-example-feature/verification.md").write_text(
        "## Requirement coverage\n\n| FR-001 | | N/A |\n",
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert any("no evidence row for FR-001" in error for error in errors)


def test_repository_rejects_underspecified_manual_and_na_evidence(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    verification = root / "specs/0001-example-feature/verification.md"
    verification.write_text(
        "## Requirement coverage\n\n| FR-001 | x | MANUAL |\n",
        encoding="utf-8",
    )
    manual_errors, _ = validator.validate_repository(root)
    assert any("MANUAL evidence must use" in error for error in manual_errors)
    verification.write_text(
        "## Requirement coverage\n\n| FR-001 | rationale=x | N/A |\n",
        encoding="utf-8",
    )
    na_errors, _ = validator.validate_repository(root)
    assert any("N/A evidence must use rationale" in error for error in na_errors)
    verification.write_text(
        "## Requirement coverage\n\n| FR-001 | rationale=<specific reason> | N/A |\n",
        encoding="utf-8",
    )
    placeholder_errors, _ = validator.validate_repository(root)
    assert any("N/A evidence must use rationale" in error for error in placeholder_errors)
    verification.write_text(
        "## Requirement coverage\n\n"
        "| FR-001 | Test, query, screenshot, or manual journey | PASS |\n",
        encoding="utf-8",
    )
    pass_errors, _ = validator.validate_repository(root)
    assert any("PASS evidence must identify" in error for error in pass_errors)
    verification.write_text(
        "## Requirement coverage\n\n| FR-001 | x | PASS |\n",
        encoding="utf-8",
    )
    token_errors, _ = validator.validate_repository(root)
    assert any("PASS evidence must identify" in error for error in token_errors)
    verification.write_text(
        "## Requirement coverage\n\n| FR-001 | passed | PASS |\n",
        encoding="utf-8",
    )
    generic_errors, _ = validator.validate_repository(root)
    assert any("PASS evidence must identify" in error for error in generic_errors)
    verification.write_text(
        "## Requirement coverage\n\n"
        "| FR-001 | all automated checks completed | PASS |\n",
        encoding="utf-8",
    )
    prose_errors, _ = validator.validate_repository(root)
    assert any("PASS evidence must identify" in error for error in prose_errors)
    verification.write_text(
        "## Requirement coverage\n\n"
        "| FR-001 | all test/query checks passed | PASS |\n",
        encoding="utf-8",
    )
    slash_prose_errors, _ = validator.validate_repository(root)
    assert any("PASS evidence must identify" in error for error in slash_prose_errors)
    verification.write_text(
        "## Requirement coverage\n\n"
        "| FR-001 | reviewer=<name>; environment=<preview>; date=2026-09-15; observed=<observable result> | MANUAL |\n",
        encoding="utf-8",
    )
    manual_placeholder_errors, _ = validator.validate_repository(root)
    assert any("MANUAL evidence must use" in error for error in manual_placeholder_errors)


def test_repository_accepts_only_supported_manual_evidence_environments(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path)
    verification = root / "specs/0001-example-feature/verification.md"
    for environment in ("preview", "staging", "production"):
        verification.write_text(
            "## Requirement coverage\n\n"
            f"| FR-001 | reviewer=Lan; environment={environment}; date=2026-09-15; observed=Flow completed | MANUAL |\n",
            encoding="utf-8",
        )
        errors, _ = validator.validate_repository(root)
        assert errors == []

    verification.write_text(
        "## Requirement coverage\n\n"
        "| FR-001 | reviewer=Lan; environment=moon; date=2026-09-15; observed=Flow completed | MANUAL |\n",
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert any("MANUAL evidence must use" in error for error in errors)


def test_manual_evidence_requires_real_calendar_date(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    verification = root / "specs/0001-example-feature/verification.md"
    for invalid_date in ("2026-99-99", "2026-02-30", "2099-01-01"):
        verification.write_text(
            "## Requirement coverage\n\n"
            f"| FR-001 | reviewer=Lan; environment=staging; date={invalid_date}; observed=Flow completed | MANUAL |\n",
            encoding="utf-8",
        )
        errors, _ = validator.validate_repository(root)
        assert any("MANUAL evidence must use" in error for error in errors)

    verification.write_text(
        "## Requirement coverage\n\n"
        "| FR-001 | reviewer=Lan; environment=staging; date=2024-02-29; observed=Flow completed | MANUAL |\n",
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert errors == []


def test_pass_repository_locator_must_exist(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    verification = root / "specs/0001-example-feature/verification.md"
    verification.write_text(
        "## Requirement coverage\n\n"
        "| FR-001 | backend/tests/does_not_exist.py | PASS |\n",
        encoding="utf-8",
    )
    missing_errors, _ = validator.validate_repository(root)
    assert any("PASS evidence must identify" in error for error in missing_errors)

    verification.write_text(
        "## Requirement coverage\n\n| FR-001 | backend/ | PASS |\n",
        encoding="utf-8",
    )
    directory_errors, _ = validator.validate_repository(root)
    assert any("PASS evidence must identify" in error for error in directory_errors)

    _write(root / "scripts/hooks/pre-push", "#!/bin/sh\n")
    verification.write_text(
        "## Requirement coverage\n\n| FR-001 | scripts/hooks/pre-push | PASS |\n",
        encoding="utf-8",
    )
    untracked_errors, _ = validator.validate_repository(root)
    assert any("PASS evidence must identify" in error for error in untracked_errors)

    verification.write_text(
        "## Requirement coverage\n\n| FR-001 | .git/config | PASS |\n",
        encoding="utf-8",
    )
    git_internal_errors, _ = validator.validate_repository(root)
    assert any("PASS evidence must identify" in error for error in git_internal_errors)

    subprocess.run(["git", "add", "scripts/hooks/pre-push"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "track evidence helper"], cwd=root, check=True)
    verification.write_text(
        "## Requirement coverage\n\n| FR-001 | scripts/hooks/pre-push | PASS |\n",
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert errors == []


def test_repository_accepts_documented_python_and_npx_command_evidence(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path)
    verification = root / "specs/0001-example-feature/verification.md"
    for command in (
        "python backend/scripts/validate_specs.py --root .",
        "python3 -m pytest backend/tests/test_validate_specs.py",
        "backend/venv/bin/python backend/scripts/validate_specs.py --root .",
        "npx tsc --noEmit",
    ):
        verification.write_text(
            "## Requirement coverage\n\n"
            f"| FR-001 | kind=command; ref={command} | PASS |\n",
            encoding="utf-8",
        )
        errors, _ = validator.validate_repository(root)
        assert errors == []

    verification.write_text(
        "## Requirement coverage\n\n"
        "| FR-001 | kind=command; ref=ordinary prose without an executable | PASS |\n",
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert any("PASS evidence must identify" in error for error in errors)


def test_repository_rejects_unknown_evidence_result(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path, status="implementing")
    (root / "specs/0001-example-feature/verification.md").write_text(
        "## Requirement coverage\n\n| FR-001 | unit test | MAYBE |\n",
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert any("FR-001 result must be one of" in error for error in errors)


def test_repository_rejects_stale_active_index_status(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    index = root / "specs/README.md"
    index.write_text(
        index.read_text(encoding="utf-8").replace("| verified |", "| approved |"),
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert any("status is 'approved', expected 'verified'" in error for error in errors)


def test_repository_rejects_stale_active_index_title(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    spec = root / "specs/0001-example-feature/spec.md"
    spec.write_text(
        spec.read_text(encoding="utf-8").replace("title: Example", "title: Renamed example"),
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert any("title is 'Example', expected 'Renamed example'" in error for error in errors)


def test_repository_rejects_prose_only_index_mention(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    (root / "specs/README.md").write_text(
        "# Index\n\nFEAT-0001 is discussed here but has no table row.\n",
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert any("active index has no exact row for FEAT-0001" in error for error in errors)


def test_repository_rejects_orphan_active_index_row(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    index = root / "specs/README.md"
    index.write_text(
        index.read_text(encoding="utf-8")
        + "| FEAT-0002 | Missing | approved | low | [spec](0002-missing/spec.md) |\n",
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert any("active index references missing spec FEAT-0002" in error for error in errors)


def test_repository_rejects_non_string_frontmatter(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    spec = root / "specs/0001-example-feature/spec.md"
    spec.write_text(
        spec.read_text(encoding="utf-8").replace("owner: product", "owner: [product]"),
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert any("field 'owner' must be a non-empty string" in error for error in errors)


def test_feature_pr_requires_existing_non_draft_spec(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    _, specs = validator.validate_repository(root)
    assert validator.validate_pull_request(
        _event(root=root, change_class="feature", spec="N/A"), specs, root
    )
    assert validator.validate_pull_request(
        _event(root=root, change_class="feature", spec="FEAT-9999"), specs, root
    )
    assert validator.validate_pull_request(
        _event(root=root, change_class="feature", spec="FEAT-0001"), specs, root
    ) == []


def test_feature_pr_rejects_superseded_spec(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path, status="superseded")
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    errors = validator.validate_pull_request(
        _event(root=root, change_class="feature", spec="FEAT-0001"), specs, root
    )
    assert any("not superseded" in error for error in errors)


def test_high_risk_pr_requires_high_or_critical_spec(tmp_path: Path) -> None:
    low_root = _valid_repo(tmp_path / "low", status="approved", risk="low")
    _, low_specs = validator.validate_repository(low_root)
    low_errors = validator.validate_pull_request(
        _event(root=low_root, change_class="high-risk", spec="FEAT-0001"),
        low_specs,
        low_root,
    )
    assert any("requires a high or critical risk spec" in error for error in low_errors)

    high_root = _valid_repo(tmp_path / "high", status="approved", risk="high")
    repository_errors, high_specs = validator.validate_repository(high_root)
    assert repository_errors == []
    assert validator.validate_pull_request(
        _event(root=high_root, change_class="high-risk", spec="FEAT-0001"),
        high_specs,
        high_root,
    ) == []


def test_high_risk_pr_requires_base_spec_to_have_high_risk(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path, status="approved", risk="low")
    feature = root / "specs/0001-example-feature"
    spec = feature / "spec.md"
    spec.write_text(
        spec.read_text(encoding="utf-8").replace("risk: low", "risk: high"),
        encoding="utf-8",
    )
    index = root / "specs/README.md"
    index.write_text(
        index.read_text(encoding="utf-8").replace("| low |", "| high |"),
        encoding="utf-8",
    )
    _write(
        feature / "ui-states.md",
        "| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |\n"
        "| --- | --- | --- | --- | --- | --- | --- |\n"
        "| Admin workflow | Skeleton | No records | Canonical data | Retry | Admin only | Mobile/desktop, themes, keyboard |\n",
    )
    _write(
        feature / "rollout.md",
        "## Preconditions\nReady.\n## Staging\nVerify.\n## Production\nPromote.\n"
        "## Rollback and repair\nRevert.\n## Observability\nMonitor.\n",
    )
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    errors = validator.validate_pull_request(
        _event(root=root, change_class="high-risk", spec="FEAT-0001"), specs, root
    )
    assert any("was not approved as high or critical risk" in error for error in errors)


def test_feature_pr_cannot_raise_approved_risk_or_misclassify_high_spec(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path / "raised", status="approved", risk="medium")
    feature = root / "specs/0001-example-feature"
    spec = feature / "spec.md"
    spec.write_text(
        spec.read_text(encoding="utf-8").replace("risk: medium", "risk: high"),
        encoding="utf-8",
    )
    index = root / "specs/README.md"
    index.write_text(
        index.read_text(encoding="utf-8").replace("| medium |", "| high |"),
        encoding="utf-8",
    )
    _write(
        feature / "ui-states.md",
        "| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |\n"
        "| --- | --- | --- | --- | --- | --- | --- |\n"
        "| Admin workflow | Skeleton | No records | Canonical data | Retry | Admin only | Mobile/desktop, themes, keyboard |\n",
    )
    _write(
        feature / "rollout.md",
        "## Preconditions\nReady.\n## Staging\nVerify.\n## Production\nPromote.\n"
        "## Rollback and repair\nRevert.\n## Observability\nMonitor.\n",
    )
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    raised_errors = validator.validate_pull_request(
        _event(root=root, change_class="feature", spec="FEAT-0001"), specs, root
    )
    assert any("risk changed after base approval" in error for error in raised_errors)

    high_root = _valid_repo(tmp_path / "misclassified", status="approved", risk="high")
    _, high_specs = validator.validate_repository(high_root)
    class_errors = validator.validate_pull_request(
        _event(root=high_root, change_class="feature", spec="FEAT-0001"),
        high_specs,
        high_root,
    )
    assert any("requires change class 'high-risk'" in error for error in class_errors)

    for lower_class in ("hotfix", "small", "content"):
        lower_class_errors = validator.validate_pull_request(
            _event(root=high_root, change_class=lower_class, spec="FEAT-0001"),
            high_specs,
            high_root,
        )
        assert any(
            "requires change class 'high-risk'" in error
            for error in lower_class_errors
        )

    assert validator.validate_pull_request(
        _event(root=high_root, change_class="high-risk", spec="FEAT-0001"),
        high_specs,
        high_root,
    ) == []


def test_high_risk_spec_requires_ui_state_and_rollout_artifacts(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path, risk="high")
    (root / "specs/0001-example-feature/ui-states.md").unlink()
    errors, _ = validator.validate_repository(root)
    assert any("high-risk feature artifact is required" in error for error in errors)


def test_high_risk_ui_state_matrix_requires_complete_surface_row(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path, risk="high")
    matrix = root / "specs/0001-example-feature/ui-states.md"
    matrix.write_text(
        "# UI state matrix\n\n"
        "| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |\n"
        "| --- | --- | --- | --- | --- | --- | --- |\n",
        encoding="utf-8",
    )
    header_only_errors, _ = validator.validate_repository(root)
    assert any("needs a complete surface row" in error for error in header_only_errors)

    matrix.write_text(
        "# UI state matrix\n\n"
        "| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |\n"
        "| --- | --- | --- | --- | --- | --- | --- |\n"
        "| Learner result | N/A | N/A | N/A | N/A | N/A | N/A |\n",
        encoding="utf-8",
    )
    all_na_errors, _ = validator.validate_repository(root)
    assert any("needs a complete surface row" in error for error in all_na_errors)

    matrix.write_text(
        "# UI state matrix\n\n"
        "| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |\n"
        "| --- | --- | --- | --- | --- | --- | --- |\n"
        "    | Hidden | Skeleton | Empty | Success | Retry | Admin | Evidence |\n",
        encoding="utf-8",
    )
    indented_errors, _ = validator.validate_repository(root)
    assert any("needs a complete surface row" in error for error in indented_errors)

    matrix.write_text(
        "# UI state matrix\n\n"
        "| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |\n"
        "| --- | --- | --- | --- | --- | --- | --- |\n"
        "| Learner result | Skeleton | No attempt | Score | Retry | Owner only | Mobile/desktop, both themes, keyboard |\n",
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert errors == []

    matrix.write_text(
        "# UI state matrix\n\n"
        "UI impact: N/A — Database-only migration with no user interface surface.\n",
        encoding="utf-8",
    )
    non_ui_errors, _ = validator.validate_repository(root)
    assert non_ui_errors == []


def test_feature_pr_rejects_spec_approved_only_after_base(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path, status="draft")
    spec = root / "specs/0001-example-feature/spec.md"
    spec.write_text(
        spec.read_text(encoding="utf-8").replace("status: draft", "status: approved"),
        encoding="utf-8",
    )
    index = root / "specs/README.md"
    index.write_text(
        index.read_text(encoding="utf-8").replace("| draft |", "| approved |"),
        encoding="utf-8",
    )
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    errors = validator.validate_pull_request(
        _event(root=root, change_class="feature", spec="FEAT-0001"), specs, root
    )
    assert any("was not approved in the base revision" in error for error in errors)


def test_feature_pr_rejects_spec_self_approved_in_same_change(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    source = root / "specs/0001-example-feature"
    target = root / "specs/0002-new-feature"
    target.mkdir()
    for path in source.iterdir():
        text = path.read_text(encoding="utf-8").replace("FEAT-0001", "FEAT-0002")
        target.joinpath(path.name).write_text(text, encoding="utf-8")
    index = root / "specs/README.md"
    index.write_text(
        index.read_text(encoding="utf-8")
        + "| FEAT-0002 | Example | verified | medium | [spec](0002-new-feature/spec.md) |\n",
        encoding="utf-8",
    )
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    errors = validator.validate_pull_request(
        _event(root=root, change_class="feature", spec="FEAT-0002"), specs, root
    )
    assert any("approved in the base revision before implementation" in error for error in errors)


def test_feature_pr_requires_known_requirement_coverage(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    _, specs = validator.validate_repository(root)
    missing = validator.validate_pull_request(
        _event(root=root, change_class="feature", spec="FEAT-0001", coverage="None."),
        specs,
        root,
    )
    assert any("must list at least one exact FR-NNN" in error for error in missing)
    unknown = validator.validate_pull_request(
        _event(root=root, change_class="feature", spec="FEAT-0001", coverage="- FR-999 -> test"),
        specs,
        root,
    )
    assert any("references unknown FR-999" in error for error in unknown)
    empty = validator.validate_pull_request(
        _event(root=root, change_class="feature", spec="FEAT-0001", coverage="- FR-001 ->"),
        specs,
        root,
    )
    assert any("must include evidence after the arrow" in error for error in empty)
    commented = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            coverage="<!--\n- FR-001 -> hidden evidence\n-->",
        ),
        specs,
        root,
    )
    assert any("must list at least one exact FR-NNN" in error for error in commented)
    generic = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            coverage="- FR-001 -> done",
        ),
        specs,
        root,
    )
    assert any("must identify a concrete test" in error for error in generic)
    assert validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            coverage=(
                "- FR-001 -> kind=manual; reviewer=Lan; environment=staging; "
                "date=2026-09-15; observed=Flow completed"
            ),
        ),
        specs,
        root,
    ) == []
    assert validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            coverage=(
                "- FR-001 -> reviewer=Lan; environment=staging; "
                "date=2026-09-15; observed=Flow completed"
            ),
        ),
        specs,
        root,
    ) == []
    assert validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            coverage=(
                "- FR-001 -> rationale=No runtime behavior is affected by this requirement."
            ),
        ),
        specs,
        root,
    ) == []
    incomplete_manual = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            coverage="- FR-001 -> reviewer=Lan; environment=staging",
        ),
        specs,
        root,
    )
    assert any("must identify a concrete test" in error for error in incomplete_manual)


def test_pull_request_ignores_metadata_hidden_in_comments(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    _, specs = validator.validate_repository(root)
    hidden = _event(root=root, change_class="small", spec="N/A")
    hidden["pull_request"]["body"] = hidden["pull_request"]["body"].replace(
        "Change class: small\nSpec: N/A",
        "<!--\nChange class: small\nSpec: N/A\n-->",
    )
    hidden_errors = validator.validate_pull_request(hidden, specs, root)
    assert any("'Change class:' must be one of" in error for error in hidden_errors)
    assert any("add 'Spec: N/A'" in error for error in hidden_errors)

    unclosed = _event(root=root, change_class="small", spec="N/A")
    unclosed["pull_request"]["body"] = "<!--\n" + unclosed["pull_request"]["body"]
    unclosed_errors = validator.validate_pull_request(unclosed, specs, root)
    assert any("'Change class:' must be one of" in error for error in unclosed_errors)
    assert any("add 'Spec: N/A'" in error for error in unclosed_errors)

    inline_options = _event(root=root, change_class="small", spec="N/A")
    inline_options["pull_request"]["body"] = inline_options["pull_request"][
        "body"
    ].replace(
        "Change class: small\nSpec: N/A",
        "Change class: <!-- feature | high-risk --> small\n"
        "Spec: <!-- approved ID or --> N/A",
    )
    assert validator.validate_pull_request(inline_options, specs, root) == []


def test_pull_request_ignores_metadata_and_sections_in_fenced_code(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path)
    _, specs = validator.validate_repository(root)
    fenced = _event(root=root, change_class="small", spec="N/A")
    fenced["pull_request"]["body"] = (
        "```text\n" + fenced["pull_request"]["body"] + "\n```\n"
    )
    errors = validator.validate_pull_request(fenced, specs, root)
    assert any("'Change class:' must be one of" in error for error in errors)
    assert any("add 'Spec: N/A'" in error for error in errors)

    longer_closer = _event(root=root, change_class="small", spec="N/A")
    longer_closer["pull_request"]["body"] = (
        "```text\nChange class: high-risk\nSpec: FEAT-9999\n````\n"
        + longer_closer["pull_request"]["body"]
    )
    assert validator.validate_pull_request(longer_closer, specs, root) == []


def test_feature_pr_rejects_requirement_added_after_base_approval(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path, status="approved")
    spec = root / "specs/0001-example-feature/spec.md"
    spec.write_text(
        spec.read_text(encoding="utf-8").replace(
            "- **FR-001:** Works.\n",
            "- **FR-001:** Works.\n- **FR-002:** Added after approval.\n",
        ),
        encoding="utf-8",
    )
    verification = root / "specs/0001-example-feature/verification.md"
    verification.write_text(
        verification.read_text(encoding="utf-8")
        + "| FR-002 | backend/tests/test_second.py::test_added | PASS |\n",
        encoding="utf-8",
    )
    (root / "backend/tests/test_second.py").write_text(
        "def test_added():\n    assert True\n", encoding="utf-8"
    )
    subprocess.run(["git", "add", "backend/tests/test_second.py"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "track second test"], cwd=root, check=True)
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    errors = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            coverage="- FR-002 -> automated test",
        ),
        specs,
        root,
    )
    assert any("FR-002 was not approved in the base revision" in error for error in errors)


def test_feature_pr_rejects_requirement_definition_changed_after_approval(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path, status="approved")
    spec = root / "specs/0001-example-feature/spec.md"
    spec.write_text(
        spec.read_text(encoding="utf-8").replace(
            "- **FR-001:** Works.", "- **FR-001:** Meaning changed after approval."
        ),
        encoding="utf-8",
    )
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    errors = validator.validate_pull_request(
        _event(root=root, change_class="feature", spec="FEAT-0001"), specs, root
    )
    assert any("FR-001 definition changed after base approval" in error for error in errors)


def test_feature_pr_rejects_spec_id_changed_after_approval(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path, status="approved")
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    spec = root / "specs/0001-example-feature/spec.md"
    spec.write_text(
        spec.read_text(encoding="utf-8").replace("id: FEAT-0001", "id: RENAMED-0001"),
        encoding="utf-8",
    )
    index = root / "specs/README.md"
    index.write_text(
        index.read_text(encoding="utf-8").replace("FEAT-0001", "RENAMED-0001"),
        encoding="utf-8",
    )
    _write(root / "docs/implementation.md", "implementation for renamed identity\n")
    subprocess.run(["git", "add", "specs", "docs/implementation.md"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "rename spec identity and implement"], cwd=root, check=True)
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    errors = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="RENAMED-0001",
            base_sha=base_sha,
        ),
        specs,
        root,
    )
    assert any("identity changed after base approval" in error for error in errors)
    assert any("cannot find durable approval commit" in error for error in errors)


def test_feature_pr_compares_multiline_requirement_definition(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path, status="approved")
    spec = root / "specs/0001-example-feature/spec.md"
    spec.write_text(
        spec.read_text(encoding="utf-8").replace(
            "- **FR-001:** Works.",
            "- **FR-001:** Works.\n  Approved continuation detail.",
        ),
        encoding="utf-8",
    )
    subprocess.run(["git", "add", "specs/0001-example-feature/spec.md"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "approve multiline requirement"], cwd=root, check=True)
    spec.write_text(
        spec.read_text(encoding="utf-8").replace(
            "Approved continuation detail.", "Changed continuation detail."
        ),
        encoding="utf-8",
    )
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    errors = validator.validate_pull_request(
        _event(root=root, change_class="feature", spec="FEAT-0001"), specs, root
    )
    assert any("FR-001 definition changed after base approval" in error for error in errors)


def test_feature_pr_compares_uncovered_requirements_with_base(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path, status="approved")
    spec = root / "specs/0001-example-feature/spec.md"
    spec.write_text(
        spec.read_text(encoding="utf-8").replace(
            "- **FR-001:** Works.",
            "- **FR-001:** Works.\n- **FR-002:** Second approved requirement.",
        ),
        encoding="utf-8",
    )
    verification = root / "specs/0001-example-feature/verification.md"
    verification.write_text(
        verification.read_text(encoding="utf-8")
        + "| FR-002 | backend/tests/test_second.py::test_approved | PASS |\n",
        encoding="utf-8",
    )
    (root / "backend/tests/test_second.py").write_text(
        "def test_approved():\n    assert True\n", encoding="utf-8"
    )
    subprocess.run(["git", "add", "backend/tests/test_second.py"], cwd=root, check=True)
    subprocess.run(
        ["git", "add", "specs/0001-example-feature/spec.md", "specs/0001-example-feature/verification.md"],
        cwd=root,
        check=True,
    )
    subprocess.run(["git", "commit", "-qm", "approve second requirement"], cwd=root, check=True)
    spec.write_text(
        spec.read_text(encoding="utf-8").replace(
            "Second approved requirement.", "Changed without approval."
        ),
        encoding="utf-8",
    )
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    errors = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            coverage="- FR-001 -> automated test",
        ),
        specs,
        root,
    )
    assert any("FR-002 definition changed after base approval" in error for error in errors)


def test_small_pr_may_use_na(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    _, specs = validator.validate_repository(root)
    assert validator.validate_pull_request(
        _event(root=root, change_class="small", spec="N/A"), specs, root
    ) == []


def test_spec_free_pr_requires_problem_expected_scope_and_verification(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    _, specs = validator.validate_repository(root)
    errors = validator.validate_pull_request(
        _event(
            root=root,
            change_class="small",
            spec="N/A",
            include_na_details=False,
        ),
        specs,
        root,
    )
    for heading in ("Problem", "Expected behavior", "Scope", "Verification"):
        assert any(f"'## {heading}'" in error for error in errors)

    placeholder_event = _event(root=root, change_class="small", spec="N/A")
    placeholder_event["pull_request"]["body"] = (
        "Change class: small\nSpec: N/A\n\n"
        "## Problem\n\nTBD\n\n"
        "## Expected behavior\n\nTODO\n\n"
        "## Scope\n\nplaceholder\n\n"
        "## Verification\n\nN/A\n"
    )
    placeholder_errors = validator.validate_pull_request(
        placeholder_event, specs, root
    )
    for heading in ("Problem", "Expected behavior", "Scope", "Verification"):
        assert any(f"'## {heading}'" in error for error in placeholder_errors)


def test_small_pr_cannot_skip_details_by_citing_existing_spec(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    _, specs = validator.validate_repository(root)
    errors = validator.validate_pull_request(
        _event(
            root=root,
            change_class="small",
            spec="FEAT-0001",
            include_na_details=False,
        ),
        specs,
        root,
    )
    for heading in ("Problem", "Expected behavior", "Scope", "Verification"):
        assert any(f"'## {heading}'" in error for error in errors)


def test_constitution_amendment_requires_version_bump_and_rationale(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path)
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    constitution = root / "specs/_meta/constitution.md"
    constitution.write_text(
        constitution.read_text(encoding="utf-8").replace(
            "These rules govern how product intent becomes implementation.",
            "These rules govern how approved product intent becomes implementation.",
        ),
        encoding="utf-8",
    )
    subprocess.run(["git", "add", str(constitution)], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "clarify constitution"], cwd=root, check=True)
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []

    errors = validator.validate_pull_request(
        _event(root=root, change_class="small", spec="N/A", base_sha=base_sha),
        specs,
        root,
    )
    assert any("patch version bump to 1.0.1" in error for error in errors)
    assert any("Constitution amendment" in error and "rationale" in error for error in errors)


def test_constitution_amendment_accepts_exact_patch_bump_and_rationale(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path)
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    constitution = root / "specs/_meta/constitution.md"
    constitution.write_text(
        constitution.read_text(encoding="utf-8")
        .replace("version: 1.0.0", "version: 1.0.1")
        .replace(
            "These rules govern how product intent becomes implementation.",
            "These rules govern how approved product intent becomes implementation.",
        ),
        encoding="utf-8",
    )
    subprocess.run(["git", "add", str(constitution)], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "clarify constitution"], cwd=root, check=True)
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    event = _event(root=root, change_class="small", spec="N/A", base_sha=base_sha)
    event["pull_request"]["body"] += (
        "\n## Constitution amendment\n\nAmendment class: patch\n\n"
        "Clarifies the introduction without changing an engineering obligation.\n"
    )
    assert validator.validate_pull_request(event, specs, root) == []
    wrong_class = dict(event)
    wrong_class["pull_request"] = dict(event["pull_request"])
    wrong_class["pull_request"]["body"] = event["pull_request"]["body"].replace(
        "Amendment class: patch", "Amendment class: minor"
    )
    wrong_class_errors = validator.validate_pull_request(wrong_class, specs, root)
    assert any(
        "constitution amendment class must be 'patch'" in error
        for error in wrong_class_errors
    )


def test_constitution_new_obligation_requires_minor_bump(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    constitution = root / "specs/_meta/constitution.md"
    constitution.write_text(
        constitution.read_text(encoding="utf-8")
        .replace("version: 1.0.0", "version: 1.0.1")
        .replace(
            "- Superseded documents MUST be labeled",
            "- Governance exceptions MUST name an owner and expiry date.\n"
            "- Superseded documents MUST be labeled",
        ),
        encoding="utf-8",
    )
    subprocess.run(["git", "add", str(constitution)], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "add constitution obligation"], cwd=root, check=True)
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    event = _event(root=root, change_class="small", spec="N/A", base_sha=base_sha)
    event["pull_request"]["body"] += (
        "\n## Constitution amendment\n\nAmendment class: minor\n\n"
        "Adds an expiry rule for exceptions.\n"
    )
    errors = validator.validate_pull_request(event, specs, root)
    assert any("minor version bump to 1.1.0" in error for error in errors)


def test_constitution_standalone_obligation_requires_minor_bump(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path)
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    constitution = root / "specs/_meta/constitution.md"
    constitution.write_text(
        constitution.read_text(encoding="utf-8")
        .replace("version: 1.0.0", "version: 1.0.1")
        .replace(
            "## 9. Staging-first release\n",
            "## 9. Staging-first release\n\n"
            "Deployments MUST be manually approved.\n",
        ),
        encoding="utf-8",
    )
    subprocess.run(["git", "add", str(constitution)], cwd=root, check=True)
    subprocess.run(
        ["git", "commit", "-qm", "add standalone constitution obligation"],
        cwd=root,
        check=True,
    )
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    event = _event(root=root, change_class="small", spec="N/A", base_sha=base_sha)
    event["pull_request"]["body"] += (
        "\n## Constitution amendment\n\nAmendment class: minor\n\n"
        "Adds a manual deployment approval rule.\n"
    )
    errors = validator.validate_pull_request(event, specs, root)
    assert any("minor version bump to 1.1.0" in error for error in errors)


def test_constitution_unmarked_inline_modal_participates_in_versioning(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path)
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    constitution = root / "specs/_meta/constitution.md"
    constitution.write_text(
        constitution.read_text(encoding="utf-8")
        .replace("version: 1.0.0", "version: 1.0.1")
        .replace(
            "## 2. Proportional specification\n",
            "## 2. Proportional specification\n\n"
            "In this document, `MUST` and `SHOULD` describe rule strength.\n",
        ),
        encoding="utf-8",
    )
    subprocess.run(["git", "add", str(constitution)], cwd=root, check=True)
    subprocess.run(
        ["git", "commit", "-qm", "clarify normative terminology"],
        cwd=root,
        check=True,
    )
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    event = _event(root=root, change_class="small", spec="N/A", base_sha=base_sha)
    event["pull_request"]["body"] += (
        "\n## Constitution amendment\n\nAmendment class: minor\n\n"
        "Adds unmarked normative terminology.\n"
    )
    errors = validator.validate_pull_request(event, specs, root)
    assert any("minor version bump to 1.1.0" in error for error in errors)


def test_constitution_quoted_rule_declaration_requires_minor_bump(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path)
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    constitution = root / "specs/_meta/constitution.md"
    constitution.write_text(
        constitution.read_text(encoding="utf-8")
        .replace("version: 1.0.0", "version: 1.0.1")
        .replace(
            "## 9. Staging-first release\n",
            "## 9. Staging-first release\n\n"
            'The new policy is “Deployments MUST be manually approved.”\n',
        ),
        encoding="utf-8",
    )
    subprocess.run(["git", "add", str(constitution)], cwd=root, check=True)
    subprocess.run(
        ["git", "commit", "-qm", "add quoted constitution obligation"],
        cwd=root,
        check=True,
    )
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    event = _event(root=root, change_class="small", spec="N/A", base_sha=base_sha)
    event["pull_request"]["body"] += (
        "\n## Constitution amendment\n\nAmendment class: minor\n\n"
        "Adds a quoted manual deployment approval rule.\n"
    )
    errors = validator.validate_pull_request(event, specs, root)
    assert any("minor version bump to 1.1.0" in error for error in errors)


def test_constitution_marked_inline_example_accepts_patch_bump(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path)
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    constitution = root / "specs/_meta/constitution.md"
    constitution.write_text(
        constitution.read_text(encoding="utf-8")
        .replace("version: 1.0.0", "version: 1.0.1")
        .replace(
            "## 2. Proportional specification\n",
            "## 2. Proportional specification\n\n"
            "Example: `Clients MUST retry`.\n",
        ),
        encoding="utf-8",
    )
    subprocess.run(["git", "add", str(constitution)], cwd=root, check=True)
    subprocess.run(
        ["git", "commit", "-qm", "add marked normative example"],
        cwd=root,
        check=True,
    )
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    event = _event(root=root, change_class="small", spec="N/A", base_sha=base_sha)
    event["pull_request"]["body"] += (
        "\n## Constitution amendment\n\nAmendment class: patch\n\n"
        "Adds a marked example without changing an obligation.\n"
    )
    assert validator.validate_pull_request(event, specs, root) == []


def test_constitution_marked_example_does_not_hide_following_obligation(
    tmp_path: Path,
) -> None:
    successors = (
        '“Deployments MUST be manually approved.”',
        "`Deployments` MUST be manually approved.",
        "Deployments `MUST` be manually approved.",
        "**Deployments** MUST be manually approved.",
    )
    for index, successor in enumerate(successors):
        root = _valid_repo(tmp_path / f"case-{index}")
        base_sha = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        constitution = root / "specs/_meta/constitution.md"
        constitution.write_text(
            constitution.read_text(encoding="utf-8")
            .replace("version: 1.0.0", "version: 1.0.1")
            .replace(
                "## 9. Staging-first release\n",
                "## 9. Staging-first release\n\n"
                f"Example: `Clients MUST retry`. {successor}\n",
            ),
            encoding="utf-8",
        )
        subprocess.run(["git", "add", str(constitution)], cwd=root, check=True)
        subprocess.run(
            ["git", "commit", "-qm", "add rule after marked example"],
            cwd=root,
            check=True,
        )
        repository_errors, specs = validator.validate_repository(root)
        assert repository_errors == []
        event = _event(
            root=root, change_class="small", spec="N/A", base_sha=base_sha
        )
        event["pull_request"]["body"] += (
            "\n## Constitution amendment\n\nAmendment class: minor\n\n"
            "Adds a deployment rule after a marked example.\n"
        )
        errors = validator.validate_pull_request(event, specs, root)
        assert any("minor version bump to 1.1.0" in error for error in errors)


def test_constitution_example_text_is_excluded_from_obligation_identity() -> None:
    base = """---
version: 1.0.0
---

Example: `Clients MUST retry`. Deployments MUST be manually approved.
"""
    edited_example = base.replace("Clients MUST retry", "Learners SHOULD retry")
    edited_rule = base.replace("manually approved", "automatically approved")

    assert validator._constitutional_obligations(base) == (
        validator._constitutional_obligations(edited_example)
    )
    assert validator._constitutional_obligations(base) != (
        validator._constitutional_obligations(edited_rule)
    )


def test_constitution_declarative_boundary_removal_requires_major_bump(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path)
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    constitution = root / "specs/_meta/constitution.md"
    constitution.write_text(
        constitution.read_text(encoding="utf-8")
        .replace("version: 1.0.0", "version: 1.0.1")
        .replace("- FastAPI is the only business backend and Railway deployment unit.\n", ""),
        encoding="utf-8",
    )
    subprocess.run(["git", "add", str(constitution)], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "remove backend boundary"], cwd=root, check=True)
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    event = _event(root=root, change_class="small", spec="N/A", base_sha=base_sha)
    event["pull_request"]["body"] += (
        "\n## Constitution amendment\n\nAmendment class: major\n\n"
        "Removes a canonical system boundary.\n"
    )
    errors = validator.validate_pull_request(event, specs, root)
    assert any("major version bump to 2.0.0" in error for error in errors)


def test_constitution_separate_prose_clarification_accepts_patch_bump(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path)
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    constitution = root / "specs/_meta/constitution.md"
    constitution.write_text(
        constitution.read_text(encoding="utf-8")
        .replace("version: 1.0.0", "version: 1.0.1")
        .replace(
            "## 8. Scoped parallel work",
            "Clarification: review comparison occurs during independent review.\n\n"
            "## 8. Scoped parallel work",
        ),
        encoding="utf-8",
    )
    subprocess.run(["git", "add", str(constitution)], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "clarify review obligation"], cwd=root, check=True)
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    event = _event(root=root, change_class="small", spec="N/A", base_sha=base_sha)
    event["pull_request"]["body"] += (
        "\n## Constitution amendment\n\nAmendment class: patch\n\n"
        "Clarifies when the existing review comparison applies.\n"
    )
    assert validator.validate_pull_request(event, specs, root) == []


def test_constitution_blank_separated_list_continuations_are_obligation_text() -> None:
    template = """---
version: 1.0.0
---

- Deployments MUST require approval.

{indent}Approval is mandatory in production.

Clarification: approval is recorded in the release log.
"""
    for indent, original, replacement in (
        ("  ", "Approval is mandatory in production.", "Approval is optional in production."),
        ("\t", "Approval is mandatory in production.", "Approval is optional in production."),
        (
            "  ",
            "Approval is mandatory in production.",
            "Approval is mandatory in production and\nremains optional during incidents.",
        ),
        (
            "\t",
            "Approval is mandatory in production.",
            "Approval is mandatory in production and\nremains optional during incidents.",
        ),
    ):
        base = template.format(indent=indent)
        edited_continuation = base.replace(original, replacement).replace(
            "version: 1.0.0", "version: 1.0.1"
        )
        edited_clarification = base.replace(
            "approval is recorded in the release log.",
            "approval is recorded before deployment.",
        ).replace("version: 1.0.0", "version: 1.0.1")

        _, _, required, bump = validator._expected_constitution_version(
            base, edited_continuation
        )
        assert (required, bump) == ((2, 0, 0), "major")
        _, _, required, bump = validator._expected_constitution_version(
            base, edited_clarification
        )
        assert (required, bump) == ((1, 0, 1), "patch")


def test_constitution_list_items_stop_at_interrupting_markdown_blocks() -> None:
    template = """---
version: 1.0.0
---

- Deployments MUST require approval.
{block}
Independent note text.
"""
    for block in (
        "### Notes",
        "> Notes",
        "---",
        "```text\nHidden example: Deployments MUST never run.\n```",
    ):
        base = template.format(block=block)
        edited_note = base.replace(
            "Independent note text.", "Updated independent note text."
        ).replace("version: 1.0.0", "version: 1.0.1")
        _, _, required, bump = validator._expected_constitution_version(
            base, edited_note
        )
        assert (required, bump) == ((1, 0, 1), "patch")


def test_constitution_optional_rule_edit_requires_major_bump(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path)
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    constitution = root / "specs/_meta/constitution.md"
    constitution.write_text(
        constitution.read_text(encoding="utf-8")
        .replace("version: 1.0.0", "version: 1.0.1")
        .replace(
            "the previous diff.",
            "the previous diff. Clarification: compliance is optional.",
        ),
        encoding="utf-8",
    )
    subprocess.run(["git", "add", str(constitution)], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "make review optional"], cwd=root, check=True)
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    event = _event(root=root, change_class="small", spec="N/A", base_sha=base_sha)
    event["pull_request"]["body"] += (
        "\n## Constitution amendment\n\nAmendment class: patch\n\n"
        "Claims to clarify the review obligation.\n"
    )
    errors = validator.validate_pull_request(event, specs, root)
    assert any("major version bump to 2.0.0" in error for error in errors)


def test_feature_pr_rejects_code_indented_coverage_but_accepts_nested_coverage(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path)
    _, specs = validator.validate_repository(root)
    code_errors = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            coverage="    - FR-001 -> backend/tests/test_example.py::test_works",
        ),
        specs,
        root,
    )
    assert any("must list at least one exact FR-NNN" in error for error in code_errors)

    nested_errors = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            coverage="  - FR-001 -> backend/tests/test_example.py::test_works",
        ),
        specs,
        root,
    )
    assert nested_errors == []


def test_migration_path_requires_approved_high_risk_change(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path, status="approved", risk="high")
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    _write(root / "backend/migrations/999_test.sql", "select 1;\n")
    subprocess.run(["git", "add", "backend/migrations/999_test.sql"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "add migration"], cwd=root, check=True)
    migration_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    _, specs = validator.validate_repository(root)

    small_errors = validator.validate_pull_request(
        _event(
            root=root,
            change_class="small",
            spec="N/A",
            base_sha=base_sha,
        ),
        specs,
        root,
    )
    assert any("migration paths require change class 'high-risk'" in error for error in small_errors)
    assert validator.validate_pull_request(
        _event(
            root=root,
            change_class="high-risk",
            spec="FEAT-0001",
            base_sha=base_sha,
            coverage=(
                "- FR-001 -> kind=test; ref=backend/tests/test_example.py::test_works; "
                f"implementation={migration_sha[:12]}:backend/migrations/999_test.sql"
            ),
        ),
        specs,
        root,
    ) == []


def test_migration_classification_uses_topic_changes_from_merge_base(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path, status="approved", risk="high")
    common_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    subprocess.run(["git", "checkout", "-qb", "base-advance"], cwd=root, check=True)
    _write(root / "backend/migrations/998_base_only.sql", "select 1;\n")
    subprocess.run(["git", "add", "backend/migrations/998_base_only.sql"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "base-only migration"], cwd=root, check=True)
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    subprocess.run(["git", "checkout", "-qb", "topic", common_sha], cwd=root, check=True)
    _write(root / "docs/topic.md", "ordinary topic change\n")
    subprocess.run(["git", "add", "docs/topic.md"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "ordinary topic change"], cwd=root, check=True)
    _, specs = validator.validate_repository(root)
    ordinary_errors = validator.validate_pull_request(
        _event(root=root, change_class="small", spec="N/A", base_sha=base_sha),
        specs,
        root,
    )
    assert not any("migration paths require" in error for error in ordinary_errors)

    _write(root / "backend/migrations/999_topic.sql", "select 2;\n")
    subprocess.run(["git", "add", "backend/migrations/999_topic.sql"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "topic migration"], cwd=root, check=True)
    migration_errors = validator.validate_pull_request(
        _event(root=root, change_class="small", spec="N/A", base_sha=base_sha),
        specs,
        root,
    )
    assert any("backend/migrations/999_topic.sql" in error for error in migration_errors)


def test_migration_rename_classification_preserves_both_paths(tmp_path: Path) -> None:
    moved_out = _valid_repo(tmp_path / "out")
    _write(moved_out / "backend/migrations/900_old.sql", "select 1;\n")
    subprocess.run(["git", "add", "backend/migrations/900_old.sql"], cwd=moved_out, check=True)
    subprocess.run(["git", "commit", "-qm", "add old migration"], cwd=moved_out, check=True)
    out_base = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=moved_out,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    (moved_out / "docs").mkdir(exist_ok=True)
    subprocess.run(
        ["git", "mv", "backend/migrations/900_old.sql", "docs/900_old.sql"],
        cwd=moved_out,
        check=True,
    )
    subprocess.run(["git", "commit", "-qm", "move migration out"], cwd=moved_out, check=True)
    _, out_specs = validator.validate_repository(moved_out)
    out_errors = validator.validate_pull_request(
        _event(root=moved_out, change_class="small", spec="N/A", base_sha=out_base),
        out_specs,
        moved_out,
    )
    assert any("backend/migrations/900_old.sql" in error for error in out_errors)

    moved_in = _valid_repo(tmp_path / "in")
    _write(moved_in / "docs/901_new.sql", "select 1;\n")
    subprocess.run(["git", "add", "docs/901_new.sql"], cwd=moved_in, check=True)
    subprocess.run(["git", "commit", "-qm", "add future migration"], cwd=moved_in, check=True)
    in_base = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=moved_in,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    (moved_in / "backend/migrations").mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["git", "mv", "docs/901_new.sql", "backend/migrations/901_new.sql"],
        cwd=moved_in,
        check=True,
    )
    subprocess.run(["git", "commit", "-qm", "move migration in"], cwd=moved_in, check=True)
    _, in_specs = validator.validate_repository(moved_in)
    in_errors = validator.validate_pull_request(
        _event(root=moved_in, change_class="small", spec="N/A", base_sha=in_base),
        in_specs,
        moved_in,
    )
    assert any("backend/migrations/901_new.sql" in error for error in in_errors)


def test_bootstrap_exception_uses_current_target_base(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    constitution = root / "specs/_meta/constitution.md"
    constitution_text = constitution.read_text(encoding="utf-8")
    subprocess.run(["git", "rm", "specs/_meta/constitution.md"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "pre-foundation state"], cwd=root, check=True)
    pre_foundation_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    subprocess.run(["git", "checkout", "-qb", "stale-topic"], cwd=root, check=True)
    _write(root / "docs/implementation.md", "implementation before foundation\n")
    subprocess.run(["git", "add", "docs/implementation.md"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "implement on stale topic"], cwd=root, check=True)
    topic_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    subprocess.run(
        ["git", "checkout", "-qb", "base-with-foundation", pre_foundation_sha],
        cwd=root,
        check=True,
    )
    _write(constitution, constitution_text)
    source = root / "specs/0001-example-feature"
    target = root / "specs/0000-sdd-foundation"
    target.mkdir()
    for path in source.iterdir():
        target.joinpath(path.name).write_text(
            path.read_text(encoding="utf-8").replace("FEAT-0001", "SDD-0000"),
            encoding="utf-8",
        )
    index = root / "specs/README.md"
    index.write_text(
        index.read_text(encoding="utf-8")
        + "| SDD-0000 | Example | verified | medium | [spec](0000-sdd-foundation/spec.md) |\n",
        encoding="utf-8",
    )
    subprocess.run(["git", "add", "specs"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "land foundation on target"], cwd=root, check=True)
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    errors = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="SDD-0000",
            base_sha=base_sha,
            head_sha=topic_sha,
        ),
        specs,
        root,
    )
    assert any("approved in the base revision before implementation" in error for error in errors)


def test_prior_approval_must_exist_at_topic_merge_base(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path, status="approved")
    common_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    subprocess.run(["git", "checkout", "-qb", "topic"], cwd=root, check=True)
    _write(root / "docs/implementation.md", "feature implementation\n")
    subprocess.run(["git", "add", "docs/implementation.md"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "implement before approval"], cwd=root, check=True)
    topic_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    subprocess.run(["git", "checkout", "-qb", "base-advance", common_sha], cwd=root, check=True)
    source = root / "specs/0001-example-feature"
    target = root / "specs/0002-late-approved"
    target.mkdir()
    for path in source.iterdir():
        target.joinpath(path.name).write_text(
            path.read_text(encoding="utf-8").replace("FEAT-0001", "FEAT-0002"),
            encoding="utf-8",
        )
    index = root / "specs/README.md"
    index.write_text(
        index.read_text(encoding="utf-8")
        + "| FEAT-0002 | Example | approved | medium | [spec](0002-late-approved/spec.md) |\n",
        encoding="utf-8",
    )
    subprocess.run(["git", "add", "specs"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "approve spec after topic diverged"], cwd=root, check=True)
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    subprocess.run(["git", "checkout", "topic"], cwd=root, check=True)
    subprocess.run(
        ["git", "merge", "--no-ff", "--no-edit", "base-advance"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    errors = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0002",
            base_sha=base_sha,
            head_sha=topic_sha,
        ),
        specs,
        root,
    )
    assert any("approved in the base revision before implementation" in error for error in errors)

    merged_head_errors = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0002",
            base_sha=base_sha,
            coverage=(
                "- FR-001 -> kind=test; ref=backend/tests/test_example.py::test_works; "
                f"implementation={topic_sha[:12]}:docs/implementation.md"
            ),
        ),
        specs,
        root,
    )
    assert any(
        "implementation commits predate approved FEAT-0002 FR-001" in error
        for error in merged_head_errors
    )


def test_requirement_approval_uses_latest_uninterrupted_epoch(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path, status="approved")
    spec_path = "specs/0001-example-feature/spec.md"
    spec = root / spec_path
    spec.write_text(
        spec.read_text(encoding="utf-8").replace(
            "status: approved", "status: draft"
        ),
        encoding="utf-8",
    )
    subprocess.run(["git", "add", spec_path], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "withdraw approval"], cwd=root, check=True)
    withdrawn_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    subprocess.run(["git", "checkout", "-qb", "during-withdrawal"], cwd=root, check=True)
    _write(root / "docs/too-early.md", "implementation during withdrawal\n")
    subprocess.run(["git", "add", "docs/too-early.md"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "implement while withdrawn"], cwd=root, check=True)
    too_early_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    subprocess.run(
        ["git", "checkout", "-qb", "restored-approval", withdrawn_sha],
        cwd=root,
        check=True,
    )
    spec.write_text(
        spec.read_text(encoding="utf-8").replace("status: draft", "status: approved"),
        encoding="utf-8",
    )
    subprocess.run(["git", "add", spec_path], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "restore approval"], cwd=root, check=True)
    restored_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    approval_commit = validator._git_requirement_approval_commit(
        root,
        restored_sha,
        spec_path,
        "FEAT-0001",
        "FR-001",
        "Works.",
        "medium",
    )
    assert approval_commit == restored_sha
    resolved, offenders = validator._topic_implementation_before_approval(
        root, approval_commit, {(too_early_sha, "docs/too-early.md")}
    )
    assert resolved is True
    assert offenders == [too_early_sha]

    subprocess.run(["git", "checkout", "-qb", "after-restoration"], cwd=root, check=True)
    _write(root / "docs/after.md", "implementation after restoration\n")
    subprocess.run(["git", "add", "docs/after.md"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "implement after restoration"], cwd=root, check=True)
    after_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    resolved, offenders = validator._topic_implementation_before_approval(
        root, approval_commit, {(after_sha, "docs/after.md")}
    )
    assert resolved is True
    assert offenders == []


def test_topic_revision_paths_include_merge_conflict_resolution(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path, status="approved")
    shared = root / "docs/merge-shared.md"
    _write(shared, "base\n")
    subprocess.run(["git", "add", str(shared)], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "add merge base"], cwd=root, check=True)
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    subprocess.run(["git", "checkout", "-qb", "merge-left"], cwd=root, check=True)
    shared.write_text("left\n", encoding="utf-8")
    subprocess.run(["git", "add", str(shared)], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "left implementation"], cwd=root, check=True)

    subprocess.run(
        ["git", "checkout", "-qb", "merge-right", base_sha], cwd=root, check=True
    )
    shared.write_text("right\n", encoding="utf-8")
    subprocess.run(["git", "add", str(shared)], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "right implementation"], cwd=root, check=True)
    merge = subprocess.run(
        ["git", "merge", "--no-ff", "merge-left"],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    assert merge.returncode != 0
    shared.write_text("resolved\n", encoding="utf-8")
    subprocess.run(["git", "add", str(shared)], cwd=root, check=True)
    subprocess.run(
        ["git", "commit", "-qm", "resolve implementation conflict"],
        cwd=root,
        check=True,
    )
    merge_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    resolved, revision_paths = validator._topic_revision_paths(
        root, base_sha, merge_sha
    )
    assert resolved is True
    assert dict(revision_paths)[merge_sha] == {"docs/merge-shared.md"}

    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    implementation = ",".join(
        f"{revision[:12]}:{path}"
        for revision, paths in revision_paths
        for path in sorted(paths)
    )
    covered = _event(
        root=root,
        change_class="feature",
        spec="FEAT-0001",
        base_sha=base_sha,
        head_sha=merge_sha,
        coverage=(
            "- FR-001 -> kind=check; ref=docs/merge-shared.md; "
            f"implementation={implementation}"
        ),
    )
    assert validator.validate_pull_request(covered, specs, root) == []

    without_resolution = dict(covered)
    without_resolution["pull_request"] = dict(covered["pull_request"])
    without_resolution["pull_request"]["body"] = covered["pull_request"][
        "body"
    ].replace(f",{merge_sha[:12]}:docs/merge-shared.md", "")
    ownership_errors = validator.validate_pull_request(
        without_resolution, specs, root
    )
    assert any(
        "topic commit/path units lack requirement ownership" in error
        and merge_sha[:12] in error
        for error in ownership_errors
    )


def test_approval_chronology_tracks_only_covered_requirements(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path, status="approved")
    common_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    subprocess.run(["git", "checkout", "-qb", "topic-fr-one"], cwd=root, check=True)
    _write(root / "docs/fr-one.md", "implementation for FR-001\n")
    subprocess.run(["git", "add", "docs/fr-one.md"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "implement approved FR-001"], cwd=root, check=True)
    topic_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    subprocess.run(
        ["git", "checkout", "-qb", "base-add-fr-two", common_sha],
        cwd=root,
        check=True,
    )
    spec = root / "specs/0001-example-feature/spec.md"
    spec.write_text(
        spec.read_text(encoding="utf-8").replace(
            "- **FR-001:** Works.\n",
            "- **FR-001:** Works.\n- **FR-002:** Independent approved work.\n",
        ),
        encoding="utf-8",
    )
    verification = root / "specs/0001-example-feature/verification.md"
    verification.write_text(
        verification.read_text(encoding="utf-8")
        + "| FR-002 | backend/tests/test_second.py::test_independent | PASS |\n",
        encoding="utf-8",
    )
    _write(
        root / "backend/tests/test_second.py",
        "def test_independent():\n    assert True\n",
    )
    subprocess.run(["git", "add", "specs", "backend/tests/test_second.py"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "approve independent FR-002"], cwd=root, check=True)
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    subprocess.run(["git", "checkout", "topic-fr-one"], cwd=root, check=True)
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    before_merge = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            base_sha=base_sha,
            coverage=(
                "- FR-001 -> kind=test; ref=docs/fr-one.md; "
                f"implementation={topic_sha[:12]}:docs/fr-one.md"
            ),
        ),
        specs,
        root,
    )
    assert before_merge == []

    subprocess.run(
        ["git", "checkout", "-qb", "merge-preview", base_sha],
        cwd=root,
        check=True,
    )
    subprocess.run(
        ["git", "merge", "--no-ff", "--no-edit", "topic-fr-one"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    merge_preview = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            base_sha=base_sha,
            head_sha=topic_sha,
            coverage=(
                "- FR-001 -> kind=test; ref=docs/fr-one.md; "
                f"implementation={topic_sha[:12]}:docs/fr-one.md"
            ),
        ),
        specs,
        root,
    )
    assert merge_preview == []

    subprocess.run(["git", "checkout", "topic-fr-one"], cwd=root, check=True)

    subprocess.run(
        ["git", "merge", "--no-ff", "--no-edit", "base-add-fr-two"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    after_merge = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            base_sha=base_sha,
            coverage=(
                "- FR-001 -> kind=test; ref=docs/fr-one.md; "
                f"implementation={topic_sha[:12]}:docs/fr-one.md"
            ),
        ),
        specs,
        root,
    )
    assert after_merge == []

    _write(root / "docs/fr-two.md", "implementation for approved FR-002\n")
    subprocess.run(["git", "add", "docs/fr-two.md"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "implement approved FR-002"], cwd=root, check=True)
    fr_two_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    incremental = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            base_sha=base_sha,
            coverage=(
                "- FR-001 -> kind=test; ref=docs/fr-one.md; "
                f"implementation={topic_sha[:12]}:docs/fr-one.md\n"
                "- FR-002 -> kind=test; ref=docs/fr-two.md; "
                f"implementation={fr_two_sha[:12]}:docs/fr-two.md"
            ),
        ),
        specs,
        root,
    )
    assert incremental == []

    subprocess.run(
        ["git", "checkout", "-qb", "fr-two-before-approval", common_sha],
        cwd=root,
        check=True,
    )
    _write(root / "docs/fr-two-before.md", "implementation before FR-002 approval\n")
    subprocess.run(["git", "add", "docs/fr-two-before.md"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "implement FR-002 too early"], cwd=root, check=True)
    premature_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    subprocess.run(
        ["git", "merge", "--no-ff", "--no-edit", "base-add-fr-two"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    premature = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            base_sha=base_sha,
            coverage=(
                "- FR-002 -> kind=test; ref=docs/fr-two-before.md; "
                f"implementation={premature_sha[:12]}:docs/fr-two-before.md"
            ),
        ),
        specs,
        root,
    )
    assert any(
        "implementation commits predate approved FEAT-0001 FR-002" in error
        for error in premature
    )
    alternate_evidence = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            base_sha=base_sha,
            coverage="- FR-002 -> backend/tests/test_second.py::test_independent",
        ),
        specs,
        root,
    )
    assert any(
        "coverage for FR-002 must declare valid implementation=" in error
        for error in alternate_evidence
    )
    unmatched_mapping = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            base_sha=base_sha,
            coverage=(
                "- FR-002 -> kind=test; ref=docs/fr-two-before.md; "
                f"implementation={premature_sha[:12]}:docs/never-changed.md"
            ),
        ),
        specs,
        root,
    )
    assert any(
        "ownership for FR-002 references unchanged commit/path units" in error
        for error in unmatched_mapping
    )
    invalid_mapping = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            base_sha=base_sha,
            coverage=(
                "- FR-002 -> kind=test; ref=docs/fr-two-before.md; "
                f"implementation={premature_sha[:12]}:../outside.md"
            ),
        ),
        specs,
        root,
    )
    assert any(
        "coverage for FR-002 must declare valid implementation=" in error
        for error in invalid_mapping
    )
    unknown_commit_mapping = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            base_sha=base_sha,
            coverage=(
                "- FR-002 -> kind=test; ref=docs/fr-two-before.md; "
                "implementation=deadbee:docs/fr-two-before.md"
            ),
        ),
        specs,
        root,
    )
    assert any(
        "coverage for FR-002 must declare valid implementation=" in error
        for error in unknown_commit_mapping
    )

    _write(root / "docs/decoy-after.md", "unrelated work after approval\n")
    subprocess.run(["git", "add", "docs/decoy-after.md"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "add post-approval decoy"], cwd=root, check=True)
    decoy_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    decoy_mapping = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            base_sha=base_sha,
            coverage=(
                "- FR-002 -> kind=test; ref=docs/fr-two-before.md; "
                f"implementation={decoy_sha[:12]}:docs/decoy-after.md"
            ),
        ),
        specs,
        root,
    )
    assert any(
        "topic commit/path units lack requirement ownership: "
        f"{premature_sha[:12]}:docs/fr-two-before.md" in error
        for error in decoy_mapping
    )


def test_approval_chronology_tracks_shared_file_by_commit_path(
    tmp_path: Path,
) -> None:
    root = _valid_repo(tmp_path, status="approved")
    common_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    subprocess.run(["git", "checkout", "-qb", "shared-topic"], cwd=root, check=True)
    _write(root / "backend/shared.py", "FR_ONE = True\n")
    subprocess.run(["git", "add", "backend/shared.py"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "implement FR-001 in shared file"], cwd=root, check=True)
    fr_one_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    subprocess.run(
        ["git", "checkout", "-qb", "approve-shared-fr-two", common_sha],
        cwd=root,
        check=True,
    )
    spec = root / "specs/0001-example-feature/spec.md"
    spec.write_text(
        spec.read_text(encoding="utf-8").replace(
            "- **FR-001:** Works.\n",
            "- **FR-001:** Works.\n- **FR-002:** Extends the shared behavior.\n",
        ),
        encoding="utf-8",
    )
    verification = root / "specs/0001-example-feature/verification.md"
    verification.write_text(
        verification.read_text(encoding="utf-8")
        + "| FR-002 | backend/shared.py | PASS |\n",
        encoding="utf-8",
    )
    subprocess.run(["git", "add", "specs"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "approve FR-002"], cwd=root, check=True)
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    subprocess.run(["git", "checkout", "shared-topic"], cwd=root, check=True)
    subprocess.run(
        ["git", "merge", "--no-ff", "--no-edit", "approve-shared-fr-two"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    with (root / "backend/shared.py").open("a", encoding="utf-8") as handle:
        handle.write("FR_TWO = True\n")
    subprocess.run(["git", "add", "backend/shared.py"], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "implement FR-002 in shared file"], cwd=root, check=True)
    fr_two_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    valid = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            base_sha=base_sha,
            coverage=(
                "- FR-001 -> kind=test; ref=backend/shared.py; "
                f"implementation={fr_one_sha[:12]}:backend/shared.py\n"
                "- FR-002 -> kind=test; ref=backend/shared.py; "
                f"implementation={fr_two_sha[:12]}:backend/shared.py"
            ),
        ),
        specs,
        root,
    )
    assert valid == []

    premature = validator.validate_pull_request(
        _event(
            root=root,
            change_class="feature",
            spec="FEAT-0001",
            base_sha=base_sha,
            coverage=(
                "- FR-001 -> kind=test; ref=backend/shared.py; "
                f"implementation={fr_one_sha[:12]}:backend/shared.py\n"
                "- FR-002 -> kind=test; ref=backend/shared.py; "
                f"implementation={fr_one_sha[:12]}:backend/shared.py,"
                f"{fr_two_sha[:12]}:backend/shared.py"
            ),
        ),
        specs,
        root,
    )
    assert any(
        "implementation commits predate approved FEAT-0001 FR-002" in error
        for error in premature
    )


def test_staging_to_main_promotion_is_exempt(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    _, specs = validator.validate_repository(root)
    event = _event(root=root, change_class="feature", spec="N/A", base="main", head="staging")
    assert validator.validate_pull_request(event, specs, root) == []


def test_unfiltered_workflow_reruns_when_pr_metadata_is_edited() -> None:
    workflow = (REPO_ROOT / ".github/workflows/spec-governance.yml").read_text(
        encoding="utf-8"
    )
    match = re.search(r"^\s+types:\s*\[([^]]+)]\s*$", workflow, re.MULTILINE)
    assert match
    activities = {item.strip() for item in match.group(1).split(",")}
    assert {"opened", "synchronize", "reopened", "edited"} <= activities
    assert "Spec and PR metadata" in workflow
    assert "fetch-depth: 0" in workflow
    typecheck_workflow = (REPO_ROOT / ".github/workflows/typecheck.yml").read_text(
        encoding="utf-8"
    )
    assert "edited" not in typecheck_workflow
    assert "Spec and PR metadata" not in typecheck_workflow
    assert "github.event.action != 'edited'" not in typecheck_workflow
    backend_workflow = (REPO_ROOT / ".github/workflows/backend-tests.yml").read_text(
        encoding="utf-8"
    )
    assert "types: [opened, synchronize, reopened, edited" not in backend_workflow


def test_cli_reads_github_event(tmp_path: Path, monkeypatch, capsys) -> None:
    root = _valid_repo(tmp_path)
    event_path = tmp_path / "event.json"
    event_path.write_text(
        json.dumps(_event(root=root, change_class="feature", spec="FEAT-0001"))
    )
    monkeypatch.setattr(
        "sys.argv",
        ["validate_specs.py", "--root", str(root), "--github-event", str(event_path)],
    )
    assert validator.main() == 0
    assert "Spec governance passed" in capsys.readouterr().out

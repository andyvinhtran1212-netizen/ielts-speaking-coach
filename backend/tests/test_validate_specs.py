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
        _write(specs / relative)
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
    if risk in {"high", "critical"}:
        _write(
            feature / "ui-states.md",
            "# UI state matrix\n\n"
            "| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |\n"
            "| --- | --- | --- | --- | --- | --- | --- |\n"
            "| N/A | N/A | N/A | N/A | N/A | N/A | N/A |\n",
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
    coverage: str = "- FR-001 -> automated test",
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
    root = _valid_repo(tmp_path)
    (root / "specs/0001-example-feature/tasks.md").write_text(
        "- [x] T001 Complete.\n  - [ ] T002 Pending.\n",
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert any("incomplete required tasks" in error for error in errors)


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


def test_repository_rejects_empty_tasks_artifact(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    (root / "specs/0001-example-feature/tasks.md").write_text("", encoding="utf-8")
    errors, _ = validator.validate_repository(root)
    assert any("tasks.md" in error and "checkbox task" in error for error in errors)


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


def test_repository_accepts_structured_manual_evidence(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    (root / "specs/0001-example-feature/verification.md").write_text(
        "## Requirement coverage\n\n"
        "| FR-001 | reviewer=Lan; environment=staging; date=2026-09-15; observed=Flow completed | MANUAL |\n",
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert errors == []


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
        "| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |\n",
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
        "| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |\n",
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
        ),
        specs,
        root,
    )
    assert any(
        "implementation commits predate approved Spec 'FEAT-0002'" in error
        for error in merged_head_errors
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

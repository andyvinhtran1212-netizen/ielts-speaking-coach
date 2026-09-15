from __future__ import annotations

import importlib.util
import json
import re
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


def _valid_repo(tmp_path: Path, *, status: str = "verified") -> Path:
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
risk: medium
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
        "# Verification\n\n## Requirement coverage\n\n| FR-001 | unit test | PASS |\n",
    )
    _write(specs / "README.md", "# Index\n\nFEAT-0001\n")
    return root


def _event(*, change_class: str, spec: str, base: str = "staging", head: str = "topic") -> dict:
    return {
        "pull_request": {
            "base": {"ref": base},
            "head": {"ref": head},
            "body": f"Change class: {change_class}\nSpec: {spec}\n",
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


def test_repository_rejects_missing_requirement_evidence(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    (root / "specs/0001-example-feature/verification.md").write_text(
        "## Requirement coverage\n\nNo evidence yet.\n"
    )
    errors, _ = validator.validate_repository(root)
    assert any("no evidence row for FR-001" in error for error in errors)


def test_repository_rejects_empty_required_artifact(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    (root / "specs/0001-example-feature/plan.md").write_text("", encoding="utf-8")
    errors, _ = validator.validate_repository(root)
    assert any("plan.md" in error and "missing '## Architecture impact'" in error for error in errors)


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


def test_final_evidence_requires_a_final_result_cell(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    (root / "specs/0001-example-feature/verification.md").write_text(
        "## Requirement coverage\n\n| FR-001 | not PASS yet | PENDING |\n",
        encoding="utf-8",
    )
    errors, _ = validator.validate_repository(root)
    assert any("requires PASS or MANUAL evidence" in error for error in errors)


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


def test_feature_pr_requires_existing_non_draft_spec(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    _, specs = validator.validate_repository(root)
    assert validator.validate_pull_request(_event(change_class="feature", spec="N/A"), specs)
    assert validator.validate_pull_request(
        _event(change_class="feature", spec="FEAT-9999"), specs
    )
    assert validator.validate_pull_request(
        _event(change_class="feature", spec="FEAT-0001"), specs
    ) == []


def test_feature_pr_rejects_superseded_spec(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path, status="superseded")
    repository_errors, specs = validator.validate_repository(root)
    assert repository_errors == []
    errors = validator.validate_pull_request(
        _event(change_class="feature", spec="FEAT-0001"), specs
    )
    assert any("not superseded" in error for error in errors)


def test_small_pr_may_use_na(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    _, specs = validator.validate_repository(root)
    assert validator.validate_pull_request(_event(change_class="small", spec="N/A"), specs) == []


def test_staging_to_main_promotion_is_exempt(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    _, specs = validator.validate_repository(root)
    event = {"pull_request": {"base": {"ref": "main"}, "head": {"ref": "staging"}}}
    assert validator.validate_pull_request(event, specs) == []


def test_backend_workflow_reruns_when_pr_metadata_is_edited() -> None:
    workflow = (REPO_ROOT / ".github/workflows/backend-tests.yml").read_text(
        encoding="utf-8"
    )
    match = re.search(r"^\s+types:\s*\[([^]]+)]\s*$", workflow, re.MULTILINE)
    assert match
    activities = {item.strip() for item in match.group(1).split(",")}
    assert {"opened", "synchronize", "reopened", "edited"} <= activities


def test_cli_reads_github_event(tmp_path: Path, monkeypatch, capsys) -> None:
    root = _valid_repo(tmp_path)
    event_path = tmp_path / "event.json"
    event_path.write_text(json.dumps(_event(change_class="feature", spec="FEAT-0001")))
    monkeypatch.setattr(
        "sys.argv",
        ["validate_specs.py", "--root", str(root), "--github-event", str(event_path)],
    )
    assert validator.main() == 0
    assert "Spec governance passed" in capsys.readouterr().out

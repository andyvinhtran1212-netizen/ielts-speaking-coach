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
    _write(
        specs / "README.md",
        "# Index\n\n"
        "| ID | Feature | Status | Risk | Spec |\n"
        "| --- | --- | --- | --- | --- |\n"
        f"| FEAT-0001 | Example | {status} | medium | [spec](0001-example-feature/spec.md) |\n",
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
) -> dict:
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    return {
        "pull_request": {
            "base": {"ref": base, "sha": base_sha},
            "head": {"ref": head},
            "body": (
                f"Change class: {change_class}\nSpec: {spec}\n\n"
                f"## Requirement coverage\n\n{coverage}\n"
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


def test_repository_rejects_empty_required_artifact(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    (root / "specs/0001-example-feature/plan.md").write_text("", encoding="utf-8")
    errors, _ = validator.validate_repository(root)
    assert any("plan.md" in error and "missing '## Architecture impact'" in error for error in errors)


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
        "| FR-001 | No UI surface changes, so browser evidence is not applicable. | N/A |\n",
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
        + "| FEAT-0002 | New | verified | medium | [spec](0002-new-feature/spec.md) |\n",
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


def test_small_pr_may_use_na(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    _, specs = validator.validate_repository(root)
    assert validator.validate_pull_request(
        _event(root=root, change_class="small", spec="N/A"), specs, root
    ) == []


def test_staging_to_main_promotion_is_exempt(tmp_path: Path) -> None:
    root = _valid_repo(tmp_path)
    _, specs = validator.validate_repository(root)
    event = _event(root=root, change_class="feature", spec="N/A", base="main", head="staging")
    assert validator.validate_pull_request(event, specs, root) == []


def test_unfiltered_workflow_reruns_when_pr_metadata_is_edited() -> None:
    workflow = (REPO_ROOT / ".github/workflows/typecheck.yml").read_text(
        encoding="utf-8"
    )
    match = re.search(r"^\s+types:\s*\[([^]]+)]\s*$", workflow, re.MULTILINE)
    assert match
    activities = {item.strip() for item in match.group(1).split(",")}
    assert {"opened", "synchronize", "reopened", "edited"} <= activities
    assert "Spec and PR metadata" in workflow
    assert "github.event.action != 'edited'" in workflow
    assert "fetch-depth: 2" in workflow


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

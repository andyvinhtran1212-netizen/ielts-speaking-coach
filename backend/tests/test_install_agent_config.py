"""Checkout and explicit migration must retain previously ignored agent files."""

import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[2]
SHARED = ROOT / "backend/scripts/agent-config"


def git(root, *args):
    return subprocess.check_output(["git", *args], cwd=root, text=True).strip()


def seed_shared(root):
    shutil.copytree(SHARED, root / "backend/scripts/agent-config")


def run_install(root, *, check=True):
    return subprocess.run(
        [sys.executable, str(root / "backend/scripts/agent-config/install.py")],
        cwd=root, capture_output=True, text=True, check=check,
    )


def test_checkout_then_install_preserves_all_ignored_customizations(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    git(root, "init", "-q")
    git(root, "config", "user.name", "Agent Config Test")
    git(root, "config", "user.email", "agent-config@example.test")
    # Historical ignore policy, before shared files were introduced.
    (root / ".gitignore").write_text(".agents/\n.claude/\nfrontend/CLAUDE.md\n")
    git(root, "add", ".gitignore")
    git(root, "commit", "-qm", "parent")
    parent = git(root, "rev-parse", "HEAD")
    seed_shared(root)
    (root / ".gitignore").write_bytes((ROOT / ".gitignore").read_bytes())
    git(root, "add", ".")
    git(root, "commit", "-qm", "shared config")
    head = git(root, "rev-parse", "HEAD")
    git(root, "checkout", "-q", parent)

    originals = {
        ".agents/skills/personal/SKILL.md": "personal Codex skill",
        ".claude/skills/personal/SKILL.md": "personal Claude skill",
        ".claude/launch.json": '{"custom": true}',
        "frontend/CLAUDE.md": "personal frontend instructions",
        ".claude/settings.local.json": '{"keep": true}',
    }
    for relative, content in originals.items():
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    git(root, "checkout", "-q", head)
    for relative, content in originals.items():
        assert (root / relative).read_text() == content
    assert not (root / ".agent-config-backups").exists()
    run_install(root)
    backups = list((root / ".agent-config-backups").iterdir())
    assert len(backups) == 1
    for relative, content in originals.items():
        path = root / relative if relative.endswith("settings.local.json") else backups[0] / relative
        assert path.read_text() == content
    assert (root / ".agents/skills").resolve() == root / "backend/scripts/agent-config/skills"
    assert (root / ".claude/skills").resolve() == root / "backend/scripts/agent-config/skills"
    assert (root / ".claude/launch.json").read_bytes() == (SHARED / "launch.json").read_bytes()
    assert (root / "frontend/CLAUDE.md").read_bytes() == (SHARED / "frontend-claude.md").read_bytes()
    assert git(root, "status", "--porcelain") == ""
    run_install(root)
    assert list((root / ".agent-config-backups").iterdir()) == backups


def test_install_preserves_external_and_dangling_symlinks(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    seed_shared(root)
    external = tmp_path / "personal-skills"
    external.mkdir()
    (external / "sentinel").write_text("keep external content")
    (root / ".agents").mkdir()
    (root / ".agents/skills").symlink_to(external, target_is_directory=True)
    (root / ".claude").mkdir()
    (root / ".claude/skills").symlink_to("../missing-skills")
    run_install(root)
    backup = next((root / ".agent-config-backups").iterdir())
    assert os.readlink(backup / ".agents/skills") == str(external)
    assert os.readlink(backup / ".claude/skills") == "../missing-skills"
    assert (external / "sentinel").read_text() == "keep external content"


@pytest.mark.parametrize("relative", [".agents", ".claude", "frontend", ".agent-config-backups"])
def test_install_refuses_symlinked_parents_before_replacing_any_target(tmp_path, relative):
    root = tmp_path / "repo"
    root.mkdir()
    seed_shared(root)
    (root / ".agents").mkdir()
    (root / ".agents/skills").mkdir()
    (root / ".agents/skills/sentinel").write_text("keep original")
    external = tmp_path / "external"
    if relative == ".agents":
        (root / ".agents").rename(external)
    else:
        external.mkdir()
    (root / relative).symlink_to(external, target_is_directory=True)
    result = run_install(root, check=False)
    assert result.returncode != 0
    assert "Refusing symlinked" in result.stderr
    assert (root / ".agents/skills/sentinel").read_text() == "keep original"
    if relative != ".agent-config-backups":
        assert not (root / ".agent-config-backups").exists()

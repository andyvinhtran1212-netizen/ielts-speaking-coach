#!/usr/bin/env python3
"""Explicitly install shared agent config, preserving every displaced target."""

import os
from pathlib import Path
import shutil
import tempfile


def install(root: Path) -> None:
    shared = root / "backend/scripts/agent-config"
    entries = [
        (".agents/skills", shared / "skills", "link"),
        (".claude/skills", shared / "skills", "link"),
        (".claude/launch.json", shared / "launch.json", "copy"),
        ("frontend/CLAUDE.md", shared / "frontend-claude.md", "copy"),
    ]
    pending = []
    for relative, source, mode in entries:
        if not source.exists():
            raise FileNotFoundError(source)
        target = root / relative
        if target.parent.is_symlink():
            raise ValueError(f"Refusing symlinked target parent: {target.parent}")
        link = os.path.relpath(source, target.parent)
        if mode == "link" and target.is_symlink() and os.readlink(target) == link:
            continue
        if mode == "copy" and target.is_file() and not target.is_symlink():
            if target.read_bytes() == source.read_bytes():
                continue
        pending.append((relative, source, mode, target, link))

    if not pending:
        print("Shared agent config is already installed.")
        return

    backup_root = root / ".agent-config-backups"
    if backup_root.is_symlink():
        raise ValueError(f"Refusing symlinked backup directory: {backup_root}")
    backup_root.mkdir(exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix="install-", dir=backup_root))
    print(f"Backup directory: {backup}", flush=True)
    # Move originals before writing any target. Renaming a symlink preserves
    # the link itself and never writes through it into another checkout.
    for relative, _, _, target, _ in pending:
        if target.exists() or target.is_symlink():
            saved = backup / relative
            saved.parent.mkdir(parents=True, exist_ok=True)
            target.rename(saved)
    for relative, source, mode, target, link in pending:
        target.parent.mkdir(parents=True, exist_ok=True)
        if mode == "link":
            target.symlink_to(link, target_is_directory=True)
        else:
            shutil.copy2(source, target)
        print(f"Installed {relative}")


if __name__ == "__main__":
    install(Path(__file__).resolve().parents[3])

"""`apply_migrations.sh` must work from a checkout path that contains spaces.

On 19/11 a staging dry run from "/Volumes/Kingston SSD/..." listed hundreds of
"would apply: Kingston" lines: `for f in $(ls ...)` split each path on the
space. A stub `psql` records the MIGRATION_PATH each file reaches the locked
helper with; every path must be a real file.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]

STUB_PSQL = """#!/usr/bin/env bash
for a in "$@"; do
  case "$a" in MIGRATION_PATH=*) p="${a#MIGRATION_PATH=}";; esac
done
if [ -n "$p" ]; then
  if [ -f "$p" ]; then echo "PATH_OK=$(basename "$p")"; else echo "PATH_BROKEN=$p"; fi
  echo "__apply_migration_status__=would-apply"
fi
exit 0
"""


@pytest.mark.skipif(shutil.which("bash") is None, reason="needs bash")
def test_dry_run_from_a_path_with_spaces_passes_whole_file_paths(tmp_path):
    repo = tmp_path / "Kingston SSD" / "repo"
    (repo / "backend").mkdir(parents=True)
    shutil.copytree(BACKEND / "scripts", repo / "backend" / "scripts")
    shutil.copytree(BACKEND / "migrations", repo / "backend" / "migrations")
    stub = tmp_path / "bin"
    stub.mkdir()
    (stub / "psql").write_text(STUB_PSQL, encoding="utf-8")
    (stub / "psql").chmod(0o755)

    env = {**os.environ, "PATH": f"{stub}{os.pathsep}{os.environ['PATH']}",
           "DRY_RUN": "1"}
    env.pop("MIGRATION_FEATURES", None)
    out = subprocess.run(
        ["./backend/scripts/apply_migrations.sh", "postgresql://stub@localhost/x"],
        cwd=repo, env=env, capture_output=True, text=True, timeout=120,
    )
    assert out.returncode == 0, out.stderr[-2000:]
    assert "PATH_BROKEN=" not in out.stdout
    reached = [ln.split("=", 1)[1] for ln in out.stdout.splitlines()
               if ln.startswith("PATH_OK=")]
    assert reached, "no migration reached the helper"
    assert "032_rollback.sql" not in reached

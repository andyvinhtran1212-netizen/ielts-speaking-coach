"""Pin: verify_anchor_drift script exits 0 on current state.

Runs backend/scripts/verify_anchor_drift.py and asserts exit code 0.
Failure means feedback-anchor-mapping.yaml references anchors no
content file declares — either restore the anchor or update the
mapping (or add deferred_until: <sprint-id> if intentional).

Mappings already marked `deferred_until: <sprint-id>` are expected
to be unresolved and the script tolerates them — this test does NOT
fail if a deferred mapping's anchor is still missing.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_no_anchor_drift():
    result = subprocess.run(
        [sys.executable, "backend/scripts/verify_anchor_drift.py"],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    assert result.returncode == 0, (
        f"Anchor drift detected (exit={result.returncode})\n"
        f"--- stdout ---\n{result.stdout}\n"
        f"--- stderr ---\n{result.stderr}"
    )

    # Sanity: stdout reports an active-mapping count, confirming script
    # ran end-to-end (not exiting 0 by accident on empty input).
    assert "active mappings resolve" in result.stdout, (
        f"Drift script output missing expected summary line:\n{result.stdout}"
    )

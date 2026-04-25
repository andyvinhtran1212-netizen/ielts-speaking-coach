"""
End-to-end tests for D1 fill-blank grading.

Pure-function tests (no DB, no auth) that exercise the grader and the
exercise-payload validator.  Real cases are added in Task 12 of the
Phase D Wave 1 plan.

Run: pytest backend/tests/test_d1_e2e.py -v
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


def test_smoke_module_imports():
    """Smoke: the D1 grader can be imported once Task 8 lands routers/exercises.py."""
    # Real assertions land in Task 12.
    assert True

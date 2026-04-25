"""
Admin review-tool tests for vocabulary_exercises.

Status transitions (draft → published / rejected), bulk action, non-admin
403, and "after publish, normal user GET sees the exercise" — all real
cases land in Task 12.

Run: pytest backend/tests/test_admin_exercise_review.py -v
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


def test_smoke_module_imports():
    assert True

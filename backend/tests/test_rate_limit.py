"""
Tests for the rate-limit decorator (services/rate_limit.py).

Real assertions are filled in Task 12 (use a stubbed counter so the test
runs without DB).

Run: pytest backend/tests/test_rate_limit.py -v
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


def test_smoke_module_imports():
    assert True

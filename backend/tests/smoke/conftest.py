"""Marker registration for smoke tests (path-based exclusion per Sprint W1 Q5).

Smoke tests live under tests/smoke/ and are excluded from the default suite
via the developer's invocation (e.g. `pytest tests/ --ignore=tests/smoke`).
This conftest only registers the `smoke` marker so the marker decorators
in this directory don't generate PytestUnknownMarkWarning.
"""


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "smoke: live API tests; cost real money; opt-in via "
        "`pytest tests/smoke -m smoke`",
    )

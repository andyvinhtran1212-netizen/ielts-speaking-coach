"""Admin router errors stay safe without main.py's HTTPException handler."""

import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from routers import cohorts, error_logs
from services.errors import GENERIC_MESSAGE


_DB_ERROR = 'relation "users" column secret_col contains private-db-value'
_ID = "00000000-0000-0000-0000-000000000001"
_ROW = [{"id": _ID}]
_INTERNALS = (
    _DB_ERROR, "relation", "secret_col", "private-db-value", "users", "cohorts",
    "students", "student_cohort_memberships", "access_codes",
    "user_code_assignments", "analytics_events", "error_logs",
)


def _failing_client(rows_before_error=()):
    client = MagicMock()
    query = MagicMock()
    client.table.return_value = query
    client.rpc.return_value = query
    for method in ("select", "eq", "limit", "order", "range", "gte", "in_",
                   "insert", "update"):
        getattr(query, method).return_value = query
    query.execute.side_effect = [
        *(SimpleNamespace(data=rows, count=len(rows)) for rows in rows_before_error),
        Exception(_DB_ERROR),
    ]
    return client


@pytest.mark.parametrize("router,operation,kwargs,rows_before_error", [
    pytest.param(cohorts, "list_cohorts", {}, (), id="cohort-list"),
    pytest.param(cohorts, "create_cohort",
                 {"body": cohorts.CohortCreateRequest(name="Test")}, (), id="cohort-create"),
    pytest.param(cohorts, "update_cohort",
                 {"cohort_id": _ID, "body": cohorts.CohortPatchRequest(name="Test")},
                 (), id="cohort-update"),
    pytest.param(cohorts, "cohort_members", {"cohort_id": _ID},
                 (_ROW,), id="cohort-members"),
    pytest.param(cohorts, "remove_cohort_member", {"cohort_id": _ID, "user_id": _ID},
                 (_ROW,), id="cohort-remove-member"),
    pytest.param(cohorts, "assign_student_to_cohort",
                 {"cohort_id": _ID, "body": cohorts.AssignStudentRequest(student_id=_ID)},
                 (_ROW, _ROW), id="cohort-assign-student"),
    pytest.param(cohorts, "bulk_assign_students_to_cohort",
                 {"cohort_id": _ID, "body": cohorts.BulkAssignStudentsRequest(student_ids=[_ID])},
                 (_ROW,), id="cohort-bulk-assign-students"),
    pytest.param(cohorts, "remove_student_from_cohort",
                 {"cohort_id": _ID, "student_id": _ID}, (), id="cohort-remove-student"),
    pytest.param(cohorts, "cohort_progress_matrix", {"cohort_id": _ID},
                 (_ROW,), id="cohort-progress"),
    pytest.param(error_logs, "list_error_logs", {}, (), id="error-log-list"),
    pytest.param(error_logs, "error_log_migration_stats", {}, (), id="error-log-migration-stats"),
    pytest.param(error_logs, "error_log_rollback_metrics", {}, (), id="error-log-rollback-metrics"),
    pytest.param(error_logs, "dismiss_error_log", {"log_id": _ID}, (), id="error-log-dismiss"),
    pytest.param(error_logs, "undismiss_error_log", {"log_id": _ID}, (), id="error-log-undismiss"),
    pytest.param(error_logs, "generate_test_error", {"error_type": "warning"},
                 (), id="error-log-generate-test"),
])
@pytest.mark.asyncio
async def test_direct_router_5xx_detail_is_clean(
    monkeypatch, caplog, router, operation, kwargs, rows_before_error,
):
    monkeypatch.setattr(router, "require_admin", AsyncMock(return_value={"id": _ID}))
    monkeypatch.setattr(router, "supabase_admin", _failing_client(rows_before_error))

    with caplog.at_level(logging.ERROR, logger=router.logger.name):
        with pytest.raises(HTTPException) as exc_info:
            await getattr(router, operation)(**kwargs)

    error = exc_info.value
    assert error.status_code == 500
    assert isinstance(error.detail, str)
    for internal in _INTERNALS:
        assert internal not in error.detail
    assert error.__cause__ is None
    assert error.__suppress_context__ is True
    assert any(record.name == router.logger.name
               and record.levelno == logging.ERROR
               and "failed" in record.getMessage()
               and record.exc_info is not None
               and str(record.exc_info[1]) == _DB_ERROR
               for record in caplog.records)


@pytest.mark.parametrize("router,path", [
    pytest.param(cohorts, "/admin/cohorts", id="cohorts-main-app"),
    pytest.param(error_logs, "/admin/error-logs", id="error-logs-main-app"),
])
def test_main_app_preserves_safe_500_shape(monkeypatch, router, path):
    import main

    monkeypatch.setattr(router, "require_admin", AsyncMock(return_value={"id": _ID}))
    monkeypatch.setattr(router, "supabase_admin", _failing_client())

    client = TestClient(main.app)
    try:
        response = client.get(path)
    finally:
        client.close()

    assert response.status_code == 500
    assert response.json() == {"detail": {
        "error_code": "internal_error",
        "message": GENERIC_MESSAGE,
        "ref": response.headers["X-Request-ID"],
    }}
    assert response.json()["detail"]["ref"]
    for internal in _INTERNALS:
        assert internal not in response.text

"""COURSEACCESS-0055 T009 follow-up (#2544 R2): a timed start that migration
388 refuses (SQLSTATE 55000 ``learner_session_changed_during_timed_start``)
answers 409 ``timed_start_session_changed`` on every start route, never 500,
whatever the route did with the database error."""

from __future__ import annotations

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError
from starlette.exceptions import HTTPException as StarletteHTTPException

import main
from services import session_gate

REFUSED = {"code": "55000", "message": "learner_session_changed_during_timed_start",
           "hint": "The account's current session changed while this timed start waited; nothing was started.",
           "details": None}
OTHER = {"code": "23505", "message": "duplicate key value violates unique constraint", "hint": None,
         "details": None}


class _DomainError(Exception):
    pass


class _Orig:  # SQLAlchemy DBAPIError keeps the driver error on .orig
    def __str__(self):
        return 'new row: ERROR: learner_session_changed_during_timed_start (SQLSTATE 55000)'


class _DBAPIError(Exception):
    def __init__(self):
        super().__init__("(sqlalchemy.dialects.postgresql.asyncpg.Error)")
        self.orig = _Orig()


def test_the_refusal_is_found_in_the_exception_chain():
    assert session_gate.timed_start_refusal(APIError(REFUSED))
    assert session_gate.timed_start_refusal(_DBAPIError())
    try:
        try:
            raise APIError(REFUSED)
        except Exception:
            raise _DomainError("Không tạo được sitting") from None   # context kept
    except _DomainError as wrapped:
        assert session_gate.timed_start_refusal(wrapped)
    assert not session_gate.timed_start_refusal(APIError(OTHER))
    assert not session_gate.timed_start_refusal(ValueError("x"))
    assert not session_gate.timed_start_refusal(None)
    loop_a, loop_b = ValueError("a"), ValueError("b")
    loop_a.__context__, loop_b.__context__ = loop_b, loop_a
    assert not session_gate.timed_start_refusal(loop_a)   # a cycle ends


@pytest.fixture
def client():
    app = FastAPI()
    app.add_exception_handler(Exception, main.unhandled_exception_handler)
    app.add_exception_handler(StarletteHTTPException, main.http_exception_handler)

    @app.post("/raw")
    def raw():                      # reading start: the insert error re-raised
        raise APIError(REFUSED)

    @app.post("/wrapped")
    def wrapped():                  # quiz/timed course start: mapped to 503
        try:
            raise APIError(REFUSED)
        except Exception as exc:
            raise HTTPException(503, "Chưa bắt đầu được bài. Vui lòng thử lại.") from exc

    @app.post("/domain")
    def domain():                   # mock exam: domain error, then HTTPException from None
        try:
            try:
                raise APIError(REFUSED)
            except Exception:
                raise _DomainError("x")
        except _DomainError:
            raise HTTPException(500, "Không tạo được lượt thi.") from None

    @app.post("/other-db")
    def other_db():
        raise APIError(OTHER)

    @app.post("/other-http")
    def other_http():
        try:
            raise APIError(OTHER)
        except Exception as exc:
            raise HTTPException(503, {"error_code": "x_unavailable", "message": "m"}) from exc

    return TestClient(app, raise_server_exceptions=False)


@pytest.mark.parametrize("path", ["/raw", "/wrapped", "/domain"])
def test_a_refused_start_answers_409_whatever_the_route_did(client, path):
    response = client.post(path)
    assert response.status_code == 409
    assert response.json() == {"detail": session_gate.TIMED_START_REFUSED_DETAIL}


def test_other_errors_keep_their_answers(client):
    assert client.post("/other-db").status_code == 500
    other = client.post("/other-http")
    assert other.status_code == 503 and other.json()["detail"]["error_code"] == "x_unavailable"


def test_the_message_matches_migration_388():
    from pathlib import Path
    sql = (Path(__file__).resolve().parents[1] / "migrations" / "388_learner_active_sessions.sql").read_text(
        encoding="utf-8")
    assert f"MESSAGE = '{session_gate.TIMED_START_REFUSED}'" in sql

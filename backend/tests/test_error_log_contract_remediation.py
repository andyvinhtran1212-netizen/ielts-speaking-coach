"""Regression coverage for validated production error-log contracts.

These cases used placeholder path IDs or a duplicate exam code to turn a
client input error into an unhandled backend 500.  Keep the tests at the HTTP
boundary where possible so a future string annotation cannot reopen the leak.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from routers import admin_mock_exams, admin_mock_reviews, listening, reading_student
from services import mock_exam_service


@pytest.mark.parametrize(
    ("router", "path", "auth_patches"),
    [
        (
            reading_student.router,
            "/api/reading/test/attempts/demo/review",
            ((reading_student, "_optional_auth"), (reading_student, "_is_admin")),
        ),
        (
            listening.user_router,
            "/api/listening/tests/R1",
            ((listening, "_require_auth"),),
        ),
        (
            listening.user_router,
            "/api/listening/tests/attempts/demo/review",
            ((listening, "_require_auth"),),
        ),
        (
            admin_mock_reviews.router,
            "/admin/mock-reviews/demo",
            ((admin_mock_reviews, "require_admin"),),
        ),
    ],
)
def test_invalid_uuid_path_is_422_before_database_or_auth(
    monkeypatch, router, path, auth_patches,
):
    for module, name in auth_patches:
        monkeypatch.setattr(
            module,
            name,
            AsyncMock(side_effect=AssertionError("invalid UUID reached route logic")),
        )

    app = FastAPI()
    app.include_router(router)
    response = TestClient(app).get(path)

    assert response.status_code == 422
    assert response.json()["detail"][0]["type"] == "uuid_parsing"


class _PostgrestError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__({"code": code, "message": "database request failed"})


class _FailingInsert:
    def __init__(self, exc: Exception):
        self.exc = exc

    def table(self, _name):
        return self

    def insert(self, _payload):
        return self

    def execute(self):
        raise self.exc


def test_duplicate_mock_exam_code_preserves_sqlstate_as_domain_conflict(monkeypatch):
    monkeypatch.setattr(
        mock_exam_service,
        "supabase_admin",
        _FailingInsert(_PostgrestError("23505")),
    )

    with pytest.raises(mock_exam_service.DuplicateExamCodeError):
        mock_exam_service.admin_create_exam(
            {"code": "COURSE-1", "title": "Course 1"},
            created_by="admin-id",
        )


def test_non_unique_database_error_is_not_mislabeled_as_duplicate(monkeypatch):
    original = _PostgrestError("57014")
    monkeypatch.setattr(
        mock_exam_service,
        "supabase_admin",
        _FailingInsert(original),
    )

    with pytest.raises(_PostgrestError) as caught:
        mock_exam_service.admin_create_exam(
            {"code": "COURSE-1", "title": "Course 1"},
            created_by="admin-id",
        )
    assert caught.value is original


def test_duplicate_mock_exam_code_returns_http_409(monkeypatch):
    monkeypatch.setattr(
        admin_mock_exams,
        "require_admin",
        AsyncMock(return_value={"id": "admin-id"}),
    )
    monkeypatch.setattr(
        admin_mock_exams.svc,
        "admin_create_exam",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            mock_exam_service.DuplicateExamCodeError("Mã đề đã tồn tại.")
        ),
    )

    with pytest.raises(HTTPException) as caught:
        asyncio.run(
            admin_mock_exams.create_exam(
                admin_mock_exams.ExamCreate(code="COURSE-1", title="Course 1"),
                authorization="Bearer admin",
            )
        )

    assert caught.value.status_code == 409
    assert caught.value.detail == "Mã đề đã tồn tại."

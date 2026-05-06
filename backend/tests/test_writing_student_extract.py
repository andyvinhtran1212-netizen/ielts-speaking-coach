"""Tests for POST /api/writing/extract-text (Phase 2.3c-2).

These hit the real FastAPI app through TestClient because the endpoint
is multipart-only — pinning it through HTTP catches both the route
binding (FastAPI 422 on mis-declared `UploadFile = File(...)` is a
classic regression) AND the upstream `get_current_student` dependency
gate at the same time.

Auth strategy:
  • For the happy paths we override `get_current_student` via
    `app.dependency_overrides`, returning a stub student row. That
    sidesteps Supabase entirely without the test having to know
    about JWT internals.
  • For the unauthenticated-rejection test we leave the dependency
    real and pass no Authorization header — the endpoint must
    bounce it to 401/403.
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

import docx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app
from routers.writing_student import get_current_student


client = TestClient(app)


_STUB_STUDENT = {
    "id":           "student-uuid-extract",
    "user_id":      "user-uuid-extract",
    "student_code": "STU-EXTRACT",
    "full_name":    "Extract Tester",
    "target_band":  7.0,
}


@pytest.fixture
def _override_student_auth():
    """Bypass `get_current_student` so we don't need a real JWT or
    Supabase row.  Cleared in teardown so we don't leak state into
    sibling tests that DO want the real dependency to run."""
    app.dependency_overrides[get_current_student] = lambda: _STUB_STUDENT
    yield
    app.dependency_overrides.pop(get_current_student, None)


def _make_docx_bytes(text: str = "Test essay paragraph.") -> bytes:
    doc = docx.Document()
    doc.add_paragraph(text)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# ── Happy paths ──────────────────────────────────────────────────────


def test_extract_endpoint_txt(_override_student_auth):
    """A plain .txt round-trips: text returned + counts populated."""
    files = {"file": ("essay.txt", b"Plain text essay content here.", "text/plain")}
    r = client.post("/api/writing/extract-text", files=files)
    assert r.status_code == 200, r.text

    data = r.json()
    assert "Plain text essay" in data["text"]
    assert data["filename"] == "essay.txt"
    assert data["char_count"] == len("Plain text essay content here.")
    assert data["word_count"] >= 4


def test_extract_endpoint_docx(_override_student_auth):
    """A real .docx round-trips through python-docx and surfaces the
    paragraph text."""
    docx_bytes = _make_docx_bytes("Essay paragraph one. Essay paragraph two.")
    files = {
        "file": (
            "essay.docx",
            docx_bytes,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
    }
    r = client.post("/api/writing/extract-text", files=files)
    assert r.status_code == 200, r.text
    assert "Essay paragraph" in r.json()["text"]


# ── Validation surface ───────────────────────────────────────────────


def test_extract_endpoint_rejects_pdf(_override_student_auth):
    """PDF (or any non-.docx/.txt) → 400 with the Vietnamese
    "không hỗ trợ" message so the UI toast renders cleanly."""
    files = {"file": ("essay.pdf", b"%PDF-1.4 fake", "application/pdf")}
    r = client.post("/api/writing/extract-text", files=files)
    assert r.status_code == 400
    assert "không hỗ trợ" in r.json()["detail"].lower()


def test_extract_endpoint_rejects_oversize(_override_student_auth):
    """3 MB > 2 MB cap → 400 with "quá lớn"."""
    big = b"x" * (3 * 1024 * 1024)
    files = {"file": ("big.txt", big, "text/plain")}
    r = client.post("/api/writing/extract-text", files=files)
    assert r.status_code == 400
    assert "quá lớn" in r.json()["detail"].lower()


def test_extract_endpoint_rejects_empty(_override_student_auth):
    """0-byte upload → 400 with "rỗng"."""
    files = {"file": ("empty.txt", b"", "text/plain")}
    r = client.post("/api/writing/extract-text", files=files)
    assert r.status_code == 400
    assert "rỗng" in r.json()["detail"].lower()


# ── Auth gate ────────────────────────────────────────────────────────


def test_extract_endpoint_unauthenticated():
    """No Authorization header → 401/403.  We don't pin the exact
    code because the upstream `get_supabase_user` chain may evolve;
    "rejected with one of the auth statuses" is the contract."""
    files = {"file": ("essay.txt", b"text", "text/plain")}
    r = client.post("/api/writing/extract-text", files=files)
    assert r.status_code in (401, 403)

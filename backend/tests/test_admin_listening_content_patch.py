"""Tests for Sprint 13.1 — PATCH /admin/listening/content/{id}
and PATCH /admin/listening/content/{id}/status.

Pins:
  - Metadata PATCH happy path (single field, partial update)
  - 422 on bad accent_tag / bad cefr_level / premium+NC license combo
  - 404 on unknown content_id
  - Status PATCH happy path each direction (draft↔published↔archived)
  - 422 on unknown status value
  - Auth gate (require_admin enforces 401 / 403)
"""

from __future__ import annotations

from uuid import uuid4
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient


class _Resp:
    def __init__(self, data):
        self.data = data


class _TableQuery:
    """Mimics enough of the Supabase Python client surface that
    routers/listening.py exercises during PATCH. Supports:
      .select(...).eq(...).limit(...).execute()
      .update({...}).eq(...).execute()
    """

    def __init__(self, fake, table_name):
        self.fake = fake
        self.table_name = table_name
        self._mode = "select"
        self._update_payload = None
        self.filters: list[tuple[str, object]] = []

    def select(self, *_args, **_kw):
        self._mode = "select"
        return self

    def update(self, payload):
        self._mode = "update"
        self._update_payload = payload
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def limit(self, *_a, **_kw):
        return self

    def execute(self):
        rows = self.fake.tables.setdefault(self.table_name, [])
        matched = [r for r in rows if all(r.get(f) == v for f, v in self.filters)]
        if self._mode == "update":
            if self.fake.drop_updates:
                return _Resp([])
            for r in matched:
                r.update(self._update_payload or {})
            return _Resp(matched)
        return _Resp(matched)


class _FakeSupabase:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {"listening_content": []}
        self.drop_updates = False

    def table(self, name):
        return _TableQuery(self, name)


_ADMIN_ID = "00000000-0000-0000-0000-00000000aaaa"
_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}


@pytest.fixture
def fake_db(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr("routers.listening.supabase_admin", fake)
    return fake


@pytest.fixture
def client(fake_db):
    from main import app
    with patch(
        "routers.listening.require_admin",
        new=AsyncMock(return_value={"id": _ADMIN_ID, "email": "admin@x"}),
    ):
        with TestClient(app) as c:
            yield c


def _seed_content(fake_db, **overrides):
    row = {
        "id":                     str(uuid4()),
        "title":                  "Sample Listening",
        "transcript":             "Hello world.",
        "accent_tag":             "us_general",
        "cefr_level":             "B2",
        "ielts_section":          1,
        "topic_tags":             ["travel"],
        "is_premium":             False,
        "status":                 "draft",
        "external_license":       None,
        "external_source_url":    None,
        "audio_duration_seconds": 30,
        "audio_storage_path":     "uploads/sample.mp3",
        "updated_at":             "2026-08-01T00:00:00+00:00",
    }
    row.update(overrides)
    fake_db.tables["listening_content"].append(row)
    return row


# ── PATCH /content/{id} — metadata ───────────────────────────────────────────


class TestPatchMetadata:
    def test_update_title_only(self, client, fake_db):
        row = _seed_content(fake_db)
        r = client.patch(
            f"/admin/listening/content/{row['id']}",
            json={"title": "Updated Title"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["title"] == "Updated Title"
        # Other fields untouched.
        assert body["accent_tag"] == "us_general"
        assert body["cefr_level"] == "B2"
        assert fake_db.tables["listening_content"][0]["title"] == "Updated Title"
        assert body["updated_at"] != "2026-08-01T00:00:00+00:00"

    def test_update_multiple_fields_at_once(self, client, fake_db):
        row = _seed_content(fake_db)
        r = client.patch(
            f"/admin/listening/content/{row['id']}",
            json={
                "title":          "Multi",
                "accent_tag":     "uk_rp",
                "cefr_level":     "C1",
                "ielts_section":  3,
                "topic_tags":     ["work", "career"],
                "is_premium":     True,
            },
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["title"] == "Multi"
        assert body["accent_tag"] == "uk_rp"
        assert body["cefr_level"] == "C1"
        assert body["ielts_section"] == 3
        assert body["topic_tags"] == ["work", "career"]
        assert body["is_premium"] is True

    def test_invalid_accent_tag_returns_422(self, client, fake_db):
        row = _seed_content(fake_db)
        r = client.patch(
            f"/admin/listening/content/{row['id']}",
            json={"accent_tag": "martian"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 422
        # Row untouched.
        assert fake_db.tables["listening_content"][0]["accent_tag"] == "us_general"

    def test_invalid_cefr_level_returns_422(self, client, fake_db):
        row = _seed_content(fake_db)
        r = client.patch(
            f"/admin/listening/content/{row['id']}",
            json={"cefr_level": "Z9"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 422
        assert fake_db.tables["listening_content"][0]["cefr_level"] == "B2"

    def test_premium_plus_nc_license_blocked_422(self, client, fake_db):
        # Seed a row with an NC license. Then try to flip is_premium=True.
        row = _seed_content(
            fake_db,
            external_license="CC BY-NC 4.0",
            external_source_url="https://example.com/source",
        )
        r = client.patch(
            f"/admin/listening/content/{row['id']}",
            json={"is_premium": True},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 422
        assert "NC-licensed" in r.text or "premium" in r.text
        assert fake_db.tables["listening_content"][0]["is_premium"] is False

    def test_setting_license_without_source_url_blocked_422(self, client, fake_db):
        row = _seed_content(fake_db)
        r = client.patch(
            f"/admin/listening/content/{row['id']}",
            json={"external_license": "CC BY 4.0"},  # no source_url
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 422
        assert "external_source_url" in r.text

    def test_explicit_null_clears_nullable_metadata(self, client, fake_db):
        row = _seed_content(
            fake_db,
            cefr_level="C1",
            ielts_section=4,
            external_license="CC BY 4.0",
            external_source_url="https://example.com/source",
        )
        r = client.patch(
            f"/admin/listening/content/{row['id']}",
            json={
                "cefr_level": None,
                "ielts_section": None,
                "external_license": None,
                "external_source_url": None,
            },
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200, r.text
        assert r.json()["cefr_level"] is None
        assert r.json()["ielts_section"] is None
        assert r.json()["external_license"] is None
        assert r.json()["external_source_url"] is None

    def test_topic_tags_are_trimmed_and_deduplicated_case_insensitively(self, client, fake_db):
        row = _seed_content(fake_db)
        r = client.patch(
            f"/admin/listening/content/{row['id']}",
            json={"topic_tags": [" Travel ", "travel", "WORK", "work", ""]},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200, r.text
        assert r.json()["topic_tags"] == ["Travel", "WORK"]

    def test_lowercase_nc_license_is_still_blocked_for_premium(self, client, fake_db):
        row = _seed_content(fake_db, is_premium=True)
        r = client.patch(
            f"/admin/listening/content/{row['id']}",
            json={
                "external_license": "cc by-nc 4.0",
                "external_source_url": "https://example.com/source",
            },
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 422

    def test_external_source_url_rejects_non_http_scheme(self, client, fake_db):
        row = _seed_content(fake_db)
        r = client.patch(
            f"/admin/listening/content/{row['id']}",
            json={"external_source_url": "javascript:alert(1)"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 422

    def test_external_source_url_rejects_whitespace_in_host(self, client, fake_db):
        row = _seed_content(fake_db)
        r = client.patch(
            f"/admin/listening/content/{row['id']}",
            json={"external_source_url": "https://exa mple.com/source"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 422

    def test_unrelated_license_text_containing_letters_nc_is_not_blocked(self, client, fake_db):
        row = _seed_content(fake_db, is_premium=True)
        r = client.patch(
            f"/admin/listening/content/{row['id']}",
            json={
                "external_license": "Ancillary commercial license",
                "external_source_url": "https://example.com/source",
            },
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200, r.text

    def test_expected_updated_at_prevents_stale_overwrite(self, client, fake_db):
        row = _seed_content(fake_db)
        r = client.patch(
            f"/admin/listening/content/{row['id']}",
            json={"title": "Stale edit", "expected_updated_at": "2026-07-01T00:00:00+00:00"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 409
        assert fake_db.tables["listening_content"][0]["title"] == "Sample Listening"

    def test_matching_version_updates_atomically(self, client, fake_db):
        row = _seed_content(fake_db)
        previous = row["updated_at"]
        r = client.patch(
            f"/admin/listening/content/{row['id']}",
            json={"title": "Versioned edit", "expected_updated_at": previous},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200, r.text
        assert r.json()["title"] == "Versioned edit"
        assert r.json()["updated_at"] != previous

    def test_version_from_canonical_get_is_accepted_by_patch(self, client, fake_db):
        row = _seed_content(fake_db)
        canonical = client.get(
            f"/admin/listening/content/{row['id']}",
            headers=_ADMIN_AUTH,
        )
        assert canonical.status_code == 200, canonical.text
        version = canonical.json()["updated_at"]

        updated = client.patch(
            f"/admin/listening/content/{row['id']}",
            json={"title": "GET-version edit", "expected_updated_at": version},
            headers=_ADMIN_AUTH,
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["title"] == "GET-version edit"

    def test_unconfirmed_unversioned_update_never_returns_fabricated_200(self, client, fake_db):
        row = _seed_content(fake_db)
        fake_db.drop_updates = True

        r = client.patch(
            f"/admin/listening/content/{row['id']}",
            json={"title": "Must not be fabricated"},
            headers=_ADMIN_AUTH,
        )

        assert r.status_code == 500, r.text
        assert r.json()["detail"]["error_code"] == "internal_error"
        assert fake_db.tables["listening_content"][0]["title"] == "Sample Listening"

    def test_unknown_content_id_returns_404(self, client):
        r = client.patch(
            f"/admin/listening/content/{uuid4()}",
            json={"title": "Nope"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 404

    def test_empty_body_returns_current_row(self, client, fake_db):
        row = _seed_content(fake_db)
        r = client.patch(
            f"/admin/listening/content/{row['id']}",
            json={},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == row["id"]
        assert body["title"] == row["title"]


# ── PATCH /content/{id}/status — status transition ───────────────────────────


class TestPatchStatus:
    def test_draft_to_published(self, client, fake_db):
        row = _seed_content(fake_db, status="draft")
        r = client.patch(
            f"/admin/listening/content/{row['id']}/status",
            json={"status": "published"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "published"
        assert fake_db.tables["listening_content"][0]["status"] == "published"

    def test_published_to_archived(self, client, fake_db):
        row = _seed_content(fake_db, status="published")
        r = client.patch(
            f"/admin/listening/content/{row['id']}/status",
            json={"status": "archived"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200
        assert fake_db.tables["listening_content"][0]["status"] == "archived"

    def test_archived_to_draft_restore_allowed(self, client, fake_db):
        # Sprint 13.1 commission D5 — any-to-any direction allowed.
        row = _seed_content(fake_db, status="archived")
        r = client.patch(
            f"/admin/listening/content/{row['id']}/status",
            json={"status": "draft"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200
        assert fake_db.tables["listening_content"][0]["status"] == "draft"

    def test_status_normalized_to_lowercase(self, client, fake_db):
        row = _seed_content(fake_db, status="draft")
        r = client.patch(
            f"/admin/listening/content/{row['id']}/status",
            json={"status": "PUBLISHED"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200
        assert fake_db.tables["listening_content"][0]["status"] == "published"

    def test_unknown_status_returns_422(self, client, fake_db):
        row = _seed_content(fake_db, status="draft")
        r = client.patch(
            f"/admin/listening/content/{row['id']}/status",
            json={"status": "ready_for_review"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 422
        assert fake_db.tables["listening_content"][0]["status"] == "draft"

    def test_unknown_content_id_status_returns_404(self, client):
        r = client.patch(
            f"/admin/listening/content/{uuid4()}/status",
            json={"status": "published"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 404


# ── Auth gate (require_admin) ────────────────────────────────────────────────


class TestAuthGate:
    def test_patch_metadata_blocks_non_admin(self, fake_db, monkeypatch):
        # When require_admin raises 403, the endpoint must propagate.
        async def _fake_require(_auth):
            raise HTTPException(403, "Not an admin")
        monkeypatch.setattr("routers.listening.require_admin", _fake_require)
        from main import app
        with TestClient(app) as c:
            row = _seed_content(fake_db)
            r = c.patch(
                f"/admin/listening/content/{row['id']}",
                json={"title": "X"},
                headers={"Authorization": "Bearer student.jwt"},
            )
            assert r.status_code == 403

    def test_patch_status_blocks_missing_token(self, fake_db, monkeypatch):
        async def _fake_require(_auth):
            raise HTTPException(401, "Missing Authorization")
        monkeypatch.setattr("routers.listening.require_admin", _fake_require)
        from main import app
        with TestClient(app) as c:
            row = _seed_content(fake_db)
            r = c.patch(
                f"/admin/listening/content/{row['id']}/status",
                json={"status": "published"},
            )
            assert r.status_code == 401

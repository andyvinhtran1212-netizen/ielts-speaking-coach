"""Audit 2026-07-17 — 2 công cụ hậu kiểm cuối:
  • scripts/reconcile_storage_orphans.py — file mồ côi bucket ↔ DB
  • scripts/check_reading_image_links.py — link ảnh ngoài chết
  • admin_reading._check_image_url_reachable — HEAD-check ở dry-run import

Pin các helper THUẦN + hành vi fail-soft (không được raise chặn import).
"""
from __future__ import annotations

import httpx
import pytest

from routers.admin_reading import _check_image_url_reachable
from scripts.check_reading_image_links import extract_image_urls
from scripts import reconcile_storage_orphans as storage_reconcile
from scripts.reconcile_storage_orphans import find_orphans


# ── find_orphans (pure) ─────────────────────────────────────────────────────

def test_find_orphans_setminus_and_sorted():
    storage = {"a/1.mp3", "b/2.mp3", "c/3.mp3"}
    refs = {"b/2.mp3", None, ""}
    assert find_orphans(storage, refs) == ["a/1.mp3", "c/3.mp3"]


def test_find_orphans_empty_when_all_referenced():
    assert find_orphans({"x.mp3"}, {"x.mp3"}) == []


class _StorageAuditResponse:
    def __init__(self, data): self.data = data


class _StorageAuditQuery:
    def __init__(self, rows):
        self.rows = rows
        self.window = None

    def select(self, *_args): return self
    def filter(self, *_args): return self
    def range(self, start, end): self.window = (start, end); return self

    def execute(self):
        rows = self.rows
        if self.window:
            start, end = self.window
            rows = rows[start:end + 1]
        return _StorageAuditResponse(rows)


class _StorageAuditBucket:
    def __init__(self, owner, bucket): self.owner, self.bucket = owner, bucket

    def list(self, prefix, _options):
        if prefix:
            return []
        return list(self.owner.files.get(self.bucket, []))

    def remove(self, paths):
        self.owner.removed.append((self.bucket, list(paths)))


class _StorageAuditStorage:
    def __init__(self, files): self.files, self.removed = files, []
    def from_(self, bucket): return _StorageAuditBucket(self, bucket)


class _StorageAuditDb:
    def __init__(self, visual_path):
        self.tables = {
            "listening_content": [],
            "listening_tests": [],
            "listening_package_stimuli": [{"id": "stimulus-1", "p": visual_path}],
            "listening_exercises": [],
            "reading_questions": [],
        }
        self.storage = _StorageAuditStorage({
            "listening-audio": [
                {"id": "visual", "name": visual_path, "metadata": {"size": 20}},
                {"id": "orphan", "name": "orphan.svg", "metadata": {"size": 10}},
            ],
            "listening-images": [],
            "reading-images": [],
        })

    def table(self, name): return _StorageAuditQuery(self.tables[name])


def test_programme_visual_is_a_canonical_listening_audio_reference():
    path = "programmes/general/lesson-1/map.svg"
    db = _StorageAuditDb(path)
    refs = storage_reconcile._referenced_paths(db)

    assert path in refs["listening-audio"]
    assert find_orphans({path, "orphan.svg"}, refs["listening-audio"]) == ["orphan.svg"]


def test_delete_scan_never_removes_a_referenced_programme_visual(monkeypatch):
    path = "programmes/general/lesson-1/map.svg"
    db = _StorageAuditDb(path)
    monkeypatch.setattr("database.supabase_admin", db)
    monkeypatch.setattr(storage_reconcile.sys, "argv", ["reconcile_storage_orphans.py", "--delete"])

    assert storage_reconcile.main() == 0
    assert db.storage.removed == [("listening-audio", ["orphan.svg"])]


# ── extract_image_urls (pure) ───────────────────────────────────────────────

def test_extract_image_urls_frontmatter_markdown_html_dedup():
    body = (
        "intro ![chart](https://res.cloudinary.com/a/chart.png) text\n"
        '<img src="https://cdn.x/y.webp"> and again '
        "![dup](https://res.cloudinary.com/a/chart.png)"
    )
    urls = extract_image_urls("https://res.cloudinary.com/a/hero.jpg", body)
    assert urls == [
        "https://res.cloudinary.com/a/hero.jpg",
        "https://res.cloudinary.com/a/chart.png",
        "https://cdn.x/y.webp",
    ]


def test_extract_image_urls_ignores_relative_and_empty():
    assert extract_image_urls(None, "![x](/local/img.png) plain text") == []
    assert extract_image_urls("not-a-url", None) == []


# ── _check_image_url_reachable — fail-soft HEAD check ───────────────────────

class _Resp:
    def __init__(self, code): self.status_code = code


def test_head_check_ok_returns_no_warnings(monkeypatch):
    monkeypatch.setattr(httpx, "head", lambda *a, **k: _Resp(200))
    assert _check_image_url_reachable("https://cdn.x/ok.png") == []


def test_head_check_404_warns(monkeypatch):
    monkeypatch.setattr(httpx, "head", lambda *a, **k: _Resp(404))
    warns = _check_image_url_reachable("https://cdn.x/dead.png")
    assert len(warns) == 1 and "404" in warns[0]


def test_head_check_405_falls_back_to_ranged_get(monkeypatch):
    calls = []
    monkeypatch.setattr(httpx, "head", lambda *a, **k: _Resp(405))
    def _get(url, **kw):
        calls.append(kw.get("headers"))
        return _Resp(200)
    monkeypatch.setattr(httpx, "get", _get)
    assert _check_image_url_reachable("https://cdn.x/no-head.png") == []
    assert calls and calls[0].get("Range") == "bytes=0-0"


def test_head_check_network_error_is_failsoft_warning(monkeypatch):
    def _boom(*a, **k): raise httpx.ConnectTimeout("t/o")
    monkeypatch.setattr(httpx, "head", _boom)
    warns = _check_image_url_reachable("https://cdn.x/slow.png")
    assert len(warns) == 1 and "Không kiểm tra được" in warns[0]

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
from scripts.reconcile_storage_orphans import find_orphans


# ── find_orphans (pure) ─────────────────────────────────────────────────────

def test_find_orphans_setminus_and_sorted():
    storage = {"a/1.mp3", "b/2.mp3", "c/3.mp3"}
    refs = {"b/2.mp3", None, ""}
    assert find_orphans(storage, refs) == ["a/1.mp3", "c/3.mp3"]


def test_find_orphans_empty_when_all_referenced():
    assert find_orphans({"x.mp3"}, {"x.mp3"}) == []


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

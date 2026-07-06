"""Unit tests for scripts.migrate_writing_images pure helpers.

The network/DB legs (`run`) are exercised operationally against prod as a dry
run; here we pin the URL-classification logic that decides what gets re-homed."""

from __future__ import annotations

from scripts.migrate_writing_images import host_of, is_legacy

_CUR = "huwsmtubwulikhlmcirx.supabase.co"
_OLD = "nqhrtqspznepmveyurzm.supabase.co"


def test_host_of_parses_and_degrades():
    assert host_of(f"https://{_OLD}/storage/v1/object/public/writing-images/x.png") == _OLD
    assert host_of(None) is None
    assert host_of("") is None
    assert host_of("not a url") is None


def test_is_legacy_true_for_old_project_and_external():
    assert is_legacy(f"https://{_OLD}/x.png", _CUR) is True
    assert is_legacy("https://res.cloudinary.com/x/chart.png", _CUR) is True


def test_is_legacy_false_for_current_host_and_empty():
    assert is_legacy(f"https://{_CUR}/storage/v1/object/public/writing-images/x.png", _CUR) is False
    assert is_legacy(None, _CUR) is False
    assert is_legacy("", _CUR) is False

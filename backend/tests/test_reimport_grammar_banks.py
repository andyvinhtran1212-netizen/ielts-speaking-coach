"""PC-J44 — reimport_grammar_banks.py must not report a rejected bank as imported.

The importer (services.quiz_import.import_quiz_file) reports rejections via a
flat top-level `validation_errors` list and `summary.errors`; there is no
top-level `errors` key. META/frontmatter failures return `questions: []`, so
the script used to print "✓ imported (0 câu)" and exit 0 while writing nothing.

No DB is touched: `supabase_admin` and `import_quiz_file` are stubbed and
BANK_DIR points at a tmp directory.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "reimport_grammar_banks.py"

BANK_CODE = "G-test-bank"
TOPIC_ID = "11111111-1111-1111-1111-111111111111"


def _load_script():
    spec = importlib.util.spec_from_file_location("reimport_grammar_banks_under_test", _SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class _Query:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_k): return self
    def eq(self, *_a, **_k): return self

    def execute(self):
        return type("R", (), {"data": self._rows})()


class _Admin:
    def __init__(self, rows):
        self._rows = rows

    def table(self, name):
        assert name == "quiz_banks"
        return _Query(self._rows)


@pytest.fixture
def script(tmp_path, monkeypatch):
    mod = _load_script()
    (tmp_path / f"{BANK_CODE}.md").write_text(
        f'---\ncode: "{BANK_CODE}"\n---\n', encoding="utf-8")
    monkeypatch.setattr(mod, "BANK_DIR", tmp_path)
    monkeypatch.setattr(mod, "supabase_admin",
                        _Admin([{"id": "b1", "code": BANK_CODE, "topic_id": TOPIC_ID}]))
    return mod


def _stub_import(monkeypatch, mod, result):
    calls = []

    def fake(text, *, topic_id, dry_run):
        calls.append({"topic_id": topic_id, "dry_run": dry_run})
        return result

    monkeypatch.setattr(mod, "import_quiz_file", fake)
    return calls


def _meta_rejected(dry_run):
    # Shape returned by import_quiz_file for a META/frontmatter-level failure.
    return {
        "dry_run": dry_run,
        "meta": None,
        "questions": [],
        "validation_errors": [{"block": -1, "qid": "", "field": "frontmatter",
                               "message": "META YAML hỏng"}],
        "summary": {"words": 0, "questions": 0, "errors": 1, "pools": 0},
        "committed_bank_id": None,
    }


def _accepted(dry_run, n=2):
    return {
        "dry_run": dry_run,
        "meta": {"code": BANK_CODE},
        "questions": [{"index": i, "qid": f"q{i}", "item_key": f"k{i}", "type": "mcq",
                       "skill": "form", "validation_errors": []} for i in range(1, n + 1)],
        "validation_errors": [],
        "summary": {"words": 1, "questions": n, "errors": 0, "pools": 0},
        "committed_bank_id": None if dry_run else "bank-1",
    }


@pytest.mark.parametrize("argv", [["x", "--commit", BANK_CODE], ["x", BANK_CODE]])
def test_meta_rejection_is_reported_as_failure(script, monkeypatch, capsys, argv):
    commit = "--commit" in argv
    _stub_import(monkeypatch, script, _meta_rejected(dry_run=not commit))

    rc = script.main(argv)

    out = capsys.readouterr().out
    assert rc != 0
    assert f"✗ {BANK_CODE}: bị importer từ chối" in out
    assert "META YAML hỏng" in out
    assert "✓ imported" not in out and "dry-run OK" not in out
    assert "0 bank OK, 1 lỗi" in out


def test_summary_errors_without_flat_list_is_failure(script, monkeypatch, capsys):
    res = _accepted(dry_run=False)
    res["summary"]["errors"] = 1
    res["committed_bank_id"] = None
    _stub_import(monkeypatch, script, res)

    rc = script.main(["x", "--commit", BANK_CODE])

    out = capsys.readouterr().out
    assert rc != 0
    assert "✓ imported" not in out
    assert "1 lỗi" in out


def test_commit_that_writes_nothing_is_failure(script, monkeypatch, capsys):
    res = _accepted(dry_run=False, n=0)
    res["committed_bank_id"] = None
    _stub_import(monkeypatch, script, res)

    rc = script.main(["x", "--commit", BANK_CODE])

    out = capsys.readouterr().out
    assert rc != 0
    assert "✓ imported" not in out


def test_valid_bank_commit_keeps_success_output(script, monkeypatch, capsys):
    calls = _stub_import(monkeypatch, script, _accepted(dry_run=False))

    rc = script.main(["x", "--commit", BANK_CODE])

    out = capsys.readouterr().out
    assert rc == 0
    assert f"✓ imported {BANK_CODE} (2 câu)" in out
    assert "COMMIT: 1 bank OK, 0 lỗi" in out
    assert calls == [{"topic_id": TOPIC_ID, "dry_run": False}]


def test_valid_bank_dry_run_keeps_success_output(script, monkeypatch, capsys):
    calls = _stub_import(monkeypatch, script, _accepted(dry_run=True))

    rc = script.main(["x", BANK_CODE])

    out = capsys.readouterr().out
    assert rc == 0
    assert f"· dry-run OK {BANK_CODE} (2 câu)" in out
    assert "DRY-RUN: 1 bank OK, 0 lỗi" in out
    assert calls == [{"topic_id": TOPIC_ID, "dry_run": True}]

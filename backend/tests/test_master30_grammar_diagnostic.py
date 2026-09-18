from __future__ import annotations

import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from services import grammar_diagnostic_service as service


PACKAGE = Path(os.environ.get("MASTER30_DIAGNOSTIC_PACKAGE", "/nonexistent"))


def _importer_module():
    path = Path(__file__).parents[1] / "scripts" / "import_master30_grammar.py"
    spec = importlib.util.spec_from_file_location("master30_importer_test", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_approved_package_passes_manifest_and_pool_validation():
    if not PACKAGE.exists():
        pytest.skip("set MASTER30_DIAGNOSTIC_PACKAGE to exercise the source package")
    importer = _importer_module()
    payload = importer.validate_package(PACKAGE)
    assert payload["checks"] == {
        "lessons": 30,
        "combined_inventory": 3338,
        "unique_runtime_items": 733,
        "productive_tasks": 19,
    }
    assert payload["manifest"]["release"]["live_calibrated_ready"] is False
    qindex = {row["item_id"]: row for row in payload["qmatrix"]}
    assert all(
        importer._lesson_refs(item, qindex[item["id"]])
        for item in payload["runtime"]
    )


def test_learner_item_payload_never_contains_answer_material():
    source = {
        "item_id": "Q-1", "prompt": "Choose.", "options": ["A", "B"],
        "correct_index": 1, "explanation": "secret", "translation_vi": "Bản dịch",
        "distractor_explanations": ["secret", ""],
    }
    result = service._public_item(source, "BASELINE", 1, 28)
    assert result == {
        "item_id": "Q-1", "prompt": "Choose.", "options": ["A", "B"],
        "phase": "BASELINE", "ordinal": 1, "total": 28,
        "translation_available": True,
    }
    assert not ({"correct_index", "explanation", "distractor_explanations"} & result.keys())


def test_quick_and_full_have_fixed_objective_caps_and_two_phases():
    assert service.LIMITS == {"QUICK": (18, 28), "FULL": (34, 54)}
    assert service.MAX_PER_ATTRIBUTE == 6


def test_report_states_match_structural_alpha_rules():
    two_mixed = [
        {"item_id": "a", "process_facet": "P1", "is_correct": True, "assistance_used": False},
        {"item_id": "b", "process_facet": "P2", "is_correct": False, "assistance_used": False},
    ]
    confirmed_need = two_mixed + [
        {"item_id": "c", "process_facet": "P3", "is_correct": False, "assistance_used": False},
    ]
    assert service._classify(two_mixed)["state"] == "UNSTABLE"
    assert service._classify(confirmed_need)["state"] == "CONFIRMED_REVIEW_NEED"


def test_assisted_answer_is_excluded_from_clean_evidence():
    rows = [
        {"item_id": "a", "process_facet": "P1", "is_correct": True, "assistance_used": True},
        {"item_id": "b", "process_facet": "P2", "is_correct": True, "assistance_used": False},
    ]
    result = service._classify(rows)
    assert result["state"] == "PROVISIONAL_STRENGTH"
    assert result["independent_items"] == 1
    assert result["assisted_evidence_excluded"] == 1


def test_entry_confirmation_rejects_course_specific_language():
    session = {"mode": "ENTRY", "module": "GENERAL"}
    item = {
        "module": "ALL", "diagnostic_status": "CONFIRMATION_RESERVED",
        "governance": {"course_specific_level": "REQUIRED"},
    }
    assert service._eligible(item, session, "CONFIRMATION") is False
    item["governance"] = {"course_specific_level": "NONE"}
    assert service._eligible(item, session, "CONFIRMATION") is True


def test_migration_keeps_productive_scoring_outside_objective_session():
    migration = (Path(__file__).parents[1] / "migrations" / "283_master30_grammar_diagnostic.sql").read_text()
    assert "auto_scoring_enabled BOOLEAN NOT NULL DEFAULT FALSE" in migration
    assert "objective_limit = 28" in migration
    assert "objective_limit = 54" in migration
    assert "artifact_kind = 'grammar_diagnostic'" in migration
    assert "subdomain TEXT NOT NULL" in migration
    assert "master30_grammar_self_serve" in migration
    assert "status NOT IN ('validated', 'retired')" in migration


def test_self_serve_is_closed_during_assigned_only_beta(monkeypatch):
    monkeypatch.setattr(service.runtime_flags, "is_enabled", lambda *args, **kwargs: False)
    with pytest.raises(service.HTTPException) as caught:
        service.create_session(
            "user-1", mode="ENTRY", module="GENERAL", test_length="QUICK",
            class_assignment_item_id=None,
        )
    assert caught.value.status_code == 403
    assert caught.value.detail["error_code"] == "grammar_assignment_required"


class _RowsQuery:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *args, **kwargs): return self
    def eq(self, *args, **kwargs): return self
    def limit(self, *args, **kwargs): return self
    def execute(self): return SimpleNamespace(data=self.rows)


class _RowsDb:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name): return _RowsQuery(self.tables.get(name, []))


def test_assigned_session_requires_current_class_membership(monkeypatch):
    db = _RowsDb({
        "class_assignment_items": [{"id": "item-1", "assignment_id": "a-1", "student_id": "s-1"}],
        "class_assignments": [{"id": "a-1", "cohort_id": "c-1", "skill": "grammar"}],
    })
    monkeypatch.setattr(service, "supabase_admin", db)
    monkeypatch.setattr(service, "_student_for_user", lambda _: {"id": "s-1", "cohort_id": "c-1"})
    monkeypatch.setattr(service, "student_is_active_in_cohort", lambda *args, **kwargs: False)
    with pytest.raises(service.HTTPException) as caught:
        service._assignment_entitlement("u-1", "item-1")
    assert caught.value.status_code == 404

    monkeypatch.setattr(service, "student_is_active_in_cohort", lambda *args, **kwargs: True)
    assert service._assignment_entitlement("u-1", "item-1")["assignment"]["id"] == "a-1"


def test_assigned_session_creation_returns_concurrent_winner(monkeypatch):
    winner = {
        "id": "session-winner", "user_id": "u-1", "release_id": "release-1",
        "class_assignment_item_id": "item-1", "status": "in_progress",
    }

    class _RaceQuery(_RowsQuery):
        def insert(self, *args, **kwargs):
            raise RuntimeError("duplicate key value violates unique constraint")

    class _RaceDb:
        def table(self, name): return _RaceQuery([winner])

    monkeypatch.setattr(service, "supabase_admin", _RaceDb())
    monkeypatch.setattr(service, "_active_release", lambda: {"id": "release-active"})
    monkeypatch.setattr(service, "_release_by_id", lambda _: {"id": "release-1"})
    monkeypatch.setattr(service, "_assignment_config", lambda *args: {
        "item": {"state": "opened"}, "existing": None,
        "assignment": {"content_config": {
            "release_id": "release-1", "mode": "REVIEW",
            "module": "GENERAL", "test_length": "QUICK",
        }},
    })
    monkeypatch.setattr(service, "session_summary", lambda _user, row: row)
    result = service.create_session(
        "u-1", mode="ENTRY", module="ACADEMIC", test_length="FULL",
        class_assignment_item_id="item-1",
    )
    assert result["id"] == "session-winner"


def test_m14_route_uses_observed_subdomain():
    session = {"test_length": "QUICK", "mode": "REVIEW", "module": "GENERAL", "release_id": "r1"}
    responses = [
        {
            "item_id": f"q{index}", "attribute_id": "M14",
            "process_facet": facet, "subdomain": "punctuation",
            "phase": "BASELINE", "selected_option": 0,
            "is_correct": index == 0, "assistance_used": False,
        }
        for index, facet in enumerate(("P1", "P2", "P3"))
    ]
    content = {
        "learner_copy": {"M14": {"learner_title_vi": "Cơ chế viết"}},
        "route_by_attribute": {
            "M14": [
                {"route_id": "wrong", "route": {"subdomain": "spelling"}},
                {"route_id": "right", "route": {"subdomain": "punctuation"}},
            ],
        },
    }
    learner, _, _ = service._build_reports(session, responses, content)
    assert learner["priorities"][0]["route_id"] == "right"

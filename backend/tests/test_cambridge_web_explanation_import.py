import pytest

from scripts import import_cambridge_web_explanations as importer


def _hidden_parent(row_id, test_id):
    return {
        "id": row_id,
        "test_id": test_id,
        "status": "draft",
        "exam_only": True,
        "public_practice_enabled": False,
        "web_explanation_mode": "disabled",
    }


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, data):
        self.data = data

    def select(self, *_args):
        return self

    def execute(self):
        return _Result(self.data)


class _Db:
    def __init__(self, reading=None, listening=None):
        self.rows = {"reading_tests": reading or [], "listening_tests": listening or []}

    def table(self, name):
        return _Query(self.rows[name])


def _rows():
    return [
        {"object_id": "r", "skill": "reading", "book_number": 13,
         "test_number": 1, "serving_status": "ELIGIBLE_AFTER_GLOBAL_RELEASE_GATES"},
        {"object_id": "l", "skill": "listening", "book_number": 13,
         "test_number": 1, "serving_status": "ELIGIBLE_AFTER_GLOBAL_RELEASE_GATES"},
    ]


def test_internal_qa_import_marks_missing_papers_unbound():
    rows = _rows()
    importer._bind_test_ids(rows, _Db(), allow_unbound_internal_qa=True)
    assert all(row["binding_status"] == "UNBOUND_INTERNAL_QA" for row in rows)
    assert all(row["serving_status"] == "INTERNAL_QA_UNBOUND" for row in rows)
    assert all("reading_test_id" not in row and "listening_test_id" not in row for row in rows)


def test_bound_import_keeps_fail_loud_missing_paper_contract():
    try:
        importer._bind_test_ids(_rows(), _Db())
    except importer.ImportValidationError as exc:
        assert "ILR-LIS-CAM-B13-T1" in str(exc)
        assert "ILR-RDG-CAM-B13-T1" in str(exc)
    else:
        raise AssertionError("production-style import accepted unbound papers")


def test_existing_papers_bind_without_internal_qa_override():
    rows = _rows()
    importer._bind_test_ids(rows, _Db(
        reading=[_hidden_parent("reading-uuid", "ILR-RDG-CAM-B13-T1")],
        listening=[_hidden_parent("listening-uuid", "ILR-LIS-CAM-B13-T1")],
    ))
    assert rows[0]["reading_test_id"] == "reading-uuid"
    assert rows[1]["listening_test_id"] == "listening-uuid"
    assert all(row["binding_status"] == "BOUND" for row in rows)


def test_binding_rejects_parent_that_is_public_or_explanation_enabled():
    reading = _hidden_parent("reading-uuid", "ILR-RDG-CAM-B13-T1")
    reading["public_practice_enabled"] = True
    try:
        importer._bind_test_ids(_rows(), _Db(
            reading=[reading],
            listening=[_hidden_parent("listening-uuid", "ILR-LIS-CAM-B13-T1")],
        ))
    except importer.ImportValidationError as exc:
        assert "không còn bị khóa an toàn" in str(exc)
    else:
        raise AssertionError("import accepted a public Cambridge parent")


def test_production_commit_requires_explicit_hidden_ack(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    with pytest.raises(importer.ImportValidationError, match="allow-production-hidden"):
        importer.commit_rows(_rows())

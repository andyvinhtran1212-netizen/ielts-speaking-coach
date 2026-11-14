"""Actual 295 import -> 353 publish -> 306 capture + 376 admission, local PG only."""
import json
from copy import deepcopy
from uuid import UUID, uuid4

import pytest
import asyncpg

from services import listening_package_import as importer
from services.listening_blackeye import activity_from_paper
from test_blackeye_package_import import blackeye_package
from test_migration_338_paper_updated_at_triggers import (  # noqa: F401
    MIGRATIONS, package_policy_probe, paper_probe, private_probe, programme_probe,
)
from test_mock_paper_policy_postgres import activate, query


def import_and_publish(schema, plan, *, missing=None):
    # 353 explicitly leaves Q-J252-IMPORT open: importing while 306 is active
    # fails on child INSERT. Model the existing inactive import window, without
    # disabling any trigger. Publication and admission use the active guards.
    query(f"CREATE OR REPLACE FUNCTION {schema}.fn_mock_admission_contract_active() "
          "RETURNS boolean LANGUAGE sql AS 'SELECT false'")
    package, forms = deepcopy(plan.package), deepcopy(plan.forms)
    if missing:
        package["package_id"] += "-missing-" + missing
        forms[0]["test_id"] += "-missing-" + missing
        if missing == "blackeye_review":
            del forms[0]["exercise_payload"][missing]
        else:
            del forms[0]["metadata"][missing]
    [result] = query(f"SELECT * FROM {schema}.import_listening_content_package_atomic($1,$2,$3,$4)",
                    *(json.dumps(v) for v in (package, plan.lessons, plan.stimuli, forms)))
    assert result["action"] == "created"
    activate(schema)
    query(f"SELECT * FROM {schema}.set_listening_content_package_status($1,$2,'publish',NULL)",
          package["package_id"], package["manifest_sha256"])
    [row] = query(f"SELECT to_jsonb(t) AS paper FROM {schema}.listening_tests t WHERE test_id=$1",
                  forms[0]["test_id"])
    return json.loads(row["paper"])


def admit(schema, paper):
    owner = uuid4()
    query(f"INSERT INTO {schema}.users(id) VALUES($1)", owner)
    return query(f"INSERT INTO {schema}.listening_test_attempts"
        "(test_id,user_id,attempt_purpose,scoring_policy) VALUES($1,$2,'practice','report_only') RETURNING *",
        paper["id"], owner)[0]


def install_376(schema):
    sql = (MIGRATIONS / "376_blackeye_admission.sql").read_text().replace("public.", schema + ".")
    sql = sql.replace("auth.role()", "current_setting('request.jwt.claim.role',true)")
    query(sql)


def test_import_readback_publish_and_admit_with_real_guards(package_policy_probe, tmp_path):
    schema = package_policy_probe["schema"]
    install_376(schema)
    location, source, review = blackeye_package(tmp_path)
    plan = importer.build_import_plan(location)
    paper = import_and_publish(schema, plan)
    activity, full = activity_from_paper(paper)
    assert activity.binding.activity_id == "U1-A01"
    assert full.answer_set_revision == source["metadata"]["blackeye"]["binding"]["answer_set_revision"]
    assert paper["metadata"]["blackeye_db_revisions"] == {
        "paper_revision": paper["mock_content_revision"], "policy_revision": paper["policy_revision"]}
    assert paper["mock_content_revision"] == 0 and paper["policy_revision"] == 1
    attempt = admit(schema, paper)
    assert attempt["paper_revision"] == 0 and attempt["policy_revision"] == 1
    [snapshot] = query(f"SELECT paper_row,marking_rows FROM {schema}.mock_paper_attempt_snapshots WHERE attempt_id=$1",
                       attempt["id"])
    assert json.loads(snapshot["paper_row"])["metadata"] == paper["metadata"]
    assert json.loads(snapshot["marking_rows"])[0]["payload"]["blackeye_review"] == review
    # Persisted metadata cannot be repaired after import, even with the package
    # transition GUC set. Validate all fields before reaching the import RPC.
    with pytest.raises(asyncpg.PostgresError, match="listening_package_child_immutable"):
        query(f"UPDATE {schema}.listening_tests SET metadata='{{}}' WHERE id=$1", paper["id"])


def test_same_blackeye_package_reimport_reuses_identity_and_preserves_rows(package_policy_probe, tmp_path):
    schema = package_policy_probe["schema"]
    install_376(schema)
    location, _, _ = blackeye_package(tmp_path)
    plan = importer.build_import_plan(location)
    paper = import_and_publish(schema, plan)
    tables = ("listening_content_packages", "listening_lessons", "listening_package_stimuli",
              "listening_form_stimuli", "listening_tests", "listening_content", "listening_exercises")
    def readback():
        return {table: query(f"SELECT to_jsonb(t) AS row FROM {schema}.{table} t ORDER BY to_jsonb(t)::text")
                for table in tables}
    before = readback()
    [result] = query(f"SELECT * FROM {schema}.import_listening_content_package_atomic($1,$2,$3,$4)",
                    *(json.dumps(v) for v in (plan.package, plan.lessons, plan.stimuli, plan.forms)))
    assert result["action"] == "reused"
    assert result["package_uuid"] == UUID(paper["content_package_id"])
    assert result["lessons_written"] == len(plan.lessons)
    assert result["forms_written"] == len(plan.forms)
    assert result["items_written"] == sum(form["item_count"] for form in plan.forms)
    assert result["stimuli_written"] == len(plan.stimuli)
    assert readback() == before
    # The repeated import keeps the published contract admissible under 376.
    assert admit(schema, paper)["test_id"] == UUID(paper["id"])


@pytest.mark.parametrize("missing", ["blackeye", "blackeye_db_revisions", "blackeye_context", "blackeye_review"])
def test_376_rejects_missing_contract_even_if_import_validation_bypassed(package_policy_probe, tmp_path, missing):
    schema = package_policy_probe["schema"]
    install_376(schema)
    location, _, _ = blackeye_package(tmp_path)
    plan = importer.build_import_plan(location)
    # Negative control reproduces the former importer data loss in the DB.
    paper = import_and_publish(schema, plan, missing=missing)
    with pytest.raises(asyncpg.PostgresError, match="blackeye_(invalid_binding|unavailable)"):
        admit(schema, paper)
    assert query(f"SELECT count(*) AS n FROM {schema}.listening_test_attempts WHERE test_id=$1", paper["id"])[0]["n"] == 0

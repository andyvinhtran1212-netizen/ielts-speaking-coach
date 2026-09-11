"""Real migration/proof verification on an explicitly LOCAL disposable PG."""

import json
import asyncio
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import pytest
import asyncpg

from test_migration_240_core_attempt_evidence import DB, probe, psql

SQL = (Path(__file__).resolve().parents[1] / "migrations/243_core_exam_result_proofs.sql").read_text()


@pytest.fixture(scope="module")
def schema(probe):
    for table in ("reading_test_attempts", "listening_test_attempts"):
        psql(f"CREATE TABLE {probe}.{table}(id uuid, status text, submitted_at timestamptz, score numeric, band_estimate numeric, grading_details jsonb)")
    migrated = SQL.replace("public.", f"{probe}.").replace("search_path = public,", f"search_path = {probe},")
    psql(migrated)
    psql(migrated)
    return probe


def metadata():
    return {"status": "submitted", "submitted_at": "2026-09-10T01:00:00Z", "score": 1, "band_estimate": None,
            "grading_details": [{"q_num": 1, "correct": True}, {"q_num": 2, "correct": False}]}


def literal(value):
    return "NULL" if value is None else "'" + str(value).replace("'", "''") + "'"


def record_proof(schema, attempt, data, expected=(1, 2), surface="reading_exam"):
    return psql(f"SET ROLE service_role; SELECT {schema}.fn_record_core_exam_result_proof({literal(surface)},'{attempt}',{literal(json.dumps(data))}::jsonb,{literal('{' + ','.join('NULL' if n is None else str(n) for n in expected) + '}')}::integer[])")


def check(schema, attempt, data, surface="reading_exam"):
    table = "reading_test_attempts" if surface == "reading_exam" else "listening_test_attempts"
    values = [attempt, data.get("status"), data.get("submitted_at"), data.get("score"), data.get("band_estimate"), json.dumps(data.get("grading_details"))]
    return psql(f"SET ROLE service_role; SELECT {schema}.core_evidence_result_check(ROW(" +
                ",".join(literal(x) for x in values) + f")::{schema}.{table})")


@pytest.mark.parametrize("surface", ["reading_exam", "listening_test"])
def test_no_proof_then_verified_and_exact_retry_is_one_digest(schema, surface):
    attempt, data = uuid4(), metadata()
    assert check(schema, attempt, data, surface) == "unverified"
    first = record_proof(schema, attempt, data, surface=surface)
    assert len(first) == 64 and record_proof(schema, attempt, data, surface=surface) == first
    assert check(schema, attempt, data, surface) == "verified"
    assert psql(f"SELECT count(*) FROM {schema}.core_exam_result_proofs WHERE canonical_attempt_id='{attempt}'") == "1"
    saved = json.loads(psql(f"SELECT to_jsonb(p) FROM {schema}.core_exam_result_proofs p WHERE canonical_attempt_id='{attempt}'"))
    assert set(saved) == {"id", "surface", "canonical_attempt_id", "result_digest", "created_at"}


def test_equivalent_number_timezone_and_question_order_normalize(schema):
    attempt, data = uuid4(), metadata()
    fingerprint = record_proof(schema, attempt, data)
    data.update(score=1.0, submitted_at="2026-09-10T08:00:00+07:00")
    data["grading_details"].reverse()
    assert record_proof(schema, attempt, data, expected=(2, 1)) == fingerprint
    assert check(schema, attempt, data) == "verified"


def test_wrong_identity_namespace_or_modified_result_is_not_verified(schema):
    attempt, data = uuid4(), metadata()
    record_proof(schema, attempt, data)
    assert check(schema, uuid4(), data) == "unverified"
    assert check(schema, attempt, data, "listening_test") == "unverified"
    assert check(schema, attempt, data | {"score": 0}) == "invalid"
    assert check(schema, attempt, data | {"band_estimate": 5}) == "unverified"
    assert check(schema, attempt, data | {"submitted_at": "2026-09-11T01:00:00Z"}) == "unverified"
    changed = data | {"grading_details": [{"q_num": 1, "correct": False}, {"q_num": 2, "correct": True}]}
    assert check(schema, attempt, changed) == "unverified"
    assert check(schema, attempt, data | {"status": "in_progress"}) == "invalid"
    # A prior valid proof is retained, not a last-receipt-wins override.
    assert check(schema, attempt, data) == "verified"


@pytest.mark.parametrize("patch,expected", [
    ({"score": 0}, (1, 2)), ({"score": True}, (1, 2)), ({"score": "1"}, (1, 2)),
    ({"band_estimate": "NaN"}, (1, 2)), ({"band_estimate": 10}, (1, 2)),
    ({"submitted_at": "2026-09-10T01:00:00"}, (1, 2)), ({"submitted_at": "infinity"}, (1, 2)),
    ({"grading_details": []}, (1, 2)), ({"grading_details": {}}, (1, 2)),
    ({"grading_details": [None]}, (1,)),
    ({"grading_details": [{"q_num": 1, "correct": "true"}]}, (1,)),
    ({"grading_details": [{"q_num": True, "correct": True}]}, (1,)),
    ({"grading_details": [{"q_num": 1, "correct": True}, {"q_num": 1, "correct": False}]}, (1, 1)),
    ({}, (1,)), ({}, (1, 3)), ({}, (1, 2, 2)), ({}, (1, None)), ({}, ()),
    ({"answer_text": "must not be persisted"}, (1, 2)),
    ({"grading_details": [{"q_num": 1, "correct": True, "user_answer": "private"}]}, (1,)),
])
def test_invalid_or_content_bearing_proof_never_persists(schema, patch, expected):
    attempt = uuid4()
    with pytest.raises(RuntimeError):
        record_proof(schema, attempt, metadata() | patch, expected)
    assert psql(f"SELECT count(*) FROM {schema}.core_exam_result_proofs WHERE canonical_attempt_id='{attempt}'") == "0"


def test_current_question_content_is_not_a_readback_dependency(schema):
    attempt, data = uuid4(), metadata()
    record_proof(schema, attempt, data)
    data["grading_details"][0].update(user_answer="private", expected="edited answer", explanation="changed explanation")
    # Content is intentionally outside the result-persistence fingerprint.
    # This is NOT numerical grading/content correctness certification.
    assert check(schema, attempt, data) == "verified"
    assert "reading_questions" not in SQL and "listening_exercises" not in SQL


@pytest.mark.parametrize("surface", ["reading_exam", "listening_test"])
def test_low_score_is_successful_persistence_not_failed_exam(schema, surface):
    attempt, data = uuid4(), metadata()
    data.update(score=0, band_estimate=None)
    for row in data["grading_details"]:
        row["correct"] = False
    record_proof(schema, attempt, data, surface=surface)
    assert check(schema, attempt, data, surface) == "verified"


def test_private_roles_and_append_only_privileges(schema):
    signatures = [
        "fn_record_core_exam_result_proof(text,uuid,jsonb,integer[])",
        "fn_core_exam_result_digest(uuid,text,timestamptz,numeric,numeric,jsonb)",
        f"core_evidence_result_check({schema}.reading_test_attempts)",
        f"core_evidence_result_check({schema}.listening_test_attempts)",
    ]
    for role in ("anon", "authenticated"):
        with pytest.raises(RuntimeError, match="permission denied"):
            psql(f"SET ROLE {role}; SELECT * FROM {schema}.core_exam_result_proofs")
        for signature in signatures:
            assert psql(f"SELECT has_function_privilege('{role}', '{schema}.{signature}', 'EXECUTE')") == "f"
    for privilege in ("UPDATE", "DELETE", "TRUNCATE"):
        assert psql(f"SELECT has_table_privilege('service_role','{schema}.core_exam_result_proofs','{privilege}')") == "f"
    assert "CREATE TRIGGER" not in SQL and "UPDATE public." not in SQL and "DELETE FROM" not in SQL


def test_actual_source_row_and_proof_have_transaction_snapshot_visibility(schema):
    attempt, data = uuid4(), metadata()
    async def run():
        writer, reader = await asyncpg.connect(DB), await asyncpg.connect(DB)
        try:
            await writer.execute(f"GRANT SELECT ON {schema}.reading_test_attempts TO service_role")
            await writer.execute(f"INSERT INTO {schema}.reading_test_attempts VALUES ($1,'submitted',$2,1,NULL,$3::jsonb)",
                                 attempt, datetime.fromisoformat(data["submitted_at"].replace("Z", "+00:00")),
                                 json.dumps(data["grading_details"]))
            await writer.execute("SET ROLE service_role")
            await reader.execute("SET ROLE service_role")
            query = f"SELECT {schema}.core_evidence_result_check(a) FROM {schema}.reading_test_attempts a WHERE a.id=$1"
            assert await reader.fetchval(query, attempt) == "unverified"
            transaction = writer.transaction()
            await transaction.start()
            await writer.fetchval(f"SELECT {schema}.fn_record_core_exam_result_proof('reading_exam',$1,$2::jsonb,$3::integer[])",
                                  attempt, json.dumps(data), [1, 2])
            assert await reader.fetchval(query, attempt) == "unverified"
            await transaction.commit()
            assert await reader.fetchval(query, attempt) == "verified"
            await writer.execute("RESET ROLE")
            await writer.execute(f"UPDATE {schema}.reading_test_attempts SET band_estimate=5 WHERE id=$1", attempt)
            assert await reader.fetchval(query, attempt) == "unverified"
        finally:
            await writer.close()
            await reader.close()
    asyncio.run(run())

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import repair_cam16_cam18_screening as repair  # noqa: E402


def test_equal_desired_update_is_an_idempotent_noop(monkeypatch):
    class UnexpectedDatabaseCall:
        def table(self, _name):
            raise AssertionError("desired state must not issue an update")

    monkeypatch.setattr(repair, "sb", UnexpectedDatabaseCall())
    old = {"id": "row", "updated_at": "now", "payload": {"desired": True}}

    assert repair._update(
        "listening_exercises", old, {"payload": {"desired": True}}, apply=True
    ) == old


def test_atomic_reading_repair_rolls_back_when_any_predicate_drifts(monkeypatch):
    transaction = SimpleNamespace(exit_error=None)

    class FakeTransaction:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, _exc, _traceback):
            transaction.exit_error = exc_type
            return False

    class FakeConnection:
        def __init__(self):
            self.calls = 0

        def transaction(self):
            return FakeTransaction()

        async def fetchrow(self, *_args):
            self.calls += 1
            return {"id": "first"} if self.calls == 1 else None

        async def close(self):
            return None

    connection = FakeConnection()

    async def connect(_dsn):
        return connection

    monkeypatch.setitem(sys.modules, "asyncpg", SimpleNamespace(connect=connect))
    plan = [
        ({"id": "00000000-0000-0000-0000-000000000001", "prompt": "a",
          "payload": {}, "answer": {}}, {"prompt": "A"}),
        ({"id": "00000000-0000-0000-0000-000000000002", "prompt": "b",
          "payload": {}, "answer": {}}, {"prompt": "B"}),
    ]

    with pytest.raises(RuntimeError, match="atomic precondition drift"):
        asyncio.run(repair._atomic_reading_updates_async(
            plan, "postgresql://example.invalid/db"
        ))

    assert transaction.exit_error is RuntimeError


def test_database_destination_mismatch_fails_before_connect_or_update(monkeypatch):
    called = False

    async def connect(_dsn):
        nonlocal called
        called = True
        raise AssertionError("mismatched destination must not connect")

    monkeypatch.setitem(sys.modules, "asyncpg", SimpleNamespace(connect=connect))
    monkeypatch.setattr(
        repair.settings, "DATABASE_URL",
        "postgresql://postgres.wrongproject:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
    )

    with pytest.raises(RuntimeError, match="DATABASE_URL project ref mismatch"):
        repair._validated_database_dsn({"project_ref": "expectedproject"})

    assert called is False


def test_database_destination_rejects_supabase_username_on_external_host(monkeypatch):
    called = False

    async def connect(_dsn):
        nonlocal called
        called = True
        raise AssertionError("external destination must not connect")

    monkeypatch.setitem(sys.modules, "asyncpg", SimpleNamespace(connect=connect))
    monkeypatch.setattr(
        repair.settings, "DATABASE_URL",
        "postgresql://postgres.expectedproject:secret@evil.example:5432/postgres",
    )

    with pytest.raises(RuntimeError, match="DATABASE_URL project ref mismatch"):
        repair._validated_database_dsn({"project_ref": "expectedproject"})

    assert called is False


@pytest.mark.parametrize("database_url", [
    "postgresql://postgres:secret@db.expectedproject.supabase.co:5432/postgres",
    "postgresql+asyncpg://postgres.expectedproject:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
])
def test_database_destination_accepts_direct_and_pooler_urls(monkeypatch, database_url):
    monkeypatch.setattr(repair.settings, "DATABASE_URL", database_url)

    dsn = repair._validated_database_dsn({"project_ref": "expectedproject"})

    assert dsn.startswith("postgresql://")


def test_flow_verification_rejects_missing_storage_object(monkeypatch):
    payload = {"map_image_storage_path": "expected/path.png"}
    config = {
        "c16_l_flow": "flow",
        "flow_storage_path": "expected/path.png",
        "hashes": {"c16_l_flow_after": repair._hash(payload)},
    }
    monkeypatch.setattr(
        repair, "_exercise",
        lambda _row_id: {"payload": payload},
    )

    class MissingBucket:
        def download(self, _path):
            raise FileNotFoundError("missing")

    monkeypatch.setattr(
        repair, "sb",
        SimpleNamespace(storage=SimpleNamespace(from_=lambda _bucket: MissingBucket())),
    )

    with pytest.raises(RuntimeError, match="object is missing"):
        repair._verify_flow_asset(config)


def test_flow_verification_rejects_non_path_payload_drift(monkeypatch):
    desired = {"map_image_storage_path": "expected/path.png", "questions": [25, 26]}
    drifted = {**desired, "questions": [25, 99]}
    config = {
        "c16_l_flow": "flow",
        "flow_storage_path": "expected/path.png",
        "hashes": {"c16_l_flow_after": repair._hash(desired)},
    }
    monkeypatch.setattr(repair, "_exercise", lambda _row_id: {"payload": drifted})

    with pytest.raises(RuntimeError, match="desired payload hash mismatch"):
        repair._verify_flow_asset(config)


def test_flow_preflight_rejects_missing_blob_without_local_asset(monkeypatch):
    payload = {"map_image_storage_path": "expected/path.png"}
    config = {
        "c16_l_flow": "flow",
        "flow_storage_path": "expected/path.png",
        "hashes": {"c16_l_flow_after": repair._hash(payload)},
    }
    monkeypatch.setattr(repair, "_exercise", lambda _row_id, _hashes: {"payload": payload})

    class MissingBucket:
        def download(self, _path):
            raise FileNotFoundError("missing")

    monkeypatch.setattr(
        repair, "sb",
        SimpleNamespace(storage=SimpleNamespace(from_=lambda _bucket: MissingBucket())),
    )

    with pytest.raises(RuntimeError, match="no canonical local asset"):
        repair._ensure_flow_asset(config, None, apply=False)


def test_flow_preflight_rejects_existing_wrong_blob_even_with_local_asset(
    monkeypatch, tmp_path,
):
    canonical = b"canonical-flowchart"
    asset = tmp_path / "flow.png"
    asset.write_bytes(canonical)
    monkeypatch.setattr(repair, "FLOW_SHA", repair.hashlib.sha256(canonical).hexdigest())
    payload = {"map_image_storage_path": "expected/path.png"}
    config = {
        "c16_l_flow": "flow",
        "flow_storage_path": "expected/path.png",
        "hashes": {"c16_l_flow_after": repair._hash(payload)},
    }
    monkeypatch.setattr(repair, "_exercise", lambda _row_id, _hashes: {"payload": payload})

    class WrongBucket:
        def download(self, _path):
            return b"wrong-object"

    monkeypatch.setattr(
        repair, "sb",
        SimpleNamespace(storage=SimpleNamespace(from_=lambda _bucket: WrongBucket())),
    )

    with pytest.raises(RuntimeError, match="existing flowchart object hash mismatch"):
        repair._ensure_flow_asset(config, asset, apply=False)


def test_runtime_guards_are_not_removed_by_python_optimization():
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join([
        str(SCRIPTS), str(SCRIPTS.parent), env.get("PYTHONPATH", ""),
    ])
    result = subprocess.run(
        [sys.executable, "-O", "-c",
         "import repair_cam16_cam18_screening as r; r._require(False, 'guard-live')"],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode != 0
    assert "guard-live" in result.stderr

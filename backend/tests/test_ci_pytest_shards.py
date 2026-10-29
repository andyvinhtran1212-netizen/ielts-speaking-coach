"""PC-J14 / BL-14 — the CI shard split runs every backend test exactly once.

`scripts/ci_pytest_shards.py verify` is the runtime proof in CI; these pin the
pieces it relies on: the file partition is total and disjoint, `verify` goes
red on a duplicate, missing or extra id, and the workflow's matrix, `run` and
`verify` agree on the shard count.
"""
from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

import pytest
import yaml

BACKEND = Path(__file__).resolve().parent.parent
WORKFLOW = BACKEND.parent / ".github/workflows/backend-tests.yml"

_spec = importlib.util.spec_from_file_location(
    "ci_pytest_shards", BACKEND / "scripts/ci_pytest_shards.py"
)
shards = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(shards)


@pytest.fixture(autouse=True)
def _no_step_summary(monkeypatch):
    # In CI `verify` appends to the job summary; keep these fixtures out of it.
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)


def _weights() -> dict[str, float]:
    return json.loads(shards.WEIGHTS_FILE.read_text(encoding="utf-8"))


def test_discovery_includes_this_file_and_both_pytest_name_patterns():
    files = shards.test_files(BACKEND)
    assert "tests/test_ci_pytest_shards.py" in files
    assert "tests/smoke/test_gemini_smoke.py" in files
    assert any(f.endswith("_test.py") for f in files)
    assert "tests/conftest.py" not in files


@pytest.mark.parametrize("total", [1, 2, 3, 4, 5, 7])
def test_partition_assigns_every_file_to_exactly_one_shard(total):
    files = shards.test_files(BACKEND)
    parts = shards.partition(files, _weights(), total)
    assert len(parts) == total
    flat = [f for part in parts for f in part]
    assert sorted(flat) == files
    assert len(flat) == len(set(flat))


def test_partition_gives_unweighted_files_a_shard():
    parts = shards.partition(["tests/test_a.py", "tests/test_new.py"], {"tests/test_a.py": 9.0}, 2)
    assert sorted(f for p in parts for f in p) == ["tests/test_a.py", "tests/test_new.py"]


def _write(tmp_path, collected, shard_ids):
    (tmp_path / "collected.json").write_text(json.dumps({"collected": collected, "results": {}}))
    for i, ids in enumerate(shard_ids, 1):
        results = {n: {"outcome": "passed", "duration": 0.1} for n in ids}
        (tmp_path / f"shard-{i}.json").write_text(json.dumps({"collected": ids, "results": results}))


def _verify(tmp_path, total):
    return shards.main(["verify", "--dir", str(tmp_path), "--total", str(total)])


def test_verify_accepts_an_exact_split(tmp_path):
    _write(tmp_path, ["tests/a.py::t1", "tests/b.py::t2"], [["tests/a.py::t1"], ["tests/b.py::t2"]])
    assert _verify(tmp_path, 2) == 0


@pytest.mark.parametrize(
    "shard_ids",
    [
        [["tests/a.py::t1"], ["tests/a.py::t1", "tests/b.py::t2"]],  # duplicate
        [["tests/a.py::t1"], []],                                       # missing
        [["tests/a.py::t1"], ["tests/b.py::t2", "tests/c.py::t3"]],   # extra
    ],
)
def test_verify_rejects_duplicate_missing_or_extra_ids(tmp_path, shard_ids):
    _write(tmp_path, ["tests/a.py::t1", "tests/b.py::t2"], shard_ids)
    assert _verify(tmp_path, 2) == 1


def test_verify_rejects_a_missing_shard_report(tmp_path):
    _write(tmp_path, ["tests/a.py::t1"], [["tests/a.py::t1"]])
    assert _verify(tmp_path, 2) == 1


def test_verify_tolerates_only_same_count_per_process_parametrize_ids(tmp_path):
    full = ["tests/r.py::t[2026-10-28T03:01:26]", "tests/r.py::t[2026-10-28T04:31:26]"]
    rerun = ["tests/r.py::t[2026-10-28T03:01:50]", "tests/r.py::t[2026-10-28T04:31:50]"]
    _write(tmp_path, full, [rerun])
    assert _verify(tmp_path, 1) == 0
    _write(tmp_path, full, [rerun[:1]])
    assert _verify(tmp_path, 1) == 1


def test_verify_rejects_a_collected_id_without_an_outcome(tmp_path):
    _write(tmp_path, ["tests/a.py::t1"], [["tests/a.py::t1"]])
    (tmp_path / "shard-1.json").write_text(json.dumps({"collected": ["tests/a.py::t1"], "results": {}}))
    assert _verify(tmp_path, 1) == 1


def test_workflow_matrix_run_and_verify_agree_on_shard_count():
    text = WORKFLOW.read_text(encoding="utf-8")
    jobs = yaml.safe_load(text)["jobs"]
    matrix = jobs["backend-shard"]["strategy"]["matrix"]["shard"]
    total = len(matrix)
    assert matrix == list(range(1, total + 1))
    run = re.findall(r"ci_pytest_shards\.py run --total (\d+)", text)
    verify = re.findall(r"ci_pytest_shards\.py verify --dir \S+ --total (\d+)", text)
    assert run == [str(total)] and verify == [str(total)]
    assert jobs["backend-shard"]["name"].endswith(f"/{total}")
    # The required context for main and staging-promotion-gate.yml.
    assert jobs["backend"]["name"] == "Backend (pytest + anchor drift)"
    assert set(jobs["backend"]["needs"]) == {"changes", "backend-shard", "backend-collect"}
    # Still reports after a red shard; skipped only on a PR that touches no
    # gated path (push runs always evaluate the gate to true).
    assert jobs["backend"]["if"].startswith("${{ always() && ")
    # A job-level skip of a matrix job reports an unexpanded name, so the
    # required "shard N/4" checks would never report: the shard job must run.
    assert jobs["backend-shard"]["if"] == "${{ !cancelled() }}"

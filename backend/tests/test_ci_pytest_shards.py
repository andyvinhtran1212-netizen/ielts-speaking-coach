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


def test_lpt_balances_expensive_files_before_small_files():
    weights = dict(zip("abcdef", [9, 8, 7, 6, 5, 1]))
    parts = shards.partition(list(weights), weights, 3)
    loads = [sum(weights[name] for name in part) for part in parts]
    # LPT starts with 9/8/7, then places 6 with 7, 5 with 8 and 1 with 9.
    assert sorted(loads) == [10, 13, 13]
    assert max(loads) <= 1.3 * (sum(loads) / len(loads))


def test_partition_is_independent_of_input_order_and_breaks_ties_stably():
    weights = {name: 1.0 for name in "abcd"}
    assert shards.partition(list("dcba"), weights, 2) == [["a", "c"], ["b", "d"]]
    assert shards.partition(list("abcd"), weights, 2) == [["a", "c"], ["b", "d"]]


def test_new_files_use_median_of_current_files_not_removed_files():
    assert shards.file_durations(["a", "b", "new"], {"a": 2, "b": 8, "removed": 100}) == {
        "a": 2, "b": 8, "new": 5,
    }
    assert shards.file_durations(["new"], {}) == {"new": 1.0}
    assert shards.partition(["a", "b", "new"], {"a": 2, "b": 8}, 2) == [
        ["b"], ["a", "new"],
    ]


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


def test_manual_refresh_aggregates_all_test_phases_per_file(tmp_path):
    recorder = shards.Recorder(tmp_path / "shard-1.json")
    recorder.collected = ["tests/a.py::t1", "tests/a.py::t2"]
    from types import SimpleNamespace

    for nodeid in recorder.collected:
        for phase, duration in [("setup", 1.0), ("call", 3.0), ("teardown", 2.0)]:
            recorder.pytest_runtest_logreport(SimpleNamespace(
                nodeid=nodeid, duration=duration, when=phase, failed=False, skipped=False,
            ))
    recorder.pytest_sessionfinish(None)
    (tmp_path / "collected.json").write_text(json.dumps({"collected": recorder.collected}))
    output = tmp_path / "weights.json"
    assert shards.main([
        "verify", "--dir", str(tmp_path), "--total", "1", "--weights-out", str(output),
    ]) == 0
    assert json.loads(output.read_text()) == {"tests/a.py": 12.0}


def test_failed_parity_does_not_write_refresh_candidate(tmp_path):
    _write(tmp_path, ["tests/a.py::t1", "tests/b.py::t2"], [["tests/a.py::t1"]])
    output = tmp_path / "weights.json"
    assert shards.main([
        "verify", "--dir", str(tmp_path), "--total", "2", "--weights-out", str(output),
    ]) == 1
    assert not output.exists()


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
    assert jobs["backend-shard"]["timeout-minutes"] == 25
    assert "--durations=20" in text
    # The required context for main and staging-promotion-gate.yml.
    assert jobs["backend"]["name"] == "Backend (pytest + anchor drift)"
    assert set(jobs["backend"]["needs"]) == {"changes", "backend-shard", "backend-collect"}
    # Still reports after a red shard; skipped only on a PR whose every file is
    # a spec no test reads (push runs always evaluate the gate to true).
    assert jobs["backend"]["if"] == (
        "${{ always() && (github.event_name == 'push' "
        "|| needs.changes.outputs.run_tests != 'false') }}"
    )
    # A job-level skip of a matrix job reports an unexpanded name, so the
    # required "shard N/4" checks would never report: the shard job must run.
    assert jobs["backend-shard"]["if"] == "${{ !cancelled() }}"

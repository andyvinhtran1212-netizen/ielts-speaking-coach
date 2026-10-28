"""Run the backend pytest suite as CI shards — every test exactly once.

PC-J14 / BL-14: one serial job took 9–15 minutes of pytest (16 minutes with
setup) against a 25-minute budget. `.github/workflows/backend-tests.yml` now
splits the suite by test FILE across a matrix and proves the split:

    python scripts/ci_pytest_shards.py collect --out ci-pytest/collected.json
    python scripts/ci_pytest_shards.py run --total 4 --index 1 --out ci-pytest -- -v --tb=short
    python scripts/ci_pytest_shards.py verify --dir ci-pytest

`collect` records pytest's own collection of the whole `tests/` tree. Each
`run` records the node ids it collected and the outcome of every one of them.
`verify` fails unless the shards' node ids are pairwise disjoint and their
union equals the full collection, and unless each shard reported an outcome
for every id it collected. The only tolerated difference is a parametrize id
built from uuid4()/now(), which changes between any two pytest processes; it
must still be the same test function, collected the same number of times.

Files are assigned by longest-processing-time first over the per-file seconds
in `ci_pytest_shard_weights.json` (measured from a serial CI run); a file with
no weight gets the median, so a new test file is still assigned to a shard.
The weights only affect balance. `verify` prints refreshed weights when they
need updating.

Whole files stay together, so module/session fixtures and in-file ordering
behave as in the serial run. No test is selected or deselected: each shard
passes its file paths to pytest, and those files run as they would serially.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

WEIGHTS_FILE = Path(__file__).with_name("ci_pytest_shard_weights.json")
TESTS_DIR = "tests"


def test_files(root: Path = Path(".")) -> list[str]:
    """Test modules under tests/, matched like pytest's default python_files."""
    found = set()
    for pattern in ("test_*.py", "*_test.py"):
        for path in (root / TESTS_DIR).rglob(pattern):
            if "__pycache__" not in path.parts:
                found.add(path.relative_to(root).as_posix())
    return sorted(found)


def partition(files: list[str], weights: dict[str, float], total: int) -> list[list[str]]:
    known = [weights[f] for f in files if f in weights]
    default = statistics.median(known) if known else 1.0
    load = [0.0] * total
    shards: list[list[str]] = [[] for _ in range(total)]
    for name in sorted(files, key=lambda f: (-weights.get(f, default), f)):
        target = min(range(total), key=lambda i: (load[i], i))
        shards[target].append(name)
        load[target] += weights.get(name, default)
    return [sorted(s) for s in shards]


class Recorder:
    """pytest plugin: collected node ids plus the final outcome of each."""

    def __init__(self, path: Path):
        self.path = path
        self.collected: list[str] = []
        self.results: dict[str, dict] = {}

    def pytest_collection_finish(self, session):
        self.collected = [item.nodeid for item in session.items]

    def pytest_runtest_logreport(self, report):
        entry = self.results.setdefault(report.nodeid, {"outcome": "passed", "duration": 0.0})
        entry["duration"] += report.duration
        if report.failed:
            entry["outcome"] = "failed" if report.when == "call" else "error"
        elif report.skipped and entry["outcome"] == "passed":
            entry["outcome"] = "xfailed" if hasattr(report, "wasxfail") else "skipped"

    def pytest_sessionfinish(self, session):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps({"collected": self.collected, "results": self.results}),
            encoding="utf-8",
        )


def _function_id(nodeid: str) -> str:
    return nodeid.split("[", 1)[0]


def _pytest(args: list[str], out: Path) -> int:
    import pytest

    return int(pytest.main(args, plugins=[Recorder(out)]))


def cmd_collect(ns) -> int:
    return _pytest(["--collect-only", "-qq", TESTS_DIR], Path(ns.out))


def cmd_run(ns) -> int:
    weights = json.loads(WEIGHTS_FILE.read_text(encoding="utf-8"))
    files = partition(test_files(), weights, ns.total)[ns.index - 1]
    print(f"shard {ns.index}/{ns.total}: {len(files)} test files")
    for name in files:
        print(f"  {name}")
    sys.stdout.flush()
    out = Path(ns.out) / f"shard-{ns.index}.json"
    return _pytest([*files, *ns.pytest_args], out)


def cmd_verify(ns) -> int:
    base = Path(ns.dir)
    expected = json.loads((base / "collected.json").read_text(encoding="utf-8"))["collected"]
    shard_paths = sorted(base.glob("shard-*.json"))
    problems: list[str] = []
    if ns.total and len(shard_paths) != ns.total:
        problems.append(f"expected {ns.total} shard reports, found {len(shard_paths)}")

    owner: dict[str, str] = {}
    outcomes: Counter = Counter()
    per_file: defaultdict[str, float] = defaultdict(float)
    for path in shard_paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        for nodeid in data["collected"]:
            if nodeid in owner:
                problems.append(f"{nodeid} collected by {owner[nodeid]} and {path.name}")
            owner[nodeid] = path.name
        unreported = set(data["collected"]) - set(data["results"])
        if unreported:
            problems.append(f"{path.name}: {len(unreported)} collected ids have no outcome, "
                            f"e.g. {sorted(unreported)[0]}")
        for nodeid, entry in data["results"].items():
            outcomes[entry["outcome"]] += 1
            per_file[nodeid.split("::", 1)[0]] += entry["duration"]

    if len(expected) != len(set(expected)):
        problems.append("full collection itself contains duplicate node ids")
    missing = set(expected) - set(owner)
    extra = set(owner) - set(expected)
    # A few tests parametrize with uuid4()/now(), so their ids differ between
    # ANY two pytest processes (serial runs included). Accept a mismatch only
    # as the same test function collected the same number of times.
    unstable = Counter(_function_id(n) for n in missing)
    if unstable == Counter(_function_id(n) for n in extra):
        missing = extra = set()
    for label, ids in (("never run by any shard", missing), ("not in full collection", extra)):
        if ids:
            problems.append(f"{len(ids)} ids {label}, e.g. {sorted(ids)[:3]}")

    lines = [
        f"full collection: {len(expected)} ids; shards: {len(shard_paths)}; "
        f"union: {len(owner)}; missing: {len(missing)}; extra: {len(extra)}",
        "per-process parametrize ids: "
        + (", ".join(f"{k} x{v}" for k, v in sorted(unstable.items())) or "none"),
        "outcomes: " + ", ".join(f"{k}={v}" for k, v in sorted(outcomes.items())),
    ]
    for path in shard_paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        seconds = sum(e["duration"] for e in data["results"].values())
        lines.append(f"{path.stem}: {len(data['collected'])} ids, {seconds:.0f}s in tests")
    print("\n".join(lines))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write("### Backend pytest shard parity\n\n" + "\n".join(f"- {l}" for l in lines) + "\n")
    if ns.weights_out:
        Path(ns.weights_out).write_text(
            json.dumps({k: round(v, 2) for k, v in sorted(per_file.items())}, indent=0) + "\n",
            encoding="utf-8",
        )
    for problem in problems:
        print(f"::error::{problem}")
    return 1 if problems else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("collect")
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_collect)
    p = sub.add_parser("run")
    p.add_argument("--total", type=int, required=True)
    p.add_argument("--index", type=int, required=True, help="1-based")
    p.add_argument("--out", required=True)
    p.add_argument("pytest_args", nargs="*")
    p.set_defaults(func=cmd_run)
    p = sub.add_parser("verify")
    p.add_argument("--dir", required=True)
    p.add_argument("--total", type=int, default=0)
    p.add_argument("--weights-out")
    p.set_defaults(func=cmd_verify)
    ns = parser.parse_args(argv)
    if ns.cmd == "run" and not 1 <= ns.index <= ns.total:
        parser.error("--index must be within 1..--total")
    return ns.func(ns)


if __name__ == "__main__":
    # `python scripts/ci_pytest_shards.py` puts scripts/ first on sys.path;
    # `python -m pytest` (the serial CI command) puts the cwd there instead.
    # Match the latter so imports resolve exactly as in the serial run.
    sys.path[0] = os.getcwd()
    sys.exit(main())

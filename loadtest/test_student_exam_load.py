"""Unit tests for the PC-J409 load test: production guard first.

Run: python -m pytest loadtest/test_student_exam_load.py
"""

import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import student_exam_load as lt  # noqa: E402


# ── Production guard ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("url", [
    "https://ielts-speaking-coach-staging.up.railway.app",
    "https://ielts-speaking-coach-staging.up.railway.app/api/quiz/sessions",
    "https://staging.averlearning.com/",
    "https://STAGING.averlearning.com.",
    "http://localhost:8000",
    "http://127.0.0.1:8000/health",
])
def test_allowlisted_hosts_pass(url):
    assert lt.check_url_allowed(url) in lt.ALLOWED_HOSTS


@pytest.mark.parametrize("url", [
    "https://www.averlearning.com",
    "https://averlearning.com/api/quiz/banks/x",
    "https://AVERLEARNING.COM",
    "https://api.averlearning.com",
    "https://ielts-speaking-coach-production.up.railway.app",
    "https://anything-production.up.railway.app",
    "https://new-subdomain.averlearning.com",
])
def test_production_hosts_refused_as_production(url):
    with pytest.raises(lt.ProdGuardError, match="PRODUCTION"):
        lt.check_url_allowed(url)


@pytest.mark.parametrize("url", [
    "https://example.com",
    "https://ielts-speaking-coach-staging.up.railway.app.evil.com",
    "https://staging.averlearning.com@www.averlearning.com",
    "https://user:pw@localhost",
    "ftp://localhost",
    "localhost:8000",
    "",
    "https://",
    "http://0.0.0.0:8000",
    "http://[::1]:8000",
])
def test_other_hosts_refused(url):
    with pytest.raises(lt.ProdGuardError):
        lt.check_url_allowed(url)


def test_env_scan_flags_prod_values_but_not_tokens():
    env = {
        "LOADTEST_ACCOUNTS_FILE": "/tmp/x",
        "LOADTEST_BASE": "https://www.averlearning.com",
        "LOADTEST_TOKEN_1": "production-looking-token-is-not-a-url",
        "OTHER": "https://averlearning.com",
    }
    assert lt.scan_env_for_prod(env) == ["LOADTEST_BASE"]


class _NoNetwork:
    """Fails the test if anything tries to build an HTTP client."""

    def __init__(self, *a, **k):
        raise AssertionError("network client created before the guard refused")


@pytest.mark.parametrize("base", [
    "https://www.averlearning.com",
    "https://averlearning.com",
    "https://ielts-speaking-coach-production.up.railway.app",
    "https://example.org",
])
def test_main_refuses_before_any_request(monkeypatch, capsys, base):
    monkeypatch.setattr(httpx, "AsyncClient", _NoNetwork)
    rc = lt.main(["--base-url", base, "--bank-id", "b"], environ={"LOADTEST_TOKEN_1": "SECRETTOK"})
    assert rc == 2
    err = capsys.readouterr().err
    assert "REFUSED" in err and "SECRETTOK" not in err


def test_main_refuses_prod_in_env_even_with_staging_base(monkeypatch):
    monkeypatch.setattr(httpx, "AsyncClient", _NoNetwork)
    rc = lt.main(["--base-url", "http://localhost:8000", "--bank-id", "b"],
                 environ={"LOADTEST_TOKEN_1": "t",
                          "LOADTEST_ACCOUNTS_FILE": "https://ielts-speaking-coach-production.up.railway.app"})
    assert rc == 2


def test_request_hook_refuses_absolute_prod_url():
    """A staging client still refuses a request aimed at a prod absolute URL."""
    sent = []

    def handler(request):
        sent.append(str(request.url))
        return httpx.Response(200, json={})

    async def go():
        client = lt.make_client("http://localhost:8000", 5)
        client._transport = httpx.MockTransport(handler)
        async with client:
            await client.get("/health")
            with pytest.raises(lt.ProdGuardError):
                await client.get("https://www.averlearning.com/health")

    asyncio.run(go())
    assert sent == ["http://localhost:8000/health"]


def test_redirects_are_not_followed():
    def handler(request):
        return httpx.Response(302, headers={"Location": "https://www.averlearning.com/"})

    async def go():
        client = lt.make_client("http://localhost:8000", 5)
        client._transport = httpx.MockTransport(handler)
        async with client:
            r = await client.get("/health")
            return r.status_code

    assert asyncio.run(go()) == 302


# ── Accounts, budget, helpers ────────────────────────────────────────────────

def test_load_accounts_file_and_env(tmp_path):
    f = tmp_path / "acc.txt"
    f.write_text("# comment\ntokA\n\n tokB \n")
    assert lt.load_accounts({"LOADTEST_ACCOUNTS_FILE": str(f)}) == ["tokA", "tokB"]
    j = tmp_path / "acc.json"
    j.write_text(json.dumps([{"token": "x"}, "y", {"nope": 1}]))
    assert lt.load_accounts({"LOADTEST_ACCOUNTS_FILE": str(j)}) == ["x", "y"]
    assert lt.load_accounts({"LOADTEST_TOKEN_1": "a", "LOADTEST_TOKEN_2": "b",
                             "LOADTEST_TOKEN_4": "skipped"}) == ["a", "b"]


def test_grading_budget_is_clamped():
    args = lt.build_parser().parse_args([
        "--base-url", "http://localhost:8000", "--bank-id", "b",
        "--max-speaking-grades", "500", "--max-writing-grades", "99"])
    lt.validate_args(args, {})
    assert args.max_speaking_grades == lt.MAX_SPEAKING_GRADES_CEILING == 20
    assert args.max_writing_grades == lt.MAX_WRITING_GRADES_CEILING == 10


def test_percentile_nearest_rank():
    assert lt.percentile([], 95) is None
    assert lt.percentile([5], 99) == 5
    vals = list(range(1, 101))
    assert lt.percentile(vals, 50) == 50
    assert lt.percentile(vals, 95) == 95
    assert lt.percentile(vals, 99) == 99


def test_parse_mix():
    assert lt.parse_mix("exam=2,speaking=1") == ["exam", "exam", "speaking"]
    with pytest.raises(ValueError):
        lt.parse_mix("bogus=1")


def test_step_broke():
    step = {"stop_reason": "deadline", "overall": {"error_rate": 0.06, "p95_ms": 100}}
    assert "error rate" in lt.step_broke(step, 0.05, 10000)
    step["overall"] = {"error_rate": 0.0, "p95_ms": 12000}
    assert "p95" in lt.step_broke(step, 0.05, 10000)
    step["overall"] = {"error_rate": 0.0, "p95_ms": 900}
    assert lt.step_broke(step, 0.05, 10000) is None


# ── Short end-to-end run against a mocked backend ────────────────────────────

def _fake_backend(calls):
    questions = [{"qid": f"q{i}", "item_key": f"k{i}", "skill": "grammar", "type": "mcq",
                  "options": ["a", "b", "c", "d"], "answer": 1} for i in range(12)]

    def handler(request):
        path = request.url.path
        auth = request.headers.get("authorization")
        if not path.startswith("/health"):
            calls.append((request.method, path, auth))
        if path == "/health/async-db":
            return httpx.Response(200, json={"event_loop_lag": {"lag_ms_p95": 3.0, "lag_ms_max": 9.0}})
        if path.startswith("/health"):
            return httpx.Response(200, json={"status": "ok", "version": "test"})
        if path == "/api/quiz/banks/B1":
            return httpx.Response(200, json={"bank": {"id": "B1"}, "questions": questions,
                                             "mastery": {"is_timed": False}})
        if path == "/api/quiz/sessions" and request.method == "POST":
            return httpx.Response(201, json={"session_id": "00000000-0000-0000-0000-000000000001",
                                             "resume": []})
        if path.endswith("/progress"):
            n = len(json.loads(request.content)["attempts"])
            return httpx.Response(200, json={"ok": True, "attempts": n, "word_stats": 0})
        return httpx.Response(200, json={"ok": True})

    return handler


def test_short_run_follows_frontend_order(monkeypatch, tmp_path):
    calls = []
    real = lt.make_client

    def mocked(base_url, timeout_s):
        client = real(base_url, timeout_s)
        client._transport = httpx.MockTransport(_fake_backend(calls))
        return client

    monkeypatch.setattr(lt, "make_client", mocked)
    rc = lt.main(["--base-url", "http://localhost:8000", "--bank-id", "B1", "--users", "2",
                  "--sessions-per-user", "2", "--ramp-seconds", "0", "--duration-seconds", "1.5",
                  "--answer-seconds", "0.1", "--beacon-seconds", "0.5", "--tail-seconds", "0",
                  "--health-interval", "0.2", "--async-db-interval", "0.5",
                  "--label", "unit", "--out-dir", str(tmp_path)],
                 environ={"LOADTEST_TOKEN_1": "secret-token-value"})
    assert rc == 0
    vu0 = [(m, p) for m, p, _ in calls]
    first = [p for _, p in vu0]
    assert first.index("/auth/me") < first.index("/api/quiz/banks/B1") < first.index("/api/quiz/sessions")
    assert any(p.endswith("/progress") for p in first)
    assert ("PATCH", "/api/quiz/sessions/00000000-0000-0000-0000-000000000001") in vu0
    assert all(a == "Bearer secret-token-value" for _, _, a in calls)

    outputs = sorted(tmp_path.iterdir())
    names = [p.name for p in outputs]
    assert any(n.startswith("unit-") and n.endswith(".md") for n in names)
    for p in outputs:
        assert "secret-token-value" not in p.read_text()
    report = json.loads(next(p for p in outputs if p.suffix == ".json"
                             and not p.name.endswith("-sessions.json")).read_text())
    step = report["steps"][0]
    assert step["overall"]["errors"] == 0
    assert "/health" in step["health"] and step["health"]["/health"]["count"] > 0
    assert step["sessions"] and step["sessions"][0]["account"] == "user#1"


def test_too_few_accounts_is_refused(monkeypatch):
    monkeypatch.setattr(httpx, "AsyncClient", _NoNetwork)
    with pytest.raises(SystemExit, match="sessions-per-user"):
        lt.main(["--base-url", "http://localhost:8000", "--bank-id", "B1", "--users", "3"],
                environ={"LOADTEST_TOKEN_1": "t"})


def test_abort_watch_trips_on_stalled_probes():
    """No probe ever returns: in-flight ages alone must trip the guard."""
    async def go():
        args = lt.build_parser().parse_args(["--base-url", "http://localhost:8000", "--bank-id", "b",
                                             "--abort-on-health-p95-ms", "500"])
        rec = lt.Recorder()
        ctx = lt.Ctx(args=args, rec=rec, deadline=lt.time.monotonic() + 30,
                     stop=asyncio.Event(), audio=b"", writing_targets={})
        old = lt.time.monotonic() - 2.0
        for k in range(6):
            rec.probe_inflight["/health"][k] = old
        await asyncio.wait_for(lt.abort_watch(ctx), timeout=5)
        return ctx.stop.is_set(), rec.notes

    stopped, notes = asyncio.run(go())
    assert stopped and notes and notes[0].startswith("ABORT")

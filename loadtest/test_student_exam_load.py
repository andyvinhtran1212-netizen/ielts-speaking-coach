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

_real_fetch_staging_runs = lt.fetch_staging_runs


@pytest.fixture(autouse=True)
def _staging_not_busy(monkeypatch):
    """Unit tests never call GitHub: the staging busy preflight sees no running
    workflow unless a test installs its own fetcher (see the PC-J448 tests)."""
    monkeypatch.setattr(lt, "fetch_staging_runs", lambda: [])


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


def _clip(tmp_path) -> str:
    """Graded Speaking runs need --audio-file; the mocked backend ignores its length."""
    clip = tmp_path / "clip.wav"
    clip.write_bytes(lt.make_wav(0.1))
    return str(clip)


def test_grading_budget_is_clamped(tmp_path):
    args = lt.build_parser().parse_args([
        "--base-url", "http://localhost:8000", "--bank-id", "b", "--audio-file", _clip(tmp_path),
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
        if path.endswith("/course-resume"):
            return httpx.Response(200, json={"stage": 0, "session_id": None, "answered": [],
                                             "completed": [], "item_id": request.url.params.get("class_item")})
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
    markdown = next(p for p in outputs if p.suffix == ".md").read_text()
    assert "Cost caps count HTTP calls" in markdown and "~4 Gemini calls" in markdown
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


# ── Speaking budget, quota 4xx, async-db probe failures (CR #2083 P2-1/P3) ──

def _speaking_backend(calls, sessions_status=201, async_db_status=200):
    counter = {"n": 0}

    def handler(request):
        path = request.url.path
        calls.append((request.method, path))
        if path == "/health/async-db":
            if async_db_status != 200:
                return httpx.Response(async_db_status, json={"detail": "down"})
            return httpx.Response(200, json={"event_loop_lag": {"lag_ms_p95": 3.0, "lag_ms_max": 9.0}})
        if path.startswith("/health"):
            return httpx.Response(200, json={"status": "ok"})
        if path == "/sessions" and request.method == "POST":
            if sessions_status != 201:
                return httpx.Response(sessions_status, json={"detail": "hết lượt"})
            counter["n"] += 1
            return httpx.Response(201, json={"session_id": f"s{counter['n']}"})
        if path.endswith("/questions/generate") or path.endswith("/questions"):
            return httpx.Response(200, json=[{"id": "q1"}])
        return httpx.Response(200, json={"ok": True})

    return handler


def _run_mocked(monkeypatch, tmp_path, handler, argv):
    real = lt.make_client

    def mocked(base_url, timeout_s):
        client = real(base_url, timeout_s)
        client._transport = httpx.MockTransport(handler)
        return client

    monkeypatch.setattr(lt, "make_client", mocked)
    rc = lt.main(["--base-url", "http://localhost:8000", "--ramp-seconds", "0",
                  "--beacon-seconds", "0.3", "--tail-seconds", "0", "--health-interval", "0.2",
                  "--async-db-interval", "0.2", "--label", "unit", "--out-dir", str(tmp_path),
                  *argv], environ={"LOADTEST_TOKEN_1": "t"})
    assert rc == 0
    return json.loads(next(p for p in tmp_path.iterdir() if p.suffix == ".json"
                           and not p.name.endswith("-sessions.json")).read_text())


def test_speaking_generate_spends_the_capped_budget(monkeypatch, tmp_path):
    """8 speaking students, budget 3: generate + uploads together stay <= 3."""
    calls = []
    report = _run_mocked(monkeypatch, tmp_path, _speaking_backend(calls), [
        "--mix", "speaking=1", "--users", "8", "--sessions-per-user", "8",
        "--duration-seconds", "1", "--max-speaking-grades", "3", "--audio-file", _clip(tmp_path)])
    generate = sum(1 for m, p in calls if p.endswith("/questions/generate"))
    uploads = sum(1 for m, p in calls if p.endswith("/responses"))
    assert generate + uploads <= 3
    assert generate >= 1
    assert report["real_grading_calls"]["speaking"] == generate + uploads
    assert report["generate_calls"] == generate
    # Students without budget only read the existing questions.
    assert sum(1 for m, p in calls if m == "GET" and p.endswith("/questions")) >= 8 - generate


def test_speaking_generate_never_called_without_budget(monkeypatch, tmp_path):
    calls = []
    _run_mocked(monkeypatch, tmp_path, _speaking_backend(calls), [
        "--mix", "speaking=1", "--users", "4", "--sessions-per-user", "4",
        "--duration-seconds", "0.5"])
    assert not any(p.endswith("/questions/generate") or p.endswith("/responses") for _, p in calls)


def test_speaking_ceiling_holds_across_ladder(monkeypatch, tmp_path):
    calls = []
    report = _run_mocked(monkeypatch, tmp_path, _speaking_backend(calls), [
        "--mix", "speaking=1", "--ladder", "15,15", "--sessions-per-user", "15",
        "--duration-seconds", "0.5", "--step-cooldown-seconds", "0", "--max-speaking-grades", "999",
        "--audio-file", _clip(tmp_path)])
    real = sum(1 for _, p in calls if p.endswith("/questions/generate") or p.endswith("/responses"))
    assert real <= lt.MAX_SPEAKING_GRADES_CEILING
    assert report["real_grading_calls"]["speaking"] == real


def test_session_quota_429_is_not_a_load_error(monkeypatch, tmp_path):
    calls = []
    report = _run_mocked(monkeypatch, tmp_path, _speaking_backend(calls, sessions_status=429), [
        "--mix", "speaking=1", "--users", "3", "--sessions-per-user", "3",
        "--duration-seconds", "0.3"])
    step = report["steps"][0]
    ep = step["endpoints"]["POST /sessions"]
    assert ep["quota_rejections"] == 3 and ep["errors"] == 0
    assert step["overall"]["quota_rejections"] == 3 and step["overall"]["errors"] == 0
    assert lt.step_broke(step, 0.05, 10000) is None


def test_failed_async_db_probe_is_recorded(monkeypatch, tmp_path):
    calls = []
    report = _run_mocked(monkeypatch, tmp_path, _speaking_backend(calls, async_db_status=503), [
        "--mix", "speaking=1", "--users", "1", "--duration-seconds", "0.6"])
    h = report["steps"][0]["health"]["/health/async-db"]
    assert h["count"] >= 1 and h["failures"] == h["count"]


def test_class_items_are_per_account(monkeypatch, tmp_path):
    """Each account plays its own assignment item (class_item query/body)."""
    seen = []
    base = _fake_backend([])

    def handler(request):
        if request.url.path.startswith("/api/quiz/banks/"):
            seen.append((request.headers["authorization"], request.url.params.get("class_item")))
        if request.url.path == "/api/quiz/sessions" and request.method == "POST":
            seen.append((request.headers["authorization"], json.loads(request.content).get("class_item")))
        return base(request)

    real = lt.make_client

    def mocked(base_url, timeout_s):
        client = real(base_url, timeout_s)
        client._transport = httpx.MockTransport(handler)
        return client

    monkeypatch.setattr(lt, "make_client", mocked)
    rc = lt.main(["--base-url", "http://localhost:8000", "--bank-id", "B1", "--users", "2",
                  "--class-items", "I1,I2", "--ramp-seconds", "0", "--duration-seconds", "0.5",
                  "--answer-seconds", "0.1", "--tail-seconds", "0", "--out-dir", str(tmp_path)],
                 environ={"LOADTEST_TOKEN_1": "tok-a", "LOADTEST_TOKEN_2": "tok-b"})
    assert rc == 0
    assert seen and set(seen) == {("Bearer tok-a", "I1"), ("Bearer tok-b", "I2")}
    report = json.loads(next(p for p in tmp_path.glob("*.json")
                             if not p.name.endswith("-sessions.json")).read_text())
    assert {s["class_item"] for s in report["steps"][0]["sessions"]} == {"I1", "I2"}
    assert report["steps"][0]["notes"] == []


def test_class_items_count_must_match_accounts(monkeypatch):
    monkeypatch.setattr(httpx, "AsyncClient", _NoNetwork)
    with pytest.raises(SystemExit, match="class-items"):
        lt.main(["--base-url", "http://localhost:8000", "--bank-id", "B1", "--users", "1",
                 "--class-items", "I1,I2"], environ={"LOADTEST_TOKEN_1": "t"})


def test_health_ready_is_not_probed_by_default(monkeypatch, tmp_path):
    """/health/ready runs sync DB calls on the event loop: off unless asked."""
    calls = []
    _run_mocked(monkeypatch, tmp_path, _speaking_backend(calls), [
        "--mix", "speaking=1", "--users", "1", "--duration-seconds", "0.5"])
    paths = {p for _, p in calls}
    assert "/health" in paths and "/health/ready" not in paths


def test_health_ready_probe_opt_in(monkeypatch, tmp_path):
    calls = []
    _run_mocked(monkeypatch, tmp_path, _speaking_backend(calls), [
        "--mix", "speaking=1", "--users", "1", "--duration-seconds", "0.5", "--ready-interval", "30"])
    assert any(p == "/health/ready" for _, p in calls)


# ── Codex #2083 @b6ead9faf: quiz lane, resume adoption, Writing lease ──────

def test_quiz_lane_filter_matches_course_runner():
    assert lt.is_course_quiz_question({"type": "mcq"})
    assert lt.is_course_quiz_question({})
    assert not lt.is_course_quiz_question({"type": "writing"})
    assert not lt.is_course_quiz_question({"type": "mcq", "counts_toward_mastery": False})


def test_adopt_resume_shapes():
    assert lt.adopt_resume(None, 30) == (0, None, set())
    assert lt.adopt_resume({"stage": 1, "session_id": "S", "answered": [{"qid": "q10"}, {}]}, 30) \
        == (1, "S", {"q10"})
    assert lt.adopt_resume({"stage": 5}, 30)[0] == 5       # completed → result state
    assert lt.adopt_resume({"stage": -1}, 30)[0] == 0


def _resume_backend(progress, opened, resume_body, extra_q=()):
    questions = [{"qid": f"q{i}", "item_key": f"k{i}", "type": "mcq",
                  "options": ["a", "b"], "answer": 0} for i in range(20)] + list(extra_q)

    def handler(request):
        path = request.url.path
        if path == "/health/async-db":
            return httpx.Response(200, json={"event_loop_lag": {}})
        if path.startswith("/health"):
            return httpx.Response(200, json={"status": "ok"})
        if path == "/api/quiz/banks/B1":
            return httpx.Response(200, json={"questions": questions, "mastery": {"is_timed": True}})
        if path == "/api/quiz/banks/B1/course-resume":
            return httpx.Response(200, json=resume_body)
        if path == "/api/quiz/sessions" and request.method == "POST":
            opened.append(1)
            return httpx.Response(201, json={"session_id": "NEW"})
        if path.endswith("/progress"):
            for att in json.loads(request.content)["attempts"]:
                progress.append((path.split("/")[-2], att["qid"]))
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(200, json={"ok": True})

    return handler


def _run_exam(monkeypatch, tmp_path, handler, seconds="0.7"):
    real = lt.make_client

    def mocked(base_url, timeout_s):
        client = real(base_url, timeout_s)
        client._transport = httpx.MockTransport(handler)
        return client

    monkeypatch.setattr(lt, "make_client", mocked)
    assert lt.main(["--base-url", "http://localhost:8000", "--bank-id", "B1", "--users", "1",
                    "--ramp-seconds", "0", "--duration-seconds", seconds, "--answer-seconds", "0.1",
                    "--tail-seconds", "0", "--out-dir", str(tmp_path)],
                   environ={"LOADTEST_TOKEN_1": "t"}) == 0


def test_exam_continues_server_stage_and_session(monkeypatch, tmp_path):
    """stage 1 + open session S1 with q10 answered → first answers are q11.. on S1."""
    progress, opened = [], []
    _run_exam(monkeypatch, tmp_path, _resume_backend(progress, opened, {
        "stage": 1, "session_id": "S1", "answered": [{"qid": "q10"}], "completed": [],
        "item_id": None}))
    assert progress and progress[0] == ("S1", "q11")
    assert all(qid != "q10" and int(qid[1:]) >= 10 for _, qid in progress)


def test_exam_skips_non_quiz_lane_questions(monkeypatch, tmp_path):
    progress, opened = [], []
    extra = [{"qid": "w1", "type": "writing"}, {"qid": "x1", "type": "mcq", "counts_toward_mastery": False}]
    _run_exam(monkeypatch, tmp_path, _resume_backend(
        progress, opened, {"stage": 0, "answered": [], "completed": []}, extra_q=extra), seconds="2.5")
    assert progress and not any(qid in {"w1", "x1"} for _, qid in progress)
    assert opened  # no open session in resume → a new one is opened


def test_writing_submit_claims_renderer_lease_first(monkeypatch, tmp_path):
    seen = []

    def handler(request):
        seen.append((request.method, request.url.path))
        if request.url.path.startswith("/health"):
            return httpx.Response(200, json={"event_loop_lag": {}})
        return httpx.Response(200, json=[] if request.method == "GET" else {"ok": True})

    targets = tmp_path / "targets.json"
    targets.write_text(json.dumps({"1": "A1"}))
    out = tmp_path / "out"
    _run_mocked(monkeypatch, out, handler, [
        "--mix", "writing=1", "--users", "1", "--duration-seconds", "0.3",
        "--max-writing-grades", "1", "--writing-targets-file", str(targets)])
    posts = [p for m, p in seen if m == "POST" and "/my-assignments/" in p]
    assert posts == ["/api/writing/my-assignments/A1/renderer-affinity",
                     "/api/writing/my-assignments/A1/submit"]


def test_writing_lease_failure_spends_no_budget(monkeypatch, tmp_path):
    seen = []

    def handler(request):
        seen.append((request.method, request.url.path))
        if request.url.path.endswith("/renderer-affinity"):
            return httpx.Response(409, json={"detail": "closed"})
        if request.url.path.startswith("/health"):
            return httpx.Response(200, json={"event_loop_lag": {}})
        return httpx.Response(200, json=[] if request.method == "GET" else {"ok": True})

    targets = tmp_path / "targets.json"
    targets.write_text(json.dumps({"1": "A1"}))
    report = _run_mocked(monkeypatch, tmp_path / "out", handler, [
        "--mix", "writing=1", "--users", "1", "--duration-seconds", "0.3",
        "--max-writing-grades", "1", "--writing-targets-file", str(targets)])
    assert not any(p.endswith("/submit") for _, p in seen)
    assert report["real_grading_calls"]["writing"] == 0


# ── Codex #2083 @19a3769ca: terminal resume, totals, identity, guards ──────

def _course_case(monkeypatch, tmp_path, states, *, n=20, sealed=False,
                 bank_item=None, argv=()):
    """Record the full HTTP contract against an in-memory course backend."""
    requests = []
    resume_calls = 0
    questions = [{"qid": f"q{i}", "item_key": f"k{i}", "type": "mcq",
                  "options": ["a", "b"], "answer": 0} for i in range(n)]

    def handler(request):
        nonlocal resume_calls
        path = request.url.path
        body = json.loads(request.content) if request.content else None
        requests.append((request.method, path, body))
        if path == "/api/quiz/banks/B1":
            return httpx.Response(200, json={"questions": questions, "mastery": {
                "item_id": bank_item, "answers_sealed": sealed, "is_timed": True}})
        if path.endswith("/course-resume"):
            state = states[min(resume_calls, len(states) - 1)]
            resume_calls += 1
            if isinstance(state, int):
                return httpx.Response(state, json={"detail": "resume unavailable"})
            return httpx.Response(200, json=state)
        if path == "/api/quiz/sessions" and request.method == "POST":
            return httpx.Response(201, json={"session_id": "NEW"})
        return httpx.Response(200, json={"ok": True})

    monkeypatch.setattr(lt, "_jitter", lambda *args: 0)
    report = _run_mocked(monkeypatch, tmp_path, handler, [
        "--bank-id", "B1", "--users", "1", "--duration-seconds", "1",
        "--abort-on-health-p95-ms", "0", *argv])
    return report, requests


@pytest.mark.parametrize("n,stage", [(10, 1), (20, 2), (11, 2), (20, 7)])
def test_completed_course_resume_never_writes_quiz_work(monkeypatch, tmp_path, n, stage):
    report, requests = _course_case(monkeypatch, tmp_path, [{
        "stage": stage, "session_id": None, "answered": [], "item_id": None}], n=n)
    writes = [(m, p) for m, p, _ in requests if p.startswith("/api/quiz/sessions")]
    assert writes == []
    assert report["steps"][0]["sessions"] == []
    assert report["steps"][0]["notes"] == []


@pytest.mark.parametrize("sealed", [False, True])
def test_resumed_session_totals_include_saved_answers(monkeypatch, tmp_path, sealed):
    saved = [{"qid": f"q{i}", "is_correct": None if sealed else i < 3} for i in range(5)]
    report, requests = _course_case(monkeypatch, tmp_path, [
        {"stage": 0, "session_id": "SAVED", "answered": saved, "item_id": None},
        {"stage": 1, "session_id": None, "answered": [], "item_id": None},
    ], n=10, sealed=sealed)
    assert not any(p == "/api/quiz/sessions" and m == "POST" for m, p, _ in requests)
    new = [row for _, p, b in requests if p.endswith("/progress") for row in b["attempts"]]
    assert [row["qid"] for row in new] == [f"q{i}" for i in range(5, 10)]
    patches = [(p, b) for m, p, b in requests if m == "PATCH"]
    assert len(patches) == 1 and patches[0][0] == "/api/quiz/sessions/SAVED"
    totals = patches[0][1]
    right = (0 if sealed else 3) + sum(row["is_correct"] is True for row in new)
    assert totals["total_questions"] == 10
    assert totals["total_correct"] == right
    assert totals["total_wrong"] == 10 - right
    assert report["steps"][0]["notes"] == []


def test_server_stage_jump_adopts_next_open_session(monkeypatch, tmp_path):
    """Canonical stage 2 wins over local stage 1 after finishing stage 0."""
    report, requests = _course_case(monkeypatch, tmp_path, [
        {"stage": 0, "session_id": None, "answered": [], "item_id": None},
        {"stage": 2, "session_id": "S2", "answered": [{"qid": "q20", "is_correct": True}],
         "item_id": None},
        {"stage": 3, "session_id": None, "answered": [], "item_id": None},
    ], n=30)
    progress = [(p, row["qid"]) for _, p, b in requests if p.endswith("/progress")
                for row in b["attempts"]]
    assert progress == ([('/api/quiz/sessions/NEW/progress', f"q{i}") for i in range(10)]
                        + [('/api/quiz/sessions/S2/progress', f"q{i}") for i in range(21, 30)])
    assert sum(m == "POST" and p == "/api/quiz/sessions" for m, p, _ in requests) == 1
    assert [(s["session_id"], s["resumed"]) for s in report["steps"][0]["sessions"]] \
        == [("NEW", False), ("S2", True)]
    assert report["steps"][0]["notes"] == []


@pytest.mark.parametrize("explicit_item", [False, True])
def test_adopted_session_is_reported_with_canonical_item(monkeypatch, tmp_path, explicit_item):
    report, requests = _course_case(monkeypatch, tmp_path, [
        {"stage": 1, "session_id": "S1", "answered": [], "item_id": "I1"},
        {"stage": 2, "session_id": None, "answered": [], "item_id": "I1"},
    ], bank_item="I1", argv=["--class-item", "I1"] if explicit_item else [])
    sessions = report["steps"][0]["sessions"]
    assert len(sessions) == 1
    assert sessions[0].items() >= {
        "session_id": "S1", "account": "user#1", "vu": 0, "bank_id": "B1",
        "class_item": "I1", "resumed": True}.items()
    assert not any(m == "POST" and p == "/api/quiz/sessions" for m, p, _ in requests)
    cleanup = json.loads(next(tmp_path.glob("*-sessions.json")).read_text())
    assert cleanup == sessions
    assert report["steps"][0]["notes"] == []


@pytest.mark.parametrize("mismatch_after_stage", [False, True])
def test_resume_item_mismatch_stops_before_more_quiz_writes(monkeypatch, tmp_path, mismatch_after_stage):
    states = [{"stage": 1, "session_id": "OTHER", "answered": [], "item_id": "I2"}]
    if mismatch_after_stage:
        states.insert(0, {"stage": 0, "session_id": "S0", "answered": [], "item_id": "I1"})
    report, requests = _course_case(monkeypatch, tmp_path, states, bank_item="I1",
                                     argv=["--class-item", "I1"])
    writes = [p for m, p, _ in requests if p.startswith("/api/quiz/sessions")]
    assert not any("OTHER" in p or p == "/api/quiz/sessions" for p in writes)
    assert len(writes) == (11 if mismatch_after_stage else 0)  # 10 progress + 1 PATCH
    assert any("item_id" in note for note in report["steps"][0]["notes"])


@pytest.mark.parametrize("failed_after_stage", [False, True])
def test_resume_failure_never_starts_another_attempt(monkeypatch, tmp_path, failed_after_stage):
    states = [503]
    if failed_after_stage:
        states.insert(0, {"stage": 0, "session_id": "S0", "answered": [], "item_id": None})
    report, requests = _course_case(monkeypatch, tmp_path, states)
    writes = [p for m, p, _ in requests if p.startswith("/api/quiz/sessions")]
    assert not any(p == "/api/quiz/sessions" for p in writes)
    assert len(writes) == (11 if failed_after_stage else 0)
    assert any("course-resume failed status=503" in note for note in report["steps"][0]["notes"])


@pytest.mark.parametrize("interval", ["0.2", "1", "29", "29.99", "-1", "nan", "inf"])
def test_ready_interval_refused_before_network(monkeypatch, interval):
    monkeypatch.setattr(httpx, "AsyncClient", _NoNetwork)
    with pytest.raises(SystemExit, match="--ready-interval must be 0 or >= 30"):
        lt.main(["--base-url", "http://localhost:8000", "--bank-id", "B1",
                 "--ready-interval", interval], environ={"LOADTEST_TOKEN_1": "t"})


@pytest.mark.parametrize("interval", ["0", "30", "30.5"])
def test_ready_interval_valid_boundaries(interval):
    args = lt.build_parser().parse_args([
        "--base-url", "http://localhost:8000", "--bank-id", "B1", "--ready-interval", interval])
    lt.validate_args(args, {})
    assert args.ready_interval == float(interval)


def test_speaking_grades_require_audio_file_before_network(monkeypatch, capsys):
    """The default 3 s WAV is below the 15 s Part 1 minimum, so a graded run
    without --audio-file would fail every upload for the wrong reason."""
    monkeypatch.setattr(httpx, "AsyncClient", _NoNetwork)
    with pytest.raises(SystemExit, match="--audio-file is required when --max-speaking-grades > 0") as exc:
        lt.main(["--base-url", "http://localhost:8000", "--mix", "speaking=1", "--users", "1",
                 "--max-speaking-grades", "3"], environ={"LOADTEST_TOKEN_1": "t"})
    assert exc.value.code != 0


@pytest.mark.parametrize("grades,audio", [("0", False), ("-1", False), ("3", True)])
def test_audio_file_rule_leaves_other_runs_alone(tmp_path, grades, audio):
    args = lt.build_parser().parse_args([
        "--base-url", "http://localhost:8000", "--mix", "speaking=1",
        "--max-speaking-grades", grades, *(["--audio-file", _clip(tmp_path)] if audio else [])])
    lt.validate_args(args, {})


def test_supabase_production_ref_is_refused_before_network(monkeypatch, capsys):
    monkeypatch.setattr(httpx, "AsyncClient", _NoNetwork)
    ref = "huwsmtubwulikhlmcirx"
    with pytest.raises(lt.ProdGuardError, match="PRODUCTION"):
        lt.check_url_allowed(f"https://{ref}.supabase.co")
    assert lt.scan_env_for_prod({"LOADTEST_SUPABASE_URL": f"https://{ref.upper()}.supabase.co"}) \
        == ["LOADTEST_SUPABASE_URL"]
    assert lt.scan_env_for_prod({"LOADTEST_PROJECT_REF": ref}) == ["LOADTEST_PROJECT_REF"]
    assert lt.main(["--base-url", "http://localhost:8000", "--bank-id", "B1"], environ={
        "LOADTEST_TOKEN_1": "t", "LOADTEST_SUPABASE_URL": f"https://{ref}.supabase.co"}) == 2
    assert "LOADTEST_SUPABASE_URL" in capsys.readouterr().err


# ── Codex #2083 @45863540e: interrupted stages and failed progress ────────

def _exam_context():
    args = lt.build_parser().parse_args([
        "--base-url", "http://localhost:8000", "--bank-id", "B1"])
    lt.validate_args(args, {})
    return lt.Ctx(args=args, rec=lt.Recorder(), deadline=lt.time.monotonic() + 60,
                  stop=asyncio.Event(), audio=b"", writing_targets={})


def _mock_exam_client(monkeypatch, handler):
    real = lt.make_client

    def mocked(base_url, timeout_s):
        client = real(base_url, timeout_s)
        client._transport = httpx.MockTransport(handler)
        return client

    monkeypatch.setattr(lt, "make_client", mocked)


@pytest.mark.parametrize("interruption", ["deadline", "abort"])
@pytest.mark.parametrize("answered_count", [0, 3, 5])
@pytest.mark.parametrize("timed", [False, True])
def test_interrupted_stage_stays_open_and_resumes_remaining_answers(
        monkeypatch, interruption, answered_count, timed):
    requests, saved, finalized = [], [], []
    opened = False
    questions = [{"qid": f"q{i}", "type": "mcq", "answer": 0} for i in range(10)]

    def handler(request):
        nonlocal opened
        path = request.url.path
        body = json.loads(request.content) if request.content else None
        requests.append((request.method, path, body))
        if path == "/api/quiz/banks/B1":
            return httpx.Response(200, json={"questions": questions,
                                             "mastery": {"is_timed": timed}})
        if path.endswith("/course-resume"):
            # Match the backend: ended sessions no longer expose open answers.
            return httpx.Response(200, json={
                "stage": 1 if finalized and len(saved) == 10 else 0,
                "session_id": "S0" if opened and not finalized else None,
                "answered": saved if opened and not finalized else [], "item_id": None})
        if path == "/api/quiz/sessions":
            opened = True
            return httpx.Response(201, json={"session_id": "S0"})
        if path.endswith("/progress"):
            saved.extend(body["attempts"])
        if request.method == "PATCH":
            finalized.append(body)
        return httpx.Response(200, json={"ok": True})

    _mock_exam_client(monkeypatch, handler)

    async def go():
        first = _exam_context()
        answered = 0

        async def think(ctx, seconds):
            nonlocal answered
            if ctx is first:
                if answered == answered_count:
                    if interruption == "deadline":
                        ctx.deadline = lt.time.monotonic() - 1
                    else:
                        ctx.stop.set()
                    return False
                answered += 1
            return True

        monkeypatch.setattr(lt, "_sleep_or_stop", think)
        await lt.exam_student(first, 0, 1, "t")
        assert [row["qid"] for row in saved] == [f"q{i}" for i in range(answered_count)]
        assert finalized == []
        assert first.rec.notes == []

        boundary = len(requests)
        second = _exam_context()
        await lt.exam_student(second, 0, 1, "t")
        later = requests[boundary:]
        assert not any(p == "/api/quiz/sessions" for _, p, _ in later)
        progress = [(p, row["qid"]) for _, p, b in later if p.endswith("/progress")
                    for row in b["attempts"]]
        assert progress == [("/api/quiz/sessions/S0/progress", f"q{i}")
                            for i in range(answered_count, 10)]
        assert [row["qid"] for row in saved] == [f"q{i}" for i in range(10)]
        assert len(finalized) == 1 and finalized[0]["total_questions"] == 10
        assert [(s["session_id"], s["resumed"]) for s in second.rec.sessions] == [("S0", True)]
        assert second.rec.notes == []

    asyncio.run(go())


@pytest.mark.parametrize("failure", ["503", "timeout"])
@pytest.mark.parametrize("flush", ["batch", "timed", "tail", "interrupted_tail"])
def test_failed_progress_stops_student_without_finalizing(monkeypatch, failure, flush):
    requests = []
    n = 3 if flush == "tail" else 20
    questions = [{"qid": f"q{i}", "type": "mcq", "answer": 0} for i in range(n)]

    def handler(request):
        path = request.url.path
        body = json.loads(request.content) if request.content else None
        requests.append((request.method, path, body))
        if path == "/api/quiz/banks/B1":
            return httpx.Response(200, json={"questions": questions,
                                             "mastery": {"is_timed": flush == "timed"}})
        if path.endswith("/course-resume"):
            return httpx.Response(200, json={"stage": 0, "session_id": "S0",
                                             "answered": [], "item_id": None})
        if path.endswith("/progress"):
            if failure == "timeout":
                raise httpx.ReadTimeout("progress timed out", request=request)
            return httpx.Response(503, json={"detail": "progress unavailable"})
        return httpx.Response(200, json={"ok": True})

    _mock_exam_client(monkeypatch, handler)
    answered = 0

    async def think(ctx, seconds):
        nonlocal answered
        if flush == "interrupted_tail" and answered == 3:
            ctx.stop.set()
            return False
        answered += 1
        return True

    monkeypatch.setattr(lt, "_sleep_or_stop", think)

    async def go():
        ctx = _exam_context()
        await lt.exam_student(ctx, 0, 1, "t")
        return ctx.rec

    rec = asyncio.run(go())
    assert not any(m == "PATCH" for m, _, _ in requests)
    progress = [b["attempts"] for _, p, b in requests if p.endswith("/progress")]
    count = {"batch": 5, "timed": 1, "tail": 3, "interrupted_tail": 3}[flush]
    assert len(progress) == 1
    assert [row["qid"] for row in progress[0]] == [f"q{i}" for i in range(count)]
    assert requests[-1][1] == "/api/quiz/sessions/S0/progress"
    stats = rec.by_endpoint["POST /api/quiz/sessions/{id}/progress"]
    assert stats.errors == 1 and stats.timeouts == (failure == "timeout")
    assert any("progress failed" in note for note in rec.notes)


@pytest.mark.parametrize("failure", [503, 409, 302, "timeout", "transport"])
@pytest.mark.parametrize("timed", [False, True])
def test_failed_finalization_never_opens_next_stage(monkeypatch, failure, timed):
    requests, saved, opened = [], [], []
    questions = [{"qid": f"q{i}", "type": "mcq", "answer": 0} for i in range(20)]

    def handler(request):
        path = request.url.path
        body = json.loads(request.content) if request.content else None
        requests.append((request.method, path, body))
        if path == "/api/quiz/banks/B1":
            return httpx.Response(200, json={"questions": questions,
                                             "mastery": {"is_timed": timed}})
        if path.endswith("/course-resume"):
            # A failed PATCH leaves S0 open at stage 0, even after all answers.
            return httpx.Response(200, json={
                "stage": 0, "session_id": "S0" if opened else None,
                "answered": saved, "item_id": None})
        if path == "/api/quiz/sessions":
            sid = f"S{len(opened)}"
            opened.append(sid)
            return httpx.Response(201, json={"session_id": sid})
        if path.endswith("/progress"):
            saved.extend(body["attempts"])
        if request.method == "PATCH":
            if failure == "timeout":
                raise httpx.ReadTimeout("finalization timed out", request=request)
            if failure == "transport":
                raise httpx.ConnectError("finalization unavailable", request=request)
            return httpx.Response(failure, json={"detail": "finalization unavailable"})
        return httpx.Response(200, json={"ok": True})

    _mock_exam_client(monkeypatch, handler)

    async def think(ctx, seconds):
        return True

    monkeypatch.setattr(lt, "_sleep_or_stop", think)

    async def go():
        ctx = _exam_context()
        await lt.exam_student(ctx, 0, 1, "t")
        return ctx.rec

    rec = asyncio.run(go())
    assert opened == ["S0"]  # In particular, S1 must never be opened.
    assert [row["qid"] for row in saved] == [f"q{i}" for i in range(10)]
    assert [(s["session_id"], s["resumed"]) for s in rec.sessions] == [("S0", False)]
    assert [(m, p) for m, p, _ in requests if m == "PATCH"] == [
        ("PATCH", "/api/quiz/sessions/S0")]
    assert requests[-1][:2] == ("PATCH", "/api/quiz/sessions/S0")
    assert sum(p.endswith("/course-resume") for _, p, _ in requests) == 1
    stats = rec.by_endpoint["PATCH /api/quiz/sessions/{id}"]
    status = {"timeout": "timeout", "transport": "ConnectError"}.get(failure, str(failure))
    assert stats.statuses == {status: 1}
    assert stats.errors == 1 and stats.timeouts == (failure == "timeout")
    assert any("finalization failed" in note for note in rec.notes)


@pytest.mark.parametrize("runtime_body", [
    {"git_sha": "redacted (admin only)", "deployment_id": "redacted (admin only)",
     "environment_name": "redacted (admin only)"},
    {"git_sha": "a" * 40},
    {},
])
def test_anonymous_identity_is_not_a_verified_sha(monkeypatch, tmp_path, runtime_body):
    inner = _fake_backend([])

    def handler(request):
        if request.url.path == "/health/runtime":
            assert "authorization" not in request.headers
            return httpx.Response(200, json=runtime_body)
        return inner(request)

    report = _run_mocked(monkeypatch, tmp_path, handler, [
        "--bank-id", "B1", "--users", "1", "--duration-seconds", "0.1"])
    identity = report["backend_identity"]
    assert identity["/health/runtime:git_sha"] == "unknown (anon)"
    assert identity["git_sha_verified"] is False
    assert "redacted (admin only)" not in json.dumps(identity)
    markdown = next(tmp_path.glob("*.md")).read_text()
    assert "unknown (anon)" in markdown
    assert "do not establish a deployment match" in markdown


# ── Staging exclusion: busy preflight + marker (PC-J433/J448) ────────────────

STAGING = "https://ielts-speaking-coach-staging.up.railway.app"
SMOKE_RUNNING = [{"workflow": "staging-release-smoke.yml", "status": "in_progress",
                  "databaseId": 41064757555, "createdAt": "2026-10-30T13:39:00Z"}]
SMOKE_DONE = [{**SMOKE_RUNNING[0], "status": "completed"}]


def _busy_argv(tmp_path, *extra, base=STAGING):
    return ["--base-url", base, "--bank-id", "B1", "--users", "1", "--ramp-seconds", "0",
            "--duration-seconds", "0.3", "--answer-seconds", "0.1", "--beacon-seconds", "5",
            "--tail-seconds", "0", "--health-interval", "0.2", "--async-db-interval", "0.2",
            "--step-cooldown-seconds", "0", "--busy-poll-seconds", "0.05",
            "--label", "busy", "--out-dir", str(tmp_path), *extra]


def _mock_all_requests(monkeypatch, requests):
    """Every request (probes and identity reads included) lands in ``requests``."""
    real, inner = lt.make_client, _fake_backend([])

    def handler(request):
        requests.append((request.method, request.url.path))
        return inner(request)

    def mocked(base_url, timeout_s):
        client = real(base_url, timeout_s)
        client._transport = httpx.MockTransport(handler)
        return client

    monkeypatch.setattr(lt, "make_client", mocked)


def _report(tmp_path):
    jpath = next(p for p in tmp_path.iterdir() if p.suffix == ".json"
                 and not p.name.endswith("-sessions.json"))
    return json.loads(jpath.read_text()), jpath.with_suffix(".md").read_text()


@pytest.mark.parametrize("status,busy", [
    ("queued", True), ("in_progress", True), ("waiting", True), ("requested", True),
    ("pending", True), ("completed", False),
])
def test_staging_busy_statuses(status, busy):
    runs = [{**SMOKE_RUNNING[0], "status": status}]
    expected = "staging busy: staging-release-smoke.yml run 41064757555" if busy else None
    assert lt.staging_busy(runs) == expected
    assert lt.staging_busy([]) is None


def test_staging_workflows_are_real_files():
    wf_dir = Path(__file__).resolve().parent.parent / ".github" / "workflows"
    for name in lt.STAGING_WORKFLOWS:
        assert (wf_dir / name).is_file(), name


def test_fetch_reads_github_actions_read_only():
    seen = []

    class Done:
        returncode = 0
        stdout = json.dumps([{"status": "in_progress", "databaseId": 7, "createdAt": "t"}])

    def runner(cmd, **kw):
        seen.append(cmd)
        assert kw["timeout"] == lt.GH_TIMEOUT_SECONDS
        return Done()

    runs = _real_fetch_staging_runs(("staging-release-smoke.yml", "offsite-backup.yml"), runner=runner)
    assert [c[:5] for c in seen] == [["gh", "run", "list", "--workflow", "staging-release-smoke.yml"],
                                     ["gh", "run", "list", "--workflow", "offsite-backup.yml"]]
    assert all("--json" in c and "status,databaseId,createdAt" in c for c in seen)
    assert [r["workflow"] for r in runs] == ["staging-release-smoke.yml", "offsite-backup.yml"]


@pytest.mark.parametrize("failure", ["missing", "timeout", "exit", "not_json", "shape", "no_status"])
def test_fetch_fails_closed(failure):
    class Proc:
        returncode = 0
        stdout = "[]"

    def runner(cmd, **kw):
        if failure == "missing":
            raise FileNotFoundError("gh")
        if failure == "timeout":
            raise lt.subprocess.TimeoutExpired(cmd, 30)
        proc = Proc()
        proc.returncode = 4 if failure == "exit" else 0
        proc.stdout = {"exit": "", "not_json": "gh: auth required", "shape": '{"runs": []}',
                       "no_status": '[{"databaseId": 1}]'}[failure]
        return proc

    with pytest.raises(lt.BusyCheckError):
        _real_fetch_staging_runs(runner=runner)


def test_a_smoke_running_before_step_one_sends_no_request(monkeypatch, tmp_path, capsys):
    """(a) No HTTP client is ever built; the report names the busy run."""
    monkeypatch.setattr(httpx, "AsyncClient", _NoNetwork)
    reads = []
    monkeypatch.setattr(lt, "fetch_staging_runs", lambda: reads.append(1) or SMOKE_RUNNING)
    rc = lt.main(_busy_argv(tmp_path, "--busy-wait-seconds", "0.2"),
                 environ={"LOADTEST_TOKEN_1": "SECRETTOK"})
    assert rc == lt.EXIT_STAGING_BUSY == 4
    assert len(reads) >= 2   # it polled while waiting, then gave up
    report, markdown = _report(tmp_path)
    assert report["steps"] == [] and report["backend_identity"] == {}
    assert report["busy_stop"] == {"kind": "staging_busy", "users": 1, "steps_not_run": [1],
                                   "reason": "staging busy: staging-release-smoke.yml run 41064757555"}
    assert "staging busy: staging-release-smoke.yml run 41064757555" in markdown
    assert "SECRETTOK" not in capsys.readouterr().err


def test_waits_until_smoke_finishes_then_runs(monkeypatch, tmp_path):
    requests, reads = [], []
    _mock_all_requests(monkeypatch, requests)

    def fetch():
        reads.append(len(requests))
        return SMOKE_RUNNING if len(reads) < 3 else SMOKE_DONE

    monkeypatch.setattr(lt, "fetch_staging_runs", fetch)
    assert lt.main(_busy_argv(tmp_path, "--busy-wait-seconds", "30"),
                   environ={"LOADTEST_TOKEN_1": "t"}) == 0
    assert reads == [0, 0, 0]   # nothing was sent while the smoke ran
    report, _ = _report(tmp_path)
    assert report["busy_stop"] is None and len(report["steps"]) == 1
    assert report["busy_check"].startswith("github-actions: staging-release-smoke.yml")
    assert requests


def test_b_smoke_starting_between_steps_skips_step_two(monkeypatch, tmp_path):
    """(b) Step 1 runs; the smoke starts during the cooldown; step 2 never runs."""
    requests, reads = [], []
    _mock_all_requests(monkeypatch, requests)

    def fetch():
        reads.append(len(requests))
        return [] if len(reads) == 1 else SMOKE_RUNNING

    monkeypatch.setattr(lt, "fetch_staging_runs", fetch)
    rc = lt.main(_busy_argv(tmp_path, "--ladder", "1,1", "--busy-wait-seconds", "0"),
                 environ={"LOADTEST_TOKEN_1": "t"})
    assert rc == lt.EXIT_STAGING_BUSY
    assert len(reads) == 2 and reads[0] == 0
    assert len(requests) == reads[1]   # no request after the second check
    report, markdown = _report(tmp_path)
    assert [s["users"] for s in report["steps"]] == [1]
    assert report["busy_stop"]["users"] == 1 and report["busy_stop"]["steps_not_run"] == [1]
    assert "Not run: steps [1] users (staging busy" in markdown


def test_c_unreadable_status_refuses_to_run(monkeypatch, tmp_path):
    """(c) Fail closed: no client, exit 5, reason in the report."""
    monkeypatch.setattr(httpx, "AsyncClient", _NoNetwork)

    def fetch():
        raise lt.BusyCheckError("gh run list --workflow staging-release-smoke.yml: exit 4")

    monkeypatch.setattr(lt, "fetch_staging_runs", fetch)
    rc = lt.main(_busy_argv(tmp_path), environ={"LOADTEST_TOKEN_1": "t"})
    assert rc == lt.EXIT_BUSY_CHECK_REFUSED == 5
    report, _ = _report(tmp_path)
    assert report["steps"] == []
    assert report["busy_stop"]["kind"] == "busy_check_failed"
    assert "exit 4" in report["busy_stop"]["reason"]


def test_c_unreadable_status_before_step_two_keeps_step_one(monkeypatch, tmp_path):
    requests, reads = [], []
    _mock_all_requests(monkeypatch, requests)

    def fetch():
        reads.append(len(requests))
        if len(reads) > 1:
            raise lt.BusyCheckError("gh run list --workflow staging-release-smoke.yml: TimeoutExpired")
        return []

    monkeypatch.setattr(lt, "fetch_staging_runs", fetch)
    rc = lt.main(_busy_argv(tmp_path, "--ladder", "1,1"), environ={"LOADTEST_TOKEN_1": "t"})
    assert rc == lt.EXIT_BUSY_CHECK_REFUSED
    assert len(requests) == reads[1]
    report, _ = _report(tmp_path)
    assert len(report["steps"]) == 1 and report["busy_stop"]["kind"] == "busy_check_failed"


def test_d_skip_busy_check_runs_and_is_recorded(monkeypatch, tmp_path):
    requests = []
    _mock_all_requests(monkeypatch, requests)

    def fetch():
        raise AssertionError("GitHub read despite --skip-busy-check")

    monkeypatch.setattr(lt, "fetch_staging_runs", fetch)
    assert lt.main(_busy_argv(tmp_path, "--skip-busy-check"),
                   environ={"LOADTEST_TOKEN_1": "t"}) == 0
    report, markdown = _report(tmp_path)
    assert report["busy_check"] == "skipped by operator"
    assert "busy_check: skipped by operator" in markdown
    assert len(report["steps"]) == 1 and requests


def test_e_marker_exists_during_run_and_is_removed(monkeypatch, tmp_path):
    marker = tmp_path / "LOADTEST_ACTIVE"
    out = tmp_path / "out"
    seen = []
    real, inner = lt.make_client, _fake_backend([])

    def handler(request):
        seen.append(json.loads(marker.read_text()))
        return inner(request)

    def mocked(base_url, timeout_s):
        client = real(base_url, timeout_s)
        client._transport = httpx.MockTransport(handler)
        return client

    monkeypatch.setattr(lt, "make_client", mocked)
    assert lt.main(_busy_argv(out, "--busy-marker", str(marker)),
                   environ={"LOADTEST_TOKEN_1": "t"}) == 0
    assert seen and all(m["pid"] == lt.os.getpid() and m["label"] == "busy" for m in seen)
    assert {m["current_step"] for m in seen} == {1}
    assert seen[0]["started_at"] and seen[0]["base_url"] == STAGING
    assert not marker.exists()
    assert [p.name for p in tmp_path.iterdir()] == ["out"]   # no temp file left


@pytest.mark.parametrize("failure", [KeyboardInterrupt, RuntimeError, lt.ProdGuardError, "busy"])
def test_e_marker_removed_on_abort(monkeypatch, tmp_path, failure):
    marker = tmp_path / "LOADTEST_ACTIVE"
    monkeypatch.setattr(httpx, "AsyncClient", _NoNetwork)
    if failure == "busy":
        monkeypatch.setattr(lt, "fetch_staging_runs", lambda: SMOKE_RUNNING)
        assert lt.main(_busy_argv(tmp_path / "out", "--busy-marker", str(marker),
                                  "--busy-wait-seconds", "0"),
                       environ={"LOADTEST_TOKEN_1": "t"}) == lt.EXIT_STAGING_BUSY
        assert not marker.exists()
        return

    async def interrupted(args, tokens):
        assert json.loads(marker.read_text())["current_step"] == "preflight"
        raise failure("stop")

    monkeypatch.setattr(lt, "amain", interrupted)
    argv = _busy_argv(tmp_path / "out", "--busy-marker", str(marker))
    if failure is lt.ProdGuardError:
        assert lt.main(argv, environ={"LOADTEST_TOKEN_1": "t"}) == 2
    else:
        with pytest.raises(failure):
            lt.main(argv, environ={"LOADTEST_TOKEN_1": "t"})
    assert not marker.exists()


def test_e_existing_marker_refuses_and_is_kept(monkeypatch, tmp_path):
    marker = tmp_path / "LOADTEST_ACTIVE"
    marker.write_text('{"pid": 1}')
    monkeypatch.setattr(httpx, "AsyncClient", _NoNetwork)
    rc = lt.main(_busy_argv(tmp_path / "out", "--busy-marker", str(marker)),
                 environ={"LOADTEST_TOKEN_1": "t"})
    assert rc == lt.EXIT_BUSY_CHECK_REFUSED
    assert marker.read_text() == '{"pid": 1}'


@pytest.mark.parametrize("flag,value", [("--busy-wait-seconds", "-1"), ("--busy-wait-seconds", "nan"),
                                        ("--busy-poll-seconds", "0"), ("--busy-poll-seconds", "inf")])
def test_busy_wait_args_refused_before_network(monkeypatch, tmp_path, flag, value):
    monkeypatch.setattr(httpx, "AsyncClient", _NoNetwork)
    with pytest.raises(SystemExit, match=flag):
        lt.main(_busy_argv(tmp_path, flag, value), environ={"LOADTEST_TOKEN_1": "t"})

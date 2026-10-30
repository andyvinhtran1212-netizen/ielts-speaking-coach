#!/usr/bin/env python3
"""Staging-only load test: N students open the same exam bank at once.

PC-J409. Reproduces the prod incident of 2026-10-30 18:10 (12 learners opened
a 300-question Course FINAL and every endpoint stalled 10-40 s) against
STAGING, so a before/after comparison can back the hotfix promotion.

Each virtual student follows the course-runner call order
(``frontend/public/js/course-runner.js`` + ``course-behavior.tsx``):

    GET  /auth/me
    POST /api/analytics/events                 (page_view beacon)
    GET  /api/quiz/banks/{bank}[?class_item=]  (runner.load)
    GET  /api/quiz/banks/{bank}/course-resume  (adoptServerState, course banks)
    POST /api/quiz/sessions                    (_openSession)
    loop: answer with think time + jitter
          POST /api/quiz/sessions/{id}/progress  (every answer on timed banks,
                                                  else every BATCH=5 answers)
          POST /api/analytics/events             (periodic beacon)
    PATCH /api/quiz/sessions/{id}              (finishStage, every STAGE=10)
          then course-resume + a new session for the next stage

A probe task polls /health and /health/ready every second and
/health/async-db (event-loop lag) every few seconds for the whole run.

Optional flows for the capacity ladder (``--mix``): ``speaking`` (create a
session, generate questions, upload a small fixed audio clip while the
grading budget lasts) and ``writing`` (list assignments/essays, submit while
the grading budget lasts). Real grading calls are capped in code at 20
Speaking and 10 Writing per process, whatever the CLI asks for.

HARD GUARD: every URL is checked against a staging/local allowlist before the
first request and again on every request (httpx event hook, redirects off).
Production hosts are refused explicitly; anything not allowlisted is refused.

Tokens come from ``LOADTEST_ACCOUNTS_FILE`` (one access token per line, or a
JSON list of strings / ``{"token": ...}`` objects) or ``LOADTEST_TOKEN_1..n``.
Tokens are never printed; logs and reports name accounts ``user#k``.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import math
import os
import random
import struct
import sys
import time
import uuid
import wave
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

# ── Production guard ─────────────────────────────────────────────────────────

ALLOWED_HOSTS = frozenset({
    "ielts-speaking-coach-staging.up.railway.app",
    "staging.averlearning.com",
    "localhost",
    "127.0.0.1",
})

# Refused by name so the error says "production", not just "not allowlisted".
PROD_HOSTS = frozenset({
    "averlearning.com",
    "www.averlearning.com",
    "api.averlearning.com",
    "ielts-speaking-coach-production.up.railway.app",
})

# Per-process ceilings from the 2026-10-30 addendum. CLI values above these
# are clamped, never honoured.
MAX_SPEAKING_GRADES_CEILING = 20
MAX_WRITING_GRADES_CEILING = 10

STAGE = 10   # course-runner.js STAGE
BATCH = 5    # course-runner.js BATCH


class ProdGuardError(RuntimeError):
    """Raised before any request when a URL is not a staging/local target."""


def check_url_allowed(url: str) -> str:
    """Return the lower-cased host when ``url`` is a staging/local target.

    Raises ProdGuardError for production hosts, unknown hosts, userinfo
    tricks (``https://staging.averlearning.com@evil``), and non-http schemes.
    """
    if not isinstance(url, str) or not url.strip():
        raise ProdGuardError("empty URL")
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https"):
        raise ProdGuardError(f"refused scheme {parts.scheme!r} (http/https only)")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise ProdGuardError("refused URL with userinfo")
    try:
        host = (parts.hostname or "").rstrip(".").lower()
    except ValueError as exc:
        raise ProdGuardError(f"unparseable host: {exc}") from exc
    if not host:
        raise ProdGuardError("URL has no host")
    if host in PROD_HOSTS or "production" in host or (
            host.endswith(".averlearning.com") and host not in ALLOWED_HOSTS):
        raise ProdGuardError(f"refused PRODUCTION host {host!r}")
    if host not in ALLOWED_HOSTS:
        raise ProdGuardError(f"refused host {host!r}: not in staging allowlist {sorted(ALLOWED_HOSTS)}")
    return host


def scan_env_for_prod(environ: dict[str, str]) -> list[str]:
    """Names of LOADTEST_* variables whose value mentions a production host."""
    hits = []
    for name, value in environ.items():
        if not name.startswith("LOADTEST_") or name.startswith("LOADTEST_TOKEN"):
            continue
        low = (value or "").lower()
        if any(h in low for h in PROD_HOSTS) or "production" in low:
            hits.append(name)
    return sorted(hits)


# ── Accounts ─────────────────────────────────────────────────────────────────

def load_accounts(environ: dict[str, str]) -> list[str]:
    """Access tokens from LOADTEST_ACCOUNTS_FILE or LOADTEST_TOKEN_1..n."""
    path = environ.get("LOADTEST_ACCOUNTS_FILE")
    tokens: list[str] = []
    if path:
        raw = Path(path).read_text(encoding="utf-8").strip()
        if raw.startswith("["):
            for entry in json.loads(raw):
                tok = entry.get("token") if isinstance(entry, dict) else entry
                if isinstance(tok, str) and tok.strip():
                    tokens.append(tok.strip())
        else:
            tokens = [ln.strip() for ln in raw.splitlines()
                      if ln.strip() and not ln.lstrip().startswith("#")]
    else:
        k = 1
        while environ.get(f"LOADTEST_TOKEN_{k}"):
            tokens.append(environ[f"LOADTEST_TOKEN_{k}"].strip())
            k += 1
    return tokens


# ── Metrics ──────────────────────────────────────────────────────────────────

def percentile(values: list[float], pct: float) -> float | None:
    """Nearest-rank percentile; None for an empty list."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(pct / 100.0 * len(ordered)))
    return ordered[min(rank, len(ordered)) - 1]


@dataclass
class EndpointStats:
    latencies_ms: list[float] = field(default_factory=list)
    statuses: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    errors: int = 0
    timeouts: int = 0

    def summary(self) -> dict:
        n = sum(self.statuses.values())
        return {
            "count": n,
            "p50_ms": _r(percentile(self.latencies_ms, 50)),
            "p95_ms": _r(percentile(self.latencies_ms, 95)),
            "p99_ms": _r(percentile(self.latencies_ms, 99)),
            "max_ms": _r(max(self.latencies_ms) if self.latencies_ms else None),
            "errors": self.errors,
            "timeouts": self.timeouts,
            "error_rate": round(self.errors / n, 4) if n else None,
            "statuses": dict(sorted(self.statuses.items())),
        }


def _r(v: float | None) -> float | None:
    return None if v is None else round(v, 1)


class Recorder:
    def __init__(self) -> None:
        self.started = time.monotonic()
        self.by_endpoint: dict[str, EndpointStats] = defaultdict(EndpointStats)
        self.health: list[dict] = []
        self.async_db: list[dict] = []
        self.sessions: list[dict] = []
        self.notes: list[str] = []
        self.grades = {"speaking": 0, "writing": 0}
        # probe path -> {probe key: monotonic start} for probes still waiting
        self.probe_inflight: dict[str, dict[int, float]] = defaultdict(dict)

    def t(self) -> float:
        return round(time.monotonic() - self.started, 3)

    def add(self, endpoint: str, ms: float, status: str, ok: bool, timeout: bool) -> None:
        st = self.by_endpoint[endpoint]
        st.latencies_ms.append(ms)
        st.statuses[status] += 1
        if not ok:
            st.errors += 1
        if timeout:
            st.timeouts += 1

    def overall(self) -> dict:
        lat: list[float] = []
        n = errors = timeouts = 0
        for st in self.by_endpoint.values():
            lat.extend(st.latencies_ms)
            n += sum(st.statuses.values())
            errors += st.errors
            timeouts += st.timeouts
        return {
            "count": n,
            "p50_ms": _r(percentile(lat, 50)),
            "p95_ms": _r(percentile(lat, 95)),
            "p99_ms": _r(percentile(lat, 99)),
            "max_ms": _r(max(lat) if lat else None),
            "errors": errors,
            "timeouts": timeouts,
            "error_rate": round(errors / n, 4) if n else None,
        }

    def health_summary(self) -> dict:
        out = {}
        for path in sorted({h["path"] for h in self.health}):
            rows = [h for h in self.health if h["path"] == path]
            lat = [h["ms"] for h in rows]
            out[path] = {
                "count": len(rows),
                "p50_ms": _r(percentile(lat, 50)),
                "p95_ms": _r(percentile(lat, 95)),
                "max_ms": _r(max(lat) if lat else None),
                "failures": sum(1 for h in rows if not h["ok"]),
            }
        lag95 = [a["lag_p95_ms"] for a in self.async_db if a.get("lag_p95_ms") is not None]
        lagmax = [a["lag_max_ms"] for a in self.async_db if a.get("lag_max_ms") is not None]
        out["event_loop_lag"] = {
            "samples": len(self.async_db),
            "max_of_lag_p95_ms": _r(max(lag95) if lag95 else None),
            "max_of_lag_max_ms": _r(max(lagmax) if lagmax else None),
        }
        return out


# ── HTTP ─────────────────────────────────────────────────────────────────────

def _guard_hook(request) -> None:  # httpx event hook (sync form is accepted)
    check_url_allowed(str(request.url))


async def _guard_hook_async(request) -> None:
    _guard_hook(request)


def make_client(base_url: str, timeout_s: float):
    import httpx
    return httpx.AsyncClient(
        base_url=base_url,
        timeout=httpx.Timeout(timeout_s, connect=min(timeout_s, 15.0)),
        follow_redirects=False,
        headers={"User-Agent": "aver-loadtest/pc-j409"},
        event_hooks={"request": [_guard_hook_async]},
    )


async def call(rec: Recorder, client, method: str, path: str, endpoint: str,
               token: str | None = None, **kw):
    """One timed request. Returns (status_code|None, json|None)."""
    import httpx
    headers = dict(kw.pop("headers", {}) or {})
    if token:
        headers["Authorization"] = f"Bearer {token}"
    t0 = time.monotonic()
    try:
        resp = await client.request(method, path, headers=headers, **kw)
    except ProdGuardError:
        raise
    except httpx.TimeoutException:
        rec.add(endpoint, (time.monotonic() - t0) * 1000, "timeout", False, True)
        return None, None
    except httpx.HTTPError as exc:
        rec.add(endpoint, (time.monotonic() - t0) * 1000, type(exc).__name__, False, False)
        return None, None
    ms = (time.monotonic() - t0) * 1000
    ok = 200 <= resp.status_code < 300
    rec.add(endpoint, ms, str(resp.status_code), ok, False)
    try:
        body = resp.json()
    except ValueError:
        body = None
    return resp.status_code, body


# ── Virtual students ─────────────────────────────────────────────────────────

@dataclass
class Ctx:
    args: argparse.Namespace
    rec: Recorder
    deadline: float
    stop: asyncio.Event
    audio: bytes
    writing_targets: dict[int, str]


def _jitter(base: float, rnd: random.Random) -> float:
    return max(0.05, base * rnd.uniform(0.5, 1.5))


async def _sleep_or_stop(ctx: Ctx, seconds: float) -> bool:
    """Sleep; return False when the run is over (deadline or abort)."""
    remaining = ctx.deadline - time.monotonic()
    if remaining <= 0 or ctx.stop.is_set():
        return False
    try:
        await asyncio.wait_for(ctx.stop.wait(), timeout=min(seconds, remaining))
        return False
    except asyncio.TimeoutError:
        return time.monotonic() < ctx.deadline


async def beacon(ctx: Ctx, client, token: str, path: str, ui: str) -> None:
    await call(ctx.rec, client, "POST", "/api/analytics/events", "POST /api/analytics/events",
               token=token, json={
                   "event_name": "page_view",
                   "event_data": {"path": path, "referrer": "", "vw": 1280,
                                  "implementation": "next", "release": None,
                                  "loadtest_label": ctx.args.label, "loadtest_vu": ui},
               })


def _attempt_row(q: dict, rnd: random.Random, sealed: bool, shown_ms: int) -> dict:
    options = q.get("options") or q.get("choices") or []
    n_opts = len(options) if isinstance(options, list) and options else 4
    answer = q.get("answer")
    if not sealed and isinstance(answer, int) and rnd.random() < 0.7:
        picked = answer
    else:
        picked = rnd.randrange(n_opts)
    is_correct = False if sealed else (isinstance(answer, int) and picked == answer)
    return {
        "client_id": str(uuid.uuid4()),
        "item_key": q.get("item_key") or q.get("qid"),
        "qid": q.get("qid"), "skill": q.get("skill"), "type": q.get("type"),
        "subtype": q.get("subtype"),
        "is_correct": is_correct, "answer_given": str(picked),
        "response_time_ms": shown_ms, "attempt_no": 1,
    }


async def exam_student(ctx: Ctx, vu: int, account: int, token: str) -> None:
    a, rec = ctx.args, ctx.rec
    rnd = random.Random(a.seed * 1000 + vu)
    ui = f"user#{account}/vu{vu}"
    item_q = {"class_item": a.class_item} if a.class_item else {}
    async with make_client(a.base_url, a.request_timeout) as c:
        await call(rec, c, "GET", "/auth/me", "GET /auth/me", token=token)
        await beacon(ctx, c, token, "/course-exercises", ui)
        st, bank = await call(rec, c, "GET", f"/api/quiz/banks/{a.bank_id}",
                              "GET /api/quiz/banks/{id}", token=token, params=item_q)
        if st != 200 or not isinstance(bank, dict):
            rec.notes.append(f"{ui}: bank load failed status={st}")
            return
        questions = [q for q in bank.get("questions") or [] if isinstance(q, dict)]
        mastery = bank.get("mastery") or {}
        timed = bool(mastery.get("is_timed"))
        sealed = bool(mastery.get("answers_sealed"))
        await call(rec, c, "GET", f"/api/quiz/banks/{a.bank_id}/course-resume",
                   "GET /api/quiz/banks/{id}/course-resume", token=token, params=item_q)
        stage = 0
        last_beacon = time.monotonic()
        while time.monotonic() < ctx.deadline and not ctx.stop.is_set():
            body = {"bank_id": a.bank_id, **item_q}
            st, s = await call(rec, c, "POST", "/api/quiz/sessions", "POST /api/quiz/sessions",
                               token=token, json=body)
            sid = (s.get("session_id") or s.get("id")) if isinstance(s, dict) else None
            if not sid:
                rec.notes.append(f"{ui}: session open failed status={st}")
                return
            rec.sessions.append({"session_id": str(sid), "account": f"user#{account}",
                                 "vu": vu, "bank_id": a.bank_id, "class_item": a.class_item,
                                 "t": rec.t()})
            chunk = questions[stage * STAGE:(stage + 1) * STAGE] or questions[:STAGE]
            pending: list[dict] = []
            right = graded = 0
            started = time.monotonic()
            for q in chunk:
                think = _jitter(a.answer_seconds, rnd)
                if not await _sleep_or_stop(ctx, think):
                    break
                row = _attempt_row(q, rnd, sealed, int(think * 1000))
                pending.append(row)
                graded += 1
                right += 1 if row["is_correct"] else 0
                if len(pending) >= BATCH or timed:
                    await call(rec, c, "POST", f"/api/quiz/sessions/{sid}/progress",
                               "POST /api/quiz/sessions/{id}/progress", token=token,
                               json={"attempts": pending, "word_stats": []})
                    pending = []
                if time.monotonic() - last_beacon >= a.beacon_seconds:
                    last_beacon = time.monotonic()
                    await beacon(ctx, c, token, "/course-exercises", ui)
            if pending:
                await call(rec, c, "POST", f"/api/quiz/sessions/{sid}/progress",
                           "POST /api/quiz/sessions/{id}/progress", token=token,
                           json={"attempts": pending, "word_stats": []})
            await call(rec, c, "PATCH", f"/api/quiz/sessions/{sid}", "PATCH /api/quiz/sessions/{id}",
                       token=token, json={
                           "duration_sec": round(time.monotonic() - started),
                           "total_questions": graded, "total_correct": right,
                           "total_wrong": max(0, graded - right), "ended_by": None,
                       })
            if time.monotonic() >= ctx.deadline or ctx.stop.is_set():
                return
            # _advanceStage: re-read canonical stage, then open the next session.
            await call(rec, c, "GET", f"/api/quiz/banks/{a.bank_id}/course-resume",
                       "GET /api/quiz/banks/{id}/course-resume", token=token, params=item_q)
            stage += 1
            if stage * STAGE >= len(questions):
                return


def make_wav(seconds: float = 3.0, rate: int = 16000) -> bytes:
    """Small deterministic mono 16-bit WAV (440 Hz tone) for upload tests."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = b"".join(
            struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * i / rate)))
            for i in range(int(seconds * rate)))
        w.writeframes(frames)
    return buf.getvalue()


def _take_grade(ctx: Ctx, kind: str) -> bool:
    """Reserve one real grading call from the capped budget (single-threaded loop)."""
    cap = ctx.args.max_speaking_grades if kind == "speaking" else ctx.args.max_writing_grades
    if ctx.rec.grades[kind] >= cap:
        return False
    ctx.rec.grades[kind] += 1
    return True


async def speaking_student(ctx: Ctx, vu: int, account: int, token: str) -> None:
    a, rec = ctx.args, ctx.rec
    rnd = random.Random(a.seed * 1000 + vu)
    ui = f"user#{account}/vu{vu}"
    async with make_client(a.base_url, a.request_timeout) as c:
        await call(rec, c, "GET", "/auth/me", "GET /auth/me", token=token)
        await beacon(ctx, c, token, "/speaking", ui)
        st, s = await call(rec, c, "POST", "/sessions", "POST /sessions", token=token,
                           json={"mode": "practice", "part": 1, "topic": "Hometown"})
        sid = (s.get("session_id") or s.get("id")) if isinstance(s, dict) else None
        if not sid:
            rec.notes.append(f"{ui}: speaking session create failed status={st}")
            return
        rec.sessions.append({"kind": "speaking", "session_id": str(sid),
                             "account": f"user#{account}", "vu": vu, "t": rec.t()})
        st, qs = await call(rec, c, "POST", f"/sessions/{sid}/questions/generate",
                            "POST /sessions/{id}/questions/generate", token=token, json={})
        if st != 200:
            st, qs = await call(rec, c, "GET", f"/sessions/{sid}/questions",
                                "GET /sessions/{id}/questions", token=token)
        qid = next((q.get("id") for q in (qs if isinstance(qs, list) else [])
                    if isinstance(q, dict) and q.get("id")), None)
        if qid and _take_grade(ctx, "speaking"):
            await call(rec, c, "POST", f"/sessions/{sid}/responses", "POST /sessions/{id}/responses",
                       token=token, data={"question_id": str(qid)},
                       files={"audio_file": ("loadtest.wav", ctx.audio, "audio/wav")})
        while await _sleep_or_stop(ctx, _jitter(a.beacon_seconds, rnd)):
            await call(rec, c, "GET", f"/sessions/{sid}", "GET /sessions/{id}", token=token)
            await beacon(ctx, c, token, "/speaking", ui)


async def writing_student(ctx: Ctx, vu: int, account: int, token: str) -> None:
    a, rec = ctx.args, ctx.rec
    rnd = random.Random(a.seed * 1000 + vu)
    ui = f"user#{account}/vu{vu}"
    async with make_client(a.base_url, a.request_timeout) as c:
        await call(rec, c, "GET", "/auth/me", "GET /auth/me", token=token)
        await beacon(ctx, c, token, "/writing", ui)
        await call(rec, c, "GET", "/api/writing/my-assignments", "GET /api/writing/my-assignments",
                   token=token)
        target = ctx.writing_targets.get(account)
        if target and _take_grade(ctx, "writing"):
            essay = ("The chart compares figures across three years. " * 30).strip()
            request_id = str(uuid.uuid4())
            st, _ = await call(rec, c, "POST", f"/api/writing/my-assignments/{target}/submit",
                               "POST /api/writing/my-assignments/{id}/submit", token=token,
                               json={"essay_text": essay, "request_id": request_id})
            rec.sessions.append({"kind": "writing_submit", "assignment_id": target,
                                 "request_id": request_id, "status": st,
                                 "account": f"user#{account}", "vu": vu, "t": rec.t()})
        while await _sleep_or_stop(ctx, _jitter(a.beacon_seconds, rnd)):
            await call(rec, c, "GET", "/api/writing/my-essays", "GET /api/writing/my-essays",
                       token=token)
            await beacon(ctx, c, token, "/writing", ui)


FLOWS = {"exam": exam_student, "speaking": speaking_student, "writing": writing_student}


def parse_mix(spec: str) -> list[str]:
    """``exam=3,speaking=1`` → round-robin pattern ['exam','exam','exam','speaking']."""
    pattern: list[str] = []
    for part in (spec or "exam=1").split(","):
        name, _, weight = part.partition("=")
        name = name.strip()
        if name not in FLOWS:
            raise ValueError(f"unknown flow {name!r}; choose from {sorted(FLOWS)}")
        w = int(weight or 1)
        if w < 0:
            raise ValueError("flow weight must be >= 0")
        pattern.extend([name] * w)
    if not pattern:
        raise ValueError("--mix selects no flow")
    return pattern


# ── Health probes ────────────────────────────────────────────────────────────

async def probe_loop(ctx: Ctx, path: str, interval: float, sink: str) -> None:
    """Fire one probe every ``interval`` s without waiting for the previous one,
    so a stalled backend shows up as many slow in-flight probes."""
    a, rec = ctx.args, ctx.rec
    inflight: set[asyncio.Task] = set()

    async def one(client) -> None:
        import httpx
        t_start = rec.t()
        t0 = time.monotonic()
        row = {"t": t_start, "path": path}
        key = id(row)
        rec.probe_inflight[path][key] = t0
        try:
            r = await client.get(path)
            row.update(ms=round((time.monotonic() - t0) * 1000, 1), status=r.status_code,
                       ok=r.status_code == 200)
            if sink == "async_db" and r.status_code == 200:
                lag = (r.json() or {}).get("event_loop_lag") or {}
                rec.async_db.append({"t": t_start, "ms": row["ms"],
                                     "lag_p95_ms": lag.get("lag_ms_p95"),
                                     "lag_max_ms": lag.get("lag_ms_max"),
                                     "raw": lag})
                return
        except httpx.HTTPError as exc:
            row.update(ms=round((time.monotonic() - t0) * 1000, 1), status=type(exc).__name__,
                       ok=False)
        finally:
            rec.probe_inflight[path].pop(key, None)
        if sink == "health":
            rec.health.append(row)

    async with make_client(a.base_url, a.probe_timeout) as client:
        while not ctx.stop.is_set() and time.monotonic() < ctx.deadline + a.tail_seconds:
            task = asyncio.create_task(one(client))
            inflight.add(task)
            task.add_done_callback(inflight.discard)
            try:
                await asyncio.wait_for(ctx.stop.wait(), timeout=interval)
            except asyncio.TimeoutError:
                pass
        if inflight:
            await asyncio.wait(inflight, timeout=a.probe_timeout + 1)


async def abort_watch(ctx: Ctx) -> None:
    """Abort when the rolling /health p95 exceeds --abort-on-health-p95-ms.

    The window is the last 10 finished probes plus every probe still waiting,
    counted at its current age, so a fully stalled backend (no probe ever
    returns) still trips the guard. Failed probes count as 10× the limit."""
    limit = ctx.args.abort_on_health_p95_ms
    if not limit:
        return
    while not ctx.stop.is_set() and time.monotonic() < ctx.deadline:
        await asyncio.sleep(1.0)
        done = [h["ms"] if h["ok"] else float(limit) * 10
                for h in ctx.rec.health if h["path"] == "/health"][-10:]
        now = time.monotonic()
        waiting = [(now - t0) * 1000 for t0 in ctx.rec.probe_inflight["/health"].values()]
        window = done + waiting
        if len(window) < 5:
            continue
        p95 = percentile(window, 95)
        if p95 is not None and p95 > limit:
            ctx.rec.notes.append(f"ABORT at t={ctx.rec.t()}s: /health rolling p95 {p95:.0f} ms > {limit} ms")
            ctx.stop.set()
            return


# ── Run orchestration ────────────────────────────────────────────────────────

async def read_backend_identity(args) -> dict:
    out: dict = {}
    async with make_client(args.base_url, args.probe_timeout) as c:
        for path in ("/health", "/health/runtime"):
            try:
                r = await c.get(path)
                body = r.json() if r.status_code == 200 else {}
                for key in ("version", "git_sha", "deployment_id", "environment_name"):
                    if key in body:
                        out[f"{path}:{key}"] = body[key]
            except Exception as exc:  # identity is best-effort
                out[f"{path}:error"] = type(exc).__name__
    return out


async def run_step(args, tokens: list[str], users: int, writing_targets: dict[int, str],
                   audio: bytes) -> dict:
    rec = Recorder()
    stop = asyncio.Event()
    deadline = time.monotonic() + args.ramp_seconds + args.duration_seconds
    ctx = Ctx(args=args, rec=rec, deadline=deadline, stop=stop, audio=audio,
              writing_targets=writing_targets)
    pattern = parse_mix(args.mix)
    probes = [
        asyncio.create_task(probe_loop(ctx, "/health", args.health_interval, "health")),
        asyncio.create_task(probe_loop(ctx, "/health/ready", args.health_interval, "health")),
        asyncio.create_task(probe_loop(ctx, "/health/async-db", args.async_db_interval, "async_db")),
        asyncio.create_task(abort_watch(ctx)),
    ]
    flows_used: dict[str, int] = defaultdict(int)

    async def launch(vu: int) -> None:
        delay = args.ramp_seconds * vu / max(1, users)
        if not await _sleep_or_stop(ctx, delay) and delay > 0:
            return
        account = vu % len(tokens)
        flow = pattern[vu % len(pattern)]
        flows_used[flow] += 1
        try:
            await FLOWS[flow](ctx, vu, account + 1, tokens[account])
        except ProdGuardError:
            stop.set()
            raise
        except Exception as exc:  # one broken student must not kill the run
            rec.notes.append(f"user#{account + 1}/vu{vu}: {flow} crashed {type(exc).__name__}: {exc}")

    students = [asyncio.create_task(launch(vu)) for vu in range(users)]
    results = await asyncio.gather(*students, return_exceptions=True)
    stop_reason = "aborted" if stop.is_set() else "deadline"
    if not stop.is_set() and args.tail_seconds > 0:
        await asyncio.sleep(args.tail_seconds)   # keep probing while the backend drains
    stop.set()
    await asyncio.gather(*probes, return_exceptions=True)
    for res in results:
        if isinstance(res, ProdGuardError):
            raise res
    return {
        "users": users,
        "flows": dict(flows_used),
        "stop_reason": stop_reason,
        "elapsed_s": rec.t(),
        "overall": rec.overall(),
        "endpoints": {k: v.summary() for k, v in sorted(rec.by_endpoint.items())},
        "health": rec.health_summary(),
        "health_timeline": rec.health,
        "async_db_timeline": rec.async_db,
        "sessions": rec.sessions,
        "real_grading_calls": dict(rec.grades),
        "notes": rec.notes,
    }


def step_broke(step: dict, max_error_rate: float, max_p95_ms: float) -> str | None:
    o = step["overall"]
    if step["stop_reason"] == "aborted":
        return "aborted by /health guard"
    if o["error_rate"] is not None and o["error_rate"] > max_error_rate:
        return f"error rate {o['error_rate']:.1%} > {max_error_rate:.0%}"
    if o["p95_ms"] is not None and o["p95_ms"] > max_p95_ms:
        return f"p95 {o['p95_ms']:.0f} ms > {max_p95_ms:.0f} ms"
    return None


def render_markdown(report: dict) -> str:
    lines = [f"# Load test `{report['label']}` — {report['started_at']}", "",
             f"- Target: `{report['base_url']}` (staging only; prod guard on)",
             f"- Backend identity: `{json.dumps(report['backend_identity'], ensure_ascii=False)}`",
             f"- Accounts: {report['accounts']} × sessions-per-user {report['args']['sessions_per_user']}",
             f"- Bank: `{report['args']['bank_id']}` class_item: `{report['args']['class_item']}`",
             f"- Mix: `{report['args']['mix']}` · ramp {report['args']['ramp_seconds']} s · "
             f"duration {report['args']['duration_seconds']} s",
             f"- Real grading calls: {json.dumps(report['real_grading_calls'])}", ""]
    if report.get("broke_at"):
        lines += [f"**Ladder stopped at {report['broke_at']['users']} users: "
                  f"{report['broke_at']['reason']}**", ""]
    lines += ["## Summary per step", "",
              "| users | stop | requests | p50 ms | p95 ms | p99 ms | max ms | errors | timeouts | err % | /health p95 | /health max | /health/ready p95 | loop lag p95 max |",
              "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for s in report["steps"]:
        o, h = s["overall"], s["health"]
        hb, hr = h.get("/health", {}), h.get("/health/ready", {})
        er = "" if o["error_rate"] is None else f"{o['error_rate'] * 100:.1f}"
        lines.append(f"| {s['users']} | {s['stop_reason']} | {o['count']} | {o['p50_ms']} | {o['p95_ms']} | "
                     f"{o['p99_ms']} | {o['max_ms']} | {o['errors']} | {o['timeouts']} | {er} | "
                     f"{hb.get('p95_ms')} | {hb.get('max_ms')} | {hr.get('p95_ms')} | "
                     f"{h['event_loop_lag']['max_of_lag_p95_ms']} |")
    for s in report["steps"]:
        lines += ["", f"## Step: {s['users']} users ({json.dumps(s['flows'])})", "",
                  "| endpoint | n | p50 | p95 | p99 | max | errors | timeouts | statuses |",
                  "|---|---:|---:|---:|---:|---:|---:|---:|---|"]
        for ep, e in s["endpoints"].items():
            lines.append(f"| `{ep}` | {e['count']} | {e['p50_ms']} | {e['p95_ms']} | {e['p99_ms']} | "
                         f"{e['max_ms']} | {e['errors']} | {e['timeouts']} | `{json.dumps(e['statuses'])}` |")
        lines += ["", "| probe | n | p50 | p95 | max | failures |", "|---|---:|---:|---:|---:|---:|"]
        for p, hsum in s["health"].items():
            if p == "event_loop_lag":
                continue
            lines.append(f"| `{p}` | {hsum['count']} | {hsum['p50_ms']} | {hsum['p95_ms']} | "
                         f"{hsum['max_ms']} | {hsum['failures']} |")
        if s["notes"]:
            lines += ["", "Notes:"] + [f"- {n}" for n in s["notes"][:40]]
            if len(s["notes"]) > 40:
                lines.append(f"- … {len(s['notes']) - 40} more in JSON")
    lines += ["", "## Limitations", "",
              "- All virtual students come from one client IP: per-IP rate limits apply to the whole run.",
              "- Fewer accounts than users means several virtual students share one account/assignment item: "
              "per-user caches and per-user rate limits can make numbers look better (or 409s worse) than real classes.",
              "- Probes run from the same host as the load, so probe latency includes this box's network path.",
              ""]
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    p.add_argument("--base-url", required=True, help="staging/local backend base URL")
    p.add_argument("--users", type=int, default=30, help="concurrent virtual students")
    p.add_argument("--ladder", default="", help="comma list of user counts, e.g. 10,30,50,100,200 (overrides --users)")
    p.add_argument("--sessions-per-user", type=int, default=1,
                   help="max virtual students per account (accounts × this must cover --users)")
    p.add_argument("--ramp-seconds", type=float, default=10.0)
    p.add_argument("--duration-seconds", type=float, default=60.0)
    p.add_argument("--bank-id", default="", help="quiz bank id (required for the exam flow)")
    p.add_argument("--class-item", default=None, help="class_assignment_items.id when the bank is assigned")
    p.add_argument("--mix", default="exam=1", help="flow weights, e.g. exam=3,speaking=1,writing=1")
    p.add_argument("--label", default="before")
    p.add_argument("--out-dir", default=str(Path(__file__).resolve().parent / "results"))
    p.add_argument("--answer-seconds", type=float, default=4.0, help="mean think time per question (±50%% jitter)")
    p.add_argument("--beacon-seconds", type=float, default=15.0, help="mean seconds between analytics beacons")
    p.add_argument("--request-timeout", type=float, default=30.0)
    p.add_argument("--probe-timeout", type=float, default=30.0)
    p.add_argument("--health-interval", type=float, default=1.0)
    p.add_argument("--async-db-interval", type=float, default=5.0)
    p.add_argument("--tail-seconds", type=float, default=5.0, help="keep probing after the load stops")
    p.add_argument("--abort-on-health-p95-ms", type=float, default=5000.0, help="0 disables")
    p.add_argument("--ladder-max-error-rate", type=float, default=0.05)
    p.add_argument("--ladder-max-p95-ms", type=float, default=10000.0)
    p.add_argument("--step-cooldown-seconds", type=float, default=30.0)
    p.add_argument("--max-speaking-grades", type=int, default=0,
                   help=f"real Speaking grading uploads (clamped to {MAX_SPEAKING_GRADES_CEILING})")
    p.add_argument("--max-writing-grades", type=int, default=0,
                   help=f"real Writing submits (clamped to {MAX_WRITING_GRADES_CEILING})")
    p.add_argument("--audio-file", default=None, help="fixed small audio clip; default = 3 s synthetic WAV")
    p.add_argument("--writing-targets-file", default=None,
                   help="JSON {\"<account#>\": \"<writing assignment id>\"} for capped submits")
    p.add_argument("--seed", type=int, default=409)
    return p


def validate_args(args, environ: dict[str, str]) -> None:
    """All refusal checks that must pass before the first request."""
    check_url_allowed(args.base_url)
    hits = scan_env_for_prod(environ)
    if hits:
        raise ProdGuardError(f"production host mentioned in env: {', '.join(hits)}")
    args.max_speaking_grades = max(0, min(args.max_speaking_grades, MAX_SPEAKING_GRADES_CEILING))
    args.max_writing_grades = max(0, min(args.max_writing_grades, MAX_WRITING_GRADES_CEILING))
    if "exam" in parse_mix(args.mix) and not args.bank_id:
        raise SystemExit("--bank-id is required when the mix includes the exam flow")
    if args.sessions_per_user < 1 or args.users < 1:
        raise SystemExit("--users and --sessions-per-user must be >= 1")


def ladder_steps(args) -> list[int]:
    if args.ladder:
        steps = [int(x) for x in args.ladder.split(",") if x.strip()]
        if not steps or any(s < 1 for s in steps):
            raise SystemExit("--ladder needs positive integers")
        return steps
    return [args.users]


async def amain(args, tokens: list[str]) -> dict:
    steps = ladder_steps(args)
    capacity = len(tokens) * args.sessions_per_user
    too_big = [s for s in steps if s > capacity]
    if too_big:
        raise SystemExit(f"{len(tokens)} accounts × {args.sessions_per_user} sessions-per-user = {capacity} "
                         f"< requested users {too_big}; add accounts or raise --sessions-per-user")
    audio = Path(args.audio_file).read_bytes() if args.audio_file else make_wav()
    writing_targets: dict[int, str] = {}
    if args.writing_targets_file:
        raw = json.loads(Path(args.writing_targets_file).read_text(encoding="utf-8"))
        writing_targets = {int(k): str(v) for k, v in raw.items()}
    report = {
        "label": args.label,
        "started_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "base_url": args.base_url,
        "accounts": len(tokens),
        "args": {k: v for k, v in vars(args).items()},
        "backend_identity": await read_backend_identity(args),
        "steps": [],
        "broke_at": None,
    }
    grades = {"speaking": 0, "writing": 0}
    for i, users in enumerate(steps):
        # The grading budget is per process, not per step.
        args.max_speaking_grades -= grades["speaking"]
        args.max_writing_grades -= grades["writing"]
        print(f"[loadtest] step {i + 1}/{len(steps)}: {users} users", file=sys.stderr, flush=True)
        step = await run_step(args, tokens, users, writing_targets, audio)
        grades = step["real_grading_calls"]
        report["steps"].append(step)
        o = step["overall"]
        print(f"[loadtest]   n={o['count']} p95={o['p95_ms']} ms err={o['error_rate']} "
              f"stop={step['stop_reason']}", file=sys.stderr, flush=True)
        reason = step_broke(step, args.ladder_max_error_rate, args.ladder_max_p95_ms)
        if reason:
            report["broke_at"] = {"users": users, "reason": reason}
            break
        if i + 1 < len(steps):
            await asyncio.sleep(args.step_cooldown_seconds)
    report["real_grading_calls"] = {
        k: sum(s["real_grading_calls"][k] for s in report["steps"]) for k in ("speaking", "writing")}
    return report


def write_outputs(report: dict, out_dir: str) -> tuple[Path, Path, Path]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base = out / f"{report['label']}-{ts}"
    jpath, mpath = base.with_suffix(".json"), base.with_suffix(".md")
    jpath.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    mpath.write_text(render_markdown(report), encoding="utf-8")
    spath = out / f"{report['label']}-{ts}-sessions.json"
    spath.write_text(json.dumps([s for st in report["steps"] for s in st["sessions"]], indent=1),
                     encoding="utf-8")
    return jpath, mpath, spath


def main(argv: list[str] | None = None, environ: dict[str, str] | None = None) -> int:
    environ = dict(os.environ if environ is None else environ)
    args = build_parser().parse_args(argv)
    try:
        validate_args(args, environ)
    except ProdGuardError as exc:
        print(f"[loadtest] REFUSED: {exc}", file=sys.stderr)
        return 2
    tokens = load_accounts(environ)
    if not tokens:
        print("[loadtest] no accounts: set LOADTEST_ACCOUNTS_FILE or LOADTEST_TOKEN_1..n", file=sys.stderr)
        return 3
    try:
        report = asyncio.run(amain(args, tokens))
    except ProdGuardError as exc:
        print(f"[loadtest] REFUSED mid-run: {exc}", file=sys.stderr)
        return 2
    jpath, mpath, spath = write_outputs(report, args.out_dir)
    print(f"[loadtest] wrote {jpath}\n[loadtest] wrote {mpath}\n[loadtest] wrote {spath}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

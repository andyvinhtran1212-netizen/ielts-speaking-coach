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

A probe task polls /health every second and /health/async-db (event-loop
lag) every few seconds for the whole run. /health/ready is off by default
(``--ready-interval``): it is an ``async def`` that runs ~15 synchronous
PostgREST calls on the event loop, so probing it every second stalls the
backend by itself (staging smoke 2026-10-30: 3 users, /health 47 s at the edge).

Optional flows for the capacity ladder (``--mix``): ``speaking`` (create a
session, generate questions, upload a small fixed audio clip while the
grading budget lasts) and ``writing`` (list assignments/essays, submit while
the grading budget lasts). Real grading calls are capped in code at 20
Speaking and 10 Writing per process, whatever the CLI asks for. The Speaking
budget also covers ``POST /sessions/{id}/questions/generate``: that route
calls Gemini for topics missing from the library, so every generate call
reserves one unit; without budget the flow only reads ``GET .../questions``.

HARD GUARD: every URL is checked against a staging/local allowlist before the
first request and again on every request (httpx event hook, redirects off).
Production hosts are refused explicitly; anything not allowlisted is refused.

STAGING EXCLUSION (PC-J433/J448): before the first ladder step and again after
every cooldown, the driver reads GitHub Actions (read-only ``gh run list``) for
workflows that use shared staging (``STAGING_WORKFLOWS``). While one is
queued or running it sends no request, waits up to ``--busy-wait-seconds``,
then skips the remaining steps (exit 4). When the status cannot be read it
refuses to run (exit 5) unless ``--skip-busy-check`` is given, which the report
records. ``--busy-marker`` writes a JSON file for the whole run so release
owners can see that a load run is holding staging.

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
import subprocess
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
    "huwsmtubwulikhlmcirx.supabase.co",
})
PROD_PROJECT_REFS = frozenset({"huwsmtubwulikhlmcirx"})

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
        if any(h in low for h in PROD_HOSTS | PROD_PROJECT_REFS) or "production" in low:
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
    # 4xx quota/activation refusals (e.g. POST /sessions 429 "hết lượt"): an
    # account-state artefact, not a load failure, so kept out of errors.
    quota_rejections: int = 0

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
            "quota_rejections": self.quota_rejections,
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
        self.generate_calls = 0   # subset of grades["speaking"]
        # probe path -> {probe key: monotonic start} for probes still waiting
        self.probe_inflight: dict[str, dict[int, float]] = defaultdict(dict)

    def t(self) -> float:
        return round(time.monotonic() - self.started, 3)

    def add(self, endpoint: str, ms: float, status: str, ok: bool, timeout: bool,
            quota: bool = False) -> None:
        st = self.by_endpoint[endpoint]
        st.latencies_ms.append(ms)
        st.statuses[status] += 1
        if quota:
            st.quota_rejections += 1
        elif not ok:
            st.errors += 1
        if timeout:
            st.timeouts += 1

    def overall(self) -> dict:
        lat: list[float] = []
        n = errors = timeouts = quota = 0
        for st in self.by_endpoint.values():
            lat.extend(st.latencies_ms)
            n += sum(st.statuses.values())
            errors += st.errors
            timeouts += st.timeouts
            quota += st.quota_rejections
        return {
            "count": n,
            "p50_ms": _r(percentile(lat, 50)),
            "p95_ms": _r(percentile(lat, 95)),
            "p99_ms": _r(percentile(lat, 99)),
            "max_ms": _r(max(lat) if lat else None),
            "errors": errors,
            "timeouts": timeouts,
            "quota_rejections": quota,
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
               token: str | None = None, quota_statuses: tuple[int, ...] = (), **kw):
    """One timed request. Returns (status_code|None, json|None).

    ``quota_statuses`` are 4xx codes the route uses for account quota or
    activation refusals; they are counted as quota_rejections, not errors."""
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
    rec.add(endpoint, ms, str(resp.status_code), ok, False,
            quota=resp.status_code in quota_statuses)
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


def is_course_quiz_question(q: dict) -> bool:
    """course-runner.js ``isCourseQuizQuestion``: the quiz lane is mcq (or
    untyped) questions that count toward mastery; other sections are not
    answered through /progress."""
    return q.get("type") in (None, "mcq") and q.get("counts_toward_mastery") is not False


def adopt_resume(sv, n_questions: int, *, item_id: str | None = None) -> tuple[int, str | None, set[str]]:
    """``(stage, open session id, answered qids)`` from /course-resume, the
    way course-runner.js ``adoptServerState`` continues saved progress.
    Missing state starts at stage 0. Completed stages remain terminal; state
    for a different assignment item must never be adopted."""
    if not isinstance(sv, dict):
        return 0, None, set()
    if (sv.get("item_id") or None) != item_id:
        raise ValueError("course-resume item_id does not match the bank assignment")
    stage = sv.get("stage")
    stage = stage if isinstance(stage, int) and stage >= 0 else 0
    if stage * STAGE >= n_questions:
        return stage, None, set()
    sid = sv.get("session_id") if isinstance(sv.get("session_id"), str) else None
    answered = {a["qid"] for a in sv.get("answered") or []
                if isinstance(a, dict) and isinstance(a.get("qid"), str)}
    return stage, sid, answered


async def exam_student(ctx: Ctx, vu: int, account: int, token: str) -> None:
    a, rec = ctx.args, ctx.rec
    rnd = random.Random(a.seed * 1000 + vu)
    ui = f"user#{account}/vu{vu}"
    class_item = account_class_item(a, account)
    item_q = {"class_item": class_item} if class_item else {}
    async with make_client(a.base_url, a.request_timeout) as c:
        await call(rec, c, "GET", "/auth/me", "GET /auth/me", token=token)
        await beacon(ctx, c, token, "/course-exercises", ui)
        st, bank = await call(rec, c, "GET", f"/api/quiz/banks/{a.bank_id}",
                              "GET /api/quiz/banks/{id}", token=token, params=item_q)
        if st != 200 or not isinstance(bank, dict):
            rec.notes.append(f"{ui}: bank load failed status={st}")
            return
        questions = [q for q in bank.get("questions") or []
                     if isinstance(q, dict) and is_course_quiz_question(q)]
        mastery = bank.get("mastery") or {}
        # The bank resolves an assignment even when --class-item is omitted.
        bank_item = mastery.get("item_id")
        if class_item and bank_item and class_item != bank_item:
            rec.notes.append(f"{ui}: bank item_id does not match --class-item")
            return
        class_item = bank_item or class_item
        item_q = {"class_item": class_item} if class_item else {}
        timed = bool(mastery.get("is_timed"))
        sealed = bool(mastery.get("answers_sealed"))
        st, sv = await call(rec, c, "GET", f"/api/quiz/banks/{a.bank_id}/course-resume",
                           "GET /api/quiz/banks/{id}/course-resume", token=token, params=item_q)
        if st != 200 or not isinstance(sv, dict):
            rec.notes.append(f"{ui}: course-resume failed status={st}; no new quiz work")
            return
        stage, resume_sid, answered = adopt_resume(sv, len(questions), item_id=class_item)
        last_beacon = time.monotonic()
        while time.monotonic() < ctx.deadline and not ctx.stop.is_set():
            # Like resumedFinal in the runner: results only, no new attempt.
            if stage * STAGE >= len(questions):
                return
            resumed = bool(resume_sid)
            if resume_sid:
                # Continue the open session the server reports, like the runner.
                sid, resume_sid = resume_sid, None
            else:
                body = {"bank_id": a.bank_id, **item_q}
                st, s = await call(rec, c, "POST", "/api/quiz/sessions", "POST /api/quiz/sessions",
                                   token=token, json=body)
                sid = (s.get("session_id") or s.get("id")) if isinstance(s, dict) else None
                if not sid:
                    rec.notes.append(f"{ui}: session open failed status={st}")
                    return
            rec.sessions.append({"session_id": str(sid), "account": f"user#{account}",
                                 "vu": vu, "bank_id": a.bank_id, "class_item": class_item,
                                 "resumed": resumed, "t": rec.t()})
            stage_questions = questions[stage * STAGE:(stage + 1) * STAGE]
            stage_qids = {q.get("qid") for q in stage_questions}
            saved = {}
            if resumed:
                saved = {row["qid"]: row.get("is_correct") for row in (sv.get("answered") or [])
                         if isinstance(row, dict) and row.get("qid") in answered & stage_qids}
            chunk = [q for q in stage_questions if q.get("qid") not in saved]
            pending: list[dict] = []
            # Restored neutral (sealed) answers still count as answered.
            graded = len(saved)
            right = 0 if sealed else sum(correct is True for correct in saved.values())
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
                    st, _ = await call(rec, c, "POST", f"/api/quiz/sessions/{sid}/progress",
                                       "POST /api/quiz/sessions/{id}/progress", token=token,
                                       json={"attempts": pending, "word_stats": []})
                    if st is None or not 200 <= st < 300:
                        rec.notes.append(f"{ui}: progress failed status={st}; session left open")
                        return
                    pending = []
                if time.monotonic() - last_beacon >= a.beacon_seconds:
                    last_beacon = time.monotonic()
                    await beacon(ctx, c, token, "/course-exercises", ui)
            if pending:
                st, _ = await call(rec, c, "POST", f"/api/quiz/sessions/{sid}/progress",
                                   "POST /api/quiz/sessions/{id}/progress", token=token,
                                   json={"attempts": pending, "word_stats": []})
                if st is None or not 200 <= st < 300:
                    rec.notes.append(f"{ui}: progress failed status={st}; session left open")
                    return
            # A deadline/abort flushes the prefix but must not complete a stage.
            if graded != len(stage_questions):
                return
            st, _ = await call(rec, c, "PATCH", f"/api/quiz/sessions/{sid}", "PATCH /api/quiz/sessions/{id}",
                       token=token, json={
                           "duration_sec": round(time.monotonic() - started),
                           "total_questions": graded, "total_correct": right,
                           "total_wrong": max(0, graded - right), "ended_by": None,
                       })
            if st is None or not 200 <= st < 300:
                rec.notes.append(f"{ui}: finalization failed status={st}; no stage advance")
                return
            if time.monotonic() >= ctx.deadline or ctx.stop.is_set():
                return
            # _advanceStage: re-read canonical stage, then open the next session.
            st, sv = await call(rec, c, "GET", f"/api/quiz/banks/{a.bank_id}/course-resume",
                               "GET /api/quiz/banks/{id}/course-resume", token=token, params=item_q)
            if st != 200 or not isinstance(sv, dict):
                rec.notes.append(f"{ui}: course-resume failed status={st}; no new quiz work")
                return
            next_stage, resume_sid, answered = adopt_resume(sv, len(questions), item_id=class_item)
            if resume_sid == str(sid):
                resume_sid = None
            stage = next_stage if next_stage > stage else stage + 1
            if stage * STAGE >= len(questions):
                return


def account_class_item(args, account: int) -> str | None:
    """Assignment item of account ``account`` (1-based): every learner has
    their own class_assignment_items row, so ``--class-items`` lists one id per
    account in token order; ``--class-item`` is the single-account form."""
    items = getattr(args, "class_items_list", None) or []
    if items:
        return items[account - 1]
    return args.class_item


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
        # 403 = account not activated, 429 = code quota / daily cap (sessions.py).
        st, s = await call(rec, c, "POST", "/sessions", "POST /sessions", token=token,
                           quota_statuses=(403, 429),
                           json={"mode": "practice", "part": 1, "topic": a.speaking_topic})
        sid = (s.get("session_id") or s.get("id")) if isinstance(s, dict) else None
        if not sid:
            rec.notes.append(f"{ui}: speaking session create failed status={st}")
            return
        rec.sessions.append({"kind": "speaking", "session_id": str(sid),
                             "account": f"user#{account}", "vu": vu, "t": rec.t()})
        # generate may call Gemini (topic not in the library), so it spends
        # the same capped Speaking budget as a graded upload.
        st = None
        if _take_grade(ctx, "speaking"):
            rec.generate_calls += 1
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
        if target:
            # The Writing workspace claims a renderer lease before submit can
            # be accepted (writing_student._require_writing_renderer_lease).
            st, _ = await call(rec, c, "POST", f"/api/writing/my-assignments/{target}/renderer-affinity",
                               "POST /api/writing/my-assignments/{id}/renderer-affinity",
                               token=token, json={"renderer_affinity": "next"})
            if st != 200:
                rec.notes.append(f"{ui}: writing renderer lease failed status={st}; no submit")
                target = None
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
        except (httpx.HTTPError, ValueError) as exc:
            row.update(ms=round((time.monotonic() - t0) * 1000, 1), status=type(exc).__name__,
                       ok=False)
        finally:
            rec.probe_inflight[path].pop(key, None)
        # Every probe row (async-db included) lands in the health timeline so a
        # failed or non-200 lag probe shows up as a failure, not as silence.
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


# ── Staging busy preflight (PC-J433/J448) ────────────────────────────────────

# Workflows that use shared staging while they run. A load step overlapping one
# of them turns its result red for the wrong reason (PC-J433: a 30-user step
# covered Gate A's timeout and the Grammar boundary of run 41064757555).
# Not listed: CI that runs locally on the runner (backend-tests, e2e,
# next-native-browser, route-manifest, typecheck, legacy-freeze, spec
# governance, offsite-backup-selftest); production-only targets
# (production-smoke, production-release-drift, g2-authed-probe);
# staging-promotion-gate (reads the GitHub API only; the live evidence it
# waits for is staging-release-smoke); offsite-restore-drill (restores into a
# database on the runner).
STAGING_WORKFLOWS = {
    # Live Playwright smoke + grammar health check against the staging hosts;
    # every staging merge and every promotion depends on its result.
    "staging-release-smoke.yml": "live smoke on the staging hosts",
    # pg_dump + Storage copy of the staging Supabase project (weekly schedule,
    # dispatch defaults to staging). The run list does not show the dispatch
    # input, so a production-only dispatch also counts as busy.
    "offsite-backup.yml": "dump of the staging database and Storage",
}
BUSY_STATUSES = frozenset({"queued", "in_progress", "waiting", "requested", "pending"})
GH_TIMEOUT_SECONDS = 30.0
EXIT_STAGING_BUSY = 4
EXIT_BUSY_CHECK_REFUSED = 5


class BusyCheckError(RuntimeError):
    """The staging busy status could not be read: the run must not start."""


def staging_busy(runs: list[dict]) -> str | None:
    """Reason string for the first queued/running workflow run, else None.

    ``runs`` rows carry ``workflow``, ``status`` and ``databaseId``
    (``gh run list --json`` plus the workflow file name)."""
    for run in sorted(runs, key=lambda r: str(r.get("createdAt") or "")):
        if run.get("status") in BUSY_STATUSES:
            return f"staging busy: {run.get('workflow')} run {run.get('databaseId')}"
    return None


def fetch_staging_runs(workflows=tuple(STAGING_WORKFLOWS), runner=subprocess.run) -> list[dict]:
    """Recent runs of ``workflows`` from GitHub Actions, read-only.

    Any failure (gh missing, not authenticated, timeout, unexpected output)
    raises BusyCheckError: an unknown status never counts as free. gh output
    is never printed, and the error names only the exit code."""
    repo_dir = Path(__file__).resolve().parent
    runs: list[dict] = []
    for wf in workflows:
        cmd = ["gh", "run", "list", "--workflow", wf,
               "--json", "status,databaseId,createdAt", "--limit", "30"]
        try:
            proc = runner(cmd, cwd=repo_dir, capture_output=True, text=True,
                          timeout=GH_TIMEOUT_SECONDS, check=False)
        except (OSError, subprocess.SubprocessError) as exc:
            raise BusyCheckError(f"gh run list --workflow {wf}: {type(exc).__name__}") from None
        if proc.returncode != 0:
            raise BusyCheckError(f"gh run list --workflow {wf}: exit {proc.returncode}")
        try:
            rows = json.loads(proc.stdout)
        except ValueError:
            raise BusyCheckError(f"gh run list --workflow {wf}: output is not JSON") from None
        if not isinstance(rows, list) or not all(
                isinstance(r, dict) and isinstance(r.get("status"), str) for r in rows):
            raise BusyCheckError(f"gh run list --workflow {wf}: unexpected output shape")
        runs.extend({**r, "workflow": wf} for r in rows)
    return runs


async def wait_until_staging_free(args) -> str | None:
    """None once no staging workflow is queued/running; the busy reason when
    one still is after ``--busy-wait-seconds``. Sends no request to staging.
    BusyCheckError propagates (fail closed)."""
    give_up = time.monotonic() + args.busy_wait_seconds
    while True:
        reason = staging_busy(fetch_staging_runs())
        remaining = give_up - time.monotonic()
        if reason is None or remaining <= 0:
            return reason
        print(f"[loadtest] {reason}; waiting (max {remaining:.0f} s more)", file=sys.stderr, flush=True)
        await asyncio.sleep(min(args.busy_poll_seconds, remaining))


def create_busy_marker(path: str, args) -> None:
    """Create the marker; refuse when one already exists (another load run, or
    a stale marker that the operator must check and remove by hand)."""
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    except FileExistsError:
        raise BusyCheckError(f"busy marker {path} already exists: another load run, "
                             "or a stale marker (check its pid, then remove it by hand)") from None
    os.close(fd)
    try:
        update_busy_marker(path, args, "preflight")
    except BaseException:
        Path(path).unlink(missing_ok=True)
        raise


def update_busy_marker(path: str | None, args, current_step) -> None:
    """Rewrite the marker atomically with the step the run is on."""
    if not path:
        return
    started = getattr(args, "_marker_started_at", None) or datetime.now(timezone.utc).isoformat(
        timespec="seconds")
    args._marker_started_at = started
    data = {"label": args.label, "pid": os.getpid(), "started_at": started,
            "current_step": current_step, "base_url": args.base_url,
            "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    tmp = f"{path}.tmp-{os.getpid()}"
    Path(tmp).write_text(json.dumps(data), encoding="utf-8")
    os.replace(tmp, path)


# ── Run orchestration ────────────────────────────────────────────────────────

async def read_backend_identity(args) -> dict:
    # This probe is anonymous. Equal unavailable SHAs cannot prove that two
    # runs measured the same deployment, even if an older route exposes one.
    out: dict = {"/health/runtime:git_sha": "unknown (anon)", "git_sha_verified": False}
    async with make_client(args.base_url, args.probe_timeout) as c:
        for path in ("/health", "/health/runtime"):
            try:
                r = await c.get(path)
                body = r.json() if r.status_code == 200 else {}
                for key in ("version", "deployment_id", "environment_name"):
                    if key in body:
                        value = body[key]
                        out[f"{path}:{key}"] = (
                            "unknown (anon)" if value == "redacted (admin only)" else value)
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
        asyncio.create_task(probe_loop(ctx, "/health/async-db", args.async_db_interval, "async_db")),
        asyncio.create_task(abort_watch(ctx)),
    ]
    if args.ready_interval > 0:
        probes.append(asyncio.create_task(
            probe_loop(ctx, "/health/ready", args.ready_interval, "health")))
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
        "generate_calls": rec.generate_calls,
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
             "- Identity probes are anonymous: unknown SHAs do not establish a deployment match.",
             f"- busy_check: {report.get('busy_check')}",
             f"- Accounts: {report['accounts']} × sessions-per-user {report['args']['sessions_per_user']}",
             f"- Bank: `{report['args']['bank_id']}` class_item(s): "
             f"`{report['args'].get('class_items') or report['args']['class_item']}`",
             f"- Mix: `{report['args']['mix']}` · ramp {report['args']['ramp_seconds']} s · "
             f"duration {report['args']['duration_seconds']} s",
             f"- Real grading calls (Speaking includes {report.get('generate_calls', 0)} question generate): "
             f"{json.dumps(report['real_grading_calls'])}",
             "- Cost caps count HTTP calls, not provider calls: one question generate may make up to ~4 Gemini calls; "
             "one Speaking upload may call Whisper, a grader and Azure.", ""]
    if report.get("broke_at"):
        lines += [f"**Ladder stopped at {report['broke_at']['users']} users: "
                  f"{report['broke_at']['reason']}**", ""]
    if report.get("busy_stop"):
        b = report["busy_stop"]
        lines += [f"**Not run: steps {b['steps_not_run']} users ({b['reason']}). "
                  "No request was sent to staging for them.**", ""]
    lines += ["## Summary per step", "",
              "| users | stop | requests | p50 ms | p95 ms | p99 ms | max ms | errors | timeouts | quota 4xx | err % | /health p95 | /health max | /health/ready p95 | loop lag p95 max |",
              "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for s in report["steps"]:
        o, h = s["overall"], s["health"]
        hb, hr = h.get("/health", {}), h.get("/health/ready", {})
        er = "" if o["error_rate"] is None else f"{o['error_rate'] * 100:.1f}"
        lines.append(f"| {s['users']} | {s['stop_reason']} | {o['count']} | {o['p50_ms']} | {o['p95_ms']} | "
                     f"{o['p99_ms']} | {o['max_ms']} | {o['errors']} | {o['timeouts']} | "
                     f"{o['quota_rejections']} | {er} | "
                     f"{hb.get('p95_ms')} | {hb.get('max_ms')} | {hr.get('p95_ms')} | "
                     f"{h['event_loop_lag']['max_of_lag_p95_ms']} |")
    for s in report["steps"]:
        lines += ["", f"## Step: {s['users']} users ({json.dumps(s['flows'])})", "",
                  "| endpoint | n | p50 | p95 | p99 | max | errors | timeouts | quota 4xx | statuses |",
                  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|"]
        for ep, e in s["endpoints"].items():
            lines.append(f"| `{ep}` | {e['count']} | {e['p50_ms']} | {e['p95_ms']} | {e['p99_ms']} | "
                         f"{e['max_ms']} | {e['errors']} | {e['timeouts']} | {e['quota_rejections']} | "
                         f"`{json.dumps(e['statuses'])}` |")
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
              "- POST /sessions 403/429 (activation / code quota / daily cap) are counted as quota 4xx, "
              "not errors, and do not break the ladder.",
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
    p.add_argument("--class-items", default="",
                   help="comma list of class_assignment_items ids, one per account in token order")
    p.add_argument("--mix", default="exam=1", help="flow weights, e.g. exam=3,speaking=1,writing=1")
    p.add_argument("--label", default="before")
    p.add_argument("--out-dir", default=str(Path(__file__).resolve().parent / "results"))
    p.add_argument("--answer-seconds", type=float, default=4.0, help="mean think time per question (±50%% jitter)")
    p.add_argument("--beacon-seconds", type=float, default=15.0, help="mean seconds between analytics beacons")
    p.add_argument("--request-timeout", type=float, default=30.0)
    p.add_argument("--probe-timeout", type=float, default=30.0)
    p.add_argument("--health-interval", type=float, default=1.0)
    p.add_argument("--async-db-interval", type=float, default=5.0)
    p.add_argument("--ready-interval", type=float, default=0.0,
                   help="seconds between /health/ready probes; 0 = off, otherwise >= 30 (the route blocks the event loop)")
    p.add_argument("--tail-seconds", type=float, default=5.0, help="keep probing after the load stops")
    p.add_argument("--abort-on-health-p95-ms", type=float, default=5000.0, help="0 disables")
    p.add_argument("--ladder-max-error-rate", type=float, default=0.05)
    p.add_argument("--ladder-max-p95-ms", type=float, default=10000.0)
    p.add_argument("--step-cooldown-seconds", type=float, default=30.0)
    p.add_argument("--max-speaking-grades", type=int, default=0,
                   help=f"real Speaking calls: question generate + graded uploads (clamped to {MAX_SPEAKING_GRADES_CEILING})")
    p.add_argument("--max-writing-grades", type=int, default=0,
                   help=f"real Writing submits (clamped to {MAX_WRITING_GRADES_CEILING})")
    p.add_argument("--speaking-topic", default="Hometown",
                   help="Part 1 topic for the speaking flow (prefer a library topic: no Gemini call)")
    p.add_argument("--audio-file", default=None, help="fixed audio clip (>= 15 s) for graded Speaking uploads; "
                   "required when --max-speaking-grades > 0, else a 3 s synthetic WAV")
    p.add_argument("--writing-targets-file", default=None,
                   help="JSON {\"<account#>\": \"<writing assignment id>\"} for capped submits")
    p.add_argument("--seed", type=int, default=409)
    p.add_argument("--busy-wait-seconds", type=float, default=900.0,
                   help="how long to wait for a running staging smoke/backup before skipping the step")
    p.add_argument("--busy-poll-seconds", type=float, default=30.0,
                   help="seconds between GitHub Actions reads while staging is busy")
    p.add_argument("--skip-busy-check", action="store_true",
                   help="do not read GitHub Actions before each step (recorded in the report)")
    p.add_argument("--busy-marker", default=None,
                   help="JSON marker file kept for the whole run (removed on exit, abort and Ctrl-C)")
    return p


def validate_args(args, environ: dict[str, str]) -> None:
    """All refusal checks that must pass before the first request."""
    check_url_allowed(args.base_url)
    hits = scan_env_for_prod(environ)
    if hits:
        raise ProdGuardError(f"production host mentioned in env: {', '.join(hits)}")
    if not math.isfinite(args.ready_interval) or (args.ready_interval != 0 and args.ready_interval < 30):
        raise SystemExit("--ready-interval must be 0 or >= 30 seconds (finite)")
    args.max_speaking_grades = max(0, min(args.max_speaking_grades, MAX_SPEAKING_GRADES_CEILING))
    args.max_writing_grades = max(0, min(args.max_writing_grades, MAX_WRITING_GRADES_CEILING))
    # The synthetic WAV is 3 s, below the 15 s Part 1 minimum: graded uploads
    # would all fail on duration instead of measuring the grading path.
    if args.max_speaking_grades > 0 and not args.audio_file:
        raise SystemExit("--audio-file is required when --max-speaking-grades > 0 "
                         "(the default 3 s WAV is below the 15 s Part 1 minimum)")
    if "exam" in parse_mix(args.mix) and not args.bank_id:
        raise SystemExit("--bank-id is required when the mix includes the exam flow")
    args.class_items_list = [x.strip() for x in (args.class_items or "").split(",") if x.strip()]
    if args.class_items_list and args.class_item:
        raise SystemExit("use --class-item or --class-items, not both")
    if args.sessions_per_user < 1 or args.users < 1:
        raise SystemExit("--users and --sessions-per-user must be >= 1")
    if not math.isfinite(args.busy_wait_seconds) or args.busy_wait_seconds < 0:
        raise SystemExit("--busy-wait-seconds must be >= 0 (finite)")
    if not math.isfinite(args.busy_poll_seconds) or args.busy_poll_seconds <= 0:
        raise SystemExit("--busy-poll-seconds must be > 0 (finite)")


def ladder_steps(args) -> list[int]:
    if args.ladder:
        steps = [int(x) for x in args.ladder.split(",") if x.strip()]
        if not steps or any(s < 1 for s in steps):
            raise SystemExit("--ladder needs positive integers")
        return steps
    return [args.users]


async def amain(args, tokens: list[str]) -> dict:
    steps = ladder_steps(args)
    if args.class_items_list and len(args.class_items_list) != len(tokens):
        raise SystemExit(f"--class-items has {len(args.class_items_list)} ids for {len(tokens)} accounts")
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
        "args": {k: v for k, v in vars(args).items() if not k.startswith("_")},
        "backend_identity": {},
        "busy_check": ("skipped by operator" if args.skip_busy_check
                       else "github-actions: " + ", ".join(STAGING_WORKFLOWS)),
        "steps": [],
        "broke_at": None,
        "busy_stop": None,
    }
    grades = {"speaking": 0, "writing": 0}
    for i, users in enumerate(steps):
        if not args.skip_busy_check:
            update_busy_marker(args.busy_marker, args, f"busy check before {users} users")
            try:
                busy = await wait_until_staging_free(args)
            except BusyCheckError as exc:
                report["busy_stop"] = {"kind": "busy_check_failed", "users": users,
                                       "reason": f"busy check failed: {exc}",
                                       "steps_not_run": steps[i:]}
                break
            if busy:
                report["busy_stop"] = {"kind": "staging_busy", "users": users, "reason": busy,
                                       "steps_not_run": steps[i:]}
                break
        update_busy_marker(args.busy_marker, args, users)
        if i == 0:
            report["backend_identity"] = await read_backend_identity(args)
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
            update_busy_marker(args.busy_marker, args, f"cooldown after {users} users")
            await asyncio.sleep(args.step_cooldown_seconds)
    report["real_grading_calls"] = {
        k: sum(s["real_grading_calls"][k] for s in report["steps"]) for k in ("speaking", "writing")}
    report["generate_calls"] = sum(s.get("generate_calls", 0) for s in report["steps"])
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
    if args.busy_marker:
        try:
            create_busy_marker(args.busy_marker, args)
        except BusyCheckError as exc:
            print(f"[loadtest] REFUSED: {exc}", file=sys.stderr)
            return EXIT_BUSY_CHECK_REFUSED
    try:
        report = asyncio.run(amain(args, tokens))
    except ProdGuardError as exc:
        print(f"[loadtest] REFUSED mid-run: {exc}", file=sys.stderr)
        return 2
    finally:
        if args.busy_marker:
            Path(args.busy_marker).unlink(missing_ok=True)
    jpath, mpath, spath = write_outputs(report, args.out_dir)
    print(f"[loadtest] wrote {jpath}\n[loadtest] wrote {mpath}\n[loadtest] wrote {spath}", file=sys.stderr)
    if report["busy_stop"]:
        print(f"[loadtest] NOT RUN: steps {report['busy_stop']['steps_not_run']} users: "
              f"{report['busy_stop']['reason']}", file=sys.stderr)
        return (EXIT_STAGING_BUSY if report["busy_stop"]["kind"] == "staging_busy"
                else EXIT_BUSY_CHECK_REFUSED)
    return 0


if __name__ == "__main__":
    sys.exit(main())

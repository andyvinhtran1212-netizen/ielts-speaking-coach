"""
Health check endpoints for monitoring + Railway/uptime probes.

Two endpoints:
  GET /health        — fast (<500ms), no DB.  Returns {"status": "ok", ...}.
                       Wire this into Railway healthcheck + uptime probe.
  GET /health/ready  — comprehensive readiness check: DB connectivity,
                       critical tables present (proxy for "migrations applied"),
                       Gemini API key configured, feature-flag visibility.
                       Used pre-deploy + during incident triage.

Both endpoints are unauthenticated by design — they expose no PII and need
to be reachable by external probes.  Anonymous /health/ready callers get
per-check status codes only; table names, error strings and feature-flag
state are returned to admins (Bearer token) only.
"""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import contextvars
from datetime import datetime, timezone
import logging
import os
import time

from fastapi import APIRouter, Header

from config import settings
from database import supabase_admin
from services.grammar_content import grammar_service
from services import runtime_flags, curated_readiness

router = APIRouter(tags=["health"])
logger = logging.getLogger(__name__)

_REDACTED = "redacted (admin only)"


async def _is_admin(authorization: str | None) -> bool:
    """Soft admin check for health endpoints — returns bool, never raises.

    Health probes must stay reachable by anonymous external monitors, so we
    can't hard-gate the whole endpoint. Instead we redact fingerprinting detail
    (DB error strings, git SHA, deployment id) for non-admin callers while an
    authenticated admin still gets the full diagnostic.
    """
    if not authorization:
        return False
    # Imported lazily to avoid a health→admin import cycle at module load.
    from routers.admin import require_admin
    try:
        await require_admin(authorization)
        return True
    except Exception:
        return False

# Sprint 6.5 diagnostic constants — keep colocated so they update together
# when a new sprint adds mappings. EXPECTED_MAPPING_COUNT must equal the
# number of non-deferred entries in feedback-anchor-mapping.yaml on main.
# Sprint 7a Day 3 added 8 mappings + unfroze M030 → 40.
# Sprint 7b added M049 (missing-subjects) + M050 (missing-main-verbs) → 42.
# Sprint unfreeze (post-7c.3) dropped vestigial deferred_until: sprint-3
# from M016/M017/M025/M027/M028 (Sprint 3 shipped long ago, anchors
# already exist per drift gate) → 47.
# cce1f566b (2026-05-28, "expand wiki recommendation coverage") added
# M051–M064 for 13 newly covered articles without bumping this → 61.
# test_health_runtime_expected_count_matches_mapping_file pins it to the YAML.
_EXPECTED_MAPPING_COUNT  = 61
_SPRINT_6_SENTINEL_IDS   = ("M033", "M034", "M035")


# Critical tables that prove the relevant migrations have applied.  If any
# of these are missing the deploy is wedged — readers (e.g. the dashboard)
# would surface confusing 500s otherwise.  Order doesn't matter; we probe
# each independently so the failure list is precise.
_CRITICAL_TABLES = (
    "user_vocabulary",         # migration 019
    "vocabulary_exercises",    # migration 021
    "d1_sessions",             # migration 023
    "flashcard_stacks",        # migration 025
    "flashcard_reviews",       # migration 027
    "sessions",
    "responses",
    "reading_test_attempts",
    "reading_attempt_answers",
    "listening_test_attempts",
    "mock_exams",
    "mock_exam_sittings",
    "course_section_submissions",
    "course_pronunciation_submissions",
    "advanced_vocab_stage_progress",
    "advanced_vocab_practice_selections",
    "advanced_vocab_question_attempts",
    "advanced_vocab_listening_attempts",
    "advanced_vocab_rewrite_submissions",
)

# Projection failures catch missing columns, not merely missing tables. This
# bounded readiness sample is not a replacement for exact migration/RPC tests.
_CRITICAL_COLUMNS = {
    'sessions': 'id,overall_band,renderer_affinity,resume_expires_at',
    'responses': 'id,session_id,grading_status,overall_band,audio_storage_path',
    'reading_test_attempts': 'id,renderer_affinity,resume_expires_at,score,submitted_at',
    'reading_attempt_answers': 'attempt_id,q_num,user_answer',
    'listening_test_attempts': 'id,renderer_affinity,resume_expires_at,answers,score,submitted_at',
    'mock_exams': 'id,collection_sweep_completed_section',
    'mock_exam_sittings': 'id,collection_flush_acks,writing_submission',
    'course_section_submissions': 'id,attempt_no,content_snapshot,score',
    'course_pronunciation_submissions': 'id,attempt_no,duration_sec,status',
    'advanced_vocab_stage_progress': 'id,class_assignment_item_id,stage,status,evidence',
    'advanced_vocab_practice_selections': 'id,class_assignment_item_id,stage,qids',
    'advanced_vocab_question_attempts': 'id,class_assignment_item_id,stage,qid,is_correct',
    'advanced_vocab_listening_attempts': 'id,class_assignment_item_id,answers,answer_key,submitted_at',
    'advanced_vocab_rewrite_submissions': (
        'id,bank_id,user_id,class_assignment_item_id,answers,content_snapshot,'
        'feedback,status,model,prompt_version,error_code,provider_started_at,'
        'completed_at,created_at,updated_at'
    ),
}


@router.get("/health")
async def health_basic() -> dict:
    """Fast liveness probe.  Returns 200 + status="ok" unconditionally."""
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": os.environ.get("APP_VERSION", "next"),
    }


# A timeout bounds the response, but cannot stop a synchronous HTTP call in a
# thread. Retain each in-flight probe until it actually finishes so polling a
# stalled upstream cannot enqueue the same probe again after every cache TTL.
_READY_PROBE_TIMEOUT_SECONDS = 1.5
_READY_PROBE_TTL_SECONDS = 5.0
# Readiness owns a private pool: stalled probes (up to the 120 s transport
# timeout) must never occupy the shared default executor used by requests.
_READY_PROBE_WORKERS = 4
_READY_PROBE_POLL_SECONDS = 0.01
_ready_executor = ThreadPoolExecutor(
    max_workers=_READY_PROBE_WORKERS, thread_name_prefix='health-ready',
)
_ready_probe_tasks: dict[str, '_ReadyProbe'] = {}
_ready_probe_cache: tuple[float, dict] | None = None
_ready_probe_lock = asyncio.Lock()


class _ReadyProbe:
    def __init__(self):
        self.submitted = time.monotonic()
        self.started = None
        self.future = None

    def run(self, call):
        # The timeout starts here, when a worker runs the call, not at submit.
        self.started = time.monotonic()
        return call()

    def overdue(self, now):
        return (self.started is not None and not self.future.done()
                and now - self.started >= _READY_PROBE_TIMEOUT_SECONDS)


def _ready_queue_budget():
    # In-flight probes have distinct names, so at most N-1 = 20 wait ahead of
    # a queued probe. While it waits every worker is busy with them; if each
    # ran within its timeout T, it starts within (N-1)*T/W = 7.5 s. Still
    # queued after that means an earlier probe overran T (real degradation),
    # so healthy queueing alone can never produce a timeout.
    return (len(_CRITICAL_TABLES) + 1) * _READY_PROBE_TIMEOUT_SECONDS / _READY_PROBE_WORKERS


def _ready_probe_blocked(probe, now):
    if now - probe.submitted >= _ready_queue_budget():
        return True
    # Every worker holds a probe past its own timeout: nothing can start.
    overdue = sum(other.overdue(now) for other in _ready_probe_tasks.values())
    return overdue >= _READY_PROBE_WORKERS


async def _ready_probe(name, call):
    probe = _ready_probe_tasks.get(name)
    if probe is None:
        probe = _ReadyProbe()
        probe.future = asyncio.get_running_loop().run_in_executor(
            _ready_executor, contextvars.copy_context().run, probe.run, call,
        )
        _ready_probe_tasks[name] = probe

        def finished(done):
            if (current := _ready_probe_tasks.get(name)) is not None and current.future is done:
                _ready_probe_tasks.pop(name, None)
            # A timed-out caller may no longer be awaiting this future.
            if not done.cancelled():
                done.exception()

        probe.future.add_done_callback(finished)
    while True:
        now = time.monotonic()
        if probe.started is not None:
            wait = probe.started + _READY_PROBE_TIMEOUT_SECONDS - now
            if wait <= 0:
                return TimeoutError('probe timed out')
        elif _ready_probe_blocked(probe, now):
            return TimeoutError('probe not started: readiness workers held by timed-out probes')
        else:
            wait = _READY_PROBE_POLL_SECONDS
        done, _ = await asyncio.wait((probe.future,), timeout=wait)
        if done:
            try:
                return probe.future.result()
            except Exception as exc:
                return exc


def _ready_table(table, projection, limit):
    # Build each query inside its own thread; never share mutable builders.
    return supabase_admin.table(table).select(projection).limit(limit).execute()


def _ready_curated_schema():
    # Both helpers can perform synchronous DB reads on a cache miss.
    enabled = any(runtime_flags.is_enabled(key, default=False) for key in (
        'vocab_units_read', 'vocab_unit_attempts_write',
    ))
    if not enabled:
        return 'disabled'
    return 'ok' if curated_readiness.schema_available() else 'fail'


def _ready_error(exc):
    if isinstance(exc, TimeoutError):
        return str(exc) or 'probe timed out'
    return str(exc)


async def _collect_ready_checks(is_admin):
    global _ready_probe_cache
    database, *results = await asyncio.gather(
        _ready_probe('database', lambda: _ready_table('users', 'id', 1)),
        *(_ready_probe(table, lambda table=table: _ready_table(
            table, _CRITICAL_COLUMNS.get(table, 'id'), 0,
        )) for table in _CRITICAL_TABLES),
        _ready_probe('curated_schema', _ready_curated_schema),
    )
    curated = results.pop()
    checks = {'database': {'status': 'ok'}}
    if isinstance(database, Exception):
        error = _ready_error(database)
        logger.warning('[health] readiness DB probe failed: %s', error)
        checks['database'] = {'status': 'fail'}
        if is_admin:
            checks['database']['error'] = error[:200]

    # Preserve the critical column projections, zero-row limits, ordering and
    # existing admin-only diagnostics while running all table probes together.
    missing = [f'{table}: {_ready_error(result)[:80]}'
               for table, result in zip(_CRITICAL_TABLES, results)
               if isinstance(result, Exception)]
    checks['migrations'] = {'status': 'fail' if missing else 'ok'}
    if missing:
        logger.warning('[health] readiness critical-table probe failed: %s', missing)
    if is_admin:
        if missing:
            checks['migrations']['missing'] = missing
        else:
            checks['migrations']['verified'] = list(_CRITICAL_TABLES)
        checks['migrations']['scope'] = 'critical-table-columns; enabled curated migration ledger'

    checks['gemini_api'] = {'status': 'ok' if settings.GEMINI_API_KEY else 'missing_key'}
    checks['feature_flags'] = {'status': 'ok'}
    if is_admin:
        checks['feature_flags'].update({
            'vocab_bank_enabled': settings.VOCAB_BANK_FEATURE_FLAG_ENABLED,
            'd1_enabled': settings.D1_ENABLED,
            'd3_enabled': settings.D3_ENABLED,
            'flashcard_enabled': settings.FLASHCARD_ENABLED,
        })
    if isinstance(curated, Exception):
        logger.warning('[health] readiness curated probe failed: %s', _ready_error(curated))
        curated = 'fail'
    checks['curated_schema'] = {'status': curated}
    _ready_probe_cache = (time.monotonic(), {
        name: {'status': check['status']} for name, check in checks.items()
    })
    return checks


def _cached_ready_checks():
    if (_ready_probe_cache is not None
            and time.monotonic() - _ready_probe_cache[0] < _READY_PROBE_TTL_SECONDS):
        return {name: dict(check) for name, check in _ready_probe_cache[1].items()}
    return None


@router.get("/health/ready")
async def health_ready(authorization: str | None = Header(default=None)) -> dict:
    """
    Bounded critical-contract readiness probe. Always returns HTTP 200; the per-check
    statuses + the overall `status` field carry the verdict so monitors can
    differentiate "down" from "degraded" without juggling 5xx codes.

    Anonymous callers see only pass/fail statuses; the raw DB error string
    (which can leak hostname/schema hints) is included only for admins.
    """
    is_admin = await _is_admin(authorization)
    if is_admin:
        # Concurrent diagnostics share in-flight probes, including timeout
        # waits, without queuing a timeout per admin ahead of public monitors.
        checks = await _collect_ready_checks(True)
    else:
        checks = _cached_ready_checks()
        if checks is None:
            async with _ready_probe_lock:
                checks = _cached_ready_checks()
                if checks is None:
                    checks = await _collect_ready_checks(False)
    return {
        'status': 'ok' if all(check['status'] in ('ok', 'disabled')
                              for check in checks.values()) else 'degraded',
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'checks': checks,
    }


@router.get("/health/runtime")
async def health_runtime(authorization: str | None = Header(default=None)) -> dict:
    """
    Sprint 6.5 runtime diagnostic.  Surfaces the deployed git SHA + the
    grammar-mapping inventory the running process actually loaded so we
    can prove whether prod Railway is on stale code (Scenario A) vs the
    matcher itself dropping anchors (B/C/D).

    Mapping inventory stays public (open-source ids, no PII). The Railway
    deployment identifiers (git SHA, deployment/service/env names) aid
    fingerprinting, so they're redacted for anonymous callers and returned
    only to admins (an admin curl with a Bearer token still gets them).
    """
    is_admin = await _is_admin(authorization)
    mappings_by_slug = grammar_service._load_mappings()  # cached on service
    all_mapping_ids: list[str] = []
    for slug_mappings in mappings_by_slug.values():
        for m in slug_mappings:
            mid = m.get("mapping_id")
            if mid:
                all_mapping_ids.append(mid)

    sentinel_present = {
        sid: (sid in all_mapping_ids) for sid in _SPRINT_6_SENTINEL_IDS
    }
    sprint_6_loaded = all(sentinel_present.values())
    active_count = len(all_mapping_ids)

    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "git_sha":          os.environ.get("RAILWAY_GIT_COMMIT_SHA", "unknown") if is_admin else _REDACTED,
        "git_branch":       os.environ.get("RAILWAY_GIT_BRANCH", "unknown") if is_admin else _REDACTED,
        "deployment_id":    os.environ.get("RAILWAY_DEPLOYMENT_ID",  "unknown") if is_admin else _REDACTED,
        "service_name":     os.environ.get("RAILWAY_SERVICE_NAME",   "unknown") if is_admin else _REDACTED,
        "environment_name": os.environ.get("RAILWAY_ENVIRONMENT_NAME", "unknown") if is_admin else _REDACTED,
        "mappings": {
            "active_count":       active_count,
            "expected_count":     _EXPECTED_MAPPING_COUNT,
            "mappings_match":     active_count == _EXPECTED_MAPPING_COUNT,
            "sprint_6_loaded":    sprint_6_loaded,
            "sentinel_presence":  sentinel_present,
        },
    }


@router.get("/health/async-db")
async def health_async_db() -> dict:
    """
    P0-1 (C-1.1) async-DB scaffold status + event-loop-lag baseline.

    Reads the USE_ASYNC_DB flag, whether the async client has been initialised,
    and the rolling event-loop-lag stats from the monitor. With the flag OFF
    this is the "before" baseline: under real concurrency a blocking sync
    ``.execute()`` on the loop thread shows up as elevated lag_ms_p95/max here.
    Unauthenticated by design (no PII; booleans + timings).
    """
    from services import db_async, loop_monitor
    from database import async_client_initialised, async_pool_snapshot

    # PC-J55: ``aexecute`` is the flag-ON call stats (in-flight count and age
    # expose a hung upstream before any timeout fires), ``postgrest_pool`` the
    # async pool's connections (``None`` with the flag off), ``executor`` the
    # default thread pool that ``asyncio.to_thread`` sections share.
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "use_async_db": settings.USE_ASYNC_DB,
        "async_client_initialised": async_client_initialised(),
        "event_loop_lag": loop_monitor.snapshot(),
        "aexecute": db_async.snapshot(),
        "postgrest_pool": async_pool_snapshot(),
        "executor": _default_executor_snapshot(),
    }


def _default_executor_snapshot() -> dict | None:
    """Busy/queued threads of the loop's default executor (``to_thread``), or
    ``None`` before first use. Reads ThreadPoolExecutor internals defensively."""
    executor = getattr(asyncio.get_running_loop(), "_default_executor", None)
    if executor is None:
        return None
    try:
        threads = len(executor._threads)
        idle = executor._idle_semaphore._value
        return {
            "max_workers": executor._max_workers,
            "threads": threads,
            "busy": max(threads - idle, 0),
            "queued": executor._work_queue.qsize(),
        }
    except Exception:
        return {"unavailable": True}


# /health/grammar-check is public and each probe runs a full live grammar
# check (it bypasses the result cache by design, #1704). A short per-process
# TTL plus single-flight keeps anonymous polling from turning into unbounded
# LanguageTool work while a monitor still sees a fresh verdict.
_GRAMMAR_PROBE_TTL_SECONDS = 30.0
_grammar_probe_cache: tuple[float, dict] | None = None
_grammar_probe_lock = asyncio.Lock()


@router.get("/health/grammar-check")
async def health_grammar_check() -> dict:
    """
    Sprint 14.9 (Codex F5) — grammar-checker runtime probe.

    Exercises the real LanguageTool/JRE backend (which the unit tests do NOT —
    they cover only the regex rules), so a broken Java runtime on the deployed
    image surfaces here instead of silently degrading to regex-only. Always
    returns HTTP 200; the ``status`` field (healthy | degraded | error) carries
    the verdict, matching /health/ready's convention (no 5xx juggling).
    Results are reused for ``_GRAMMAR_PROBE_TTL_SECONDS``; ``checked_at`` is
    when the live probe ran.
    """
    from services.grammar_check import grammar_check_health

    global _grammar_probe_cache
    async with _grammar_probe_lock:
        now = time.monotonic()
        if _grammar_probe_cache is None or now - _grammar_probe_cache[0] >= _GRAMMAR_PROBE_TTL_SECONDS:
            result = await grammar_check_health()
            checked_at = datetime.now(timezone.utc).isoformat()
            _grammar_probe_cache = (time.monotonic(), {"result": result, "checked_at": checked_at})
        cached = _grammar_probe_cache[1]
    return {
        "status": cached["result"]["status"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "checked_at": cached["checked_at"],
        "grammar_check": cached["result"],
    }


@router.get("/health/quiz-write")
async def health_quiz_write() -> dict:
    """Probe that quiz progress-saving works — i.e. PostgREST recognizes the ON
    CONFLICT unique constraints (migration 119) that log_progress upserts depend
    on. This catches the exact failure that silently broke vocab/grammar quiz
    progress (every POST .../progress → 500 "no unique constraint matching ON
    CONFLICT") after a manual migration without a PostgREST schema reload, while
    quiz_sessions inserts kept working. Always HTTP 200; the ``status`` field
    (healthy | error) carries the verdict.
    """
    from services.quiz_service import quiz_write_health

    result = quiz_write_health()
    return {
        "status": "healthy" if result["ok"] else "error",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "quiz_write": result,
    }

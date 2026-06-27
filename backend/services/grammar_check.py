"""
services.grammar_check — Sprint 14.8

Wraps the Sprint 14.x grammar asset (assets/grammar-mindmap/) so the
grading pipeline can enrich its `grammar_issues` field with structured,
positional errors:

  - LanguageTool (offline JRE → online API → silent fail) for generic
    English grammar errors.
  - The asset's VI-learner regex layer (run_local_rules) for
    Vietnamese-speaker patterns that LT often misses: missing subject,
    article omission, copula confusion, etc.

Locks honoured (Sprint 14.8 commission):

  L1   Wrap, don't rewrite — the asset stays canonical; the service is
       an adapter that handles async + caching + timeout + telemetry +
       schema normalisation.
  L3   Lazy init — LTBackend is constructed on first request (cold
       start ~5s, subsequent calls reuse). Module import is side-
       effect-free so tests + CI don't pay the cost.
  L4   Cache by SHA256(transcript) with 24h TTL via the new
       grammar_check_cache table (migration 075).
  L5/6 Errors are grouped by `category` and rendered with positional
       offsets so the frontend can underline the offending spans on
       the transcript.
  L8   Top 10 errors displayed (priority = severity weight); the full
       total_count surfaces in the response so the UI can show
       "+N more" without overstuffing the panel.
  L9   Silent skip on any failure path (LT unavailable, parse error,
       timeout). Grading proceeds; the response carries grammar_issues=None.
  L10  Hard 15s timeout via asyncio.wait_for.
  L11  VN-learner regex always runs even when LT is unavailable —
       the local rules don't need Java.
  L12  Events persisted to grading_events with event_kind='grammar_check'.
  L13  Failures bubble up as best-effort log entries; the orchestrator's
       error classification isn't used here because the asset doesn't
       have providers in the Sprint 14.3 sense.
  L16  Backward-compat — frontend tolerates `grammar_issues=None`.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

from database import supabase_admin

from .grading_providers.errors import FallbackEvent
from .grading_telemetry import log_fallback_events

logger = logging.getLogger(__name__)


# ── Constants ─────────────────────────────────────────────────────────────────

GRAMMAR_CHECK_TIMEOUT_SECONDS:   float = 15.0      # L10
GRAMMAR_CACHE_TTL_HOURS:         int   = 4         # L4 — Mục 20 (B3): was 24h; a grammar-rules/asset update should not be served stale for up to a day
MAX_DISPLAYED_ERRORS:            int   = 10        # L8
_CACHE_TABLE:                    str   = "grammar_check_cache"

# Asset path — added to sys.path lazily so import errors don't break
# the whole backend boot when the asset directory is missing in a
# stripped-down deployment (e.g. early CI runs before assets/ landed).
_ASSET_DIR = Path(__file__).resolve().parent.parent.parent / "assets" / "grammar-mindmap"


# ── Category taxonomy + severity weighting ───────────────────────────────────


# Maps the asset's ruleId-prefix / category-string to a stable
# taxonomy key. Anything unmatched falls into "other" so the UI
# always has *something* to group under.
_CATEGORY_MAP: dict[str, str] = {
    # VI-learner local rules — prefixed with LOCAL_ by run_local_rules.
    "LOCAL_MISSING_TO_BE_BEFORE_ADJECTIVE":   "copula",
    "LOCAL_MISSING_SUBJECT":                  "missing_subject",
    "LOCAL_SUBJECT_VERB_AGREEMENT":           "subject_verb_agreement",
    "LOCAL_ARTICLE_OMISSION":                 "article",
    "LOCAL_WRONG_TENSE":                      "tense",
    "LOCAL_BARE_INFINITIVE":                  "verb_form",
    # LanguageTool category strings (high-level buckets observed in
    # the asset's online JSON shape).
    "TYPOS":         "spelling",
    "TYPOGRAPHY":    "spelling",
    "GRAMMAR":       "grammar",
    "MISC":          "other",
    "STYLE":         "style",
    "PUNCTUATION":   "punctuation",
    "REDUNDANCY":    "style",
    "COLLOCATIONS":  "vocabulary",
}

# Severity defaults — weighted toward what an IELTS speaking learner
# would benefit most from seeing. Tense, subject-verb agreement and
# missing-subject are high-impact; spelling/style are low.
_DEFAULT_SEVERITY_BY_CATEGORY: dict[str, str] = {
    "tense":                  "high",
    "subject_verb_agreement": "high",
    "missing_subject":        "high",
    "verb_form":              "high",
    "article":                "medium",
    "preposition":            "medium",
    "copula":                 "medium",
    "grammar":                "medium",
    "vocabulary":             "medium",
    "punctuation":            "low",
    "spelling":               "low",
    "style":                  "low",
    "other":                  "low",
}

_SEVERITY_WEIGHT: dict[str, int] = {"high": 3, "medium": 2, "low": 1}


# ── Public dataclasses ────────────────────────────────────────────────────────


@dataclass(frozen=True)
class GrammarError:
    category:                str
    original_text:           str
    suggestion:              str
    explanation_vn:          str
    transcript_offset_start: int
    transcript_offset_end:   int
    severity:                str


@dataclass(frozen=True)
class GrammarCheckResult:
    errors:          list[GrammarError] = field(default_factory=list)
    total_count:     int                = 0
    displayed_count: int                = 0
    cached:          bool               = False


# ── Hashing ──────────────────────────────────────────────────────────────────


def _hash_transcript(transcript: str) -> str:
    """L4 cache key — normalise then SHA256 hex-encode."""
    normalised = (transcript or "").lower().strip()
    return hashlib.sha256(normalised.encode("utf-8")).hexdigest()


# ── Normalisation: asset finding → GrammarError ──────────────────────────────


def _categorise(finding: dict) -> str:
    """Map a raw asset finding to a taxonomy key."""
    rule_id = (finding.get("ruleId") or "").upper()
    category_raw = (finding.get("category") or "").upper()
    return (
        _CATEGORY_MAP.get(rule_id)
        or _CATEGORY_MAP.get(category_raw)
        or "other"
    )


def _explanation_vn(finding: dict, fallback_text: str) -> str:
    """Pull the bilingual tip from the asset's enriched finding, else
    fall back to the LT message (which is English but actionable)."""
    tip = finding.get("_tip") or {}
    vn = (tip.get("tip_vi") or "").strip()
    if vn:
        return vn[:300]
    # The LT message is technical English ("Use 'is' instead of 'are'");
    # surfacing it is better than nothing.
    return (fallback_text or "")[:300]


def _normalise_finding(finding: dict, transcript: str) -> GrammarError:
    category    = _categorise(finding)
    severity    = _DEFAULT_SEVERITY_BY_CATEGORY.get(category, "medium")
    offset      = int(finding.get("offset", 0))
    err_length  = int(finding.get("errorLength", 0))
    original    = transcript[offset:offset + err_length] if err_length > 0 else ""
    replacements = finding.get("replacements") or []
    suggestion  = (replacements[0] if replacements else "") or ""
    message     = finding.get("message") or ""

    return GrammarError(
        category=category,
        original_text=original,
        suggestion=suggestion,
        explanation_vn=_explanation_vn(finding, message),
        transcript_offset_start=offset,
        transcript_offset_end=offset + err_length,
        severity=severity,
    )


# ── Cache adapters ───────────────────────────────────────────────────────────


def _cache_get(transcript_sha: str) -> Optional[GrammarCheckResult]:
    """Best-effort cache read. Returns None on any error (silent skip
    matches L9). Treats rows older than the TTL as cache misses."""
    try:
        res = (
            supabase_admin.table(_CACHE_TABLE)
            .select("payload, created_at")
            .eq("transcript_sha", transcript_sha)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.debug("[grammar_check] cache_get skipped (non-fatal): %s", exc)
        return None

    rows = res.data or []
    if not rows:
        return None

    row = rows[0]
    # TTL check — payload age vs 24h. created_at is ISO-8601 with timezone.
    try:
        from datetime import datetime, timedelta, timezone
        created = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
        if datetime.now(timezone.utc) - created > timedelta(hours=GRAMMAR_CACHE_TTL_HOURS):
            return None
    except Exception:
        # If the timestamp is unparseable we fall through and trust
        # the row; a stale row is harmless beyond noise.
        pass

    try:
        payload = row["payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)
        errors = [GrammarError(**e) for e in payload.get("errors", [])]
        return GrammarCheckResult(
            errors=errors,
            total_count=int(payload.get("total_count", len(errors))),
            displayed_count=int(payload.get("displayed_count", len(errors))),
            cached=True,
        )
    except Exception as exc:
        logger.debug("[grammar_check] cache row malformed (treated as miss): %s", exc)
        return None


def _cache_set(transcript_sha: str, result: GrammarCheckResult) -> None:
    """Best-effort upsert. Never raises."""
    try:
        payload = {
            "errors":          [asdict(e) for e in result.errors],
            "total_count":     result.total_count,
            "displayed_count": result.displayed_count,
        }
        supabase_admin.table(_CACHE_TABLE).upsert(
            {
                "transcript_sha": transcript_sha,
                "payload":        payload,
                "error_count":    result.total_count,
            },
            on_conflict="transcript_sha",
        ).execute()
    except Exception as exc:
        logger.debug("[grammar_check] cache_set skipped (non-fatal): %s", exc)


# ── The service ──────────────────────────────────────────────────────────────


class GrammarCheckService:
    """Async-friendly facade over the asset's sync backend.

    Construction is cheap; the heavyweight LTBackend (which loads Java
    + LanguageTool dictionaries) is constructed lazily on first .check()
    so module import + test runs don't pay the cost.
    """

    def __init__(self, timeout_seconds: float = GRAMMAR_CHECK_TIMEOUT_SECONDS):
        self._backend: Any | None = None
        self._backend_init_failed: bool = False
        self._timeout_seconds: float = timeout_seconds

    def _ensure_asset_on_path(self) -> None:
        asset_str = str(_ASSET_DIR)
        if asset_str not in sys.path:
            sys.path.insert(0, asset_str)

    def _ensure_backend(self) -> Any | None:
        """L3 — lazy init. Returns the LTBackend instance, or None if
        construction is unavailable (Java missing, asset stripped,
        etc.) so the caller can fall back to local rules only."""
        if self._backend is not None:
            return self._backend
        if self._backend_init_failed:
            return None
        try:
            self._ensure_asset_on_path()
            import grammar_checker as _gc  # type: ignore[import-not-found]
            self._backend = _gc.LTBackend(prefer_offline=True, language="en-US")
            logger.info("[grammar_check] LTBackend initialised in mode=%s", self._backend.mode)
        except Exception as exc:
            logger.warning(
                "[grammar_check] LTBackend init failed — falling back to local "
                "rules only (non-fatal): %s",
                exc,
            )
            self._backend_init_failed = True
            return None
        return self._backend

    def _run_sync(self, transcript: str) -> GrammarCheckResult:
        """Synchronous worker — called inside asyncio.to_thread so the
        Java/HTTP-bound check doesn't block the event loop.

        L11 — the VI-learner regex rules ALWAYS run; LanguageTool's
        output is layered on top when the backend is available.
        """
        self._ensure_asset_on_path()
        import grammar_checker as _gc  # type: ignore[import-not-found]

        local_findings = _gc.run_local_rules(transcript)

        backend = self._ensure_backend()
        lt_findings: list[dict] = []
        if backend is not None:
            try:
                lt_findings = backend.check(transcript)
            except Exception as exc:
                logger.info(
                    "[grammar_check] LTBackend.check failed mid-call (continuing "
                    "with local rules only): %s",
                    exc,
                )

        merged = _gc.merge_findings(transcript, lt_findings, local_findings)
        all_errors = [_normalise_finding(f, transcript) for f in merged]

        # L8 — prioritise by severity weight, cap displayed at 10.
        prioritised = sorted(
            all_errors,
            key=lambda e: _SEVERITY_WEIGHT.get(e.severity, 1),
            reverse=True,
        )
        displayed = prioritised[:MAX_DISPLAYED_ERRORS]

        return GrammarCheckResult(
            errors=displayed,
            total_count=len(all_errors),
            displayed_count=len(displayed),
            cached=False,
        )

    async def check(
        self,
        transcript: str,
        *,
        question_id: Optional[str] = None,
        session_id: Optional[str] = None,
        response_id: Optional[str] = None,
    ) -> Optional[GrammarCheckResult]:
        """Run the check and return a result, or ``None`` on silent skip.

        Silent-skip conditions (L9):
          - empty/whitespace transcript (no signal possible)
          - 15s timeout (L10)
          - any uncaught exception inside the sync worker
        """
        if not transcript or not transcript.strip():
            return None

        sha = _hash_transcript(transcript)
        cached = _cache_get(sha)
        if cached is not None:
            logger.info("[grammar_check] cache hit (%d errors)", cached.total_count)
            return cached

        events: list[FallbackEvent] = []
        start = time.monotonic()

        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(self._run_sync, transcript),
                timeout=self._timeout_seconds,
            )
        except asyncio.TimeoutError:
            latency_ms = int((time.monotonic() - start) * 1000)
            logger.info(
                "[grammar_check] timeout after %.1fs — silent skip (L10)",
                self._timeout_seconds,
            )
            events.append(FallbackEvent(
                provider="grammar_check",
                attempt=0,
                outcome="non_retryable",
                latency_ms=latency_ms,
                error_status="timeout",
                error_type="TimeoutError",
            ))
            self._persist_events(events, session_id, question_id, response_id)
            return None
        except Exception as exc:
            latency_ms = int((time.monotonic() - start) * 1000)
            logger.warning(
                "[grammar_check] worker raised %s — silent skip (L9): %s",
                type(exc).__name__, exc,
            )
            events.append(FallbackEvent(
                provider="grammar_check",
                attempt=0,
                outcome="non_retryable",
                latency_ms=latency_ms,
                error_status="exception",
                error_type=type(exc).__name__,
            ))
            self._persist_events(events, session_id, question_id, response_id)
            return None

        latency_ms = int((time.monotonic() - start) * 1000)
        events.append(FallbackEvent(
            provider="grammar_check",
            attempt=0,
            outcome="success",
            latency_ms=latency_ms,
        ))
        self._persist_events(events, session_id, question_id, response_id)

        _cache_set(sha, result)
        return result

    def _persist_events(
        self,
        events: list[FallbackEvent],
        session_id: Optional[str],
        question_id: Optional[str],
        response_id: Optional[str],
    ) -> None:
        if not events:
            return
        log_fallback_events(
            session_id=session_id,
            question_id=question_id,
            response_id=response_id,
            events=events,
            event_kind="grammar_check",
        )


# ── Module-level singleton + test seam ───────────────────────────────────────


_service: GrammarCheckService | None = None


def get_grammar_check_service() -> GrammarCheckService:
    """Lazy singleton — shared LTBackend across requests so Java
    cold-start cost is paid once per process."""
    global _service
    if _service is None:
        _service = GrammarCheckService()
    return _service


async def grammar_check_health() -> dict:
    """Sprint 14.9 (Codex F5) — deploy-time runtime probe for the grammar
    checker.

    The unit tests cover the VI-learner regex rules but NOT the real
    LanguageTool/JRE backend production depends on (Codex F5). This forces the
    lazy LTBackend to initialise and runs a check on a known-bad transcript, so
    a broken Java/LanguageTool runtime surfaces as ``degraded`` rather than
    silently falling back to regex-only.

    Always returns a dict — never raises (Pattern #29 silent-skip). The caller
    maps it onto an always-200 health response per the repo's probe convention.
    """
    svc = get_grammar_check_service()
    out: dict = {
        "status": "unknown",
        "languagetool_available": False,
        "backend_mode": None,
        "sample_error_count": 0,
        "messages": [],
    }
    # Subject-verb-agreement errors a working checker must catch.
    sample = "I goes to school yesterday and I doesn't have time."
    try:
        # Force the lazy (~5s) LTBackend init off the event loop.
        backend = await asyncio.to_thread(svc._ensure_backend)
        out["languagetool_available"] = backend is not None and not svc._backend_init_failed
        out["backend_mode"] = getattr(backend, "mode", None) if backend is not None else None

        result = await svc.check(sample)
        out["sample_error_count"] = result.total_count if result else 0

        if svc._backend_init_failed:
            out["status"] = "degraded"
            out["messages"].append("LanguageTool/JRE backend init failed — local VI-learner rules only")
        elif out["sample_error_count"] <= 0:
            out["status"] = "degraded"
            out["messages"].append("0 errors detected for a known-bad transcript")
        else:
            out["status"] = "healthy"
    except Exception as e:  # a health probe must never raise
        out["status"] = "error"
        out["messages"].append(str(e)[:200])
    return out


def set_grammar_check_service(service: GrammarCheckService | None) -> None:
    """Test seam — inject a stub or reset to None."""
    global _service
    _service = service

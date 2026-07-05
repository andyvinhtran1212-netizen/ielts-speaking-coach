"""kp_evidence — record learning signals and roll them into KP mastery (Phase 1).

Rule-based, NO AI at runtime (the quality bar: mastery must be canonical and
explainable). Every skill funnels its signals here through one of the record_*
helpers, so a learner's grammar/vocab profile is unified across Speaking, SRS,
exams and quizzes instead of living in parallel tables.

Model weights (plan §2.3 — microcheck > exam_item > implicit) and the time-decay
are centralized below as tunable constants. `compute_mastery` is a PURE function
(unit-tested without a DB); the record/recompute paths are best-effort against
the DB and NEVER raise into a caller's critical path (mirrors
grading._save_grammar_recommendations — non-fatal, non-blocking).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from database import supabase_admin
from services import kp_registry
from services.content_import_service import slugify

logger = logging.getLogger(__name__)

# ── Tunable model (plan §2.3) ────────────────────────────────────────────────
# Weight by evidence source. Ordering is the contract; the exact numbers are
# tunable. microcheck (explicit recall) > direct answer (exam/quiz/srs) > implicit.
WEIGHTS: dict[str, float] = {
    "microcheck":        3.0,
    "exam_right":        2.0,
    "exam_wrong":        2.0,
    "quiz":              2.0,
    "srs_review":        2.0,
    "distractor_chosen": 1.0,
    "speaking_feedback": 1.0,
    "writing_feedback":  1.0,
}

VALID_SOURCES = frozenset(WEIGHTS)

# Recent evidence counts more: an evidence's weight halves every HALF_LIFE_DAYS.
# Same time-based spirit as services/retention.py (there: hard expiry windows;
# here: a continuous decay factor), so mastery fades if a KP is left unpracticed.
HALF_LIFE_DAYS = 30.0

# score buckets → status. Symmetric: two fresh direct-answer signals (2×±1×~1.0)
# push to strong/weak; anything mixed/thin stays 'learning'.
STRONG_THRESHOLD = 2.0

# rating → signal for SRS reviews.
_SRS_SIGNAL = {"good": 1, "easy": 1, "hard": -1, "again": -1}


def _parse_ts(value) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def _decay(age_days: float) -> float:
    """Evidence weight multiplier for something `age_days` old (1.0 fresh → 0.5 at
    one half-life). Never negative; future-dated rows (clock skew) clamp to 1.0."""
    if age_days <= 0:
        return 1.0
    return 0.5 ** (age_days / HALF_LIFE_DAYS)


# ── pure aggregate ───────────────────────────────────────────────────────────

def compute_mastery(evidence_rows: list[dict], now: Optional[datetime] = None) -> dict:
    """Roll evidence rows ({signal, weight, created_at}) into a mastery snapshot.

    score = Σ signal · weight · decay(age). status buckets the score. Pure and
    deterministic given `now` — the record path passes an explicit now so the
    stored snapshot is reproducible."""
    now = now or datetime.now(timezone.utc)
    score = 0.0
    last_at: Optional[datetime] = None
    for r in evidence_rows:
        ts = _parse_ts(r.get("created_at"))
        if ts is None:
            age_days = 0.0
        else:
            age_days = max(0.0, (now - ts).total_seconds() / 86400.0)
            if last_at is None or ts > last_at:
                last_at = ts
        try:
            signal = float(r.get("signal") or 0)
            weight = float(r.get("weight") if r.get("weight") is not None else 1.0)
        except (TypeError, ValueError):
            continue
        score += signal * weight * _decay(age_days)

    if score >= STRONG_THRESHOLD:
        status = "strong"
    elif score <= -STRONG_THRESHOLD:
        status = "weak"
    else:
        status = "learning"

    return {
        "score": round(score, 4),
        "status": status,
        "evidence_count": len(evidence_rows),
        "last_evidence_at": last_at.isoformat() if last_at else None,
    }


# ── KP id resolution (cache the small, stable knowledge_points table) ─────────

_kp_index: Optional[dict[tuple, str]] = None


def _load_kp_index() -> dict[tuple, str]:
    global _kp_index
    if _kp_index is not None:
        return _kp_index
    idx: dict[tuple, str] = {}
    start = 0
    while True:
        rows = (supabase_admin.table("knowledge_points")
                .select("id,kp_type,ref_slug,anchor")
                .range(start, start + 999).execute().data or [])
        for r in rows:
            idx[(r["kp_type"], r["ref_slug"], r.get("anchor") or "")] = r["id"]
        if len(rows) < 1000:
            break
        start += 1000
    _kp_index = idx
    return idx


def reset_kp_index_cache() -> None:
    """Drop the cached KP index (call after seeding new KPs in a live process)."""
    global _kp_index
    _kp_index = None


def resolve_kp_id(kp_type: str, ref_slug: str, anchor: str = "") -> Optional[str]:
    return _load_kp_index().get((kp_type, ref_slug, anchor or ""))


# ── record + recompute (best-effort DB) ──────────────────────────────────────

def recompute_mastery(user_id: str, kp_id: str, now: Optional[datetime] = None) -> Optional[dict]:
    """Re-derive user_kp_mastery for one (user, kp) from ALL its evidence and
    upsert the snapshot. Returns the snapshot, or None on DB error."""
    now = now or datetime.now(timezone.utc)
    try:
        rows = (supabase_admin.table("kp_evidence")
                .select("signal,weight,created_at")
                .eq("user_id", user_id).eq("kp_id", kp_id)
                .execute().data or [])
        agg = compute_mastery(rows, now)
        # Atomic, non-regressing upsert (fn_upsert_kp_mastery, mig 132): a stale
        # compute over fewer rows can't clobber a fresher aggregate under
        # concurrent evidence writes for the same (user, kp).
        supabase_admin.rpc("fn_upsert_kp_mastery", {
            "p_user":   user_id,
            "p_kp":     kp_id,
            "p_score":  agg["score"],
            "p_status": agg["status"],
            "p_count":  agg["evidence_count"],
            "p_last":   agg["last_evidence_at"],
            "p_now":    now.isoformat(),
        }).execute()
        return agg
    except Exception as e:  # noqa: BLE001 — best-effort, never fatal
        logger.warning("[kp] recompute_mastery failed user=%s kp=%s: %s", user_id, kp_id, e)
        return None


def record_evidence(user_id: str, *, kp_type: str, ref_slug: str, anchor: str = "",
                    source: str, signal: int, context: Optional[dict] = None) -> Optional[str]:
    """Insert one kp_evidence row (weight derived from source) + recompute mastery.
    Returns the kp_id written, or None if the KP doesn't resolve / source invalid.
    Raises on DB failure — callers on a critical path use record_evidence_safe."""
    if source not in VALID_SOURCES:
        logger.warning("[kp] unknown evidence source '%s' — skipped", source)
        return None
    if signal not in (-1, 1):
        logger.warning("[kp] invalid signal %r (must be ±1) — skipped", signal)
        return None
    kp_id = resolve_kp_id(kp_type, ref_slug, anchor)
    if not kp_id:
        logger.info("[kp] no KP for (%s, %s, %s) — evidence skipped", kp_type, ref_slug, anchor)
        return None
    supabase_admin.table("kp_evidence").insert({
        "user_id": user_id, "kp_id": kp_id, "source": source,
        "signal":  signal,  "weight": WEIGHTS[source], "context": context or {},
    }).execute()
    recompute_mastery(user_id, kp_id)
    return kp_id


def record_evidence_safe(user_id: str, **kwargs) -> Optional[str]:
    """Never-raising wrapper for wiring into critical paths (grading, review
    submit). A failure here must never break the user-facing flow."""
    try:
        return record_evidence(user_id, **kwargs)
    except Exception as e:  # noqa: BLE001
        logger.warning("[kp] record_evidence failed (non-fatal): %s", e)
        return None


# ── skill-signal wiring helpers ──────────────────────────────────────────────

def record_speaking_feedback(user_id: str, slug: str, anchor: Optional[str] = None,
                             context: Optional[dict] = None) -> Optional[str]:
    """A Speaking grammar_recommendation (a detected error) → a -1 grammar signal
    (source=speaking_feedback). Resolves to the article-level KP when no anchor."""
    return record_evidence_safe(
        user_id, kp_type="grammar", ref_slug=slug, anchor=anchor or "",
        source="speaking_feedback", signal=-1, context=context)


def record_srs_review(user_id: str, headword: str, rating: str,
                      context: Optional[dict] = None) -> Optional[str]:
    """A flashcard self-rating → a ±1 vocab signal (source=srs_review). Maps the
    headword to a vocab KP by slug; unmapped words (no vocab_card KP) are skipped."""
    signal = _SRS_SIGNAL.get(rating)
    if signal is None or not headword:
        return None
    return record_evidence_safe(
        user_id, kp_type="vocab", ref_slug=slugify(headword), anchor="",
        source="srs_review", signal=signal, context=context)


def record_microcheck(user_id: str, *, kp_type: str, ref_slug: str, anchor: str = "",
                      correct: bool, context: Optional[dict] = None) -> Optional[str]:
    """A stepper micro-check answer → the HIGHEST-weight, explicit ±1 signal
    (source=microcheck, plan §2.3 Tier-2). Direct 1-1 evidence about one KP."""
    return record_evidence_safe(
        user_id, kp_type=kp_type, ref_slug=ref_slug, anchor=anchor,
        source="microcheck", signal=1 if correct else -1, context=context)


# ── mastery read (canonical, backend-owned) ──────────────────────────────────

def get_user_mastery(user_id: str, *, status: Optional[str] = None,
                     kp_type: Optional[str] = None, limit: int = 1000) -> list[dict]:
    """The learner's KP mastery profile — user_kp_mastery joined to its KP. Each
    item flattens the KP pointer (kp_type/ref_slug/anchor/level) next to the
    score/status. Read-only; returns [] on any DB error."""
    try:
        q = (supabase_admin.table("user_kp_mastery")
             .select("kp_id,score,status,evidence_count,last_evidence_at,updated_at,"
                     "knowledge_points(kp_type,ref_slug,anchor,level)")
             .eq("user_id", user_id))
        if status:
            q = q.eq("status", status)
        rows = q.limit(limit).execute().data or []
    except Exception as e:  # noqa: BLE001
        logger.warning("[kp] get_user_mastery failed user=%s: %s", user_id, e)
        return []
    out: list[dict] = []
    for r in rows:
        kp = r.get("knowledge_points") or {}
        if kp_type and kp.get("kp_type") != kp_type:
            continue
        # {title, category?} so the frontend shows a real title and can deep-link
        # grammar KPs to /grammar/{category}/{slug}.
        meta = kp_registry.label_for(kp.get("kp_type"), kp.get("ref_slug"))
        out.append({
            "kp_id":            r.get("kp_id"),
            "kp_type":          kp.get("kp_type"),
            "ref_slug":         kp.get("ref_slug"),
            "anchor":           kp.get("anchor") or "",
            "level":            kp.get("level") or "",
            "title":            meta.get("title"),
            "category":         meta.get("category"),
            "score":            r.get("score"),
            "status":           r.get("status"),
            "evidence_count":   r.get("evidence_count"),
            "last_evidence_at": r.get("last_evidence_at"),
        })
    return out

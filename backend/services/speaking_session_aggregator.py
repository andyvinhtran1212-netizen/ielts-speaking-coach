"""services/speaking_session_aggregator.py — Compute session band aggregate.

Sprint 5.0 foundation for the Phase B Speaking dashboard. Many sessions
have NULL `band_fc` / `band_lr` / `band_gra` / `band_p` (pre-Phase B
grading runs only populated `overall_band`); the dashboard needs a
single aggregate object that uses session-level columns where present
and falls back to per-response averages where they're not.

This module is **read-only**. It does NOT update the `sessions` row —
a future background-job sprint can backfill the columns for completed
historical sessions; for now we compute on-demand.

Source provenance is tracked on the result so downstream UI can:
  - render confidence affordances ("4 criteria from 3 responses")
  - skip averaging into longer trends if data quality is mixed
  - debug why a number is what it is

Pronunciation conversion: `pronunciation_score` is on a 0-100 scale
(Azure speech assessment); IELTS pronunciation band is 0-9. Using
`score / 10` as a linear heuristic matches the rough mapping Azure
publishes (60 → 6.0 etc). This is a known approximation; Sprint 5.1
dashboard QA may refine it.
"""

from __future__ import annotations

import logging
from typing import Optional
from uuid import UUID

from pydantic import BaseModel

from database import supabase_admin

logger = logging.getLogger(__name__)


# Session-level rubric columns the aggregator reads + writes through.
_SESSION_BAND_FIELDS = ("overall_band", "band_fc", "band_lr", "band_gra", "band_p")


class SessionBandAggregate(BaseModel):
    """Session-level band aggregate with provenance tracking.

    Any band field can still be `None` when there's no data to populate it
    (e.g., session in_progress with 0 graded responses, or a criterion
    that only lives at session-rubric level — band_fc/lr/gra cannot be
    derived from per-response columns and stay None when the session
    columns are NULL).
    """
    overall_band: Optional[float] = None
    band_fc: Optional[float] = None
    band_lr: Optional[float] = None
    band_gra: Optional[float] = None
    band_p: Optional[float] = None

    # `source` describes how the band fields were populated:
    #   "session_columns"        — every value came from the sessions row
    #   "computed_from_responses" — every value came from response averaging
    #   "mixed"                   — some session columns + some computed
    #   "no_data"                 — session row missing AND no graded responses
    source: str = "no_data"
    response_count: int = 0
    responses_with_grading: int = 0


def compute_session_band_aggregate(session_id: UUID) -> SessionBandAggregate:
    """Build the band aggregate for one session.

    Strategy (per the spec):
      1. Fetch the session row. If all 4 criteria + overall are populated,
         return early with `source='session_columns'` — no response query
         needed.
      2. Otherwise fetch the responses for the session, average over the
         ones with `grading_status='completed'`, and fill any gaps left
         by the session columns.
      3. `source` reports what actually happened:
         - all values from the session row → `session_columns`
         - all values from response averaging → `computed_from_responses`
         - any blend → `mixed`
         - both empty → `no_data`

    Field-by-field:
      - `overall_band` averages graded responses' `overall_band` when the
        session column is NULL.
      - `band_p` averages `pronunciation_score / 10` (0-100 → 0-9).
      - `band_fc` / `band_lr` / `band_gra` have NO per-response equivalent
        — they're rubric judgements that only live at session level. They
        stay `None` when the session column is NULL.
    """
    session_resp = supabase_admin.table("sessions").select(
        "overall_band, band_fc, band_lr, band_gra, band_p",
    ).eq("id", str(session_id)).limit(1).execute()

    session_data: dict = (session_resp.data or [{}])[0] or {}

    has_full_session_level = all(
        session_data.get(f) is not None for f in _SESSION_BAND_FIELDS
    )

    # Fast path — session row already has everything we need.
    if has_full_session_level:
        return SessionBandAggregate(
            overall_band=float(session_data["overall_band"]),
            band_fc=float(session_data["band_fc"]),
            band_lr=float(session_data["band_lr"]),
            band_gra=float(session_data["band_gra"]),
            band_p=float(session_data["band_p"]),
            source="session_columns",
        )

    # Fallback — fetch responses so we can fill gaps.
    responses_resp = supabase_admin.table("responses").select(
        "overall_band, pronunciation_score, grading_status",
    ).eq("session_id", str(session_id)).execute()
    responses = responses_resp.data or []
    graded = [
        r for r in responses
        if r.get("grading_status") == "completed"
        and r.get("overall_band") is not None
    ]

    aggregate = SessionBandAggregate(
        response_count=len(responses),
        responses_with_grading=len(graded),
    )

    # Carry over any non-NULL session-level fields so we don't recompute
    # things the row already knows.
    session_filled: list[str] = []
    for field in _SESSION_BAND_FIELDS:
        val = session_data.get(field)
        if val is not None:
            setattr(aggregate, field, float(val))
            session_filled.append(field)

    # Response-driven gap fills.
    response_filled: list[str] = []
    if graded:
        if aggregate.overall_band is None:
            bands = [float(r["overall_band"]) for r in graded if r.get("overall_band") is not None]
            if bands:
                aggregate.overall_band = round(sum(bands) / len(bands), 1)
                response_filled.append("overall_band")

        if aggregate.band_p is None:
            # 0-100 → 0-9 linear heuristic. See module docstring.
            scores = [
                r["pronunciation_score"] / 10.0 for r in graded
                if r.get("pronunciation_score") is not None
            ]
            if scores:
                aggregate.band_p = round(sum(scores) / len(scores), 1)
                response_filled.append("band_p")
        # band_fc / band_lr / band_gra: no per-response source — leave as None.

    # Pick the right source label for downstream UX.
    if session_filled and response_filled:
        aggregate.source = "mixed"
    elif session_filled:
        # Some session columns were present but not all; nothing came from
        # responses to fill the gaps. Calling this "session_columns" would
        # be misleading (it's partial); calling it "mixed" implies a
        # response contribution that didn't happen. Use "session_columns"
        # but rely on field-by-field NULLs to communicate the gaps —
        # consistent with the spec (mixed = blend; pure session = label
        # session_columns).
        aggregate.source = "session_columns"
    elif response_filled:
        aggregate.source = "computed_from_responses"
    else:
        aggregate.source = "no_data"

    return aggregate

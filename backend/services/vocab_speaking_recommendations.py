"""High-precision Speaking feedback -> curated vocabulary recommendations.

The model never sees learning-unit prose or the internal signal catalog, and
this module never keyword-matches free-form feedback. Editors own deterministic
pair rules over structured original/corrected evidence. A candidate survives
only when confidence is high, evidence is present in the learner transcript,
and exactly one active editorial rule matches.
"""

from __future__ import annotations

import logging
import re
import time
import uuid
from copy import deepcopy
from typing import Any

from database import supabase_admin

logger = logging.getLogger(__name__)

MAX_ACTIVE_SIGNAL_MAPS = 100
MAX_RECOMMENDATIONS_PER_RESPONSE = 2
SIGNAL_CATALOG_CACHE_TTL_SECONDS = 15.0
_RECOMMENDATION_NAMESPACE = uuid.UUID("24c31e9c-65c1-4fbd-93b6-f187c66f9fa7")
_NON_WORD = re.compile(r"[^a-z0-9']+")
_SPACES = re.compile(r"\s+")
_catalog_cache: tuple[float, list[dict[str, Any]]] | None = None


class VocabSpeakingRecommendationError(Exception):
    """The curated signal catalog is unavailable or violates its bound."""


def _rows(result: Any) -> list[dict[str, Any]]:
    data = getattr(result, "data", None)
    return data if isinstance(data, list) else []


def _load_signal_catalog_uncached() -> list[dict[str, Any]]:
    """Load active mappings whose target is a currently published unit."""
    mappings = _rows(
        supabase_admin.table("vocab_speaking_signal_maps")
        .select(
            "id,signal_code,unit_id,trigger_description,"
            "exclusion_description,match_spec,reason_vi,priority"
        )
        .eq("status", "active")
        .order("signal_code")
        .limit(MAX_ACTIVE_SIGNAL_MAPS + 1)
        .execute()
    )
    if len(mappings) > MAX_ACTIVE_SIGNAL_MAPS:
        raise VocabSpeakingRecommendationError(
            f"Speaking signal catalog vượt giới hạn {MAX_ACTIVE_SIGNAL_MAPS} mappings"
        )
    unit_ids = list(dict.fromkeys(
        str(row.get("unit_id")) for row in mappings if row.get("unit_id")
    ))
    if not unit_ids:
        return []
    units = _rows(
        supabase_admin.table("vocab_learning_units")
        .select("id,unit_slug,display_headword,current_published_version_id")
        .in_("id", unit_ids)
        .eq("status", "published")
        .limit(MAX_ACTIVE_SIGNAL_MAPS)
        .execute()
    )
    published = {
        str(unit.get("id")): unit
        for unit in units
        if unit.get("current_published_version_id")
    }
    catalog: list[dict[str, Any]] = []
    for mapping in mappings:
        unit = published.get(str(mapping.get("unit_id")))
        if not unit:
            continue
        catalog.append({
            "mapping_id": str(mapping.get("id") or ""),
            "signal_code": str(mapping.get("signal_code") or ""),
            "unit_id": str(mapping.get("unit_id") or ""),
            "unit_slug": str(unit.get("unit_slug") or ""),
            "title": str(unit.get("display_headword") or ""),
            "trigger": str(mapping.get("trigger_description") or ""),
            "exclude": str(mapping.get("exclusion_description") or ""),
            "match_spec": mapping.get("match_spec")
                if isinstance(mapping.get("match_spec"), dict) else {},
            "reason_vi": str(mapping.get("reason_vi") or ""),
            "priority": int(mapping.get("priority") or 100),
        })
    catalog.sort(key=lambda row: (row["priority"], row["signal_code"]))
    return catalog


def load_signal_catalog() -> list[dict[str, Any]]:
    """Load a short-lived copy so practice grading avoids two DB reads each time."""
    global _catalog_cache
    now = time.monotonic()
    if _catalog_cache and now - _catalog_cache[0] < SIGNAL_CATALOG_CACHE_TTL_SECONDS:
        return deepcopy(_catalog_cache[1])
    catalog = _load_signal_catalog_uncached()
    _catalog_cache = (now, deepcopy(catalog))
    return catalog


def clear_signal_catalog_cache() -> None:
    """Test/operator hook; normal editorial changes age out within 15 seconds."""
    global _catalog_cache
    _catalog_cache = None


def _normalise_phrase(value: str) -> str:
    folded = value.casefold().replace("’", "'").replace("`", "'")
    return _SPACES.sub(" ", _NON_WORD.sub(" ", folded)).strip()


def _evidence_is_in_transcript(evidence: str, transcript: str) -> bool:
    needle = _normalise_phrase(evidence)
    haystack = _normalise_phrase(transcript)
    if not needle or not haystack or not re.search(r"[a-z]", needle):
        return False
    return f" {needle} " in f" {haystack} "


def _matches_spec(candidate: dict[str, Any], mapping: dict[str, Any]) -> bool:
    spec = mapping.get("match_spec")
    if not isinstance(spec, dict):
        return False
    issue_type = str(candidate.get("issue_type") or "").strip().lower()
    if issue_type != str(spec.get("issue_type") or "").strip().lower():
        return False
    original_pattern = str(spec.get("original_pattern") or "")
    corrected_pattern = str(spec.get("corrected_pattern") or "")
    if not (1 <= len(original_pattern) <= 240 and 1 <= len(corrected_pattern) <= 240):
        return False
    try:
        original_match = re.search(
            original_pattern, str(candidate.get("evidence") or ""), re.I,
        )
        corrected_match = re.search(
            corrected_pattern, str(candidate.get("corrected") or ""), re.I,
        )
        if not original_match or not corrected_match:
            return False
        if spec.get("require_distinct_match") is True:
            return _normalise_phrase(original_match.group(0)) != _normalise_phrase(
                corrected_match.group(0)
            )
        return True
    except re.error:
        logger.warning(
            "[vocab_speaking_recommendations] invalid regex signal=%s",
            mapping.get("signal_code"),
        )
        return False


def match_structured_signals(
    raw_signals: Any,
    catalog: list[dict[str, Any]],
    transcript: str,
    *,
    reliability_label: str | None,
) -> list[dict[str, Any]]:
    """Fail closed from model candidates to at most two canonical unit matches."""
    if reliability_label == "low" or not isinstance(raw_signals, list) or not catalog:
        return []
    recommendations: list[dict[str, Any]] = []
    seen_units: set[str] = set()
    for candidate in raw_signals[:8]:
        if not isinstance(candidate, dict):
            continue
        if str(candidate.get("confidence") or "").lower() != "high":
            continue
        evidence = str(candidate.get("evidence") or "").strip()
        corrected = str(candidate.get("corrected") or "").strip()
        if not (1 <= len(evidence) <= 180 and 1 <= len(corrected) <= 240):
            continue
        if not _evidence_is_in_transcript(evidence, transcript):
            continue
        if _normalise_phrase(evidence) == _normalise_phrase(corrected):
            continue
        matches = [mapping for mapping in catalog if _matches_spec(candidate, mapping)]
        # Ambiguity is evidence that the editorial rules are not specific enough.
        if len(matches) != 1:
            continue
        mapping = matches[0]
        signal_code = str(mapping["signal_code"])
        unit_id = str(mapping["unit_id"])
        if unit_id in seen_units:
            continue
        recommendations.append({
            "mapping_id": str(mapping["mapping_id"]),
            "signal_code": signal_code,
            "unit_id": unit_id,
            "unit_slug": str(mapping["unit_slug"]),
            "title": str(mapping["title"]),
            "reason_vi": str(mapping["reason_vi"]),
            "evidence": evidence,
            "corrected": corrected,
            "confidence": "high",
        })
        seen_units.add(unit_id)
        if len(recommendations) >= MAX_RECOMMENDATIONS_PER_RESPONSE:
            break
    return recommendations


def premint_recommendation_ids(
    recommendations: list[dict[str, Any]],
    *,
    session_id: str,
    question_id: str,
) -> None:
    """Give feedback JSON and the canonical DB row the same stable UUID."""
    for recommendation in recommendations:
        unit_id = str(recommendation.get("unit_id") or "")
        if not unit_id:
            continue
        recommendation["rec_id"] = str(uuid.uuid5(
            _RECOMMENDATION_NAMESPACE,
            f"{session_id}:{question_id}:{unit_id}",
        ))


def persist_recommendations(
    recommendations: list[dict[str, Any]],
    *,
    user_id: str,
    response_id: str,
) -> list[dict[str, Any]]:
    """Atomically reconcile one response's actionable recommendations.

    Best-effort by design: recommendation persistence must never break grading.
    The RPC repeats all ownership/mapping/published checks in the database.
    """
    rows = [{
        "id": row.get("rec_id"),
        "mapping_id": row.get("mapping_id"),
        "signal_code": row.get("signal_code"),
        "unit_id": row.get("unit_id"),
        "confidence": row.get("confidence"),
    } for row in recommendations]
    try:
        result = supabase_admin.rpc(
            "fn_replace_speaking_vocab_recommendations",
            {"p_user": user_id, "p_response": response_id, "p_rows": rows},
        ).execute()
        stored = _rows(result)
        stored_by_unit = {
            str(row.get("unit_id")): row for row in stored if row.get("unit_id")
        }
        logger.info(
            "[vocab_speaking_recommendations] saved %d recommendations response=%s",
            len(stored), response_id,
        )
        public_rows: list[dict[str, Any]] = []
        for row in recommendations:
            stored_row = stored_by_unit.get(str(row.get("unit_id")))
            if not stored_row:
                continue
            public_rows.append({
                "rec_id": stored_row.get("rec_id"),
                "unit_id": stored_row.get("unit_id"),
                "unit_slug": stored_row.get("unit_slug"),
                "title": stored_row.get("title"),
                "reason_vi": stored_row.get("reason_vi"),
                "status": stored_row.get("status"),
                "confidence": stored_row.get("confidence"),
                "evidence": row.get("evidence"),
                "corrected": row.get("corrected"),
            })
        return public_rows
    except Exception as exc:  # noqa: BLE001 - explicitly non-fatal to grading
        logger.warning(
            "[vocab_speaking_recommendations] save failed response=%s (non-fatal): %s",
            response_id, exc,
        )
        # Never surface a recommendation that canonical persistence did not
        # confirm. Missing enrichment is safer than a dangling learning link.
        return []

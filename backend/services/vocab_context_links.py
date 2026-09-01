"""Fail-closed authored glossary -> curated vocabulary unit resolution."""

from __future__ import annotations

from typing import Any

from database import supabase_admin
from services import vocab_context_rules, vocab_units

MAX_CONTEXT_TERMS = 30
SURFACE_SCOPE = "reading_glossary"


class VocabContextLookupError(Exception):
    """The request or private editorial catalog violates its safe bound."""


def _rows(result: Any) -> list[dict[str, Any]]:
    data = getattr(result, "data", None)
    return data if isinstance(data, list) else []


def resolve_context_links(terms: list[str]) -> dict[str, Any]:
    """Resolve exact normalized terms to safe summaries of published units."""
    if len(terms) > MAX_CONTEXT_TERMS:
        raise VocabContextLookupError(
            f"Context lookup vượt giới hạn {MAX_CONTEXT_TERMS} terms"
        )
    normalized: list[str] = []
    identity_by_request: list[tuple[str, str]] = []
    for term in terms:
        identity = vocab_context_rules.normalize_context_term(term)
        if not identity:
            continue
        identity_by_request.append((term, identity))
        if identity not in normalized:
            normalized.append(identity)
    if not normalized:
        return {"links": []}

    mappings = _rows(
        supabase_admin.table("vocab_context_lookup_terms")
        .select("term,normalized_term,unit_id,rationale_vi")
        .eq("surface_scope", SURFACE_SCOPE)
        .eq("status", "active")
        .in_("normalized_term", normalized)
        .limit(MAX_CONTEXT_TERMS + 1)
        .execute()
    )
    if len(mappings) > MAX_CONTEXT_TERMS:
        raise VocabContextLookupError("Context lookup catalog trả quá giới hạn")

    unit_ids = [str(row.get("unit_id") or "") for row in mappings]
    published = vocab_units._load_published_units(unit_ids=unit_ids)
    summaries = {
        str(unit.get("id")): vocab_units._unit_summary(unit, version)
        for unit, version in published
    }
    mapping_by_identity: dict[str, dict[str, Any]] = {}
    for mapping in mappings:
        normalized_term = str(mapping.get("normalized_term") or "")
        summary = summaries.get(str(mapping.get("unit_id") or ""))
        if normalized_term not in normalized or normalized_term in mapping_by_identity or not summary:
            continue
        mapping_by_identity[normalized_term] = {
            "term": str(mapping.get("term") or ""),
            "normalized_term": normalized_term,
            "rationale_vi": str(mapping.get("rationale_vi") or ""),
            "unit": summary,
        }
    links: list[dict[str, Any]] = []
    seen_requests: set[str] = set()
    for request_term, identity in identity_by_request:
        match = mapping_by_identity.get(identity)
        if not match or request_term in seen_requests:
            continue
        links.append({**match, "request_term": request_term})
        seen_requests.add(request_term)
    return {"links": links}

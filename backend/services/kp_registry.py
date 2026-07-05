"""kp_registry — resolve a Knowledge-Point reference to a LIVE asset.

Single source of truth for "is this (kp_type, ref_slug, anchor) real?", shared by
the KP integrity gates (scripts/verify_kp_asset_drift.py, tests/
test_kp_ref_drift.py) and, later, kp_evidence scoring (Phase 1). A KP holds no
content — it is only a pointer — so its validity is entirely "does the pointer
still resolve to a live asset":

  grammar → a Grammar Wiki article slug; if an anchor is given it must be declared
            in that article's frontmatter `anchors:` list.
  vocab   → a vocab_cards headword slug. Source of truth is the DB; the markdown
            fallback (content_vocab/**) is INCOMPLETE, so vocab resolution is only
            reliable where the DB is reachable. Callers that must run offline
            (the pytest gate) validate grammar/skill strictly and treat vocab
            structurally; the DB gate validates vocab for real.
  skill   → one of the 8 closed reading skill_tags.

Every resolver returns None when the ref is valid, or a human-readable reason
string when it is not — so a caller can accumulate a drift report.
"""
from __future__ import annotations

from typing import Optional

from services.grammar_content import grammar_service
from services.reading_diagnostic_engine import SKILL_LABELS
from services.vocab_content import vocab_service

VALID_TYPES: tuple[str, ...] = ("grammar", "vocab", "skill")
SKILL_TAGS: frozenset[str] = frozenset(SKILL_LABELS)


def grammar_anchor_ids(slug: str) -> Optional[set[str]]:
    """Declared anchor ids for a grammar article, or None if the article is gone."""
    art = grammar_service.articles_by_slug.get(slug)
    if art is None:
        return None
    return {a["id"] for a in (art.get("anchors") or []) if a.get("id")}


def vocab_slugs() -> set[str]:
    """Distinct headword slugs from the live vocab source (DB, else markdown)."""
    return {c["slug"] for c in vocab_service.get_all_articles() if c.get("slug")}


def resolve_grammar(slug: str, anchor: str = "") -> Optional[str]:
    ids = grammar_anchor_ids(slug)
    if ids is None:
        return f"grammar article '{slug}' not found"
    if anchor and anchor not in ids:
        return f"grammar anchor '{anchor}' not declared in article '{slug}'"
    return None


def resolve_skill(tag: str) -> Optional[str]:
    if tag in SKILL_TAGS:
        return None
    return f"skill_tag '{tag}' not in closed taxonomy {sorted(SKILL_TAGS)}"


def resolve_vocab(slug: str, known: Optional[set[str]] = None) -> Optional[str]:
    """Validate a vocab slug. Pass `known` (a precomputed vocab_slugs() set) to
    avoid re-scanning per ref when checking many refs."""
    known = vocab_slugs() if known is None else known
    if slug in known:
        return None
    return f"vocab card '{slug}' not found"


def label_for(kp_type: str, ref_slug: str) -> dict:
    """Human-facing metadata for a KP ref so the frontend can show a real title
    and (for grammar) deep-link to /grammar/{category}/{slug}. Returns {} when the
    asset is unknown; never raises."""
    if kp_type == "grammar":
        a = grammar_service.articles_by_slug.get(ref_slug)
        if not a:
            return {}
        return {"category": a.get("category"), "title": a.get("title") or ref_slug}
    if kp_type == "vocab":
        a = vocab_service.articles_by_slug.get(ref_slug)
        return {"title": (a.get("headword") if a else None) or ref_slug}
    if kp_type == "skill":
        return {"title": SKILL_LABELS.get(ref_slug, ref_slug)}
    return {}


def resolve_ref(kp_type: str, ref_slug: str, anchor: str = "",
                *, vocab_known: Optional[set[str]] = None) -> Optional[str]:
    """Resolve any KP ref. Returns None if valid, else a reason string.

    `vocab_known` lets a batch caller share one vocab_slugs() scan. Grammar/skill
    need no such hint (their sources are cheap dict/enum lookups)."""
    if kp_type == "grammar":
        return resolve_grammar(ref_slug, anchor)
    if kp_type == "skill":
        if anchor:
            return f"skill KP '{ref_slug}' must not carry an anchor (got '{anchor}')"
        return resolve_skill(ref_slug)
    if kp_type == "vocab":
        if anchor:
            return f"vocab KP '{ref_slug}' must not carry an anchor (got '{anchor}')"
        return resolve_vocab(ref_slug, vocab_known)
    return f"unknown kp_type '{kp_type}' (expected one of {VALID_TYPES})"

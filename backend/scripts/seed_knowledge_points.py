"""seed_knowledge_points.py — Phase 0.2: seed the knowledge_points table.

Seeds ONE KP per live asset, from the sources that already exist in the repo —
so there is no hand-authored content and CI ref-drift can always verify KP →
asset both ways:

  * grammar → every Grammar Wiki article (article-level, anchor='') PLUS one KP
              per declared anchor in that article's frontmatter `anchors:` list.
              Source: services.grammar_content.grammar_service (107 articles).
  * vocab   → one KP per distinct vocab_cards headword slug (anchor='').
              Source: services.vocab_content.vocab_service (DB-backed).
  * skill   → one KP per reading skill_tag (8, closed taxonomy, anchor='').
              Source: services.reading_diagnostic_engine.SKILL_LABELS.

Idempotent: upserts on the (kp_type, ref_slug, anchor) identity key (matches the
UNIQUE constraint in migration 127), so a re-run UPDATEs level in place — no
duplicates, safe to run repeatedly. Run AFTER migration 127 is applied:

    cd backend && python -m scripts.seed_knowledge_points

Failure modes:
  * supabase_admin not configured (env missing) → aborts on first upsert with the
    underlying client error. Fix the env and re-run.
  * knowledge_points table missing (migration 127 not applied) → PostgREST error
    on first upsert. Apply the migration and re-run.
"""

from __future__ import annotations

import logging

from database import supabase_admin
from services.grammar_content import grammar_service
from services.reading_diagnostic_engine import SKILL_LABELS
from services.vocab_content import vocab_service

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("seed_kp")

# Upsert in chunks so one giant payload doesn't strain PostgREST.
_CHUNK = 500
_CONFLICT = "kp_type,ref_slug,anchor"


def _collect_grammar() -> list[dict]:
    """One KP per article (anchor='') + one per declared anchor."""
    rows: list[dict] = []
    for slug, art in grammar_service.articles_by_slug.items():
        level = (art.get("level") or "").strip()
        rows.append({"kp_type": "grammar", "ref_slug": slug, "anchor": "", "level": level})
        for a in art.get("anchors") or []:
            anchor_id = (a.get("id") or "").strip()
            if anchor_id:
                rows.append({
                    "kp_type": "grammar", "ref_slug": slug,
                    "anchor": anchor_id, "level": level,
                })
    return rows


def _collect_vocab() -> list[dict]:
    """One KP per DISTINCT headword slug (a word shared across topics = one KP)."""
    seen: dict[str, str] = {}  # slug → level (first non-empty wins)
    for card in vocab_service.get_all_articles():
        slug = (card.get("slug") or "").strip()
        if not slug:
            continue
        level = (card.get("level") or "").strip()
        if slug not in seen or (not seen[slug] and level):
            seen[slug] = level
    return [
        {"kp_type": "vocab", "ref_slug": slug, "anchor": "", "level": level}
        for slug, level in seen.items()
    ]


def _collect_skill() -> list[dict]:
    """One KP per closed reading skill_tag."""
    return [
        {"kp_type": "skill", "ref_slug": tag, "anchor": "", "level": ""}
        for tag in SKILL_LABELS
    ]


def _dedup(rows: list[dict]) -> list[dict]:
    """Guard the payload against duplicate identity keys before upsert."""
    by_key: dict[tuple, dict] = {}
    for r in rows:
        by_key[(r["kp_type"], r["ref_slug"], r["anchor"])] = r
    return list(by_key.values())


def main() -> None:
    grammar = _collect_grammar()
    vocab = _collect_vocab()
    skill = _collect_skill()
    rows = _dedup(grammar + vocab + skill)

    logger.info(
        "Collected KP rows: grammar=%d (articles=%d), vocab=%d, skill=%d → total unique=%d",
        len(grammar), len(grammar_service.articles_by_slug),
        len(vocab), len(skill), len(rows),
    )

    written = 0
    for i in range(0, len(rows), _CHUNK):
        chunk = rows[i:i + _CHUNK]
        supabase_admin.table("knowledge_points").upsert(
            chunk, on_conflict=_CONFLICT,
        ).execute()
        written += len(chunk)
        logger.info("  upserted %d/%d", written, len(rows))

    logger.info("Done. upserted=%d knowledge_points", written)


if __name__ == "__main__":
    main()

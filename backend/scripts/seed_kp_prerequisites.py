"""seed_kp_prerequisites.py — Phase 2.2: materialize the prerequisite DAG.

Reads each Grammar Wiki article's frontmatter `prerequisites:` (already live —
106 articles, 375 edges) and writes one kp_prerequisites row per edge, mapping
both the article and each prerequisite to their ARTICLE-LEVEL grammar KP
(anchor=''). Prereq slugs that don't resolve to a live grammar KP are skipped
with a warning (should be none — CI ref-drift keeps prerequisites pointing at
live articles).

Idempotent: upsert on the (kp_id, prereq_kp_id) primary key. Run AFTER migration
130 is applied:

    cd backend && python -m scripts.seed_kp_prerequisites
"""
from __future__ import annotations

import logging

from database import supabase_admin
from services.grammar_content import grammar_service

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("seed_kp_prereq")

_CHUNK = 500


def _grammar_kp_index() -> dict[str, str]:
    """slug → article-level grammar KP id (anchor='')."""
    idx: dict[str, str] = {}
    start = 0
    while True:
        rows = (supabase_admin.table("knowledge_points")
                .select("id,ref_slug,anchor")
                .eq("kp_type", "grammar").eq("anchor", "")
                .range(start, start + 999).execute().data or [])
        for r in rows:
            idx[r["ref_slug"]] = r["id"]
        if len(rows) < 1000:
            break
        start += 1000
    return idx


def main() -> None:
    kp_by_slug = _grammar_kp_index()
    logger.info("Loaded %d article-level grammar KPs.", len(kp_by_slug))

    rows: list[dict] = []
    missing: set[str] = set()
    for slug, art in grammar_service.articles_by_slug.items():
        kp_id = kp_by_slug.get(slug)
        if not kp_id:
            missing.add(slug)
            continue
        for prereq in art.get("prerequisites") or []:
            prereq_id = kp_by_slug.get(prereq)
            if not prereq_id:
                missing.add(prereq)
                continue
            if prereq_id == kp_id:
                continue  # defensive: DB CHECK rejects self-edges anyway
            rows.append({"kp_id": kp_id, "prereq_kp_id": prereq_id})

    # De-dup on the composite key.
    rows = list({(r["kp_id"], r["prereq_kp_id"]): r for r in rows}.values())
    logger.info("Collected %d prerequisite edges (skipped %d unresolved slugs).",
                len(rows), len(missing))
    if missing:
        logger.warning("  unresolved: %s", ", ".join(sorted(missing)))

    written = 0
    for i in range(0, len(rows), _CHUNK):
        chunk = rows[i:i + _CHUNK]
        supabase_admin.table("kp_prerequisites").upsert(
            chunk, on_conflict="kp_id,prereq_kp_id").execute()
        written += len(chunk)
        logger.info("  upserted %d/%d", written, len(rows))

    logger.info("Done. upserted=%d prerequisite edges", written)


if __name__ == "__main__":
    main()

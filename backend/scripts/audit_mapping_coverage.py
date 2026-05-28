"""Sprint 7 Phase 1 — mapping coverage audit.

Inventory every grammar wiki article (`backend/content/**/*.md`, excluding
reading seeds under `backend/content/reading/`) against
`feedback-anchor-mapping.yaml`. Two outputs:

  1. MAPPING_COVERAGE_GAP_REPORT.md — markdown report grouping missing
     slugs by category and bucketing each as "ready" (≥1 frontmatter
     anchor declared) or "blocked" (0 anchors — needs Sprint-1-style
     anchor declaration before any mapping work can land).

  2. MAPPING_SKELETONS_SPRINT_7.yaml — TODO-marked YAML skeleton, one
     entry per ready slug, primary anchor pre-filled. Andy + planner
     fill `feedback_keywords`, `user_phrase_examples`, etc. iteratively
     in Sprint 7 Day 2+ batches before merging into the master mapping
     file.

A slug is "covered" iff *some* mapping's `target_anchor` starts with
the slug (anchor IDs are dotted: `<slug>.<section>.<sub>`). This is a
slug-level audit; an article whose slug has *one* mapping is reported
as covered even if it has 10 anchors and only 1 is mapped — Sprint 7
Day 2+ planning decides anchor-level depth.

Run:
    python3 backend/scripts/audit_mapping_coverage.py

Exit codes:
    0 — report + skeleton written, prints stdout summary
    1 — IO / parsing error
"""
from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path
from typing import Iterable

import yaml

ROOT          = Path(__file__).resolve().parents[2]
CONTENT_DIR   = ROOT / "backend" / "content"
MAPPING_FILE  = CONTENT_DIR / "feedback-anchor-mapping.yaml"
REPORT_OUT    = ROOT / "MAPPING_COVERAGE_GAP_REPORT.md"
SKELETON_OUT  = ROOT / "MAPPING_SKELETONS_SPRINT_7.yaml"

GENERATED_DATE = "2026-05-05"
EXCLUDED_TOP_LEVEL_DIRS = {"reading"}


# ── Data collection ──────────────────────────────────────────────────────

def is_grammar_article(md_path: Path) -> bool:
    """Return True for grammar wiki markdown content only.

    Sprint 21.3: reading seed passages also live under backend/content,
    but they are not part of the Grammar Wiki denominator.
    """
    if "_archive" in md_path.parts:
        return False
    rel = md_path.relative_to(CONTENT_DIR)
    if rel.parts and rel.parts[0] in EXCLUDED_TOP_LEVEL_DIRS:
        return False
    return True


def parse_frontmatter(md_path: Path) -> dict:
    """Return parsed YAML frontmatter dict, or {} if file has no
    frontmatter / is malformed. Mirrors verify_anchor_drift.py logic."""
    raw = md_path.read_text(encoding="utf-8")
    if not raw.startswith("---"):
        return {}
    parts = raw.split("---", 2)
    if len(parts) < 3:
        return {}
    try:
        return yaml.safe_load(parts[1]) or {}
    except yaml.YAMLError:
        return {}


def collect_articles() -> list[dict]:
    """Walk CONTENT_DIR/**/*.md for grammar wiki content only. Return one dict per
    article: {slug, category, path, anchors: list[id]}.

    `slug` comes from frontmatter when present; falls back to file stem
    (matches GrammarContentService._parse_file resolution order)."""
    out: list[dict] = []
    for md_file in sorted(CONTENT_DIR.rglob("*.md")):
        if not is_grammar_article(md_file):
            continue
        if md_file.name.startswith("README"):
            continue
        fm = parse_frontmatter(md_file)
        slug = fm.get("slug") or md_file.stem
        category = fm.get("category") or md_file.parent.name
        anchor_ids: list[str] = []
        for a in (fm.get("anchors") or []):
            aid = a.get("id") if isinstance(a, dict) else None
            if aid:
                anchor_ids.append(aid)
        out.append({
            "slug":     slug,
            "category": category,
            "path":     str(md_file.relative_to(ROOT)),
            "anchors":  anchor_ids,
        })
    return out


def collect_covered_slugs() -> tuple[set[str], int, list[dict]]:
    """Parse the master mapping file. Returns:
       - set of slugs that have ≥1 active mapping (excluding deferred)
       - count of active mappings (for sanity check vs drift gate's 37)
       - raw mapping list (for max-id calculation)"""
    if not MAPPING_FILE.exists():
        print(f"ERROR: mapping file missing: {MAPPING_FILE}", file=sys.stderr)
        sys.exit(1)
    data = yaml.safe_load(MAPPING_FILE.read_text(encoding="utf-8")) or {}
    raw = data.get("mappings") or []
    covered: set[str] = set()
    active = 0
    for m in raw:
        if m.get("deferred_until"):
            continue
        target = m.get("target_anchor", "")
        slug = target.split(".", 1)[0] if target else ""
        if slug:
            covered.add(slug)
        active += 1
    return covered, active, raw


def next_mapping_id(existing: list[dict]) -> int:
    """Find the highest M### id and return the next integer.
    Skeletons start numbering from this so they don't collide with
    live mappings or each other when we later merge."""
    max_id = 0
    for m in existing:
        mid = str(m.get("mapping_id", ""))
        if mid.startswith("M") and mid[1:].isdigit():
            max_id = max(max_id, int(mid[1:]))
    return max_id + 1


# ── Output rendering ─────────────────────────────────────────────────────

def render_report(
    articles: list[dict],
    covered_slugs: set[str],
    active_mapping_count: int,
) -> str:
    """Markdown report — Phase 1 + 2 combined output."""
    missing = [a for a in articles if a["slug"] not in covered_slugs]
    by_category: dict[str, list[dict]] = defaultdict(list)
    for a in missing:
        by_category[a["category"]].append(a)

    blocked = [a for a in missing if not a["anchors"]]
    ready   = [a for a in missing if a["anchors"]]

    lines: list[str] = []
    lines.append("# Mapping Coverage Gap Report")
    lines.append("")
    lines.append(f"_Generated: {GENERATED_DATE} — Sprint 7 Phase 1 scaffolding_")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(f"- **Total articles:** {len(articles)}")
    lines.append(f"- **Covered slugs (≥1 active mapping):** {len(covered_slugs)}")
    lines.append(f"- **Missing slugs:** {len(missing)}")
    lines.append(f"  - **Ready** (anchors declared, mapping content can be written): {len(ready)}")
    lines.append(f"  - **Blocked** (0 anchors, needs Sprint-1-style anchor declaration first): {len(blocked)}")
    lines.append(f"- **Active mappings (sanity check vs drift gate):** {active_mapping_count}")
    lines.append("")
    lines.append("> **Slug coverage** = does *any* mapping's `target_anchor` begin")
    lines.append("> with this slug? An article counts as covered with as little as")
    lines.append("> one mapping pinned to it. Sprint 7 Day 2+ planning decides per-")
    lines.append("> anchor depth — this report is the slug-level skeleton.")
    lines.append("")

    lines.append("## Missing slugs WITH declared anchors (ready for Sprint 7 mapping work)")
    lines.append("")
    if not ready:
        lines.append("_None — every uncovered article also lacks anchors. See blocked section._")
    else:
        ready_by_cat: dict[str, list[dict]] = defaultdict(list)
        for a in ready:
            ready_by_cat[a["category"]].append(a)
        for cat in sorted(ready_by_cat):
            arts = sorted(ready_by_cat[cat], key=lambda x: x["slug"])
            lines.append(f"### {cat} ({len(arts)} ready)")
            lines.append("")
            for a in arts:
                lines.append(f"- `{a['slug']}` — {len(a['anchors'])} anchor(s) declared")
            lines.append("")

    lines.append("## Missing slugs WITHOUT declared anchors (blocker — anchor declaration first)")
    lines.append("")
    if not blocked:
        lines.append("_None — every uncovered article has at least one anchor available._")
    else:
        blocked_by_cat: dict[str, list[dict]] = defaultdict(list)
        for a in blocked:
            blocked_by_cat[a["category"]].append(a)
        for cat in sorted(blocked_by_cat):
            arts = sorted(blocked_by_cat[cat], key=lambda x: x["slug"])
            lines.append(f"### {cat} ({len(arts)} blocked)")
            lines.append("")
            for a in arts:
                lines.append(f"- `{a['slug']}` — 0 anchors")
            lines.append("")

    lines.append("## Priority signal — to be filled in Sprint 7 Day 2 review")
    lines.append("")
    lines.append("This script is a deterministic filesystem audit; it does not")
    lines.append("query production. Andy + planner overlay AI-emit frequency from")
    lines.append("`grammar_recommendations` (last 30 days, group by")
    lines.append("`recommended_slug`) onto the **ready** list to decide which")
    lines.append("batches go first.")
    lines.append("")
    return "\n".join(lines)


def render_skeletons(ready: list[dict], starting_id: int) -> str:
    """Generate Sprint 7 placeholder yaml. One entry per ready slug,
    primary anchor = first anchor in the article's frontmatter list.
    All entries carry `deferred_until: sprint-7-content` so the drift
    gate doesn't break when this file gets merged into the master one
    before content lands."""
    lines: list[str] = []
    lines.append("# Sprint 7 mapping skeletons — TO BE FILLED")
    lines.append("# Generated by backend/scripts/audit_mapping_coverage.py")
    lines.append(f"# Generated date: {GENERATED_DATE}")
    lines.append("#")
    lines.append("# This file is NOT loaded by the matcher. Merge curated entries")
    lines.append("# into backend/content/feedback-anchor-mapping.yaml batch-by-")
    lines.append("# batch as Sprint 7 progresses. Every entry here is")
    lines.append("# `deferred_until: sprint-7-content` — drop that field once the")
    lines.append("# entry is merged + ready to go live.")
    lines.append("#")
    lines.append("# Required fills before merge:")
    lines.append("#   feedback_pattern_summary  — short Vietnamese description")
    lines.append("#   feedback_keywords         — concrete English/Vietnamese tokens")
    lines.append("#   user_phrase_examples      — production-shaped phrases")
    lines.append("# Tune confidence/severity per the vocab at the top of the master")
    lines.append("# mapping file.")
    lines.append("")
    lines.append("schema_version: \"1.0\"")
    lines.append("generated_by: \"audit_mapping_coverage.py\"")
    lines.append(f"generated_date: \"{GENERATED_DATE}\"")
    lines.append("")
    lines.append("mappings:")

    next_id = starting_id
    for a in sorted(ready, key=lambda x: (x["category"], x["slug"])):
        slug         = a["slug"]
        category     = a["category"]
        primary      = a["anchors"][0]
        target_file  = a["path"]
        related      = a["anchors"][:3]  # first 3 for context

        lines.append("")
        lines.append(f"  # {category}/{slug} — {len(a['anchors'])} anchors available")
        lines.append(f"  - mapping_id: M{next_id:03d}")
        lines.append(f"    target_anchor: {primary}")
        lines.append(f"    target_file: {target_file}")
        lines.append("    feedback_pattern_summary: \"<TODO: short Vietnamese summary of this error pattern>\"")
        lines.append("    feedback_keywords:")
        lines.append("      - \"<TODO: keyword 1>\"")
        lines.append("      - \"<TODO: keyword 2>\"")
        lines.append("    user_phrase_examples:")
        lines.append("      - \"<TODO: example phrase 1>\"")
        lines.append("      - \"<TODO: example phrase 2>\"")
        lines.append("    confidence: medium")
        lines.append("    severity: common")
        lines.append("    related_anchors:")
        for r in related:
            lines.append(f"      - {r}")
        lines.append("    deferred_until: sprint-7-content")
        next_id += 1

    lines.append("")
    return "\n".join(lines)


# ── Entry point ──────────────────────────────────────────────────────────

def main() -> int:
    articles = collect_articles()
    covered, active_count, raw_mappings = collect_covered_slugs()
    starting_id = next_mapping_id(raw_mappings)

    report = render_report(articles, covered, active_count)
    REPORT_OUT.write_text(report, encoding="utf-8")

    ready = [a for a in articles if a["slug"] not in covered and a["anchors"]]
    skeletons = render_skeletons(ready, starting_id)
    SKELETON_OUT.write_text(skeletons, encoding="utf-8")

    missing = sum(1 for a in articles if a["slug"] not in covered)
    blocked = sum(1 for a in articles if a["slug"] not in covered and not a["anchors"])

    print(f"Articles scanned:    {len(articles)}")
    print(f"Covered slugs:       {len(covered)}")
    print(f"Missing slugs:       {missing}")
    print(f"  ready (skeleton):  {len(ready)}")
    print(f"  blocked (anchors): {blocked}")
    print(f"Active mappings:     {active_count}")
    print(f"Skeleton id range:   M{starting_id:03d}–M{starting_id + len(ready) - 1:03d}")
    print(f"")
    print(f"Wrote: {REPORT_OUT.relative_to(ROOT)}")
    print(f"Wrote: {SKELETON_OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

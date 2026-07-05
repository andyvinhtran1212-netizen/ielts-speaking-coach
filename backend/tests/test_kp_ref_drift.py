"""Phase 0.6 — lock the kp_ref → live-asset contract in OFFLINE CI.

The KP-layer sibling of test_grammar_wiki_ref_drift. Grammar + skill refs resolve
fully from files/the closed enum, so they are HARD-gated here (no DB needed).
Vocab's source of truth is the DB (the markdown fallback is incomplete offline),
so a vocab ref's slug EXISTENCE is verified by the DB gate
(scripts/verify_kp_asset_drift.py); here we only pin its STRUCTURE.

Today no content carries kp_refs yet (Phase 0.3/0.4 add reading-question refs;
Phase B adds related_vocab/related_grammar cross-links), so the content scan is
vacuous — but the contract is locked the moment the first ref lands. Reading
questions serialize kp_refs inside question payloads (not frontmatter); those get
their own validation when that shape is defined in Phase 0.3 — this gate covers
frontmatter-level refs (cross-links + any frontmatter kp_refs/kp_tags).
"""
from __future__ import annotations

import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import kp_registry
from services.grammar_content import grammar_service

CONTENT_DIR = Path(__file__).resolve().parents[1] / "content"

# Frontmatter fields that carry KP refs, and the kp_type each implies. Explicit
# `kp_refs`/`kp_tags` lists carry their own `type`, handled separately.
_TYPED_FIELDS = {
    "related_vocab":   "vocab",    # grammar article → vocab card (A4/B6)
    "related_grammar": "grammar",  # vocab card → grammar article/anchor (B2/B6)
    "confusable_with": "vocab",    # vocab card → vocab card (B2)
}


def _split_frontmatter(raw: str) -> dict | None:
    if not raw.startswith("---"):
        return None
    parts = raw.split("---", 2)
    if len(parts) < 3:
        return None
    try:
        return yaml.safe_load(parts[1]) or {}
    except yaml.YAMLError:
        return None


def _as_ref(item, default_type: str) -> tuple[str, str, str]:
    """Normalise a ref item → (kp_type, slug, anchor). A bare string is a slug;
    a dict may carry {type?, slug, anchor?}."""
    if isinstance(item, str):
        return default_type, item, ""
    if isinstance(item, dict):
        return (item.get("type") or default_type,
                item.get("slug") or "",
                item.get("anchor") or "")
    return default_type, "", ""


def _collect_refs_from_fm(fm) -> list[tuple[str, str, str, str]]:
    """Recursively pull (kp_type, slug, anchor, source_field) refs from a parsed
    frontmatter structure — so refs nested under e.g. question blocks are found."""
    refs: list[tuple[str, str, str, str]] = []

    def walk(node):
        if isinstance(node, dict):
            for key, val in node.items():
                if key in _TYPED_FIELDS and isinstance(val, list):
                    for it in val:
                        t, s, a = _as_ref(it, _TYPED_FIELDS[key])
                        refs.append((t, s, a, key))
                elif key in ("kp_refs", "kp_tags") and isinstance(val, list):
                    for it in val:
                        t, s, a = _as_ref(it, "")
                        refs.append((t, s, a, key))
                else:
                    walk(val)
        elif isinstance(node, list):
            for it in node:
                walk(it)

    walk(fm)
    return refs


def _iter_content_files():
    for p in CONTENT_DIR.rglob("*.md"):
        if "_archive" not in p.parts:
            yield p


def test_kp_resolver_accepts_live_assets_and_rejects_fakes():
    """The resolver the gates depend on must accept live grammar/skill assets and
    reject fabricated ones — otherwise every downstream ref check is worthless."""
    # A real grammar article + a real declared anchor of it.
    slug = next(iter(grammar_service.articles_by_slug))
    anchors = kp_registry.grammar_anchor_ids(slug) or set()
    assert kp_registry.resolve_grammar(slug) is None
    assert kp_registry.resolve_grammar("definitely-not-a-real-slug") is not None
    if anchors:
        assert kp_registry.resolve_grammar(slug, next(iter(anchors))) is None
        assert kp_registry.resolve_grammar(slug, "not-a-real-anchor") is not None

    # Skill taxonomy is closed at exactly 8; each resolves, a fake does not.
    assert len(kp_registry.SKILL_TAGS) == 8
    for tag in kp_registry.SKILL_TAGS:
        assert kp_registry.resolve_skill(tag) is None
    assert kp_registry.resolve_skill("guessing") is not None

    # Type/anchor invariants.
    assert kp_registry.resolve_ref("skill", "inference", "some-anchor") is not None
    assert kp_registry.resolve_ref("bogus", "x") is not None


def test_content_kp_refs_resolve_offline():
    """Every grammar/skill kp_ref declared in content frontmatter must resolve to a
    live asset. Vacuous until Phase 0.3/B, then a hard gate against dead refs."""
    broken: list[str] = []
    vocab_seen = 0
    for md in _iter_content_files():
        fm = _split_frontmatter(md.read_text(encoding="utf-8"))
        if not fm:
            continue
        rel = md.relative_to(CONTENT_DIR)
        for kp_type, slug, anchor, field in _collect_refs_from_fm(fm):
            if not slug:
                broken.append(f"  {rel}.{field} → ref with empty slug")
                continue
            if kp_type in ("grammar", "skill"):
                reason = kp_registry.resolve_ref(kp_type, slug, anchor)
                if reason:
                    broken.append(f"  {rel}.{field} → {reason}")
            elif kp_type == "vocab":
                vocab_seen += 1  # structure ok; existence checked by the DB gate
            else:
                broken.append(f"  {rel}.{field} → unknown kp_type '{kp_type}'")

    assert not broken, (
        "Dead KP references in content frontmatter (fix the slug/anchor OR create "
        "the target asset):\n" + "\n".join(sorted(broken))
        + f"\n(vocab refs seen, deferred to DB gate: {vocab_seen})"
    )

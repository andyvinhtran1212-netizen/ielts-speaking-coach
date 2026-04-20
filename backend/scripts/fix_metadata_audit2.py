#!/usr/bin/env python3
"""
fix_metadata_audit2.py — Phase 2 post-audit corrections.

Addresses systematic gaps found in the metadata audit:
  1. Pathway gap — grammar-for-meaning, sentence-structures, verb-patterns,
     tenses, and modifiers were missing grammar-for-ielts-speaking /
     grammar-for-ielts-writing pathways entirely.
  2. Error tag fixes — preposition-errors had wrong tags; a few articles
     with clear errors had empty common_error_tags.
  3. One remaining dead link — comparison.md next_articles.

Run from repo root:
  python3 backend/scripts/fix_metadata_audit2.py [--dry-run]
"""
import re
import sys
import yaml
from pathlib import Path

DRY_RUN = "--dry-run" in sys.argv
CONTENT_DIR = Path(__file__).parent.parent / "content"

ORDERED_PATHWAYS = [
    "grammar-for-beginners",
    "grammar-for-ielts-speaking",
    "grammar-for-ielts-writing",
    "fix-common-mistakes",
    "band-6-to-7",
]


# ── Helpers ──────────────────────────────────────────────────────────────────

def read_frontmatter(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8")
    if not raw.startswith("---"):
        return {}
    parts = raw.split("---", 2)
    if len(parts) < 3:
        return {}
    return yaml.safe_load(parts[1]) or {}


def patch_field(path: Path, field: str, new_value: str) -> bool:
    """Replace `field: <anything>` with `field: <new_value>` in frontmatter."""
    raw = path.read_text(encoding="utf-8")
    pattern = re.compile(rf"^{re.escape(field)}:.*$", re.MULTILINE)
    match = pattern.search(raw)
    if not match:
        print(f"    WARN: field '{field}' not found in {path.name}")
        return False
    old_line = match.group(0)
    new_line = f"{field}: {new_value}"
    if old_line == new_line:
        return False
    if DRY_RUN:
        print(f"    [DRY] {field}: {old_line.split(':', 1)[1].strip()} → {new_value}")
    else:
        new_raw = raw[:match.start()] + new_line + raw[match.end():]
        path.write_text(new_raw, encoding="utf-8")
    return True


def patch_pathways_add(path: Path, to_add: list[str]) -> bool:
    """Add pathway slugs to an existing pathways list (preserving existing order, no duplicates)."""
    fm = read_frontmatter(path)
    existing = fm.get("pathways") or []
    if isinstance(existing, str):
        # Handle edge case where YAML parsed as string
        existing = [existing]
    merged = list(dict.fromkeys(existing + to_add))  # deduplicate, preserve order
    # Re-order according to canonical order, unknown last
    ordered = [p for p in ORDERED_PATHWAYS if p in merged]
    ordered += [p for p in merged if p not in ORDERED_PATHWAYS]
    if ordered == existing:
        return False  # nothing changed
    new_value = "[" + ", ".join(ordered) + "]"
    return patch_field(path, "pathways", new_value)


def patch_file(rel_path: str, changes: dict) -> None:
    path = CONTENT_DIR / rel_path
    if not path.exists():
        print(f"  MISSING: {rel_path}")
        return
    changed = False
    print(f"  {rel_path}")
    for field, new_value in changes.items():
        if patch_field(path, field, new_value):
            changed = True
    if not changed:
        print(f"    (no changes needed)")


# ── Phase 2A: Pathway additions by category ──────────────────────────────────
#
# Rule: core grammar categories (grammar-for-meaning, sentence-structures,
# verb-patterns, tenses, modifiers) teach skills used in BOTH IELTS speaking
# and writing, but the inference script only assigned those pathways to articles
# whose slugs contained explicit "speaking"/"task" keywords.
#
# The fix: add the appropriate speaking/writing pathways to all articles
# in those categories, with surgical exclusions for purely writing-focused
# advanced structures (inversion, cleft, emphasis-inversion).
# ─────────────────────────────────────────────────────────────────────────────

SPEAKING_ONLY_WRITING = {
    # These structures are used in advanced formal writing but rarely in natural speech
    "emphasis-inversion",
    "inversion",
    "cleft-sentences",
}

WRITING_ONLY = {
    # need-doing is primarily written (passive infinitive construction)
    "need-doing-vs-need-to-be-done",
}

# Category → pathways to ADD (won't remove existing ones)
CATEGORY_PATHWAY_RULES: dict[str, list[str]] = {
    "grammar-for-meaning":   ["grammar-for-ielts-speaking", "grammar-for-ielts-writing"],
    "sentence-structures":   ["grammar-for-ielts-speaking", "grammar-for-ielts-writing"],
    "verb-patterns":         ["grammar-for-ielts-speaking", "grammar-for-ielts-writing"],
    "tenses":                ["grammar-for-ielts-speaking", "grammar-for-ielts-writing"],
    "modifiers":             ["grammar-for-ielts-speaking", "grammar-for-ielts-writing"],
}


def apply_category_pathway_additions() -> int:
    changed_count = 0
    for category, to_add in CATEGORY_PATHWAY_RULES.items():
        cat_dir = CONTENT_DIR / category
        if not cat_dir.exists():
            print(f"  MISSING category dir: {category}")
            continue
        for path in sorted(cat_dir.glob("*.md")):
            slug = read_frontmatter(path).get("slug") or path.stem

            # Determine which pathways actually apply to this article
            effective_add = list(to_add)
            if slug in SPEAKING_ONLY_WRITING:
                effective_add = [p for p in effective_add if p != "grammar-for-ielts-speaking"]
            if slug in WRITING_ONLY:
                effective_add = [p for p in effective_add if p != "grammar-for-ielts-speaking"]

            if not effective_add:
                continue

            rel = str(path.relative_to(CONTENT_DIR))
            print(f"  {rel}")
            if patch_pathways_add(path, effective_add):
                changed_count += 1
            else:
                print(f"    (no changes needed)")

    return changed_count


# ── Phase 2B: Targeted article-level corrections ─────────────────────────────

CORRECTIONS = {

    # ── Error tag fixes ──────────────────────────────────────────────────────

    # preposition-errors: collocation_error is wrong; wrong_preposition is primary
    "error-clinic/preposition-errors.md": {
        "common_error_tags": "[wrong_preposition, missing_preposition]",
    },

    # reporting speech shifts tense → wrong_tense is the dominant error
    "sentence-structures/reported-speech.md": {
        "common_error_tags": "[wrong_tense]",
    },

    # avoiding-repetitive-sentence-openings → vocabulary_repetition at sentence level
    "sentence-structures/avoiding-repetitive-sentence-openings.md": {
        "common_error_tags": "[vocabulary_repetition]",
    },

    # adjective-vs-adverb confusion is word_order_error (placing wrong modifier form)
    "modifiers/adjective-vs-adverb.md": {
        "common_error_tags": "[collocation_error]",
    },

    # phrasal-verbs: using wrong particle = wrong_preposition
    "verb-patterns/phrasal-verbs.md": {
        "common_error_tags": "[wrong_preposition]",
    },

    # ── Dead link fix ────────────────────────────────────────────────────────

    # comparative-superlative slug doesn't exist; comparing-ideas-in-speaking does
    "grammar-for-meaning/comparison.md": {
        "next_articles": "[adjectives, adverbs, comparing-ideas-in-speaking]",
    },
}


def main():
    print(f"{'[DRY RUN] ' if DRY_RUN else ''}Phase 2 metadata corrections\n")

    print("── Phase 2A: Category-wide pathway additions ──")
    n = apply_category_pathway_additions()
    print(f"\n{'[DRY RUN] ' if DRY_RUN else ''}Phase 2A: {n} files changed\n")

    print("── Phase 2B: Article-level targeted corrections ──")
    for rel_path, changes in CORRECTIONS.items():
        patch_file(rel_path, changes)

    print(f"\n{'[DRY RUN] ' if DRY_RUN else ''}Phase 2 done.")


if __name__ == "__main__":
    main()

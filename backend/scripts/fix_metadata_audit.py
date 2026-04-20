#!/usr/bin/env python3
"""
fix_metadata_audit.py — Apply targeted post-audit corrections to Grammar Wiki frontmatter.

Run from repo root:
  python3 backend/scripts/fix_metadata_audit.py [--dry-run]
"""
import re
import sys
from pathlib import Path

DRY_RUN = "--dry-run" in sys.argv
CONTENT_DIR = Path(__file__).parent.parent / "content"


def patch_field(path: Path, field: str, new_value: str) -> bool:
    """
    Replace `field: <anything>` with `field: <new_value>` in frontmatter.
    Returns True if changed.
    """
    raw = path.read_text(encoding="utf-8")
    pattern = re.compile(rf"^{re.escape(field)}:.*$", re.MULTILINE)
    match = pattern.search(raw)
    if not match:
        print(f"    WARN: field '{field}' not found in {path.name}")
        return False
    old_line = match.group(0)
    new_line = f"{field}: {new_value}"
    if old_line == new_line:
        return False  # already correct
    new_raw = raw[:match.start()] + new_line + raw[match.end():]
    if DRY_RUN:
        print(f"    [DRY] {field}: {old_line.split(':', 1)[1].strip()} → {new_value}")
    else:
        path.write_text(new_raw, encoding="utf-8")
    return True


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


# ── Correction manifest ──────────────────────────────────────────────────────
#
# Format: "category/slug.md" → { field: "new_raw_yaml_value" }
# Values are written verbatim as the part after "field: "
# Use YAML inline list syntax for arrays: [a, b, c]
# ─────────────────────────────────────────────────────────────────────────────

CORRECTIONS = {

    # ── 1. common_error_tags FALSE POSITIVES ────────────────────────────────

    # Confusable word pairs — wrong_tense came from error-clinic fallback
    "error-clinic/affect-vs-effect.md": {
        "common_error_tags": "[collocation_error]",
    },
    "error-clinic/economic-vs-economical.md": {
        "common_error_tags": "[collocation_error]",
    },
    "error-clinic/historic-vs-historical.md": {
        "common_error_tags": "[collocation_error]",
    },

    # Register / formality errors — wrong_tense came from fallback
    "error-clinic/informal-grammar-in-academic-writing.md": {
        "common_error_tags": "[collocation_error, wrong_connector]",
    },

    # Missing subject → subject-verb structure, not tense
    "error-clinic/missing-subjects.md": {
        "common_error_tags": "[subject_verb_disagreement, pronoun_error]",
    },

    # Missing main verb → predicate absent, closest tag is SVA
    # "missing-main-verb" keyword triggered missing_preposition — incorrect
    "error-clinic/missing-main-verbs.md": {
        "common_error_tags": "[subject_verb_disagreement]",
    },

    # overusing-i-think — "overusing" keyword triggered article_overuse
    "error-clinic/overusing-i-think.md": {
        "common_error_tags": "[vocabulary_repetition]",
    },

    # run-on-sentences — opposite problem to simple_sentence_overuse;
    # fix = add connectors between fused clauses
    "error-clinic/run-on-sentences.md": {
        "common_error_tags": "[missing_connector, wrong_connector]",
    },

    # sentence-fragments — incomplete sentences; fix = build proper complex structures
    "error-clinic/sentence-fragments.md": {
        "common_error_tags": "[no_complex_sentences]",
    },

    # parts-of-speech/verbs — reference article; "tenses" in tags is a topic tag,
    # not an error the article addresses
    "parts-of-speech/verbs.md": {
        "common_error_tags": "[]",
    },

    # ── 2. PATHWAY GAPS ─────────────────────────────────────────────────────

    # Hedging is core to BOTH writing and speaking
    "grammar-for-meaning/academic-hedging.md": {
        "pathways": "[grammar-for-ielts-speaking, grammar-for-ielts-writing, band-6-to-7]",
    },
    "grammar-for-meaning/hedging-language.md": {
        "pathways": "[grammar-for-ielts-speaking, grammar-for-ielts-writing, band-6-to-7]",
    },

    # Balanced arguments = Task 2 staple; strong/cautious opinions = academic writing too
    "ielts-grammar-lab/balanced-arguments-grammar.md": {
        "pathways": "[grammar-for-ielts-speaking, grammar-for-ielts-writing, band-6-to-7]",
    },
    "ielts-grammar-lab/strong-vs-cautious-opinions.md": {
        "pathways": "[grammar-for-ielts-speaking, grammar-for-ielts-writing, band-6-to-7]",
    },

    # Softening disagreement = speaking strategy, not error correction
    "ielts-grammar-lab/softening-disagreement-politely.md": {
        "pathways": "[grammar-for-ielts-speaking, band-6-to-7]",
    },

    # ── 3. DIFFICULTY / LEVEL / BAND misclassifications ─────────────────────
    #
    # These articles had level: beginner in source but teach intermediate concepts.
    # We update both level (original field) and the inferred difficulty + band_relevance.
    # We also remove grammar-for-beginners pathway where the article doesn't belong.

    # Contrast connectors (although/however/despite) = intermediate skill
    "sentence-structures/adding-contrast-naturally.md": {
        "level":           "intermediate",
        "difficulty":      "intermediate",
        "band_relevance":  "[6.0, 6.5, 7.0]",
        "pathways":        "[band-6-to-7]",
    },

    # Result connectors (therefore/consequently/as a result) = intermediate skill
    "sentence-structures/adding-results-clearly.md": {
        "level":           "intermediate",
        "difficulty":      "intermediate",
        "band_relevance":  "[6.0, 6.5, 7.0]",
        "pathways":        "[band-6-to-7]",
    },

    # Varying sentence openings = intermediate stylistic awareness
    "sentence-structures/avoiding-repetitive-sentence-openings.md": {
        "level":           "intermediate",
        "difficulty":      "intermediate",
        "band_relevance":  "[6.0, 6.5, 7.0]",
        "pathways":        "[band-6-to-7]",
    },

    # Past perfect = narrative complexity; definitely intermediate
    "tenses/past-perfect.md": {
        "level":           "intermediate",
        "difficulty":      "intermediate",
        "band_relevance":  "[6.0, 6.5, 7.0]",
        "pathways":        "[band-6-to-7]",
    },

    # Comparative/superlative grammar = intermediate in IELTS context
    "grammar-for-meaning/comparison.md": {
        "level":           "intermediate",
        "difficulty":      "intermediate",
        "band_relevance":  "[6.0, 6.5, 7.0]",
        "pathways":        "[band-6-to-7]",
    },

    # because vs because of = intermediate preposition distinction
    "grammar-for-meaning/because-vs-because-of.md": {
        "level":           "intermediate",
        "difficulty":      "intermediate",
        "band_relevance":  "[6.0, 6.5, 7.0]",
        "pathways":        "[band-6-to-7]",
    },

    # ── 4. DEAD LINKS in next_articles ──────────────────────────────────────

    # "modifiers" is a category, not a slug → replace with adjectives
    "grammar-for-meaning/comparison.md": {
        "level":           "intermediate",
        "difficulty":      "intermediate",
        "band_relevance":  "[6.0, 6.5, 7.0]",
        "pathways":        "[band-6-to-7]",
        "next_articles":   "[adjectives, adverbs, comparative-superlative]",
    },

    # "avoiding-overusing-i-think" slug doesn't exist; correct slug is overusing-i-think
    "sentence-structures/avoiding-repetitive-sentence-openings.md": {
        "level":           "intermediate",
        "difficulty":      "intermediate",
        "band_relevance":  "[6.0, 6.5, 7.0]",
        "pathways":        "[band-6-to-7]",
        "next_articles":   "[combining-two-short-sentences, adding-contrast-naturally, overusing-i-think]",
    },

    # "tenses" slug doesn't exist; replace with past-simple
    "sentence-structures/reported-speech.md": {
        "next_articles":   "[past-perfect, past-simple, present-perfect]",
    },
}


def main():
    print(f"{'[DRY RUN] ' if DRY_RUN else ''}Applying {len(CORRECTIONS)} file corrections...\n")

    for rel_path, changes in CORRECTIONS.items():
        patch_file(rel_path, changes)

    print(f"\n{'[DRY RUN] ' if DRY_RUN else ''}Done.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
add_metadata_fields.py — Append new YAML frontmatter fields to all Grammar Wiki .md files.

New fields added (skipped if already present):
  difficulty, band_relevance, common_error_tags,
  speaking_relevance, writing_relevance, next_articles, pathways

Run from repo root:
  python3 backend/scripts/add_metadata_fields.py [--dry-run]
"""
import re
import sys
from pathlib import Path

import yaml

CONTENT_DIR = Path(__file__).parent.parent / "content"
DRY_RUN = "--dry-run" in sys.argv

NEW_FIELDS = [
    "difficulty", "band_relevance", "common_error_tags",
    "speaking_relevance", "writing_relevance", "next_articles", "pathways",
]

# ── Inference helpers ────────────────────────────────────────────────────────

def infer_difficulty(slug: str, level: str, category: str) -> str:
    if level in ("beginner", "intermediate", "advanced"):
        return level

    advanced_slugs = [
        "inversion", "cleft", "emphasis", "academic-hedging", "hedging-language",
        "band7plus", "grammar-for-band7plus", "reported-speech", "causative",
        "emphasis-inversion",
    ]
    if any(p in slug for p in advanced_slugs):
        return "advanced"

    category_map = {
        "foundations": "beginner",
        "parts-of-speech": "beginner",
        "tenses": "intermediate",
        "verb-patterns": "intermediate",
        "sentence-structures": "intermediate",
        "modifiers": "intermediate",
        "grammar-for-meaning": "intermediate",
        "error-clinic": "intermediate",
        "common-errors": "intermediate",
        "advanced": "advanced",
        "ielts-grammar-lab": "intermediate",
        "ielts": "intermediate",
        "compare": "intermediate",
        "roadmaps": "intermediate",
    }
    return category_map.get(category, "intermediate")


def infer_band_relevance(difficulty: str, slug: str) -> list:
    if "band7plus" in slug or "band-7-plus" in slug or "grammar-for-band7" in slug:
        return [7.0, 7.5, 8.0]
    return {
        "beginner":     [5.0, 6.0],
        "intermediate": [6.0, 6.5, 7.0],
        "advanced":     [7.0, 7.5, 8.0],
    }.get(difficulty, [6.0, 6.5, 7.0])


def infer_error_tags(slug: str, tags: list, category: str) -> list:
    combined = f"{slug} {' '.join(str(t) for t in tags)} {category}".lower()
    result = set()

    rules = [
        (["article-error", "article-errors", "wrong-article"],         "wrong_article"),
        (["missing-article", "zero-article", "article"],               "missing_article"),
        (["article-overuse", "overusing"],                             "article_overuse"),
        (["subject-verb-agreement", "subject-verb"],                   "subject_verb_disagreement"),
        (["past-simple", "present-simple", "present-continuous",
          "past-continuous", "present-perfect", "past-perfect",
          "future-forms", "tenses", "tense"],                          "wrong_tense"),
        (["tense-consistency"],                                        "tense_inconsistency"),
        (["simple-sentence", "combining-two-short", "sentence-fragment",
          "run-on-sentence", "from-simple-to-complex"],                "simple_sentence_overuse"),
        (["complex-sentence", "relative-clause", "conditional",
          "from-simple-to-complex"],                                   "no_complex_sentences"),
        (["compound-sentence", "conjunction", "combining"],            "no_compound_sentences"),
        (["preposition-error", "preposition"],                         "wrong_preposition"),
        (["missing-preposition", "missing-main-verb"],                 "missing_preposition"),
        (["gerund-vs-infinitive", "gerund", "infinitive",
          "forget-doing", "remember-doing", "stop-doing",
          "try-doing", "regret-doing", "need-doing", "used-to"],      "gerund_infinitive_confusion"),
        (["modal-verb", "modal"],                                      "modal_verb_error"),
        (["pronoun", "wrong-pronoun", "double-subject"],               "pronoun_error"),
        (["comparison", "comparative", "superlative",
          "comparing", "rankings-and-extremes"],                       "comparatives_error"),
        (["passive-voice", "passive"],                                 "passive_voice_error"),
        (["word-order", "inversion", "cleft", "emphasis-inversion"],  "word_order_error"),
        (["discourse-marker", "linking", "connector", "although",
          "despite", "because-vs", "so-vs-such", "adding-contrast",
          "adding-conditions", "adding-results", "balanced-arguments",
          "adding-reasons"],                                           "missing_connector"),
        (["wrong-connector", "although-vs", "despite-vs"],            "wrong_connector"),
        (["avoiding-repetition", "vocabulary-repetition",
          "overusing-i-think"],                                        "vocabulary_repetition"),
        (["collocation", "do-vs-make", "say-tell"],                   "collocation_error"),
        (["word-form"],                                                "collocation_error"),
    ]

    for keywords, tag in rules:
        if any(kw in combined for kw in keywords):
            result.add(tag)

    # error-clinic always gets something relevant
    if category == "error-clinic" and not result:
        result.add("wrong_tense")  # fallback

    return sorted(result)


def infer_relevance(slug: str, category: str) -> tuple:
    speaking_patterns = [
        "speaking", "habits-and-routines", "expressing-preferences",
        "expressing-uncertainty", "comparing-ideas-in-speaking",
        "strong-vs-cautious", "conditionals-in-speaking",
        "agreeing-and-disagreeing", "softening-disagreement",
        "making-answers-longer", "talking-about-future", "talking-about-past",
        "talking-about-changes", "adding-reasons", "giving-examples",
        "speculating", "grammar-in-speaking", "balanced-arguments",
    ]
    writing_patterns = [
        "task1", "task2", "academic-hedging", "hedging-language",
        "percentages-and-proportions", "rankings-and-extremes",
        "overview-sentence", "grammar-in-task1", "grammar-in-task2",
        "avoiding-repetition-in-task2", "informal-grammar-in-academic",
    ]

    is_speaking = any(p in slug for p in speaking_patterns)
    is_writing  = any(p in slug for p in writing_patterns)

    if category == "ielts-grammar-lab":
        if is_speaking and not is_writing:
            return "high", "medium"
        if is_writing and not is_speaking:
            return "medium", "high"
        return "high", "high"

    high_both = {
        "tenses", "sentence-structures", "verb-patterns",
        "grammar-for-meaning", "advanced", "error-clinic", "common-errors",
    }
    if category in high_both:
        return "high", "high"

    # foundations / parts-of-speech / modifiers: medium by default
    # but some are clearly useful for both
    if any(p in slug for p in ["word-order", "noun-phrase", "sentence-element"]):
        return "high", "high"

    return "medium", "medium"


def infer_pathways(slug: str, category: str, difficulty: str, tags: list) -> list:
    pathways = []

    # grammar-for-beginners
    if difficulty == "beginner" or category in ("foundations", "parts-of-speech"):
        pathways.append("grammar-for-beginners")

    # grammar-for-ielts-speaking
    speaking_indicators = [
        "speaking", "habits-and-routines", "expressing-preferences",
        "expressing-uncertainty", "comparing-ideas-in-speaking",
        "strong-vs-cautious", "conditionals-in-speaking",
        "agreeing-and-disagreeing", "softening-disagreement",
        "making-answers-longer", "talking-about-future", "talking-about-past",
        "talking-about-changes", "adding-reasons", "giving-examples",
        "speculating", "grammar-in-speaking", "balanced-arguments",
        "grammar-for-band7plus", "common-ielts-grammar-mistakes",
    ]
    if any(p in slug for p in speaking_indicators):
        pathways.append("grammar-for-ielts-speaking")

    # grammar-for-ielts-writing
    writing_indicators = [
        "task1", "task2", "academic-hedging", "hedging-language",
        "percentages-and-proportions", "rankings-and-extremes",
        "overview-sentence", "grammar-in-task1", "grammar-in-task2",
        "avoiding-repetition-in-task2", "informal-grammar-in-academic",
        "grammar-for-band7plus", "common-ielts-grammar-mistakes",
    ]
    if any(p in slug for p in writing_indicators):
        pathways.append("grammar-for-ielts-writing")

    # fix-common-mistakes
    fix_indicators = [
        "error-clinic", "common-errors", "errors", "error", "mistake",
        "wrong-", "agreement", "tense-consistency", "double-subject",
        "run-on", "sentence-fragment", "missing-", "overusing",
        "word-form", "do-vs-make", "say-tell", "affect-vs-effect",
        "economic-vs", "historic-vs",
    ]
    if category in ("error-clinic", "common-errors") or any(p in slug for p in fix_indicators):
        pathways.append("fix-common-mistakes")

    # band-6-to-7
    band67_indicators = [
        "sentence-structures", "grammar-for-meaning", "advanced",
        "relative-clause", "passive-voice", "inversion", "cleft",
        "conditional", "discourse-marker", "academic-hedging",
        "hedging-language", "band7plus",
    ]
    if (difficulty == "intermediate"
            or any(p in slug for p in band67_indicators)
            or category in ("sentence-structures", "grammar-for-meaning", "advanced")):
        pathways.append("band-6-to-7")

    return list(dict.fromkeys(pathways))  # deduplicate, preserve order


def infer_next_articles(related_pages: list, slug: str) -> list:
    candidates = [s for s in (related_pages or []) if s != slug]
    return candidates[:3]


# ── YAML serialiser for new fields ──────────────────────────────────────────

def _yaml_list(values: list) -> str:
    """Inline list e.g. [5.0, 6.0] or []"""
    return "[" + ", ".join(str(v) for v in values) + "]"


def _yaml_str_list(values: list) -> str:
    """Inline string list e.g. [wrong_article, missing_article]"""
    if not values:
        return "[]"
    return "[" + ", ".join(values) + "]"


def build_new_fields_yaml(new_fields: dict) -> str:
    lines = []
    for key, val in new_fields.items():
        if isinstance(val, list) and val and isinstance(val[0], float):
            lines.append(f"{key}: {_yaml_list(val)}")
        elif isinstance(val, list):
            lines.append(f"{key}: {_yaml_str_list(val)}")
        else:
            lines.append(f"{key}: {val}")
    return "\n".join(lines)


# ── Main processor ───────────────────────────────────────────────────────────

def process_file(path: Path) -> bool:
    raw = path.read_text(encoding="utf-8")

    if not raw.startswith("---"):
        print(f"  SKIP (no frontmatter): {path.name}")
        return False

    parts = raw.split("---", 2)
    if len(parts) < 3:
        print(f"  SKIP (malformed): {path.name}")
        return False

    fm_raw  = parts[1]   # raw frontmatter text
    body    = parts[2]   # everything after closing ---

    fm = yaml.safe_load(fm_raw) or {}
    existing_keys = set(fm.keys())

    slug     = fm.get("slug") or path.stem
    category = fm.get("category") or path.parent.name
    level    = fm.get("level", "")
    tags     = fm.get("tags") or []

    # Compute difficulty first (needed for other fields)
    difficulty = fm.get("difficulty") or infer_difficulty(slug, level, category)

    new_fields = {}
    if "difficulty"        not in existing_keys:
        new_fields["difficulty"]        = difficulty
    if "band_relevance"    not in existing_keys:
        new_fields["band_relevance"]    = infer_band_relevance(difficulty, slug)
    if "common_error_tags" not in existing_keys:
        new_fields["common_error_tags"] = infer_error_tags(slug, tags, category)
    if "speaking_relevance" not in existing_keys or "writing_relevance" not in existing_keys:
        sp, wr = infer_relevance(slug, category)
        if "speaking_relevance" not in existing_keys:
            new_fields["speaking_relevance"] = sp
        if "writing_relevance"  not in existing_keys:
            new_fields["writing_relevance"]  = wr
    if "next_articles"     not in existing_keys:
        new_fields["next_articles"]     = infer_next_articles(fm.get("related_pages") or [], slug)
    if "pathways"          not in existing_keys:
        new_fields["pathways"]          = infer_pathways(slug, category, difficulty, tags)

    if not new_fields:
        return False  # nothing to add

    extra_yaml = build_new_fields_yaml(new_fields)

    # Append before closing --- (fm_raw ends with \n, add new lines then close)
    new_content = f"---{fm_raw}{extra_yaml}\n---{body}"

    if DRY_RUN:
        print(f"  [DRY] {path.relative_to(CONTENT_DIR)}: {list(new_fields.keys())}")
    else:
        path.write_text(new_content, encoding="utf-8")
        print(f"  UPDATED {path.relative_to(CONTENT_DIR)}: +{list(new_fields.keys())}")

    return True


def main():
    if not CONTENT_DIR.exists():
        print(f"ERROR: content dir not found: {CONTENT_DIR}")
        sys.exit(1)

    files = sorted(CONTENT_DIR.rglob("*.md"))
    print(f"{'[DRY RUN] ' if DRY_RUN else ''}Processing {len(files)} markdown files...\n")

    updated = 0
    skipped = 0
    for f in files:
        result = process_file(f)
        if result:
            updated += 1
        else:
            skipped += 1

    print(f"\n{'[DRY RUN] ' if DRY_RUN else ''}Done. {updated} updated, {skipped} already complete.")


if __name__ == "__main__":
    main()

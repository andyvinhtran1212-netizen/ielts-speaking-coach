from __future__ import annotations

import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.grammar_content import grammar_service  # noqa: E402


_EXPECTED_NEW_COVERED_SLUGS = {
    "grammar-for-band7plus",
    "grammar-in-speaking",
    "cleft-sentences",
    "articles-a-an-sound-rules",
    "zero-article",
    "some-any-no",
    "singular-vs-plural",
    "preposition-errors",
    "sentence-fragments",
    "wrong-pronoun-reference",
    "expressing-preferences-naturally",
    "talking-about-past-experiences",
    "talking-about-future-plans",
}

_NEW_ANCHOR_IDS = {
    "articles-a-an-sound-rules": {
        "articles-a-an-sound-rules.overview",
        "articles-a-an-sound-rules.core.sound-not-letter",
        "articles-a-an-sound-rules.h-silent-vs-pronounced",
        "articles-a-an-sound-rules.initialisms-and-letters",
    },
    "zero-article": {
        "zero-article.overview",
        "zero-article.generic.plural-nouns",
        "zero-article.generic.uncountable-nouns",
        "zero-article.institutions.school-work-home-bed",
    },
    "some-any-no": {
        "some-any-no.overview",
        "some-any-no.some.invitations-and-expected-yes",
        "some-any-no.any.negatives-and-questions",
        "some-any-no.no.double-negative",
    },
    "singular-vs-plural": {
        "singular-vs-plural.overview",
        "singular-vs-plural.irregular-plurals",
        "singular-vs-plural.subject-verb-agreement",
        "singular-vs-plural.number-of-vs-a-number-of",
    },
    "preposition-errors": {
        "preposition-errors.overview",
        "preposition-errors.time.at-on-in",
        "preposition-errors.verb-preposition-collocations",
        "preposition-errors.adjective-preposition-collocations",
    },
    "sentence-fragments": {
        "sentence-fragments.overview",
        "sentence-fragments.missing-main-verb",
        "sentence-fragments.subordinate-clause-alone",
        "sentence-fragments.ving-toinf-alone",
    },
    "wrong-pronoun-reference": {
        "wrong-pronoun-reference.overview",
        "wrong-pronoun-reference.it-ambiguous",
        "wrong-pronoun-reference.they-ambiguous",
        "wrong-pronoun-reference.this-that-ambiguous",
    },
    "expressing-preferences-naturally": {
        "expressing-preferences-naturally.overview",
        "expressing-preferences-naturally.prefer-structure",
        "expressing-preferences-naturally.id-rather",
        "expressing-preferences-naturally.reason-expansion",
    },
    "talking-about-past-experiences": {
        "talking-about-past-experiences.overview",
        "talking-about-past-experiences.past-simple-backbone",
        "talking-about-past-experiences.past-perfect-before-past",
        "talking-about-past-experiences.sequencing-language",
    },
    "talking-about-future-plans": {
        "talking-about-future-plans.overview",
        "talking-about-future-plans.will.decisions-and-predictions",
        "talking-about-future-plans.be-going-to.prior-intention",
        "talking-about-future-plans.present-continuous.arrangements",
    },
    "tense-consistency": {
        "tense-consistency.past-narrative.main-timeline",
        "tense-consistency.ielts-writing.task2-default-tense",
        "tense-consistency.ielts-speaking.storytelling",
    },
}


def _load_mapping_rows():
    raw = yaml.safe_load(
        (Path(__file__).parent.parent / "content" / "feedback-anchor-mapping.yaml")
        .read_text(encoding="utf-8")
    )
    return raw.get("mappings") or []


def test_sprint_21_2_coverage_adds_expected_slug_set():
    rows = _load_mapping_rows()
    covered_slugs = {
        row["target_anchor"].split(".", 1)[0]
        for row in rows
        if row.get("target_anchor") and not row.get("deferred_until")
    }

    assert _EXPECTED_NEW_COVERED_SLUGS <= covered_slugs
    assert len(covered_slugs) >= 41, (
        f"Expected slug coverage to grow from 28 to at least 41; got {len(covered_slugs)}"
    )


def test_sprint_21_2_new_mappings_target_complete_articles_only():
    rows = [r for r in _load_mapping_rows() if r.get("mapping_id", "") >= "M051"]

    for row in rows:
        slug = row["target_anchor"].split(".", 1)[0]
        article = grammar_service.articles_by_slug.get(slug)
        assert article is not None, f"Missing article for new mapping slug {slug!r}"
        assert article.get("status") == "complete", (
            f"New mapping {row['mapping_id']} points at non-complete article {slug!r} "
            f"(status={article.get('status')!r})"
        )


def test_sprint_21_2_new_anchor_declarations_exist_on_target_articles():
    for slug, expected_ids in _NEW_ANCHOR_IDS.items():
        article = grammar_service.articles_by_slug.get(slug)
        assert article is not None, f"Article {slug!r} missing from grammar service"
        declared = {a["id"] for a in (article.get("anchors") or [])}
        missing = expected_ids - declared
        assert not missing, f"Article {slug!r} is missing anchors: {sorted(missing)}"

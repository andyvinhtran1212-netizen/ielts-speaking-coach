# Mapping Coverage Gap Report

_Generated: 2026-05-05 — Sprint 7 Phase 1 scaffolding_

## Summary

- **Total articles:** 98
- **Covered slugs (≥1 active mapping):** 28
- **Missing slugs:** 70
  - **Ready** (anchors declared, mapping content can be written): 3
  - **Blocked** (0 anchors, needs Sprint-1-style anchor declaration first): 67
- **Active mappings (sanity check vs drift gate):** 42

> **Slug coverage** = does *any* mapping's `target_anchor` begin
> with this slug? An article counts as covered with as little as
> one mapping pinned to it. Sprint 7 Day 2+ planning decides per-
> anchor depth — this report is the slug-level skeleton.

## Missing slugs WITH declared anchors (ready for Sprint 7 mapping work)

### ielts-grammar-lab (2 ready)

- `grammar-for-band7plus` — 8 anchor(s) declared
- `grammar-in-speaking` — 7 anchor(s) declared

### sentence-structures (1 ready)

- `cleft-sentences` — 6 anchor(s) declared

## Missing slugs WITHOUT declared anchors (blocker — anchor declaration first)

### error-clinic (12 blocked)

- `affect-vs-effect` — 0 anchors
- `do-vs-make` — 0 anchors
- `double-subject-errors` — 0 anchors
- `economic-vs-economical` — 0 anchors
- `historic-vs-historical` — 0 anchors
- `overusing-i-think` — 0 anchors
- `preposition-errors` — 0 anchors
- `run-on-sentences` — 0 anchors
- `say-tell-speak-talk` — 0 anchors
- `sentence-fragments` — 0 anchors
- `word-form-errors` — 0 anchors
- `wrong-pronoun-reference` — 0 anchors

### foundations (14 blocked)

- `articles-a-an-sound-rules` — 0 anchors
- `articles-with-places-and-names` — 0 anchors
- `few-a-few-little-a-little` — 0 anchors
- `many-much-a-lot-of` — 0 anchors
- `noun-phrase-basics` — 0 anchors
- `other-another-the-other-others` — 0 anchors
- `parts-of-speech` — 0 anchors
- `phrase-vs-clause` — 0 anchors
- `sentence-elements` — 0 anchors
- `singular-vs-plural` — 0 anchors
- `some-any-no` — 0 anchors
- `there-is-vs-it-is` — 0 anchors
- `this-that-these-those-in-use` — 0 anchors
- `zero-article` — 0 anchors

### grammar-for-meaning (6 blocked)

- `academic-hedging` — 0 anchors
- `although-though-even-though` — 0 anchors
- `because-vs-because-of` — 0 anchors
- `despite-vs-in-spite-of` — 0 anchors
- `quantifiers` — 0 anchors
- `so-vs-such` — 0 anchors

### ielts-grammar-lab (15 blocked)

- `adding-reasons-clearly` — 0 anchors
- `agreeing-and-disagreeing-naturally` — 0 anchors
- `common-ielts-grammar-mistakes` — 0 anchors
- `comparing-ideas-in-speaking` — 0 anchors
- `conditionals-in-speaking` — 0 anchors
- `expressing-preferences-naturally` — 0 anchors
- `giving-examples-naturally` — 0 anchors
- `making-answers-longer-naturally` — 0 anchors
- `softening-disagreement-politely` — 0 anchors
- `speculating-about-the-future` — 0 anchors
- `strong-vs-cautious-opinions` — 0 anchors
- `talking-about-changes-over-time` — 0 anchors
- `talking-about-future-plans` — 0 anchors
- `talking-about-habits-and-routines` — 0 anchors
- `talking-about-past-experiences` — 0 anchors

### modifiers (2 blocked)

- `adjective-vs-adverb` — 0 anchors
- `adverbs` — 0 anchors

### parts-of-speech (4 blocked)

- `conjunctions` — 0 anchors
- `nouns` — 0 anchors
- `pronouns` — 0 anchors
- `verbs` — 0 anchors

### sentence-structures (4 blocked)

- `complex-sentence` — 0 anchors
- `compound-sentence` — 0 anchors
- `inversion` — 0 anchors
- `simple-sentence` — 0 anchors

### tenses (3 blocked)

- `past-continuous` — 0 anchors
- `past-perfect` — 0 anchors
- `present-perfect-continuous` — 0 anchors

### verb-patterns (7 blocked)

- `bare-infinitive` — 0 anchors
- `causative-verbs` — 0 anchors
- `gerund` — 0 anchors
- `infinitive` — 0 anchors
- `phrasal-verbs` — 0 anchors
- `used-to-be-used-to-get-used-to` — 0 anchors
- `wish-hope` — 0 anchors

## Priority signal — to be filled in Sprint 7 Day 2 review

This script is a deterministic filesystem audit; it does not
query production. Andy + planner overlay AI-emit frequency from
`grammar_recommendations` (last 30 days, group by
`recommended_slug`) onto the **ready** list to decide which
batches go first.

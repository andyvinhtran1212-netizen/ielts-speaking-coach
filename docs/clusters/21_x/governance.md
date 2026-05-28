# Cluster 21.x Grammar Wiki Governance

**Date:** 2026-05-28  
**Cluster:** 21.x Grammar Wiki Learning Loop Enhancement  
**Scope:** status truth, recommendation visibility, and editorial release decisions

## Purpose

Sprint 21.1 established that Grammar Wiki recommendations must reflect canonical article status truth. Sprint 21.3 closes that loop with a lightweight governance rule so future content work does not reintroduce draft/live ambiguity.

## Status policy

### `complete`

Use `status: complete` when all of the following are true:

1. The article has a coherent learning arc, not just a stub.
2. Frontmatter metadata is populated enough to support navigation and recommendation reuse.
3. The article has anchor coverage for its main sections or pitfall areas when deep-linking is expected.
4. The content is safe to recommend publicly without an editorial warning.

Effect:
- Article is publicly visible.
- Recommendation pipeline may surface it.
- Mapping entries targeting its anchors are considered live coverage.

### `draft`

Use `status: draft` when any of the following are true:

1. The article is structurally incomplete.
2. Anchor plan exists but the content is not ready for student-facing recommendation.
3. Editorial review still expects meaningful factual, pedagogical, or structural changes.

Effect:
- Article may still be accessible directly for internal/editorial review.
- Recommendation pipeline must skip it.
- Mappings pointing at it are effectively dormant until the article is promoted.

### `updating`

Use `status: updating` when a live article temporarily needs a maintenance placeholder rather than full public recommendation.

Effect:
- Public page can show maintenance-state UI.
- Recommendation surfaces should generally prefer `complete` articles first.

## Release decision rule

Cluster 21.x uses a simple rule:

- If the article is recommendation-safe for a student today, mark it `complete`.
- If Andy would still hesitate to let a recommendation land there today, keep it `draft`.

This avoids the previous ambiguous state where structurally rich articles stayed `draft` while mappings already targeted them.

## Sprint 21.3 assessment of the 3 former draft articles

### `grammatical-collocations`

Assessment:
- 2,200+ words
- 13 declared anchors
- clear overview, pitfall breakdown, IELTS Speaking application, and high-frequency lists

Decision:
- Promote to `complete`

Rationale:
- This is not a stub; it is already strong enough to absorb recommendation traffic safely.

### `discourse-markers-spoken`

Assessment:
- ~1,900 words
- 12 declared anchors
- strong speaking-specific pedagogy, common-mistake section, and per-Part IELTS application

Decision:
- Promote to `complete`

Rationale:
- The article is content-complete enough for live recommendation use and directly supports Grammar Wiki learning-loop goals.

### `pronunciation-grammar-link`

Assessment:
- ~1,400 words
- 10 declared anchors
- clear scope, concrete drills, strong relevance to speaking grading feedback

Decision:
- Promote to `complete`

Rationale:
- The article is specialized but recommendation-safe. Keeping it `draft` would block a real learning-loop path without a clear editorial reason.

## Operational rule going forward

Before merging new mappings or anchor expansions that target an article:

1. Confirm the article is `complete`.
2. Confirm anchor IDs exist in frontmatter.
3. Confirm the recommendation is pedagogically useful, not just technically valid.

If any of those fail, leave the article `draft` and do not treat it as live recommendation coverage yet.

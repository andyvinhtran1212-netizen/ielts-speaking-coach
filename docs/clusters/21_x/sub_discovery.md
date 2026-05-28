# Cluster 21.x Sprint 21.0 Sub-Discovery — Grammar Wiki Learning Loop Triage

**Date:** 2026-05-28  
**Agent:** Codex (OpenAI Codex CLI)  
**Coordinator:** Mình  
**Project owner:** Andy  
**Predecessor:** Broad Codex Grammar Discovery (merged earlier)

## Summary

The biggest empirical reliability bug is not in anchor generation itself, but in the **inline recommendation links** on Result and Practice: they point to `grammar.html` instead of the grammar article route, so hash anchors often never land on the article page. Coverage is also still thin: only `28/98` article slugs are mapping-covered, only `31/98` articles declare any anchors, and `9/47` active mappings currently point to articles marked `draft`.

Sprint 21.1 should likely focus on two code fixes first: correct the deep-link destination path and make draft/status truth honest in the recommendation pipeline. Sprint 21.2 can then expand coverage using the three already-anchored-but-unmapped articles plus the highest-value anchorless articles.

## Section 0 — Mind-side premise corrections (Pattern #42)

The broad Discovery premise "grammar exists and is mature" remains correct. The sharper corrections from this Sub-Discovery are:

1. **There is no closed speaking-grader error taxonomy.**
   - `grammar_issues` are free-form Vietnamese strings emitted by the Claude practice prompt, not enum-like codes.
   - Evidence: [backend/services/claude_grader.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/claude_grader.py:272)
   - Implication: "coverage %" cannot be measured against a finite authoritative grader taxonomy. It can only be measured against current mapping inventory, observed fixtures, and content anchor coverage.

2. **The matcher itself is not obviously broken today.**
   - The local anchor/matcher suites pass: `27 passed`.
   - Evidence run: `backend/venv/bin/python -m pytest backend/tests/test_grammar_anchor_matcher.py backend/tests/test_grammar_matcher_integration.py -q`
   - Implication: the current reliability gap is more "last-mile pipeline + coverage + status truth" than "core matcher completely failing."

3. **Anchor UX does exist and is deliberate.**
   - Article pages already perform post-render hash scroll and pulse highlight.
   - Evidence: [frontend/js/grammar.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/grammar.js:530)
   - Implication: the main UX bug is pathing/integration, not absence of anchor logic.

## Section 1 — Recommendation pipeline empirical trace

### Practice-mode recommendation path

1. Claude grader emits free-form `grammar_issues`
   - Prompt contract: up to 5 short Vietnamese issue strings
   - [backend/services/claude_grader.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/claude_grader.py:272)

2. Claude grader attaches grammar recommendations
   - `_attach_grammar_recommendations(result)` iterates over `grammar_issues`
   - Calls `grammar_service.find_best_match(issue)`
   - Then calls `grammar_service.find_best_anchor(issue, slug)`
   - Builds `{ issue, slug, category, title, score, anchor }`
   - [backend/services/claude_grader.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/claude_grader.py:1274)

3. `find_best_match()` routes issue text to an article slug
   - Tier 1: `feedback-anchor-mapping.yaml` keywords/examples/summary
   - Tier 2: article title + tags fallback
   - Body text excluded by design
   - [backend/services/grammar_content.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/grammar_content.py:363)

4. `find_best_anchor()` resolves within-slug anchor
   - Uses active mapping entries grouped by slug
   - Token-overlap scoring against `feedback_keywords`, `user_phrase_examples`, and `feedback_pattern_summary`
   - [backend/services/grammar_content.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/grammar_content.py:731)

5. Grading router persists the recommendation rows
   - Practice mode only
   - Persists `recommended_anchor` into `grammar_recommendations`
   - [backend/routers/grading.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/grading.py:573)
   - Save helper: [backend/routers/grading.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/grading.py:708)

6. Frontend rendering splits into two paths
   - **Grammar cards** use clean article route `/grammar/<category>/<slug>#anchor`
     - Result page: [frontend/pages/result.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/result.html:1038)
     - Practice page: [frontend/js/practice.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/practice.js:994)
   - **Inline issue links** use `grammar.html?category=...&slug=...#anchor`
     - Result page: [frontend/pages/result.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/result.html:498)
     - Practice page: [frontend/js/practice.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/practice.js:1367)

### Anchor landing path

1. Article page loads the article HTML via `/api/grammar/article/{category}/{slug}`
   - [frontend/js/grammar.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/grammar.js:588)

2. After DOM injection, `_scrollToHashAnchor()` runs
   - Finds `window.location.hash`
   - `requestAnimationFrame(...)`
   - `el.scrollIntoView({ behavior: 'smooth', block: 'start' })`
   - `_pulseAnchorHeading(el)`
   - [frontend/js/grammar.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/grammar.js:540)

3. CSS gives anchors and headings scroll offset and pulse animation
   - `.article-body .grammar-anchor { scroll-margin-top: 80px; }`
   - `.grammar-anchor-pulse { animation: gw-grammarAnchorPulse 3s ease-out; }`
   - [frontend/css/grammar-wiki.css](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/css/grammar-wiki.css:645)

## Section 2 — Reliability bug identification

### High — Inline recommendation links route to the wrong page

**Root cause**

- Inline links next to grammar issues on both Result and Practice open `grammar.html?category=...&slug=...#anchor`
- `grammar.html` is the landing page, not the article page
- `loadGrammarHome()` handles `q` and `category`, but not article hash landing
- The article-page anchor logic in `loadGrammarArticle()` never runs on that route

**Evidence**

- Wrong href generation:
  - [frontend/pages/result.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/result.html:498)
  - [frontend/js/practice.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/practice.js:1367)
- Actual article-page hash landing logic:
  - [frontend/js/grammar.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/grammar.js:588)

**Impact**

- Users click a specific anchor recommendation and often do not land at the intended article section
- This exactly matches Andy's "anchor UX không reliable" report

**Reproduction**

1. Open a practice/result response with a recommendation that includes `anchor`
2. Click the small inline `→ Học bài`
3. Browser opens `grammar.html?...#anchor`
4. Landing page renders instead of article page; anchor highlight/scroll path never executes

### High — Draft article status is normalized away, but mappings already target draft content

**Root cause**

- Loader only accepts `complete` or `updating`
- Any other status, including `draft`, is normalized to `complete`
- Yet active mappings target draft articles

**Evidence**

- Status normalization: [backend/services/grammar_content.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/grammar_content.py:200)
- Active mappings count: `47`
- Active mappings targeting draft articles: `9`
- Draft-targeted slugs:
  - `grammatical-collocations`
  - `discourse-markers-spoken`
  - `pronunciation-grammar-link`

**Impact**

- Recommendation pipeline can send users into content that editorially says `draft`
- Student/admin surfaces may present those pages as effectively live/complete
- This is an operational-truth bug, not just a content backlog issue

### Medium — Recommendation coverage is still sparse at slug level

**Root cause**

- Only `28/98` article slugs have at least one active mapping
- Only `31/98` articles declare any anchors
- The matcher can only deep-link where both slug coverage and anchor declarations exist

**Evidence**

- `47` active mappings
- `28` covered slugs
- `70` uncovered slugs
- `67` uncovered slugs are blocked by zero anchors
- `3` uncovered slugs are ready for mapping now

**Impact**

- Reliability degrades into "sometimes article-level route, sometimes no recommendation, sometimes no anchor"
- This is the main explanation for Andy's "thiếu bao quát" concern

### Low-to-Medium — Click telemetry parity is inconsistent

**Root cause**

- Practice inline links patch `/api/grammar/recommendations/{rec_id}/clicked`
- Result-page inline links do not
- Card links also do not visibly patch click telemetry in this local scan

**Evidence**

- Practice inline click patch: [frontend/js/practice.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/practice.js:1370)
- Result inline link lacks equivalent patch: [frontend/pages/result.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/result.html:498)

**Impact**

- Reliability diagnostics are weaker because not all recommendation-entry paths measure click-through consistently

## Section 3 — Anchor scroll + highlight UX architecture

### What already works

- Article anchors are embedded into rendered HTML as empty `<a id="...">` markers
  - [backend/services/grammar_content.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/grammar_content.py:187)
- Article page manually scrolls to hash after content injection
  - [frontend/js/grammar.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/grammar.js:540)
- The next heading gets a 3-second pulse class
  - [frontend/js/grammar.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/grammar.js:573)
- CSS includes `scroll-margin-top: 80px` to avoid header collision
  - [frontend/css/grammar-wiki.css](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/css/grammar-wiki.css:645)

### Specific bugs / UX gaps

1. **Primary bug: wrong deep-link destination path**
   - The scroll/highlight code only lives on the article page
   - Inline links often never reach that page

2. **Missing in-page failure signal**
   - If hash anchor is absent, code only `console.warn(...)`
   - Users get no inline indication that the target section could not be found
   - [frontend/js/grammar.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/grammar.js:555)

3. **No explicit hashchange re-handler**
   - Current flow runs `_scrollToHashAnchor()` after article load
   - I did not find a `hashchange` listener for same-page anchor retargeting
   - This is lower priority than the broken href path, but still a UX ceiling

### Verdict

The anchor UX architecture is present and reasonably intentional. The most important issue is **integration pathing**, not missing scroll or missing highlight code.

## Section 4 — Coverage analysis (quantitative)

### Core metrics

| Metric | Value |
|---|---:|
| Active grammar articles | 98 |
| Articles with at least 1 anchor | 31 |
| Articles with zero anchors | 67 |
| Total declared anchors | 217 |
| Avg anchors per article | 2.21 |
| Avg anchors per anchored article | 7.00 |
| Active mappings | 47 |
| Covered slugs | 28 |
| Slug coverage across all articles | 28.6% |
| Article anchor coverage | 31.6% |
| Anchor-level direct targeting (`47 / 217`) | 21.7% |
| Broken slug references in active mappings | 0 |
| Broken anchor references in active mappings | 0 |

### Status truth metrics

| Metric | Value |
|---|---:|
| `complete` articles | 95 |
| `draft` articles | 3 |
| `updating` articles | 0 |
| Active mappings targeting `draft` articles | 9 / 47 (19.1%) |

Draft-targeted slugs:

- `grammatical-collocations`
- `discourse-markers-spoken`
- `pronunciation-grammar-link`

### Category anchor density

| Category | Articles | With anchors | Total anchors |
|---|---:|---:|---:|
| `error-clinic` | 17 | 5 | 22 |
| `foundations` | 18 | 4 | 24 |
| `grammar-for-meaning` | 12 | 6 | 62 |
| `ielts-grammar-lab` | 18 | 3 | 25 |
| `modifiers` | 3 | 1 | 2 |
| `parts-of-speech` | 5 | 1 | 2 |
| `sentence-structures` | 8 | 4 | 21 |
| `tenses` | 8 | 5 | 38 |
| `verb-patterns` | 9 | 2 | 21 |

### Ready vs blocked expansion

Already anchored but still unmapped:

1. `grammar-for-band7plus` — 8 anchors
2. `grammar-in-speaking` — 7 anchors
3. `cleft-sentences` — 6 anchors

Blocked by zero anchors: `67` slugs.

### Top currently mapped slugs

| Slug | Mapping count |
|---|---:|
| `article-errors` | 6 |
| `articles` | 3 |
| `conditionals` | 3 |
| `grammatical-collocations` | 3 |
| `discourse-markers-spoken` | 3 |
| `pronunciation-grammar-link` | 3 |

## Section 5 — Content quality spot-check

### Sample set

I spot-checked these articles:

- `articles`
- `grammar-for-band7plus`
- `article-errors`
- `tense-consistency`
- `adjectives`
- `discourse-markers-spoken`
- `pronunciation-grammar-link`
- `grammar-in-speaking`
- `cleft-sentences`

### Observations

**Strong patterns**

1. Vietnamese explanations are generally clear and pedagogical.
2. English examples are plentiful in the stronger articles.
3. Complete hub articles are metadata-rich: related/next/pathways/tags are usually populated.
4. IELTS-oriented articles are already real content, not placeholders.

**Weakness patterns**

1. **Anchor coverage is highly uneven**
   - Many complete articles still have zero anchors
   - This is the biggest blocker for recommendation deep-link expansion

2. **Some high-value recommendation targets are still `draft`**
   - `discourse-markers-spoken`, `pronunciation-grammar-link`, and `grammatical-collocations` are structurally rich, but not status-honest in the current loader path

3. **Error-clinic depth varies**
   - `article-errors` is richly segmented with 7 anchors
   - `tense-consistency` only has 2 anchors despite being a common recommendation destination

4. **Some useful meta-hub articles are unmapped**
   - `grammar-in-speaking` and `grammar-for-band7plus` look strong, but contribute little to recommendation coverage today because they are not mapped

### Top 3 content QA priorities

1. Add anchors to high-value complete articles that are currently anchorless.
2. Deepen anchor granularity for already-mapped but under-segmented slugs like `tense-consistency`.
3. Resolve draft-vs-live truth for the three draft articles already being recommended.

## Section 6 — Fix scope estimation per bug

| Priority | Item | Est. LOC | File scope |
|---|---|---:|---|
| P0 | Fix inline recommendation hrefs to use article route, not `grammar.html` | 10–30 | `frontend/pages/result.html`, `frontend/js/practice.js` |
| P1 | Make `draft` status truthful in grammar loader / recommendation surfacing | 10–40 | `backend/services/grammar_content.py`, possibly grammar frontend display path |
| P1 | Add inline fallback state when anchor missing instead of console-only fail | 20–50 | `frontend/js/grammar.js` |
| P1 | Add hashchange re-trigger for same-page anchor changes | 15–35 | `frontend/js/grammar.js` |
| P2 | Click telemetry parity across result/practice recommendation entry paths | 10–25 | result/practice frontend files |
| P2 | Add mappings for the 3 already-anchored unmapped slugs | 50–120 | `backend/content/feedback-anchor-mapping.yaml` |
| P3 | Declare anchors for the top blocked complete slugs | 400–1200 | content Markdown files only |

### Dependencies

- P0 deep-link fix should land before any anchor UX polishing; otherwise users still miss the article page entirely.
- Status-truth fix should land before broader recommendation expansion; otherwise Sprint 21.2 may expand into more content whose publish state is still ambiguous.

## Section 7 — Sprint 21.1+ scope recommendation

### Sprint 21.1 — Reliability fixes + honest surfacing

Recommended scope:

- fix inline deep-link hrefs
- make `draft` state truthful in runtime behavior
- improve anchor-miss UX on article page
- optionally add hashchange re-trigger

Estimated scope: **small-to-medium**, roughly `40–120 LOC`.

### Sprint 21.2 — Coverage expansion

Recommended scope:

- first add mappings for `grammar-for-band7plus`, `grammar-in-speaking`, `cleft-sentences`
- then prioritize anchor declarations for high-value complete slugs among the current `67` blocked articles

Estimated scope: **content-heavy**, mostly YAML/Markdown, not architectural.

### Sprint 21.3 — Content QA / editorial governance

Recommended scope:

- review draft-vs-live policy
- review anchor density standards
- review metadata depth for top recommendation targets

### Cluster 21.x likely shape

1. Sprint 21.1 — reliability and truth
2. Sprint 21.2 — mapping and anchor expansion
3. Sprint 21.3 — content QA and authoring/governance decisions

## Section 8 — Pre-emptive guidance for Sprint 21.1 commission

### Reuse mandates

- Reuse existing matcher pipeline; do not replace `find_best_match()` or `find_best_anchor()` without fresh evidence
  - [backend/services/grammar_content.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/grammar_content.py:363)
- Reuse article-page anchor landing path; fix the broken callers first
  - [frontend/js/grammar.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/grammar.js:540)
- Treat `feedback-anchor-mapping.yaml` as the canonical mapping source
  - [backend/content/feedback-anchor-mapping.yaml](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/content/feedback-anchor-mapping.yaml:1)

### Pattern #42 watch-items

1. Do not assume greenfield: this is a repair-and-expand sprint.
2. Do not assume the matcher is broken because users report unreliable UX; the last-mile link path is the clearest bug found.
3. Do not assume drift script green means production-ready recommendations; draft-targeted mappings prove otherwise.
4. Do not assume "taxonomy coverage %" can be exact while `grammar_issues` remain free-text strings.

### External / process notes

- Local matcher tests are green, so Sprint 21.1 should keep them green and add regression coverage for the broken href path.
- I did not observe a new concrete Vercel hook false-positive beyond the commission warning; nothing needed here beyond noting the baseline.

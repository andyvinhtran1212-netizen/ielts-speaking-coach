# Grammar Wiki Discovery — Codex Independent Investigation

**Date:** 2026-05-28  
**Agent:** Codex (OpenAI Codex CLI)  
**Coordinator:** Mình (Claude chat assistant)  
**Project owner:** Andy

## Summary

Grammar Wiki is not greenfield. It is already a mature, production-facing subsystem with a live student surface, a live admin surface, a file-based editorial workflow, personalized tracking, grammar recommendation integration, and a substantial content corpus.

The empirical lean is not "build Grammar Wiki from scratch." The likely upgrade scope is one of: editorial/authoring workflow uplift, taxonomy/search/navigation polish, recommendation-quality improvements, or deeper integration with Speaking/Writing/Reading. A full rebuild would throw away working infrastructure that already exists.

## Section 0 — Mind-side premise corrections (Pattern #42)

The prompt framed Grammar Wiki as "state unknown" with a real possibility of placeholder or greenfield status. Repository evidence corrects that premise heavily:

- Grammar Wiki already has a mounted FastAPI router in [backend/main.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/main.py:29) and [backend/main.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/main.py:126).
- Student navigation already exposes a live Grammar tab in [frontend/js/components/aver-chrome.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/components/aver-chrome.js:59) and [frontend/js/components/aver-chrome.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/components/aver-chrome.js:319).
- Admin navigation already exposes a live Grammar section in [frontend/js/components/aver-admin-chrome.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/components/aver-admin-chrome.js:43) and [frontend/js/components/aver-admin-chrome.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/components/aver-admin-chrome.js:397).
- Grammar content is already substantial: `98` active Markdown articles under `backend/content/**` excluding `_archive/`.
- Grammar is integrated into grading, home/dashboard, sitemap, and recommendation flows.

Bottom line: Grammar Wiki is a mature subsystem with real product surface area, not an empty placeholder.

## Section 1 — Existence + maturity inventory

### Maturity classification

**Classification:** mature subsystem with file-based editorial workflow.

This is supported by all four layers existing and wired:

1. **Content layer**
   - `backend/content/**/*.md` grammar corpus
   - `backend/content/_groups.yaml`
   - `backend/content/feedback-anchor-mapping.yaml`

2. **Backend read API**
   - [backend/routers/grammar.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/grammar.py:32)
   - Home, categories, article, roadmap, compare, search, groups, view/save/dashboard endpoints

3. **Student UI**
   - [frontend/grammar.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/grammar.html:76)
   - [frontend/pages/grammar-article.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/grammar-article.html:72)
   - [frontend/pages/grammar-search.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/grammar-search.html:55)
   - [frontend/pages/grammar-roadmap.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/grammar-roadmap.html:56)
   - [frontend/pages/grammar-compare.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/grammar-compare.html:55)
   - [frontend/js/grammar.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/grammar.js:37)
   - [frontend/css/grammar-wiki.css](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/css/grammar-wiki.css)

4. **Admin tooling**
   - [frontend/pages/admin/grammar/index.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/grammar/index.html:97)
   - [frontend/js/admin-grammar-articles.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/admin-grammar-articles.js:1)
   - [frontend/js/admin-grammar-analytics.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/admin-grammar-analytics.js)
   - [frontend/js/admin-grammar-recommend.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/admin-grammar-recommend.js)
   - Admin endpoints in [backend/routers/admin.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/admin.py:3656)

### Inventory notes

- Public routes are mounted under `/api/grammar/*` in [backend/routers/grammar.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/grammar.py:35).
- Admin routes are mounted under `/admin/grammar/*` in [backend/routers/admin.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/admin.py:3665).
- Grammar is included in sitemap generation via [backend/routers/sitemap.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/sitemap.py:24).
- Grammar is integrated into student home aggregation via [backend/services/student_home_aggregator.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/student_home_aggregator.py:95).

There is no evidence of a locked placeholder tab. Grammar is already live in both student and admin chrome.

## Section 2 — Content state

### Content volume

Active grammar Markdown files excluding `_archive`:

- `98` total active articles
- `9` category directories

Category counts:

| Category | Count |
|---|---:|
| `foundations` | 18 |
| `ielts-grammar-lab` | 18 |
| `error-clinic` | 17 |
| `grammar-for-meaning` | 12 |
| `verb-patterns` | 9 |
| `sentence-structures` | 8 |
| `tenses` | 8 |
| `parts-of-speech` | 5 |
| `modifiers` | 3 |

### Format

The grammar corpus is file-based Markdown with YAML frontmatter, parsed in [backend/services/grammar_content.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/grammar_content.py:163).

Observed frontmatter fields include:

- `title`
- `slug`
- `category`
- `summary`
- `level`
- `difficulty`
- `band_relevance`
- `common_error_tags`
- `speaking_relevance`
- `writing_relevance`
- `next_articles`
- `pathways`
- `tags`
- `prerequisites`
- `related_pages`
- `compare_with`
- `order`
- `last_updated`
- `status`
- `anchors`

This is richer than a simple article store. The content model already supports roadmaping, related links, deep-link anchors, recommendation mapping, and skill relevance.

### Quality spot-check

Sample article 1: [backend/content/foundations/articles.md](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/content/foundations/articles.md:1)

- Vietnamese explanation with English examples
- strong pedagogical structure
- explicit IELTS relevance
- rich anchors for deep-linking and recommendations

Sample article 2: [backend/content/ielts-grammar-lab/grammar-for-band7plus.md](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/content/ielts-grammar-lab/grammar-for-band7plus.md:1)

- IELTS-specific advanced grammar focus
- high-detail examples
- explicit band targeting
- cross-links to core grammar topics

### Important content-state caveat

There is a status-semantic drift:

- Some files use `status: draft`, e.g. `discourse-markers-spoken.md`, `grammatical-collocations.md`, `pronunciation-grammar-link.md`
- The loader only recognizes `complete` and `updating`, then normalizes any other value back to `complete` in [backend/services/grammar_content.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/grammar_content.py:200)

This means draft semantics are currently not operationally truthful.

## Section 3 — User-facing UI state

### Student journey

The grammar student journey is already multi-surface:

1. Enter from live chrome tab to [frontend/grammar.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/grammar.html:76)
2. Browse via:
   - 8 conceptual topic groups
   - featured articles
   - category directory cards
   - direct search
3. Read article page with:
   - breadcrumb
   - TOC sidebar
   - reading progress bar
   - related pages
   - next articles
   - compare links
4. Continue to:
   - compare page
   - roadmap page
   - search page
5. Logged-in users can generate view/save telemetry; guests see CTA gating on article pages

### UX maturity observations

Landing page already has:

- strong hero and search surface in [frontend/grammar.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/grammar.html:89)
- 8-group navigation in [frontend/grammar.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/grammar.html:157)
- roadmap CTA in [frontend/grammar.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/grammar.html:195)

Article page already has:

- reading progress bar in [frontend/pages/grammar-article.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/grammar-article.html:67)
- TOC sidebar in [frontend/pages/grammar-article.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/grammar-article.html:137)
- compare/related/next sections in [frontend/pages/grammar-article.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/grammar-article.html:114)
- guest CTA and modal in [frontend/pages/grammar-article.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/grammar-article.html:147)

Search, roadmap, and compare pages also exist as dedicated routes, not hacked-on overlays:

- [frontend/pages/grammar-search.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/grammar-search.html:55)
- [frontend/pages/grammar-roadmap.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/grammar-roadmap.html:56)
- [frontend/pages/grammar-compare.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/grammar-compare.html:55)

### UX gaps observed

- Search exists, but no evidence of faceted filtering beyond text query.
- Taxonomy is split between filesystem categories and conceptual groups; this is powerful but can be mentally heavy for first-time users.
- Guest CTA is article-only; grammar home itself appears fully open and does not visibly connect learning progress to Speaking/Writing plans beyond text.
- Compare and roadmap flows exist, but the landing page still centers discovery more than guided learning progression.

## Section 4 — Admin authoring mechanism

### Current workflow

Admin grammar is intentionally **read-only**.

The admin landing page states this explicitly in [frontend/pages/admin/grammar/index.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/grammar/index.html:102):

- browse articles
- inspect analytics
- dogfood recommendation matcher
- edit actual content in repo Markdown files

The same rule is repeated in [frontend/js/admin-grammar-articles.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/admin-grammar-articles.js:4).

Backend admin routes reinforce the same contract in [backend/routers/admin.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/admin.py:3652):

- `GET /admin/grammar/articles`
- `GET /admin/grammar/articles/{slug}/preview`
- `GET /admin/grammar/analytics`
- `POST /admin/grammar/recommend-test`

There are **no write endpoints**, no `.md` upload path, no DB-backed article CRUD, and no import pipeline for grammar content.

### Authoring implications

This is not a CMS. It is a hybrid editorial system:

- source of truth = repo Markdown files
- publish = git commit + deploy
- admin UI = browse/preview/analytics/test only

That is a strong fit for a curated knowledge base, but it creates scale friction if Andy wants faster editorial throughput, non-technical editing, draft workflow, or bulk content operations.

## Section 5 — Reuse map (cluster 19.x patterns)

| Existing asset / pattern | Grammar applicability | Empirical finding |
|---|---|---|
| Canonical student chrome | Already reused | [frontend/js/components/aver-chrome.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/components/aver-chrome.js:59) |
| Canonical admin chrome | Already reused | [frontend/js/components/aver-admin-chrome.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/components/aver-admin-chrome.js:43) |
| Design tokens + DS baseline | Already reused | `grammar.html` and grammar subpages link tokens/components/ds CSS |
| Markdown render pipeline | Reused conceptually, but backend-side | Python `markdown` render in [backend/services/grammar_content.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/grammar_content.py:181), not frontend `marked` + DOMPurify |
| Admin import 19.1C `content_import_service.py` | Not currently reused | `content_import_service.py` is for writing tips and reading passage import, not grammar |
| Status simplification patterns | Partially reused, but imperfect | grammar supports `complete`, `updating`, `planned`; `draft` currently drifts into `complete` |
| Analytics/admin operational truth patterns | Reused | article views + saves + zero-view surfaced in admin analytics |
| Content recommender integration | Strongly reused/extended | grammar links directly into grading feedback and recommendation matching |

### Net-new vs reusable

Most of the platform primitives already exist and are reused:

- chrome
- tokens/design baseline
- admin shell
- analytics conventions
- recommendation hooks

The biggest missing reusable primitive is **editorial ingestion** for grammar content. Unlike Writing Tips or Reading import, grammar still lacks an import/authoring abstraction.

## Section 6 — Gaps + opportunities

Ranked by likely impact × effort:

1. **Authoring workflow gap**
   - Editing requires repo access and Markdown fluency.
   - Biggest operational constraint if content velocity matters.

2. **Status truth gap**
   - `draft` exists in content but is treated as `complete`.
   - This can mislead student surfaces, admin analytics, and editorial planning.

3. **Taxonomy complexity**
   - There are filesystem categories, conceptual groups, pathways, related pages, compare pairs, and error tags.
   - Powerful, but could become difficult to govern without metadata QA tooling.

4. **Search/navigation ceiling**
   - Search is text query only.
   - No faceted browse by band, skill relevance, difficulty, common error, or pathway.

5. **Integration opportunity with Speaking/Writing**
   - Grammar already participates in recommendations.
   - There is room to turn it from “reference wiki” into “learning loop” with clearer follow-through from grading to study to re-practice.

6. **Integration opportunity with Reading**
   - Reading foundation is being built now.
   - Grammar articles could later cross-link to reading passages, question rationales, or pattern-focused drills.

7. **Metadata integrity risk**
   - Rich frontmatter is a strength, but also means more room for stale slugs or semantically weak links if not audited regularly.

8. **No non-technical editorial path**
   - Admin can preview content, but cannot correct typos, tweak summaries, or stage small revisions without repo commits.

9. **Limited progress/productization signals**
   - The student experience is rich, but still leans reference-library over structured mastery/product loop.

10. **Analytics are useful but lightweight**
   - Views, saves, top content, and zero-view lists exist.
   - There is room for recommendation CTR, anchor-level effectiveness, and pathway completion visibility.

## Section 7 — Upgrade direction options

### Option A — Editorial scale-up without rebuild

**Scope**

- keep Markdown as source of truth
- add stronger metadata QA and status truth
- improve admin preview/validation/reporting

**Likely work**

- low-to-medium LOC
- 1 sprint

**Value**

- safer content operations
- better editorial confidence
- smallest risk

**Risks / dependencies**

- does not solve non-technical authoring

**Best when**

- Andy wants more trustworthy operations first, not a big product redesign

### Option B — Search + taxonomy UX uplift

**Scope**

- improve discovery by band, pathway, level, error tag, and skill relevance
- clarify the relationship between groups, categories, and roadmaps

**Likely work**

- medium LOC
- 1 to 2 sprints

**Value**

- higher content discoverability
- lower student friction
- better perceived depth of the existing library

**Risks / dependencies**

- requires careful IA decisions, not just UI polish

**Best when**

- the content library is already strong enough, but users may not be finding the right lessons efficiently

### Option C — Grammar learning loop integration

**Scope**

- push grammar articles deeper into Speaking/Writing follow-up flows
- connect recommendations, saved articles, weak areas, and retry loops more explicitly

**Likely work**

- medium-to-high LOC
- 2 sprints

**Value**

- strongest product value per lesson
- turns wiki into a coaching asset, not just reference content

**Risks / dependencies**

- requires coordination with grading/result/session surfaces

**Best when**

- Andy wants grammar to drive retention and measurable learning outcomes

### Option D — Admin authoring pipeline upgrade

**Scope**

- introduce structured import/staging/validation for grammar articles
- possibly reuse patterns from Writing Tips / Reading content import

**Likely work**

- medium-to-high LOC
- 1 to 2 sprints

**Value**

- faster editorial throughput
- clearer governance
- better fit for scaled content production

**Risks / dependencies**

- touches workflow assumptions more than student UX
- needs careful coordination if `content_import_service.py` becomes shared infrastructure

**Best when**

- the team wants to produce or revise grammar content faster without editing raw repo files manually

### Option E — Full cluster-level grammar expansion

**Scope**

- combine editorial tooling, search IA, metadata QA, and product integration
- treat Grammar Wiki as a new cluster

**Likely work**

- high LOC
- multi-sprint cluster

**Value**

- biggest upside
- could make grammar a first-class pillar alongside Speaking/Writing/Reading

**Risks / dependencies**

- highest coordination cost
- should come after current Reading foundation stabilizes

**Best when**

- Andy wants a true “Grammar 2.0” initiative, not a tactical uplift

## Section 8 — Coordination với cluster 20.x reading

### Empirical overlap check

The main potential overlap zone is **not** article rendering or chrome. It is content operations:

- Reading foundation is already touching [backend/services/content_import_service.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/content_import_service.py:42)
- Grammar currently does **not** use that service
- If a future grammar upgrade adds import/staging, that shared service would become a likely design touchpoint

### Conflict zones

1. **`content_import_service.py`**
   - Reading is extending it now.
   - Grammar does not currently depend on it.
   - Future grammar authoring work should avoid colliding with the Reading foundation branch.

2. **Migration numbering**
   - Discovery creates none.
   - If grammar later needs DB changes, avoid the `086+` range currently being consumed by Reading work.

3. **Shared nav / design primitives**
   - Grammar already uses canonical chrome and DS primitives.
   - Low conflict risk if future work stays scoped.

4. **Cross-linking with Reading**
   - Product opportunity is real, but best sequenced after Reading foundation lands.

### Merge order recommendation

Recommended sequence:

1. land Reading foundation work first
2. synthesize this discovery into an explicit grammar upgrade decision
3. execute grammar implementation on a fresh branch after Reading infra settles

This minimizes collisions around shared content infrastructure and keeps the product roadmap legible.

## Section 9 — Recommended next steps

Codex non-authoritative lean:

1. **Do not rebuild Grammar Wiki.**
   - The subsystem already exists and is stronger than the starting premise suggested.

2. **If Andy wants a small, low-risk next step, choose Option A first.**
   - Fix status truth
   - add metadata QA reporting
   - strengthen editorial confidence

3. **If Andy wants the highest product upside, choose Option C next.**
   - Grammar already has recommendation hooks and user telemetry.
   - Deepening the learning loop likely delivers more user value than cosmetic UI refresh alone.

4. **If Andy wants scaled content operations, pair Option D after Reading 20.1 stabilizes.**
   - That is the cleanest time to decide whether grammar joins the emerging import/staging pipeline family.

5. **If a full grammar cluster is commissioned later, anchor it around existing strengths rather than replacing them.**
   - live content corpus
   - established article schema
   - recommendation integration
   - student/admin chrome integration
   - analytics and personalization primitives

## Appendix — Key evidence paths

- [backend/main.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/main.py:29)
- [backend/routers/grammar.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/grammar.py:32)
- [backend/routers/admin.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/admin.py:3656)
- [backend/services/grammar_content.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/grammar_content.py:20)
- [backend/content/_groups.yaml](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/content/_groups.yaml:1)
- [frontend/grammar.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/grammar.html:76)
- [frontend/pages/grammar-article.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/grammar-article.html:72)
- [frontend/pages/admin/grammar/index.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/grammar/index.html:102)
- [frontend/js/admin-grammar-articles.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/admin-grammar-articles.js:4)
- [backend/migrations/014_grammar_recommendations.sql](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/migrations/014_grammar_recommendations.sql:1)
- [backend/migrations/015_grammar_user_data.sql](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/migrations/015_grammar_user_data.sql:1)
- [backend/migrations/032_add_recommended_anchor_to_grammar_recommendations.sql](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/migrations/032_add_recommended_anchor_to_grammar_recommendations.sql:1)
- [backend/migrations/075_grammar_check_infra.sql](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/migrations/075_grammar_check_infra.sql:1)

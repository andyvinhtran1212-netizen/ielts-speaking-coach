# Reading translation, phrase and illustration quality correction

## Status and scope

Local correction on `codex/reading-language-quality-20261015`, based on staging
`0c70093c4414a9e5c4a5e861348818d4a415b8e9`. All 196 published articles were read
against fresh staging/production exports; all 3052 English units, their Vietnamese
translations and every existing phrase link were reviewed manually. All 123
existing SVG scenes were rendered and inspected against the articles and their
alt text/captions. No translation or image provider was called.

The correction changes 148 articles: 289 sentence translations, 258 phrase lists
and illustration metadata in 89 articles. There are now 6437 phrase links and 128
distinct scenes. English units, IDs, question content/keys, glossary and existing
after-check evidence are unchanged. The other 48 reviewed articles need no patch.
Full Test, timed Mini content and the four core articles are excluded.

## Findings and repairs

| Severity | Root cause and example | Minimal repair |
| --- | --- | --- |
| Medium | Over-compressed translation lost qualifiers, quantities or causal meaning. Examples: wolf population grew **to**, rather than **by**, 20,000; `much` was sometimes treated as a majority; `can` or tentative scientific language was omitted. | Correct the affected Vietnamese sentence and its links while preserving the English and uncertainty. See `../authored/the-return-of-the-wolf.json`, `the-science-of-sleep-cycles.json`, `the-rise-of-plant-based-diets.json`. |
| Medium | Some phrase selections omitted the comparative or condition, or joined a technical term to an unclear Vietnamese fragment. | Use exact, non-overlapping phrases that retain the relevant meaning in both directions. See `the-science-of-laughter.json`, `the-rise-of-remote-work.json`, `why-breakfast-matters.json`. |
| Low | Literal wording or unexplained borrowed terminology made otherwise accurate translations hard to understand. Examples include yeast, camera obscura, alevin/fry/parr and `vested interests`. | Use natural Vietnamese, adding a short in-context gloss where needed. See `completion-how-a-rainbow-trout-grows.json`, `the-invention-of-photography.json`, `ynng-is-economic-growth-sustainable.json`. |
| Low | Alt descriptions were drafted from briefs rather than the actual pixels: outdoor camera described as on a table, clock parts absent from the image, jeans described as folded with thread instead of a measuring tape. Some alt text contained authoring restrictions. | Match the rendered image and remove implementation notes from learner-facing descriptions. |
| Medium | A shared scene represented only one subtopic or implied the wrong context: ancient Mediterranean harbour for world explorers, flight for several kinds of invention, concert for cultural celebrations, planet/moons for the Solar System, recycling for paper history, charging a car for AI accountability. | Draw five context scenes and retarget seven articles; retain suitable shared scenes elsewhere. |

The five new SVGs show an exploration desk, community celebration, invention
workbench, astronomical observation and paper/writing desk. They contain no
answer labels, named routes, planet order, question identifiers or external
assets. `ynng-should-ai-make-decisions` reuses the existing human algorithm-review
scene to represent responsibility for automated decisions.

Two English-source limitations were recorded separately: the sea-exploration
article links circumnavigation to sailors no longer fearing an edge of Earth;
the habit article calls Charles Duhigg a researcher while another calls him a
journalist. These are source-review notes, not claims that the corresponding
Vietnamese silently corrects the original or that answer keys were re-audited.

## Validation and release boundary

The compiler accepts all 196 articles / 3052 units / 6437 links. An independent
rendered-Markdown comparison resolves every sentence action and English phrase,
with no missing prose or nested buttons. The actual correction SQL was executed
in temporary PostgreSQL 16 over a local Unix socket: both environments perform
exactly 148 updates, preserve 1129 question rows and the other 48 articles, and
leave core-practice/Full-Test sentinels unchanged. Reapply is refused; a changed
last row aborts the whole transaction. Rollback restores the exact baseline and
refuses concurrent edits.

Local browser acceptance uses the unchanged Reading runtime build with candidate
content fixtures and every external request mocked. Nine articles cover all seven
retargeted illustrations plus corrected comparisons in Laughter and Breakfast.
Exact inline translation, both highlight directions, image/alt/caption/zoom and
no horizontal overflow pass at 1280/390/320 pixels in light and dark themes.
All five new SVGs were rendered and inspected. The full local backend suite
passes (10207 tests, 808 configured live/provider skips), React passes (583 tests,
50 files), frontend contracts pass (13037 tests, two skips), and spec governance
validates 24 specs. These are local results, not hosted acceptance.

`release/manifest.json` pins the four SQL files. Each apply file updates only
translation/support/image fields on published L1/L2 articles with `test_id IS
NULL`, guarded by the exact ID, slug, English body, metadata and image baseline,
under the repository advisory lock. There are zero inserts or question writes.
Rollback has equivalent guards against the reviewed post-correction values.

Only reads were approved for this quality task. These changes have not been
pushed, imported or deployed. Staging needs a new approval covering the concrete
commit, PR/CI/merge, assets, delta SQL and isolated synthetic QA/cleanup.
Production requires its own approval after staging acceptance. Save a fresh
baseline before an approved import and refuse drift rather than overwrite it.
The original expansion SQL must not be reapplied.

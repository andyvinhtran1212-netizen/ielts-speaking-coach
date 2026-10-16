# Reading: quality review of the original 23 practice articles

This package reviews the exact 23 articles in `../20261014-repairs.json` against the current published content. Nineteen also belong to the 196-article expansion; four (Commons, Battery, Psychology of Colour and Movements in Art) are distinct. The audit covers all 23, rather than assuming these cohorts are disjoint.

`audit.json` records each reviewed source revision, sentence/phrase coverage and change disposition. `corrections.json` contains only the five necessary article patches. Deployment permissions, exact Git SHAs and hosted acceptance belong in the associated release PR; this authoring baseline does not imply a deployment state or request a repeated approval.

## Changes and findings

| Root cause and severity | Content locations | Correction |
| --- | --- | --- |
| Medium: battery `cell` was translated as biological “tế bào”; `dead` suggested a broken battery. Related glossary definitions used the same terminology. | Battery p2-s1, p4-s2, p4-s3, p4-s4; anode/cathode/electrolyte definitions. | Use “ngăn pin”, distinguish discharged from broken, give Vietnamese anode/cathode terms and use “chất điện ly” consistently. |
| Medium: a tentative research result became “cho thấy”; cool colour temperature and the comparison with advertising claims lost part of their meaning. | Colour p1-s1, p1-s3, p2-s2, p3-s2, p3-s3, p4-s4, p4-s5. | Preserve aesthetic taste, may/help/suggested, colour temperature, small differences and the explicit limits of the final question. |
| Medium: literal expressions obscured the pictured styles and painting vocabulary; phrase fragments omitted the complete alternatives. | Art p1-s1, p1-s2, p2-s1, p3-s1, p3-s3, p5-s2, p6-s1, p6-s2. | Describe depicted gardens/guitars, artistic paint and likeness; keep the opposition, expectation and complete comparative phrases. |
| Low: nuance/time and some phrase boundaries were incomplete or overly literal. | Commons p1-s1, p1-s2, p3-s3, p3-s4, p4-s1, p4-s2. | Retain future-in-the-past, resource failure, community norms, “considerably” and overgeneralisation. |
| Medium: “against” became a neutral reaction, and “severity” read as harsh conditions rather than austere architectural style. | Schools of Architecture p1-s2, p5-s1. | Restore opposition and the design-specific meaning. |
| Low: generic art alternatives described a concept instead of the visible image; paint strokes crossed the canvas and touched its explanatory footer. Three core articles had only checked-question figures. | Art checked illustrations; `art-gestures.svg`; Battery/Colour/Art context covers; Commons cover. | Describe the actual drawing, clip paint within the canvas, add neutral context covers and caption the existing Commons cover. Keep answer-bearing illustrations under checked evidence. |

The bounded delta changes 32 sentence translations and 31 phrase lists in five articles. Three battery glossary definitions are corrected. All 342 source units and their IDs remain unchanged; the cohort has 834 manually reviewed phrase pairs (previously 815). Eighteen reviewed articles need no additional data changes. One original battery context SVG is added; existing neutral packaging/gallery scenes are reused. The battery review diagrams are explicitly described as the external circuit during discharge, with arrows for electron motion.

## Scope and release safety

Applies to existing published L1/L2 practice only, under spec 0021 FR-003/004/005/006/008. No runtime, schema, English, passage/question IDs, questions, keys, evidence quotes or grading changes. Full Test, timed Mini, real learner records and provider APIs are excluded. An existing English historical claim in Explorers of the Sea remains a source-editorial limitation recorded in the expansion quality review; this translation patch does not rewrite English history or certify the source's factual claims.

Each environment's SQL updates exactly five existing rows. It guards the full current body, metadata, glossary and image URL, as well as ID/slug/library/status and `test_id IS NULL`, inside one transaction with repository advisory lock `(173204, 1)`. The rollback requires the exact post-patch values and restores only this package's fields. No inserts, question writes or schema statements are included. Never rerun the original repair/expansion imports for this correction.

Before any approved hosted apply, verify the deployed asset bytes against `release/manifest.json`, save a private current backup, recheck all guards and execute only the corresponding SQL. Preserve synthetic QA actor/session IDs until analytics and account absence have been verified.

## Verification

- Current staging/production snapshots match across all 23 articles and 133 questions; the nineteen overlapping support revisions match the accepted expansion quality package.
- Backend support validation checks complete prose coverage (allowing only the original Art A–F paragraph labels outside its units), exact unique/non-overlapping phrase spans, revision hashes and preserved checked-evidence quotes.
- Rendered DOM preserves every source character after normalisation, all 342 sentence actions and all 834 source phrase marks, with no nested buttons.
- The unchanged local Reading runtime passed 23 article journeys at 1280/390/320px and both themes: exact selected translations, every phrase in those selected units in both directions, cover deduplication/alt/caption/zoom, Escape and no early review figures. Ten separate checked-question journeys verify the actual reviewed figures after checking. All external browser requests were mocked; this is local acceptance, not hosted acceptance.
- All 31 SVGs referenced by this cohort were visually inspected; the corrected art figure was inspected again after clipping. Local mobile screenshots cover the five changed articles.
- The focused Reading practice support regression suite passed (16 tests); spec governance passed for all 24 feature specs.
- Both exact SQL files were executed on temporary local PostgreSQL: five updates, eighteen unchanged reviewed articles, 133 questions and non-target/Full Test sentinels unchanged; repeat apply refused; drift caused atomic abort; rollback restored the baseline and refused concurrent edits.

Private source snapshots, QA screenshots and command evidence remain outside the repository. No translation, dictionary, image or AI API was called.

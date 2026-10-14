---
id: READINGPRACTICE-0021
title: Repair Reading practice and support sentence translation in place
status: approved
risk: high
owner: product
---

# Reading practice repair and sentence support

## Problem

The 14 October production audit found missing item-specific matching descriptions,
missing options for multiple-choice and matching tasks, unrendered Markdown tables,
unrecognised inflected glossary words, disconnected translations and explanations,
inconsistent library return context and misleading practice metadata. Published
L1/L2 passages already have Vietnamese translations, but no sentence alignment or
illustrations. Mini Tests share the timed test player with Full Tests.

## Scope

- Close findings R01–R10 defined below, keeping each finding's
  actual content/UI boundary and verification scope explicit.
- L1 Vocab Reading and L2 Skill Practice: original text remains visible while a
  selected sentence reveals its Vietnamese translation in place.
- Manually authored English/Vietnamese phrase links allow bidirectional
  highlighting. Translations, glossary and explanatory illustrations are authored
  by the agent without paid translation/image APIs.
- Mini Test library organisation and practice-only post-submit support; preserve
  timed player behaviour and existing required diagram questions.
- Preserve passage/question identities, answer correctness, all unrelated
  metadata and all learner/history records during bounded content changes.

## Non-goals

- Full Test, mock/full-exam player, timing, autosave, finalisation, RLS or admission
  changes; no translation/evidence/image assistance added to active timed tests.
- New AI/provider calls, auto-translation on clicks, new paid services, generic
  authoring platform, learner-created shared vocabulary or schema migrations.
- Guessing lost questions from stored answer keys; certifying every historic
  answer key; replacing the whole question set to change explanatory metadata.

## Users and journeys

- A learner reads a passage, checks a word, reveals a sentence translation, clicks
  an aligned phrase in either language and sees its counterpart without losing
  the original sentence or selecting an answer accidentally.
- After checking a practice question, the learner locates its source evidence,
  sees the relevant translation, then returns to that question.
- A learner filters or searches a library, loads more, opens a passage and returns
  to the same results. Mini lessons follow their canonical lesson sequence.

## Original audit findings

The following list is the repository-owned acceptance scope. The external workspace
audit supplies discovery evidence; a clean checkout does not depend on that file.

| Finding | Observable defect and minimal repair boundary | Requirements |
| --- | --- | --- |
| R01 | Matching prompts lack item-specific descriptions/stems. Repair source-supported statements without deleting identities or inferring facts from keys. | FR-001 |
| R02 | L1/L2 falls back to a textbox for multi-choice and feature/ending matching, hiding actual options. Render the real choices and grade the complete authored selection. | FR-002 |
| R03 | Table Markdown delimiters and flow-chart line breaks render as plain prompt text. Use the existing sanitised renderer and keep instructions/gap numbers. | FR-002 |
| R04 | Exact glossary matching misses inflections; published L2 has no glossary. Author real forms/definitions and avoid substring or overlap errors. | FR-006 |
| R05 | Switching the translation tab hides the original and supplies no source-to-translation mapping. Keep source visible, reveal the selected reviewed unit inline and report fallback precision honestly. | FR-003, FR-004, FR-005 |
| R06 | L1/L2 explanations do not locate evidence; Mini review highlights a whole block. Add reviewed source locators after the proper reveal boundary and a return-to-question action. | FR-007, FR-010 |
| R07 | Skill loses filters/batches on return; title search is absent and skill-group totals describe only loaded cards without a clear scope. Preserve bounded URL context and label statistics accurately. | FR-009 |
| R08 | Mini lessons have mixed/reverse sequencing and long technical titles; 30 of 40 published tests are configured for 60 minutes. Group canonical lesson identities, show actual timing and review duration per test rather than silently rewriting all timers. | FR-010 |
| R09 | Existing detail supports images, but all 200 L1/L2 passages lack them and card normalisers drop image metadata. Add useful authored visuals, accurate alternatives and failure/reveal behaviour. | FR-008 |
| R10 | `/reading` returns 404; L2 word-count metadata is missing and practice entry labels are unclear. Resolve the entry and show truthful readable metadata. | FR-009 |

## Requirements

- **FR-001:** Every repaired matching/ending item has a source-supported, distinct
  statement/stem and complete displayed options. Missing original wording is
  identified; any newly authored replacement is labelled in the content change
  record and reviewed against the passage independently of its key. Preserve IDs;
  do not infer the statement solely from the key.
- **FR-002:** L1/L2 renders each actual question type correctly, including multiple
  selection, matching, table and flow completion. Multiple selections are graded
  as the complete authored set, independent of order, with missing, additional or
  duplicate labels rejected. Single-answer/completion behaviour remains compatible.
  Full Test uses its existing grader and controls unchanged.
- **FR-003:** For reviewed source/translation units, clicking a sentence or a
  keyboard-accessible sentence action reveals the corresponding Vietnamese unit
  inline. Previous/next, close and full-translation fallback remain available.
  Preserve Markdown, glossary, images, text selection/copy and the reading position.
  A source unit may map to multiple translated sentences; ordinal equality alone
  never establishes alignment. Unreviewed units explicitly fall back to the
  containing translated paragraph without claiming sentence precision.
- **FR-004:** Reviewed phrase links map exact source and translated spans, including
  many-to-many phrase equivalents. Clicking either span highlights both with
  semantic labels and a visible focus state. Unmapped words do not get invented
  counterparts. Glossary lookup has priority over sentence click, and selecting
  text for copying does not trigger translation.
- **FR-005:** Alignment/illustration/evidence metadata is bounded, validated and
  revision-bound to the actual passage and translation. Malformed or stale support
  data cannot replace original content, highlight unrelated text or expose answers.
  Old clients continue receiving existing fields; new consumers validate optional
  support shapes. No schema change is required.
- **FR-006:** Authored glossary aliases cover the forms used in the passage, including
  depleted/conflated/norms/sanctions in Commons. Match complete words/phrases,
  preserve the correct definition/context and avoid overlapping/nested controls.
  Add manually authored glossary to upgraded L2 content; no dictionary API.
- **FR-007:** L1/L2 check reveals only the checked question's supported evidence and
  explanation. Initial detail has no key/solution/evidence revealing the answer.
  Evidence targets reviewed units/paragraphs and reports its true precision. A
  locate action has a route back to the question. Failed checks remain retryable;
  results and draft state stay scoped to the current account/resource/revision.
- **FR-008:** Add explanatory visuals where they help understand objects, structure
  or processes. Use authored SVG/HTML or approved existing assets, accurate alt and
  captions, responsive sizing and zoom. Answer-bearing labels/relationships appear
  only after check or in permitted post-submit practice review. Image failure
  never prevents reading. Do not claim that every passage needs an illustration.
- **FR-009:** Skill/Vocab search and filter return context is consistent, bounded and
  URL-driven. Results restore filters and loaded batches on return. Library metrics
  identify their scope accurately; word count comes from the current body or is
  omitted when unavailable. `/reading` resolves to the existing Reading entry.
- **FR-010:** Mini Test lessons are grouped and ordered by their existing lesson
  identity; technical IDs remain secondary. Show actual per-test duration and
  structure. Review duration only with authored per-test evidence; no blanket
  timer rewrite. Any support added to Mini review checks canonical `test_type=mini`
  and submitted/preview permissions rather than trusting `from=mini` alone.
- **FR-011:** Cover loading, empty, error, retry, access denial, stale content and
  unsupported alignment states. Verify desktop and 320/390px mobile, light/dark,
  keyboard focus, copy/select, reduced motion and no obscured source/question.
- **FR-012:** All external API access needs the user's approval before use. The user
  approved read-only Codex chat state, Git/GitHub refs/PR/CI and published Reading
  content/keys/metadata on 14 October. This does not permit writes, releases,
  provider calls or reading learner history. Prepare concrete diffs and validation
  before requesting the corresponding write/release operation; preserve other
  active sessions' work.

## Acceptance scenarios

- Commons: source `commons` and Vietnamese `tài nguyên chung` highlight each other;
  `graze their cattle` maps to its complete translated phrase. Text copy remains
  possible, and inflected glossary forms open the right entry.
- Colour: the TWO-choice question displays A–E, supports exactly two selections
  and grades both orders of the correct set correctly; incomplete/extra sets fail.
- Battery: the table and flow tasks retain instructions and gap numbers, render
  readable structure, and inputs refer to the correct gap on mobile.
- Modern Art: each repaired matching item can be answered from its own statement
  and displayed options; content evidence is distinct from rendering evidence.
- A passage/translation changes after alignment is authored: support is rejected
  or explicitly falls back, without attaching old text to a new sentence.
- Full Test and mock: opening/answering/reviewing keeps the current behaviour and
  does not load the new practice support, even with forged practice query flags.

## Edge cases

Abbreviations, quoted punctuation, semicolons, headings/paragraph labels, repeated
phrases, split/merged translated sentences, overlapping phrase links, Unicode,
glossary spans inside translated sentences, multiple-check ordering, stale ACKs,
resource/account changes, absent translations, broken images and question revisions.

## Success criteria

Each original finding has a concrete fix or an evidence-backed non-applicability
decision, with remaining content work explicitly identified. Every implemented
requirement has focused tests and UI evidence. Staging/production acceptance is
reported separately; no paid model calls or unapproved APIs are used.

## Approval record

The user selected the inline translation design and explicitly requested repair
and upgrade of Reading practice on 14 October 2026, with self-authored translations
and illustrations, Full Test exclusion, session isolation and prior API approval.
The subsequent phrase-highlight question supplies the bidirectional lookup intent;
this spec makes the proposed phrase-level mapping reviewable. This is the separate
intent change, not an implementation PR or proof of deployment.

## Open questions

No product scope expansion is proposed. External writes/releases remain separately
permissioned, and exact content repairs require current source-derived evidence.

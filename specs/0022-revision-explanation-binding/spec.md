---
id: REVEXPLAIN-0022
title: Bind reviewed interactive explanations to Cambridge revision papers and name approval refusals
status: implementing
risk: high
owner: product
---

# Bind reviewed explanations to Cambridge revision papers

Parent: [MOCKREPAIR-0016](../0016-mock-content-remediation/spec.md). This spec
covers only the explanation-binding gap that 0016's REV publication exposed; it
does not widen or re-approve 0016.

## Problem

The MOCK0016 package (2026-10-06) published corrected Cambridge 13–21 copies as
new papers (`MOCK0016-PROD-20261006-ILR-{RDG|LIS}-CAM-Bxx-Tx-REVnn`). The 2,960
current interactive-explanation objects stay bound to the original
`ILR-*-CAM-Bxx-Tx` papers, so on 2026-10-25 75 of 77 published REV papers had 0
objects. Giving such a paper to a class with interactive explanations calls
`fn_approve_web_explanation_paper`, which refuses with one generic message
("Không tìm thấy một content version hiện hành duy nhất cho đề.") and a 0/0
counter. Admins cannot tell "nothing bound" from "two versions current" or "the
pinned version is no longer current", and there is no reviewed, repeatable way
to give a REV paper its own explanations. The only precedent (C18T4 REV01,
2026-10-17) was bound ad hoc with a custom content version.

On 2026-10-25 the owner approved a one-off, reviewed binding for Cambridge 19
Test 1 REV01 Reading and Listening so Course 5 could receive them; that operation
was performed with the tool proposed here (draft PR #1692) and is recorded as
evidence, not as a general authorisation.

## Scope

- Make the database approval refusal name its cause with stable reason codes:
  nothing bound, several versions current, or the pinned version not current.
- Keep the admin/class-give message mapping for those codes (shipped in #1689)
  working against the real reasons.
- Provide an operator tool that binds one named REV paper to its source paper's
  single current explanation version, dry-run first, refusing on any doubt.
- Record each binding with a reviewed plan hash and verified read-back.

## Non-goals

- Binding the remaining REV papers in bulk, or any paper the owner has not
  reviewed one by one.
- Choosing, merging, deactivating or deleting any explanation version; editing
  explanation text; re-auditing explanations.
- Changing answer keys, scoring overrides, audio, attempts, answers, scores or
  review history; regrading.
- Changing the ad-hoc C18T4 REV01 binding.
- New UI. The admin homework form already blocks 0-object papers and shows the
  named cause (#1689).

## Users and journeys

- Admin giving a REV paper to a class with interactive explanations: sees either
  a successful give or the exact reason it cannot be approved.
- Operator (owner-approved session) preparing a REV paper: runs a read-only dry
  run, reviews which questions changed versus the source, then commits the exact
  reviewed plan and checks the read-back.
- Learner: receives the same explanations the original paper serves, on the
  revision's own identity rows, with unchanged grading.

## Requirements

- **FR-001:** `fn_approve_web_explanation_paper` raises `web_explanation_content_version_unavailable:none` when the paper has no current bound object, `…:multiple:<n>` when n current versions are bound, and `…:pinned_not_current` when a requested version is not current while other current objects exist; success, signature, grants and every other check stay identical to migration 260.
- **FR-002:** The class-give and admin approval paths translate each reason code into its specific Vietnamese message, and keep the previous generic message for an unsuffixed (pre-319) error.
- **FR-003:** The binding tool acts on exactly one named revision paper per run, requires the operator to name the expected source content version, never selects a version itself, and defaults to a read-only dry run that prints the plan and its SHA-256.
- **FR-004:** The tool refuses the whole paper when the source does not have exactly one current version, when the source lacks current, bound, servable Q1–Q40, when the revision already has any explanation object, when the revision keys are not exactly Q1–Q40, when any revision answer set differs from the explanation's accepted set, when a scoring override would change the revision's runtime key, when the set of changed questions differs from the reviewer-supplied list, or when source data is malformed.
- **FR-005:** Committed rows use the revision's own identity (`mock-<revision id>-<skill>-qNN`), the source's content version, the source payload and hash as evidence, the correct per-skill binding, and pending rights/editorial approval so the give records its own approval event; source rows are never written.
- **FR-006:** A commit requires the plan SHA from the reviewed dry run (covering both papers' fingerprints and the reviewed change list), inserts all 40 rows in one statement, and reads back 40 current rows, one version, unchanged source rows and rows equal to the plan before reporting success.
- **FR-007:** Each production binding is preceded by an owner review of the changed questions and a staging rehearsal of the same tool; learner answers, attempts, scores, audio and existing gives are unchanged before and after.
- **FR-008:** Migration 319 is applied to staging before any dependent code merges and to production through the advisory-locked runner before promotion, with the migration number reconciled against other in-flight migrations.

## Acceptance scenarios

### Scenario 1 — named refusal

- **Given** a REV paper with no bound explanation objects
- **When** an admin gives it with "self-assessment then explanations"
- **Then** the give fails with the "0/40 object hiện hành" message, not the generic one, and no assignment row is created

### Scenario 2 — reviewed binding

- **Given** a REV paper whose answers match its source and whose changed questions were reviewed
- **When** the operator runs the dry run, then commits with that plan SHA
- **Then** 40 current rows exist for the revision under the source version, the source rows are unchanged, and a later give approves the paper

### Scenario 3 — refusal on doubt

- **Given** a revision whose Q14 key differs from the explanation's accepted answer, or whose changed questions differ from the reviewer list
- **When** the operator runs the tool
- **Then** the dry run refuses with the reason and nothing is written

## Edge cases

- Running the commit twice: the second run refuses because the revision already has objects.
- Plan SHA from a different dry run, or data changed after review: refused.
- Canonical answer stored as a list; nested `payload.solution`; non-l3 passages; Listening sections shared across questions.
- Staging copies use the `QA-CAM19-YYYYMMDD-` prefix without `ILR-`.
- A pinned version that was current earlier but has since been superseded.

## Success criteria

- No REV give fails with the unexplained generic message after 319 is live.
- Every bound REV paper has a recorded dry-run SHA, owner review of changed questions, import batch id and passing read-back.
- Zero changes to learner history attributable to binding.

## Open questions

- None blocking approval. Which further REV papers to bind is decided per paper by the owner when a class needs one.

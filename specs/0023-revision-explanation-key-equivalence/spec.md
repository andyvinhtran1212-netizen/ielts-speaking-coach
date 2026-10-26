---
id: REVEXPLAIN-0023
title: Bind Cambridge REV papers by marking-equivalent keys and document accepted forms
status: draft
risk: high
owner: product
---

# Bind REV papers by marking equivalence

Parent: [REVEXPLAIN-0022](../0022-revision-explanation-binding/spec.md). That
spec's binder and approval flow stay in force; this spec changes only how the
binder decides that a revision's answer key agrees with the explanation it
would serve, and what the revision's copy of the explanation says is accepted.

## Problem

On 2026-10-26 the 0022 binder bound 30 Cambridge REV papers (34/77 published REV
papers now have explanations). It refused the other 35 Cambridge papers because
it compares answer keys as literal strings, while the runtime marker
(`listening_test_grader.answer_matches`, also used for Reading) expands Cambridge
shorthand before comparing. A read-only analysis of the 35 refusals against the
marker's own rules found:

- **21 papers** agree with their explanations once compared the way learners are
  marked: `flavour / flavor`, `(food) consumption`, `tail(s)`, UK/US spellings,
  and Listening "Choose TWO" groups stored as `B, C` on both slots or as `B` then
  `C`, which the grader scores as one any-order set.
- **6 papers** have a REV key that accepts more forms than the explanation lists
  (for example `8795482361` beside `87954 82361`, `two thirty`, `orang-utan`,
  `C weight` beside `C`). Learners typing those forms are marked right, but the
  explanation does not mention them.
- **3 papers** have an authored `response_policy` on one question that the binder
  cannot compare yet; every form the explanation lists passes that policy.
- **5 papers** (6 questions: C13T1 Q3, C15T3 Q5, C19T2 Q5, C19T3 Q3, C21T2 Q1
  and Q6, all Listening) carry a human-adjudicated scoring override
  (`cambridge-release-overrides/1.0`) that differs from the REV key in both
  directions (for example REV accepts `three thirty` but not `3:30`; the
  override accepts `13 Jan` and `13/01`, REV does not). Binding applies the
  override at marking (`apply_scoring_overrides`), so it changes grading.

The other 8 published REV papers (AVR mocks) have no source explanations and are
out of scope.

## Owner decisions (2026-10-26, Claude chat)

- Use a new spec for marking-equivalent comparison, with each REV copy listing
  exactly the forms the REV accepts. Papers are still reviewed one by one.
- For the 6 override conflicts, accept **both** sets (union of REV key and
  adjudicated override) for future marking. Scores already recorded stay
  unchanged.
- Leave the 8 AVR REV papers for a later, separate spec.

## Scope

- Compare each revision answer with the explanation by the marker's expansion,
  and Listening "Choose TWO" groups as the grader's any-order set.
- In the revision's copy of an explanation, set `item.answer.accepted_forms` to
  the forms the revision marks right, when they differ, and record the change in
  the copy's audit; the source explanation is never changed.
- Check `response_policy` questions by running every documented form through the
  policy.
- For questions with an adjudicated override, write the union of the override's
  and the revision's forms when the owner approves that question by number.

## Non-goals

- Editing explanation prose, evidence or worked solutions; re-auditing
  explanations.
- Changing any answer key row, response policy, audio, attempt, answer, score or
  marking snapshot; regrading submitted work.
- Binding papers the owner has not reviewed, or the 8 AVR REV papers.
- Changing papers already bound under 0022.
- New UI.

## Users and journeys

- Operator: dry-runs a refused paper, sees per question whether it is
  equivalent, synced (forms added to the copy), policy-checked, or a grading
  change, then commits the reviewed plan.
- Owner: reviews each paper's changed questions, synced forms and grading
  changes before commit.
- Learner: sees an explanation whose accepted answers match how the REV paper
  marks them; on the 5 override papers, future attempts accept both sets.

## Requirements

- **FR-001:** The binder treats a revision answer and an explanation as agreeing when the sets of normalised forms produced by the runtime marker's expansion (`normalize_answer`; whitespace-delimited ` / ` alternatives; optional parenthesised words) are equal; literal string differences alone never refuse.
- **FR-002:** For a Listening `mcq_multi` exercise, the binder compares the grader's expected letter multiset for the whole exercise (`_expected_letters`) with each row's explanation canonical letter set, and refuses when any row's set differs or when the exercise spans more slots than the explanation's set.
- **FR-003:** When the revision accepts forms the explanation does not list and the explanation lists no form the revision rejects, the revision's copy sets `item.answer.accepted_forms` to the explanation's forms plus the revision's missing forms, keeps `canonical`, and records `audit.revision_answer_sync` (revision test id, added forms, spec id); a revision that rejects a documented form refuses unless FR-005 applies.
- **FR-004:** For a question with a `response_policy`, the binder requires every explanation canonical and accepted form to pass `policy_answer_matches`, refuses if the explanation also carries an override, and otherwise syncs listed forms as in FR-003.
- **FR-005:** For a question whose explanation carries a `cambridge-release-overrides/1.0` adjudication, the copy's `accepted_forms` is the union of the override's and the revision's forms. When that union marks differently from the revision key (a grading change), the operator must name the question in `--approved-grading-changes`, otherwise the paper refuses as in 0022; when it marks the same, the question is a sync under FR-003.
- **FR-006:** Every question whose copy differs from the source payload must be named in `--reviewed-answer-sync`, and every grading change in `--approved-grading-changes`; a missing or extra number refuses. The plan lists both, covers them in its SHA-256, and records the per-question classification.
- **FR-007:** All 0022 guarantees stay: one named paper per run, operator-named source version, dry run by default, one 40-row insert, read-back that compares rows to the plan, source rows never written, owner review and staging rehearsal before each production commit.
- **FR-008:** No answer key row, response policy, attempt, answer, score, marking snapshot or audio is written; existing attempts keep their marking.

## Acceptance scenarios

### Scenario 1 — shorthand only

- **Given** a REV Reading key `flavour / flavor` and an explanation listing `flavour` and `flavor`
- **When** the operator dry-runs the paper
- **Then** the question is "equivalent", nothing is synced, and the plan can be committed

### Scenario 2 — REV accepts more

- **Given** a REV key accepting `87954 82361` and `8795482361`, and an explanation listing only `87954 82361`
- **When** the operator dry-runs without naming the question in `--reviewed-answer-sync`
- **Then** the paper refuses; with the question named, the copy lists both forms and `audit.revision_answer_sync` names `8795482361`

### Scenario 3 — override conflict

- **Given** C19T3 Listening Q3 with REV `3.30`/`three thirty` and an adjudicated override `3.30`/`3:30`
- **When** the question is named in both lists and committed
- **Then** the copy accepts `3.30`, `3:30` and `three thirty`; a new attempt typing `3:30` is marked right; earlier attempts keep their scores

### Scenario 4 — choose-two group

- **Given** a Listening `mcq_multi` exercise Q21–22 keyed `D` then `E`, and explanations listing `D, E` on both
- **When** the operator dry-runs
- **Then** the group is equivalent; an exercise spanning four slots against a two-letter explanation refuses

## Edge cases

- Slash with no spaces (`24/04`, `and/or`) stays literal, as at marking.
- Currency or trailing punctuation (`£250`, `20%`) normalises as at marking.
- Two adjacent pairs with the same letters (C20T1 Q19–20 and Q21–22) are separate exercises.
- A policy question that also has an override refuses.
- Re-running after commit refuses (revision already has objects).

## Success criteria

- Each refused Cambridge paper is either bound after owner review or refused with a named reason no literal-string rule produced.
- Every synced question and grading change is listed in the reviewed plan and the read-back.
- Zero writes to answer keys or learner history.

## Open questions

- None blocking approval.

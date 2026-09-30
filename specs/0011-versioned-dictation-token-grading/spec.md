---
id: DICTATIONTOKEN-0011
title: Version dictation word grading and distinguish punctuation in reports
status: approved
risk: high
owner: product
---

# Versioned dictation token grading

## Problem

The current whitespace tokenizer counts punctuation-only tokens as words. A
reference such as `— Hello there.` gives `Hello there.` 2/3 rather than 2/2.
Standalone full stops and commas can lower the denominator even when their
normalized keys are empty and absent from the word trends. Admin reports also
rank punctuation under “Từ hay bỏ sót” and “Từ hay viết sai”. A read-only
production sample confirmed the em dash key U+2014, 2,684 misses and 412 wrong
tokens, in a scope of 303 sessions. These observations establish a grading and
reporting policy mismatch; they do not establish the corrected score of every
historical session.

Historical scores and attempts are persisted evidence. Changing a tokenizer
without freezing its version would change resume/completion semantics and make
old and new reports difficult to interpret. The current accuracy is the mean of
sentence scores within a session, then the mean of session accuracies in the
admin aggregate. This proposal preserves that aggregation method.

## Scope

- First distinguish lexical tokens, punctuation/symbol-only tokens, and missing
  or invalid trend data in admin reports without changing persisted scores.
- Introduce an explicit version of word grading for newly started, compatible
  dictation work; punctuation-only expected/actual tokens remain visible as
  source/display evidence but do not count as lexical correctness or errors.
- Preserve existing case, smart-quote, terminal-punctuation, filler,
  lexical alignment and score-aggregation policies while explicitly separating
  em/en dashes and unambiguous paired outer quote/bracket shells from words.
- Freeze grading version and reference evidence across start, sentence grade,
  resume, retry and completion. Protect older clients and active attempts.
- Define optional historical comparison and repair gates; preserve original
  evidence and scores unless a separate, explicit repair run is authorized.

## Non-goals

- IELTS band, CEFR, mastery, semantic AI grading or new paid provider behavior.
- Changing extra-word penalties, content-word variants, filler policy, replay
  policy, answer access, ownership, renderer affinity or attempt expiry.
- Changing transcript/source package bytes to remove display punctuation.
- Silently regrading completed sessions, altering historical dashboards on
  deployment, or building a general-purpose regrade/background-job platform.
- Converting punctuation or symbols into inferred spoken words; authored
  references must express the lexical words the learner is asked to transcribe.

## Users and journeys

- A learner transcribes every spoken word while omitting a speaker dash and
  receives full word credit, with no false red “missing word” for the dash.
- A learner returns to an active older attempt after a release and completes
  it under the version/reference that existed when that attempt started.
- An admin sees lexical error rankings separately from punctuation/missing
  records, while historical session counts and accuracy remain unchanged.
- An authorized operator compares historical results from frozen evidence and
  performs a bounded repair only after reviewing its impact and restore path.

## Requirements

- **FR-001:** The new token policy is explicit and deterministic. Segment on
  Unicode whitespace and on em/en dashes (U+2014/U+2013), including dashes
  attached to text: `hello—world` has lexical words `hello` and `world`, with the
  dash retained as unscored display evidence. Never collapse these words into
  `helloworld`, infer an extra spoken word or change their order. A resulting
  token whose NFC-normalized form contains at least one Unicode letter or
  number is lexical; remaining standalone punctuation/symbols are unscored.
  Recognize balanced outer `()`, `[]`, `{}`, straight/curly double quotes and
  straight/curly single quotes enclosing an entire token or contiguous word
  span. Separate unambiguous matched shell marks as unscored evidence, including
  nested pairs and punctuation beside a closing mark. Interior apostrophes
  never open/close a shell. Unpaired leading elision apostrophes (`'cause`,
  `’em`) remain lexical; ambiguous pairing is never silently removed. Preserve
  the existing equality normalization for the lexical text after segmentation.
  Attached contractions, decimal/ordinal/time/quantity numbers, ASCII +/- and
  Unicode minus U+2212 signs, attached currency/percentage markers and
  ASCII-hyphenated words retain their lexical identity. No blanket stripping
  may make `don't` equal `dont`, erase an elision/sign, or split
  `state-of-the-art`. All segments retain raw source/user spans and positions.
- **FR-002:** The new version counts only lexical expected tokens in
  `total_words`, only lexical matches in `correct_words`, and only lexical
  missed/wrong/extra operations in word-error counters. Existing filler
  forgiveness remains effective. Omission/insertion/substitution of unscored
  display punctuation (standalone tokens, separated em/en dashes and recognized
  paired shells) cannot consume a lexical alignment slot, produce a false lexical error,
  change lexical ordering, or reduce word accuracy. Raw source/user tokens and
  their positions remain available for display/audit. References with no
  lexical token are invalid content, not a successful 100% submission; new
  start/grade/completion fails explicitly without persisting a completed result.
- **FR-003:** A grading version is frozen when new work starts and is returned
  by all applicable sentence-grade, resume, completion and result contracts.
  Reference snapshots/hash or the persisted reference text used for grading
  identify the exact input for each result. Sentence answers and terminal
  reports use the same frozen version/reference. Retry, lost ACK, reload,
  concurrent content edits, finalization and renderer claims cannot silently
  upgrade the version, mutate the source snapshot or produce duplicate results.
- **FR-004:** Existing completed and in-progress work without an explicit
  version is treated as the legacy whitespace version, never guessed to be the
  new policy from its timestamp. Older clients/default unversioned requests
  retain legacy behavior, including legacy dash and shell handling, during the
  compatibility window. New-version writes
  are enabled only for an explicitly compatible consumer; unsupported versions
  fail clearly before a write. Both versions remain readable and resumable with
  truthful version labels; switching mode or revisiting a historical report
  does not regrade it. Existing idempotency fingerprints and owner/expiry gates
  remain backward compatible.
- **FR-005:** Admin aggregate first classifies persisted trend keys into
  lexical, non-lexical and missing/invalid groups and derives each ranking
  within its group before display caps. A missing label/count is never rendered
  as a dash word. Raw historical punctuation counts remain available with a
  clear label; they are not silently discarded. Session/filter scope,
  `session_count`, persisted scores and the mean-of-means accuracy remain
  unchanged by classification. Version-specific counts/accuracy are explicit
  once versions coexist; no mixed number is labeled as a single-policy score.
- **FR-006:** Learner sentence/result/history and admin detail/aggregate
  surfaces distinguish unscored display punctuation from lexical errors and
  identify the scoring policy. They preserve reference/user text and frozen
  historical values. Loading, empty, invalid-content, error/retry, expired and
  permission-denied states are explicit; punctuation-only content is not
  treated as empty-success. Labels and controls support keyboard/focus,
  44px targets, reduced motion, light/dark themes and 360/390/768/1440 widths.
- **FR-007:** Before release a deidentified gold cohort includes real affected
  patterns and authored adversarial cases, reviewed independently by two
  academic reviewers. A report records old/new per-sentence operations, lexical
  totals, scores, per-session/aggregate results, mismatch/false-positive counts
  and affected-case counts. Acceptance requires zero deviations from the
  approved gold labels, zero unintended changes on punctuation-free legacy
  control cases, zero lost lexical errors and zero default historical mutations.
  Alignment, paired/nested/across-word shells, ambiguous/unpaired apostrophes,
  dash-without-whitespace, contractions/numbers/hyphens/fillers and
  empty/invalid references must all have coverage. The explicit policy matrix
  below is part of the reviewed gold contract, not assumed evaluator behavior.
  Model/AI evaluation is unnecessary for this policy.
- **FR-008:** Historical comparison uses only persisted reference/user/diff
  evidence from the original session or its frozen attempt snapshot. Missing
  evidence is reported as unrepairable/unknown; current edited content cannot
  substitute for a historical reference. A repair is opt-in, bounded by an
  explicit approved scope and old-version/source hashes, preceded by a dry-run
  old/new comparison and operator review. It is idempotent/retry-safe, checks
  concurrent changes, preserves original scores/diffs/references and provenance,
  records the actor/authorization/version and makes restore possible. No
  historical repair occurs as a migration/deploy/startup side effect.
- **FR-009:** Request/success/error and additive trend/version fields are
  concrete OpenAPI contracts with generated frontend wire types and runtime
  validation. Persistence/migrations are additive and compatible with the
  deployed backend/frontend; existing result ownership and private answer
  boundaries remain enforced. Staging migrations precede dependent code, and
  exact-SHA staging evidence verifies old/new clients, active legacy attempts,
  new-version work and unchanged historical records before production promotion.
- **FR-010:** Rollout proceeds through classification-only reporting, reviewed
  gold comparison, staged compatible new writes and an opt-in repair decision.
  A rollback disables new-version starts without making existing new-version
  work unreadable or unfinishable. Scoped monitoring records version counts,
  invalid references, grade/complete conflicts and classification anomalies;
  restoring a scoring policy never requires deleting attempts or publicizing
  private content. Operational acceptance records each stage's enabled scope
  and final frontend/backend deployed SHA.

## Acceptance scenarios

### Punctuation is display evidence

- **Given** reference `— Hello there.` and input `Hello there.`
- **When** a compatible new-version attempt grades and completes
- **Then** lexical counts are 2/2 and the score is 1.0; the dash remains visible
  as unscored reference evidence and never becomes a missing lexical word.
  The same holds for standalone commas/full stops/quotes/brackets, including
  several adjacent symbols, while genuine missing words still reduce credit.

### Lexical punctuation keeps meaning

- **Given** contractions, smart quotes, paired/nested quoted words (`“hello”`,
  `'hello'`, `[“hello world”]`), `hello—world` without whitespace,
  `state-of-the-art`, `-3.5`, `+42`, `10:30`, `50%`,
  and a genuine misspelling or omitted lexical word
- **When** the new policy compares answers
- **Then** tokens retain their authored lexical identity, approved existing
  normalization/filler behavior remains, and the missing/misspelled word is
  still an error. `hello—world` and `hello world` both yield `hello`, `world`;
  `helloworld` remains a lexical mismatch. Recognized quote/bracket shells do
  not make `“hello”` versus `hello` a false word error. Unpaired `'cause`,
  interior `don't`, attached signs/currency and internal ASCII hyphens retain
  lexical distinctions. Unscored actual segments cannot shift word alignment.

### Proposed gold policy matrix

Each row requires source/user span evidence and reviewed lexical operations.
Full credit assumes no other errors; legacy results remain frozen as originally
graded. These cases define proposed v2 behavior, not passing test evidence.

| Reference | User text | New-version lexical outcome |
| --- | --- | --- |
| `— Hello there.` | `Hello there.` | `Hello`, `there`: 2/2; standalone dash unscored |
| `hello—world` / `hello–world` | `hello world` | `hello`, `world`: 2/2; dash is a boundary |
| `hello—world` | `helloworld` | No full credit; do not collapse two words |
| `“hello”` / `'hello'` / `(hello)` | `hello` | One matching lexical word; paired shell unscored |
| `[“hello world”]` | `hello world` | Two matching words; nested/across-word shells unscored |
| `“hello,”` | `hello` | Shell unscored; existing terminal-punctuation equality retained |
| `“don't”` | `don't` | One matching contraction; shell removal does not remove apostrophe |
| `don't` | `dont` | Lexical mismatch retained |
| `'cause` / `’em` | `cause` / `em` | Unpaired elision apostrophe retained; lexical mismatch |
| `state-of-the-art` | `state of the art` | Hyphenated lexical identity retained; no full credit |
| `-42` / `+42` / `−42` | `42` | Attached sign retained; lexical mismatch |
| `$42` / `50%` / `3.5` / `10:30` | Exact reference | Lexical marker/number preserved; full credit |
| `— . , “ ” ( )` | Empty or punctuation only | No lexical reference: explicit invalid content, no completed grade |
| `hello — there` | `hello . there` | Two lexical matches; display punctuation cannot occupy a word slot |

Unpaired non-elision delimiters and ambiguous quote pairing retain lexical
baseline text rather than guessing a shell. Gold review must include adversarial
mixed elision/quotation strings and label which pairs are structurally
unambiguous. New source with unresolved ambiguity is flagged for author review;
the grader does not infer omitted spoken text or a matching word. This boundary
is explicit so a punctuation bug cannot become permissive word matching.

### No silent upgrade on resume

- **Given** an in-progress legacy attempt and a completed legacy report
- **When** the new release deploys, an old client retries, or source is edited
- **Then** resume/completion/report use legacy grading and frozen references;
  scores, idempotency identity and historical evidence do not change.

### Classification does not regrade history

- **Given** historical dash trends and persisted sentence/session accuracies
- **When** an admin opens the classification-only report with identical filters
- **Then** lexical/punctuation/missing groups reconcile to original counters;
  session count and mean accuracy remain unchanged. With mixed versions the
  report labels the combined activity scope and separate policy-specific scores.

### Invalid reference and controlled repair

- **Given** a punctuation-only new reference or a historical row missing its
  original reference/user evidence
- **When** grading or historical comparison is requested
- **Then** it fails or reports unknown explicitly, never fabricates 100% or a
  corrected score. An authorized repair dry-run shows before/after scope; replay
  cannot double-repair and restore retains the original evidence.

## Edge cases

- Unicode em/en dash attached to words or numbers, hyphen/minus,
  punctuation-only dot/comma/quote/bracket, adjacent punctuation, nested/paired
  shells across words, unpaired/elision/ambiguous apostrophes, currency/symbols,
  combining marks, non-Latin letters, numeric units and empty/whitespace input.
- Existing fillers, extra lexical words, ambiguous alignment, reference with
  only fillers, duplicated/missing sentence indexes and saved-ACK conflicts.
- Start/save/complete during deploy or source edit; N-1 clients; unsupported
  version; account/owner/expiry failures; renderer handoff and idempotent retry.
- Malformed legacy trend maps, missing reference evidence, capped rankings,
  aggregate mean versus word-weighted accuracy and concurrent repair attempts.

## Success criteria

- Approved gold cohort and all FR-linked contract/unit/browser tests pass.
- Default release preserves every historical score/evidence and every active
  attempt's policy; additive classification counts reconcile exactly.
- Compatible new work gives lexical credit without punctuation false errors;
  no contraction/number/hyphen/filler or genuine lexical error regresses.
- Staging and production acceptance are version/SHA-specific and include a
  rollback that still reads/resumes/completes already-started new-version work.

## Approval record

Approved on 2026-09-30 for the separately landed specification, under the
user's authorization to complete the validated remediation with controlled
agents and independent review. The root coordinator approved product scope;
the content council reviewed lexical/academic policy and the admin engineering
council independently reviewed compatibility, persistence, rollout and rollback.
Review refined paired/nested shells, attached dash boundaries, elisions,
contractions, signed numbers and lexical-error preservation before approval.

This approval defines behavior and the policy matrix. It does not certify an
implemented grader, a completed gold evaluation, deployed SHAs or historical
repair. Those remain explicit pending gates in tasks and verification.
No grading code, migration or production data mutation is included in this
specification approval PR.

## Open questions

None in the approved behavioral scope. Concrete implementation choices must
preserve the requirements and pass the recorded gold, contract and release gates.

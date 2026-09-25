# Listening editorial revision — review packet 1

This records the **2026-09-24 packet-1 decision**, not the final release
authority. The owner subsequently delegated validation and publication of the
remaining Listening content to the assistant; the delegated scope, evidence
and technical gates are recorded in the later release packet. The owner did
not personally review batches 02–68 or the localized maps. Follow the current
[rollout.md](rollout.md) cutover, not the historical request in step 5 below.

## Delegation recorded 2026-09-25

- Delegator: product owner. Delegate: assistant operating this Listening
  release task. Scope: validate and release the remaining 1,001 translations
  (B02–B68) and two localized museum-map SVGs (V01), after the 44 directly
  approved B01 questions. This is not a claim of personal owner review.
- Evidence: the locked source hashes below; one-to-one source/option checks for
  1,045 items; assistant text/transcript/protected-key review for 1,001 items;
  technical checks of 390 WAV and 1,474 timing segments; offline ASR screen;
  geometry/anchor checks for both SVGs; and a real v1.1 local build/import
  dry-run with zero mutations. The content PR carries the detailed ledger.
- Authority does not waive migration ordering, exact-SHA staging E2E,
  authenticated learner/theme/accessibility checks, the zero-active-attempt
  drain, production promotion gate or compensating rollback.

Historical packet-1 status: **owner-approved editorial packet; no package had
then been rebuilt, imported or published**. The owner approved the 65/9/5 metadata proposals,
batch 01's 44 items, and the implementation spec on 2026-09-24 against PR
#1501 head `c19e7febb2b0a279c23b07d2d100799f6ffae93c`. Approval applies
to this packet only; batches 02–68, cutover policy, package revision and
publication required separate decisions at that time; the later delegation
and cutover decision above supersede those pending requests.

## Source lock

| Artifact | SHA-256 |
| --- | --- |
| v1.0 release index | `05ade5ea7981a3dd4c1e5b34e6a1a8ad309aaa347ba6907a85df6b46f6de8d71` |
| General v1.0 manifest | `c8686083b2843f8e1ddabd27cb1b351c6d3940e6c67ca297d5869e869b87506c` |
| IELTS v1.0 manifest | `209cb7e3eedd4f4935e264a57b4904aaa5f7c6ed841b238b4cbe40e5d0f6a7b5` |

The files are under `/Users/trantrongvinh/Downloads/Listening-Content/02_PUBLISH_READY`.
Their published package IDs, manifests and release index must not be edited.

## What to review

- [lesson-metadata-draft.json](lesson-metadata-draft.json): 65 individualized
  listening instructions, nine clean learner titles and five outcome sets.
  The contrast-reversal lesson already has a specific instruction and is not
  overwritten. Confirm that each line describes the actual audio and task,
  especially the longer B2 lessons; edit or reject any claim that the source
  does not support.
- [translation-batch-01-draft.json](translation-batch-01-draft.json): 44 General
  item translations across `manus:A0-38` (38) and the practice form of
  `manus:A0.2-018` (six). Twelve reproduce the current UI pilot; 32 are new.
  Source prompts and changed option labels match the v1.0 package exactly.
  For the seven `A0-38` choice items, the options themselves are the English
  words being heard, so `unchanged_options_reviewed` keeps those labels.
  The 31 short answers still ask for words/locations from the English audio.

If this batch is accepted, it makes nine entire forms eligible for a truthful
language switch. It does **not** complete the second lesson's three-item
transfer form. Item coverage would be 44/1,045; 1,001 items remain in later
batches. Existing runtime coverage remains 12 items until a separately approved
contract and new package revision are implemented and released.

## Proposed batch sequence

1. Review this packet for fidelity, naturalness and answer-language guidance.
2. Continue in lesson-sized batches, pairing all form items and choice labels.
   Maintain a ledger of accepted/rejected/pending IDs; only accepted items count
   toward the 1,045-item completion gate.
3. After the approved spec lands on `staging`, implement the minimum package
   localization contract and source-mismatch validator in a separate PR.
4. Build new, unpublished General and IELTS package IDs. Compare every source
   answer key, media hash and timing artifact to v1.0, dry-run both, then
   verify representative bilingual forms in staging.
5. Historical step: ask the owner to review exact revision/manifests before
   publish. The later delegation replaces that personal-review request, but
   does not waive the gates in [rollout.md](rollout.md).

## Review decisions recorded

- The owner accepted the 65/9/5 metadata proposals and batch 01's 44 question
  translations, including the A0 answer-language guidance. This is a text
  approval, not confirmation of all 1,045 items or learner-side readiness.
- The owner accepted [spec.md](spec.md). Runtime/importer work can begin only
  after the approved spec lands on the `staging` base branch in a separate PR.

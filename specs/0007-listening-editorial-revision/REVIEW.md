# Listening editorial revision — review packet 1

Status: **draft; no package has been rebuilt, imported or published**. This
packet records proposed wording, not editorial approval.

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
5. Ask the owner to review the exact revision/manifests before publish. Do not
   move the release index or production content on the strength of this packet.

## Review decisions needed

- Approve or request edits to the 65/9/5 metadata proposals.
- Approve or request edits to batch 01's 44 question translations, including
  whether “write only the noun” and “position (in/on/at)” are clear to A0
  learners. This review is of text, not a confirmation that all 1,045 items
  are translated.
- Review and approve [spec.md](spec.md) before importer/player implementation.

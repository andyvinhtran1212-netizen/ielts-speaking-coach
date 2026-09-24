# IELTS bilingual questions — editorial review wave 02

Status: **draft for owner review, not approved or published**. This packet adds
all 134 question-text drafts in the immutable IELTS v1.0 source package. It
does not change v1.0, the 12-question UI pilot, answer keys, audio, timing,
imported rows, or learner-visible content.

## Source lock and scope

| Artifact | SHA-256 |
| --- | --- |
| v1.0 release index | `05ade5ea7981a3dd4c1e5b34e6a1a8ad309aaa347ba6907a85df6b46f6de8d71` |
| IELTS v1.0 manifest | `209cb7e3eedd4f4935e264a57b4904aaa5f7c6ed841b238b4cbe40e5d0f6a7b5` |

The source lives under
`/Users/trantrongvinh/Downloads/Listening-Content/02_PUBLISH_READY/02_IELTS-Listening-Practice/packages/ielts-listening-practice-v1.0.0/`.
Every JSON row gives the source ID, original English prompt and options,
proposed Vietnamese prompt and translated option labels. The 12 batches cover
16 complete forms:

| Batches | Source | Items | Forms |
| --- | --- | ---: | ---: |
| 02 | Five compatibility lessons | 25 | 5 |
| 09–10, 12–16 | Contrast/reversal drills | 65 | 7 |
| 17–20 | Four reference lessons | 44 | 4 |
| **Total** | **Entire IELTS programme** | **134** | **16** |

## Preliminary checks, not editorial approval

- All 134 IDs are unique and account for all 134 items in the 10 protected
  source-lesson JSON files. Every original prompt and option map matches its
  source item exactly; no missing source IDs or mismatches were found.
- Every item has Vietnamese question text. Translated choice maps preserve all
  source option keys. Seven choice items deliberately retain the original
  labels: two heard function-word contrasts, three bare-number choices, one
  proper-name set, and one programming-language set. Each is explicitly marked
  `unchanged_options_reviewed` for the editor to confirm.
- A text pass corrected three semantic risks before this packet: `reference:1.9`
  now asks who administered the test rather than who authored it;
  `reference:G66` no longer narrows “what will he do” to a housing choice;
  `reference:L2.3` asks for the English word that the existing gap key expects.
- This is textual/source-identity QA only. No claim is made that every audio
  clip has been perceptually checked or that Vietnamese wording is owner
  approved. The protected answer mapping remains outside the learner payload.

## Specific editorial attention

- `reference:G2` keeps the source distractor “melting rivers” literally as
  “các dòng sông tan chảy”. Confirm whether literal fidelity or a clearer
  Vietnamese distractor is preferable without changing the option's meaning.
- `compatibility:MarineBiology.item.04` uses “tập đoàn san hô” for “coral
  colonies”; confirm that this term is natural for the intended learners.
- `reference:G12.P2.901` has bare-number time choices in the source. Confirm
  that retaining these numbers is clearer than adding units not present in the
  approved source.
- Gap responses still follow English audio and the original answer-review
  rules, even when the question is displayed in Vietnamese. Check especially
  `compatibility:Proc.Photosynthesis.item.01`, `reference:L2.3`, and the
  word-limit/number prompts. Do not translate the expected answer by silently
  changing the answer key.
- Check the final-decision wording in contrast/reversal drills against their
  transcripts, including “undecided” distractors. A question translation
  must not reveal which answer is correct.

## Owner decision and next gate

Please accept or request edits to the 12 batches individually. No item in this
packet counts toward the reviewed 1,045-item coverage gate until accepted.
If all 134 are accepted, the editorial count becomes **178/1,045** (44 General
+ 134 IELTS), and all 16 IELTS forms become text-complete candidates for a
future language switch. They still need a separately approved package/import
contract, learner-side verification and an explicit publication decision.

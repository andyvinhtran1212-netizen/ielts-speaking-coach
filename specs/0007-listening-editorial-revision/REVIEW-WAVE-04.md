# General map and B2 bilingual questions — editorial review wave 04

Status: **draft for owner review, not approved or published**. This packet
contains 70 question-text candidates across eight batches. It also includes
two unpublished Vietnamese map SVG candidates; their inclusion does **not**
make either map form bilingual-ready. No v1.0 package, release index, answer
key, audio, timing, scoring, imported row or learner UI is changed.

## Source lock and scope

| Artifact | SHA-256 |
| --- | --- |
| v1.0 release index | `05ade5ea7981a3dd4c1e5b34e6a1a8ad309aaa347ba6907a85df6b46f6de8d71` |
| General v1.0 manifest | `c8686083b2843f8e1ddabd27cb1b351c6d3940e6c67ca297d5869e869b87506c` |

The source is
`/Users/trantrongvinh/Downloads/Listening-Content/02_PUBLISH_READY/01_General-Listening-Practice/packages/general-listening-practice-v1.0.0/`.
Every JSON row preserves source ID, original prompt/options and proposed
English or Vietnamese text.

| Batch | Lesson group | Items | Forms |
| --- | --- | ---: | ---: |
| 11 | `manus:B1.4-075` museum maps | 9 | 2 visual-dependent |
| 21–22 | `manus:B2.6-010`, `manus:B2.6-001` | 15 | 3 |
| 23–27 | `manus:B2.8-096` through `-100` | 46 | 10 |
| **Total** | **Eight batches** | **70** | **15, of which 2 need map UI work** |

## Preliminary content checks

- All 70 IDs are unique and match the eight locked source lessons. Recorded
  original prompts and option maps match 70/70; every item has a translated
  question and translated choice keys where applicable.
- The B1.4 source questions are Vietnamese but their maps have English visible
  labels. A complete language switch would pair English question text with
  the original English map, and Vietnamese questions with a reviewed
  Vietnamese map. A text-only translation must never enable the map form's
  language control.
- B2.6-001's Vietnamese source becomes English in batch 22. The proposed
  short-answer wording still permits a Vietnamese response where the source
  explicitly does. B2.8 proposals retain denominator, evidence limits,
  ownership and bounded-decision distinctions.
- This is source-identity and preliminary text QA, not owner editorial or
  perceptual/audio approval. Protected answer mapping is not part of the
  learner-facing draft.

## Map visual review and release blocker

- [Research-wing Vietnamese SVG](visuals-draft/westbury-research-wing.vi.draft.svg)
  and [annex Vietnamese SVG](visuals-draft/westbury-annex-transfer.vi.draft.svg)
  parse as XML. `visual-batch-01-draft.json` records source and draft hashes,
  translated visible text, `title`, `desc`, and proposed image alternatives.
- Side-by-side SVG diff shows changes only to text nodes. Room positions,
  paths, dimensions, north arrows and A–F/P–U anchors remain identical to the
  v1.0 source. No room name or answer location was added.
- Nominal-size renders are legible. At a static 360px width, the secondary
  instructions and labels are too small. The learner UI needs zoom/pan or
  separately readable instructions, keyboard/focus and 44px controls before
  these two forms can be released. Check the actual embedding in light and
  dark themes, including border/white-plan separation, and verify the
  accessible alternative with a screen reader. None of that is proven by
  static SVG inspection.

## Specific editorial attention

- Verify left/right directions against the visitor's facing direction in
  both maps. Confirm visible text, `title`/`desc` and image alternatives in
  `visual-batch-01-draft.json` without exposing answer locations.
- Confirm “warrant”, alternative explanation and qualified decision wording
  in B2.6-010; do not convert a conditional proposal into approval.
- In B2.6-001, keep the four-week Riverside and two-week Room B trials,
  unsurveyed groups, and available spare-bus evidence distinct.
- In B2.8-096…100, preserve observed result versus causal claim, denominator,
  excluded or under-served groups, access/privacy safeguards, funding limits,
  named decision owners and review timing. Audio/context review is pending.

## Owner decision and next gate

Please accept or request edits to each of the eight text batches and the two
SVG/text-alternative candidates separately. If all 70 text items are accepted,
the editorial count becomes **114/1,045** from the already approved 44-item
batch 01, excluding independently pending waves 02 and 03. Even then, the two
map forms remain original-language-only until the visual variants, mobile
interaction and accessible embedding pass staging review under FR-009 of the
separately proposed safety amendment. This packet authorizes no import or
publication.

# Listening bilingual editorial queue and delegated decision

Status: **batch 01 owner-approved; batches 02–68 and V01 approved under
owner delegation, not yet published**. See the
[delegated decision](DELEGATED-RELEASE-DECISION.md) for the evidence and
remaining release gates. PR #1501 merged
the first approved packet (metadata 65/9/5 and batch 01) into `staging`;
batches 02–68 are not in that PR.
Four B2.7 instructions (`manus:B2.7-096`, `-097`, `-099`, `-100`) were
corrected after transcript QA and synchronized to PR #1501 at
`c19e7febb2b0a279c23b07d2d100799f6ffae93c`. Review that current PR
head rather than the earlier draft SHA.

The locked v1.0 packages remain unchanged. `DRAFT-QUEUE.md` lists every
batch, its source lesson and item count. The 68 JSON files contain one-to-one
source IDs and original prompts alongside proposed target-language prompts;
changed answer options, where any exist, are captured in those files.

| Editorial wave | Batches | Items | Review focus |
| --- | --- | ---: | --- |
| 1 | 01 | 44 | Owner-approved text and 65/9/5 metadata; runtime/package release pending |
| 2 | [02, 09–10, 12–20](OWNER-REVIEW-WAVE-02.md) | 134 | Entire IELTS programme: question fidelity, IELTS terms and distractor semantics |
| 3 | [03–08](OWNER-REVIEW-WAVE-03.md) | 103 | Remaining A0–A2 General forms and common beginner vocabulary |
| 4 | [11, 21–27](OWNER-REVIEW-WAVE-04.md) | 70 | Museum-map text plus B2 special forms; map forms additionally require two localized SVGs |
| 5 | [28–32](OWNER-REVIEW-WAVE-05.md) | 101 | B2.0 source, claim and evidence boundaries |
| 6 | [33–37](OWNER-REVIEW-WAVE-06.md) | 87 | B2.1 source, claim and evidence boundaries |
| 7 | [38–42](OWNER-REVIEW-WAVE-07.md) | 86 | B2.2 source, claim and evidence boundaries |
| 8 | [43–47](OWNER-REVIEW-WAVE-08.md) | 90 | B2.3 source, claim and evidence boundaries |
| 9 | [48–52](OWNER-REVIEW-WAVE-09.md) | 81 | B2.4 source, claim and evidence boundaries |
| 10 | [53–57](OWNER-REVIEW-WAVE-10.md) | 77 | B2.5 source, claim and evidence boundaries |
| 11 | [58–62](OWNER-REVIEW-WAVE-11.md) | 74 | B2.6 source, claim and evidence boundaries |
| 12 | [63–68](OWNER-REVIEW-WAVE-12.md) | 98 | B2.7 and B2.8 inference, uncertainty and causal limits |
| **Total** | **01–68** | **1,045** | **44 direct-owner; 1,001 delegated, unpublished** |

For each wave, compare the proposed wording with the original prompt, options,
answer key, transcript and audio. Check that a Vietnamese question does not
give away the answer or strengthen an uncertain statement. Switching the
question language must not silently translate the existing answer key. Mark
each item accepted, edited or rejected, recording the exact source ID. A wave
is editorially accepted only when all its items and forms are accepted;
learner-facing readiness also requires UI sampling after implementation.
The owner has since delegated editorial validation and release; the
[delegated decision](DELEGATED-RELEASE-DECISION.md) records what was checked
and what remains unverified. Drafting alone never pre-approved a wave.

The museum-map lesson has nine translated question texts and two separate
unpublished Vietnamese SVG variants under `visuals-draft/`. Their delegated
editorial decision is recorded above; inspect the underlying work in the
[separate visual packet](OWNER-REVIEW-VISUAL-01.md). Their element
structure, geometry and answer-letter anchors match the v1.0 originals, and
nominal-size renders were inspected. Do not count either map form as
bilingual-ready until the variants have delegated editorial review and learner-side
mobile/theme/screen-reader verification. At 360px static width, secondary
labels/instructions are too small; provide zoom/pan or separate readable
instructions in the learner UI rather than altering the answer anchors.

## Preliminary QA, not editorial approval

- All 1,045 draft IDs are distinct and match exact v1.0 source IDs, original
  prompts and original option keys. All 159 forms have question-text drafts.
- Of 158 entries carrying a `source_options` field, 137 have translated
  labels, 14 deliberately retain the same heard word/name/number labels,
  and seven have empty option objects. No non-empty choice set is untreated.
- Across all 68 batches, an NFC/casefold/trim screen found zero cases where
  distinct source choices collapse to the same translated label. A separate
  literal prompt/option-overlap screen flagged only B01 `manus:A0.2-018.P1`:
  its English question repeats an option phrase, but the Vietnamese source
  question already states that same alternative. These screens do not prove
  that distractors remain pedagogically equivalent; the delegated transcript
  review ledger provides the separate semantic check.
- A screening pass found no missing Vietnamese limitation/negative cue among
  94 English prompts containing one, and no dropped numeric token where the
  English prompt spells a number with digits. Interrogative-type flags were
  checked as translation candidates, not treated as a semantic proof.
- The four B2.7 metadata corrections were checked against controlled
  transcripts. All 1,001 formerly pending question-text drafts in batches 02–68 have
  now had assistant text/transcript pre-review, recorded in
  [TRANSCRIPT-REVIEW-LEDGER.md](TRANSCRIPT-REVIEW-LEDGER.md). This is not owner
  semantic approval. The owner subsequently delegated the editorial decision;
  live UI and perceptual audio sampling remain release checks. A separate
  [read-only signal screen](AUDIO-SIGNAL-QA-LOCAL.md) found no simple file,
  level or silence anomalies in the 390 source WAV files.

Publication still requires a new immutable package revision and manifests,
the selected active-attempt drain policy, import dry-runs, exact-SHA staging
verification and a separate production promotion gate. This queue alone is
not evidence of publication.

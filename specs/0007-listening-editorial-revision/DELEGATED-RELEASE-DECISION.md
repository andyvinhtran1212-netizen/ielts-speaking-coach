# Delegated editorial decision — 2026-09-25

The owner asked the assistant to perform all feasible validation and release the
Listening content without waiting for the owner to review each question. This
delegates the editorial release decision; it **does not mean the owner personally
reviewed** batches B02–B68 or visual batch V01. B01 (44 questions) and the
65/9/5 lesson-metadata packet retain their earlier direct-owner approval.

After the checks below, B02–B68 (1,001 questions) and V01 (two localized SVGs)
are marked `approved_under_owner_delegation_not_published`. This means the
content may be built into a new immutable v1.1 candidate, not that it is live.

Evidence and limits:

- The locked v1.0 manifests and release index match the approved SHA-256 values.
  Draft IDs cover exactly 1,045 source questions with no missing or duplicate
  question; source prompt/options and translated option keys bind exactly.
- [TRANSCRIPT-REVIEW-LEDGER.md](TRANSCRIPT-REVIEW-LEDGER.md) records an
  assistant text/transcript/protected-key pre-review for all 1,001 newly
  delegated items. This is not a human owner reading or listening pass.
- Structural checks found no collapsed translated choice labels and no missing
  English negation/number cues in the screened cases. These checks cannot
  prove every nuance of translation is perfect.
- Technical WAV checks cover all 390 source files and 1,474 timing segments.
  A local, offline Whisper-base English ASR screen of all 390 WAVs against the
  controlled transcripts gave 97.22% median normalized token similarity,
  minimum 75%, and zero files below 75%. ASR is a secondary signal, not a
  perceptual or accessibility sign-off; the lowest-scoring clips should be
  sampled during staging review.
- Both Vietnamese SVG variants were hash-, XML-, geometry-, label-anchor-,
  and wording-checked against the originals. The learner UI must still be
  checked at mobile width, in light/dark themes, and with accessible text.
- A synthetic **DO-NOT-PUBLISH** build (approvals changed only in a temporary
  copy) verified that all 1,045 questions project into 159 forms and that
  v1.0 protected answers, audio, timing and item/form IDs remain invariant.
  That synthetic package must never be imported or published.

Release is still gated by a real strict-approved build and import dry-run,
staging migration and exact-SHA integrated/live tests, active-v1.0-attempt
drain, representative learner checks, and the staging-to-production promotion
gate. If any check fails, stop; the delegated approval is not a waiver.

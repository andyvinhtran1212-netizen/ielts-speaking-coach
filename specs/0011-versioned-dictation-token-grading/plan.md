# Implementation plan

The behavioral contract is approved in a separate specification PR. No grading implementation belongs
in the specification approval PR.

## Architecture impact

- Existing dictation grader, standalone/test/attempt completion flows, private
  frozen references, learner result views and admin aggregate/detail consumers.
- Reuse existing attempt/idempotency/renderer-affinity boundaries. No generic
  worker or regrade platform is proposed.

## Data and contracts

- Audit every write/read path before choosing additive version persistence and
  compatible request negotiation. Preserve legacy defaults and frozen snapshots.
- OpenAPI/runtime validation covers classification/version fields and errors.
- New segmentation separates em/en dashes and unambiguous paired outer shells
  with original offsets; retains contraction/elision/sign/hyphen identity and
  the existing equality/alignment policy for remaining lexical words.
- Historical comparison/repair is opt-in and preserves original evidence.

## UI and interaction

- Classification-only reports precede new grading; historical scores do not
  change. Display punctuation is distinct from lexical errors across consumers.
- Apply the loading/error/invalid/permission/retry and accessibility matrix in
  FR-006; old clients remain supported through an explicit compatibility window.

## Work decomposition

1. Approve policy and gold labels; inventory contracts/consumers/persistence.
2. Add classification-only reporting and reconcile historical counters.
3. Add additive version/ref contracts and migrations, then versioned grader.
4. Add compatible consumers and old/new resume/retry/browser evidence.
5. Dry-run historical comparison and obtain an explicit repair decision.
6. Independent review, exact-SHA staging, bounded rollout and rollback evidence.

## Rollout and rollback

- Stage migrations before dependent code. Enable new starts only after gold,
  consumer, legacy and live staging acceptance pass.
- Disable new-version starts on rollback while keeping existing versioned work
  readable/resumable/completable; do not regrade or delete historical data.

## Verification strategy

- Deidentified gold report; lexical/diff/filler/version unit tests; contract,
  persistence/idempotency/ownership checks; browser old/new journeys; default
  historical immutability queries; exact-SHA staging/production/rollback proof.

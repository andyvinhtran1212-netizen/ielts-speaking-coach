# Implementation plan

## Architecture impact

- Add a shared pricing catalog and usage logger under `backend/services`.
- Instrument existing Claude, Gemini, OpenAI, ElevenLabs, and Azure call sites
  without moving their provider timeout or fallback ownership.
- Extend the existing admin usage endpoint and Next.js admin surface rather than
  creating a competing reporting source.
- Keep model selection in existing settings, with the Speaking primary routed by
  `SPEAKING_GRADING_MODEL` and the current orchestrator owning retries/fallbacks.

## Data and contracts

- Add nullable columns to `ai_usage_logs` for feature, operation, status, errors,
  latency, provider identifiers, resource units, thinking tokens, pricing version,
  currency, cost source, idempotency key, and bounded metadata.
- Create a full unique index on non-null `usage_event_id` so PostgREST upsert can use
  `ON CONFLICT` deterministically.
- Preserve legacy columns and reads during the compatibility window. Failed,
  unpriced, and Writing events that cannot be represented truthfully are not written
  to the legacy shape.
- Extend the admin response with explicit legacy/truncated/unpriced signals while
  retaining existing totals and authorization.

## UI and interaction

- The admin AI-usage page continues to load through the canonical admin endpoint.
- Loading and error states remain visible; unknown services remain present instead
  of being discarded by client normalization.
- Legacy and truncation metadata is displayed so incomplete data never appears as a
  trustworthy zero.
- Learner Speaking, Writing, Listening, TTS, and pronunciation result surfaces keep
  their existing response and interaction contracts.

## Work decomposition

- Add the migration and effective-dated price catalog first.
- Add sync/async idempotent ledger writers and schema compatibility behavior.
- Instrument provider attempts by feature without changing retry boundaries.
- Add truthful admin aggregation and frontend metadata rendering.
- Update supported model defaults and request-shape compatibility.
- Add regression tests, perform independent review, and reconcile every finding.

## Rollout and rollback

- Apply the additive migration on staging before backend deployment.
- Deploy one exact candidate SHA and run one successful/error-path smoke where safe
  for each provider class.
- Monitor usage completeness, duplicate keys, fallback/error rates, latency, ratings,
  regrade reports, and estimated-versus-billed cost for 24–48 hours.
- Revert Speaking through `SPEAKING_GRADING_MODEL=gemini-3.5-flash`; retain the
  additive schema and ledger history during application rollback.

## Verification strategy

- Unit-test pricing boundaries, Gemini 3.8 request compatibility, idempotency,
  schema fallback, provider usage extraction, retry/fallback attribution, and Writing
  deduplication across date windows.
- Run the complete backend suite and targeted frontend contract tests after the
  implementation is rebased onto the approved spec revision.
- On staging, query the unique index and representative ledger rows, compare the
  dashboard with provider responses/invoices, and record the exact deployed SHA.

---
id: AI-0004
title: AI model usage observability and controlled model rollout
status: implementing
risk: high
owner: product
---

# AI model usage observability and controlled model rollout

## Problem

AI calls are spread across Speaking, Writing, Listening, vocabulary, course,
speech-to-text, text-to-speech, and pronunciation paths. Model identifiers,
price assumptions, usage dimensions, and error recording are inconsistent, so
operators cannot reliably attribute spend or distinguish a true zero-cost call
from missing data. Paid-model changes can also alter learner grading without a
single rollback and monitoring contract.

## Scope

- Establish one effective-dated price catalog for supported AI providers.
- Persist one idempotent usage event per provider attempt, including failures and
  calls whose regional price cannot be calculated locally.
- Make the admin AI-usage view report canonical ledger truth and explicitly mark
  legacy, truncated, or unpriced data.
- Move bounded workloads to supported models and set Gemini 3.8 Flash as the
  configurable primary Speaking grader.
- Preserve provider fallbacks and define staging-first rollout, monitoring, and
  model rollback procedures.

## Non-goals

- Replacing provider invoices as the final billing source of truth.
- Persisting prompts, transcripts, essays, audio payloads, API keys, or raw model
  responses in the usage ledger.
- Automatically promoting Gemini 3.8 Flash to the production Writing grader.
- Recalibrating Azure pronunciation scores to IELTS bands without a teacher-rated
  gold set.
- Removing legacy usage columns or dropping historical records during rollback.

## Users and journeys

- A learner submits a Speaking response and receives the existing result contract
  while the configured primary model and any fallback attempts are auditable.
- An administrator filters AI usage by date, provider, model, feature, or user and
  sees truthful cost/status metadata without Writing cost being counted twice.
- An operator deploys the additive ledger migration before application code,
  verifies provider smoke calls, and can flip the Speaking grader back to the
  previous model without a database rollback.

## Requirements

- **FR-001:** Every configured paid AI attempt records provider, model, feature,
  operation, status, latency, available token/audio/character resources, pricing
  version, currency, cost source, correlation identifiers, and a stable
  `usage_event_id`; retries and fallbacks are separate attempts, and identical
  event replays never double-count.
- **FR-002:** Usage persistence is best-effort and occurs outside provider timeout
  and retry boundaries, so a slow or unavailable ledger cannot repeat a billable
  provider call or block learner grading, transcription, TTS, or pronunciation.
- **FR-003:** Cost estimation uses an effective-dated catalog for supported Claude,
  Gemini, OpenAI, and ElevenLabs models; unknown or region-dependent prices remain
  explicitly unpriced rather than appearing as successful zero-cost usage.
- **FR-004:** The admin AI-usage contract aggregates ledger events by provider,
  model, feature, operation, status, and user; it exposes legacy/truncation metadata
  and merges historical Writing records without counting a ledger-backed job twice,
  including when the matching ledger row falls outside the selected date window.
- **FR-005:** The primary Speaking grader defaults to `gemini-3.8-flash`, removes
  sampling controls rejected by that model, retains the Haiku 4.5 then Sonnet 5
  fallback chain, and can be reverted to `gemini-3.5-flash` solely through
  `SPEAKING_GRADING_MODEL` plus a backend restart.
- **FR-006:** The rollout applies the additive ledger migration before dependent
  code, smoke-tests every provider/feature class on staging, reconciles estimates
  against provider billing, and blocks production promotion while schema warnings,
  unexpected unpriced calls, or material grading/reliability regressions remain.
- **FR-007:** The ledger stores only operational metadata and bounded resource
  counters; provider credentials and learner content are excluded, and admin usage
  reads retain the existing admin authorization boundary.

## Acceptance scenarios

### Successful Speaking grade

- **Given** Gemini 3.8 Flash is configured and the ledger migration is applied
- **When** a learner response is graded successfully
- **Then** the learner receives the unchanged grading result shape and exactly one
  successful `speaking_grading` usage attempt identifies Gemini 3.8 Flash.

### Primary provider fallback

- **Given** the primary provider returns a retryable failure
- **When** the orchestrator retries and then invokes a fallback
- **Then** each attempt has its own status and correlation data, while only the
  successful grading result is persisted for the learner.

### Ledger outage

- **Given** the provider returns a valid grade and usage persistence is unavailable
- **When** the ledger write fails
- **Then** the grade completes without replaying the provider request and the
  failure is diagnosable through application logging.

### Writing dashboard reconciliation

- **Given** a Writing feedback row and a matching ledger event share the canonical
  grading job identifier
- **When** an administrator queries a window containing either side of the boundary
- **Then** the job contributes cost once and the response states whether legacy or
  truncated data affected the aggregate.

### Speaking model rollback

- **Given** feedback or metrics show a Gemini 3.8 regression
- **When** operations set `SPEAKING_GRADING_MODEL=gemini-3.5-flash` and restart the
  backend
- **Then** new primary attempts use Gemini 3.5 Flash, fallbacks remain available,
  and existing ledger history remains intact.

## Edge cases

- Missing provider usage metadata creates an unpriced event rather than invented
  token counts.
- Cancellation, timeout, safety blocking, invalid JSON, and permanent API errors
  remain distinct statuses or error codes.
- A pre-migration legacy schema cannot safely represent failed or Writing events;
  unsupported fallback writes are skipped instead of creating misleading rows.
- Azure cost remains unpriced until the deployment region and invoice rate are
  reconciled.
- Background ledger tasks are retained until completion and do not disappear due
  to garbage collection.

## Success criteria

- All changed backend and frontend contract tests pass after rebase onto staging.
- Staging smoke calls produce one truthful row per provider attempt with no duplicate
  `usage_event_id` values.
- The dashboard reports zero unexplained Writing double-counts and no silent legacy
  or truncation state.
- Speaking 3.8 can be reverted through configuration without code or schema change.
- No usage row contains learner prompt, transcript, essay, audio, or credential data.

## Open questions

- None for approval; production promotion depends on the rollout evidence in
  `rollout.md` and may be stopped or reverted by the product owner.

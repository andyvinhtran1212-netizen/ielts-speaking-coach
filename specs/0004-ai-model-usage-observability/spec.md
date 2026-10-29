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
- Move bounded workloads to supported models and make Claude Sonnet 5.5 the
  configurable primary Speaking grader, keeping Gemini 3.8 Flash, Claude Haiku
  4.5 and Claude Sonnet 5 as automatic fallbacks (FR-005 revision 2026-10-26).
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
- **FR-005:** The primary Speaking grader defaults to `claude-sonnet-5-5` for
  both practice and test modes and keeps every previous option as an automatic
  fallback, in order `gemini-3.8-flash` (`SPEAKING_GRADING_MODEL`), then
  `claude-haiku-4-5-20251001`, then `claude-sonnet-5`. The Claude primary is
  skipped without a learner-visible error when it fails, times out, is rate
  limited, refuses, truncates, or `ANTHROPIC_API_KEY` is blank; a response that
  fails JSON validation is retried on the next provider after the one that
  answered, never on the same model. No request sends sampling controls the
  selected model rejects, and the learner result JSON schema is unchanged.
  Operations restore the previous Gemini-primary chain solely through
  `AI_PROVIDER_ORDER_SPEAKING_GRADING=gemini` (or the global
  `AI_PROVIDER_ORDER`, or a blank `ANTHROPIC_API_KEY`) plus a backend restart,
  and `SPEAKING_GRADING_MODEL` still selects the Gemini rung, including the
  `gemini-3.5-flash` rollback. The Claude Sonnet 5.5 default must not serve
  production learners until the constitution §6 Speaking gold-set comparison
  against the `gemini-3.8-flash` baseline has a recorded passing report.
- **FR-006:** The rollout applies the additive ledger migration before dependent
  code, smoke-tests every provider/feature class on staging, reconciles estimates
  against provider billing, and blocks production promotion while schema warnings,
  unexpected unpriced calls, or material grading/reliability regressions remain.
- **FR-007:** The ledger stores only operational metadata and bounded resource
  counters; provider credentials and learner content are excluded, and admin usage
  reads retain the existing admin authorization boundary.

## Acceptance scenarios

### Successful Speaking grade

- **Given** the code defaults apply, `ANTHROPIC_API_KEY` is set and the ledger
  migration is applied
- **When** a learner response is graded successfully on the first attempt
- **Then** the learner receives the unchanged grading result shape and exactly one
  successful `speaking_grading` usage attempt identifies `claude-sonnet-5-5`.

### Claude primary unavailable

- **Given** Claude Sonnet 5.5 returns a 429, 5xx, timeout, refusal or truncated
  answer, or `ANTHROPIC_API_KEY` is blank
- **When** a learner response is graded
- **Then** Gemini 3.8 Flash serves the grade within the existing chain's time
  budget, the failed Claude attempt (when one was made) is a separate ledger
  attempt, and Haiku 4.5 then Sonnet 5 remain available behind Gemini.

### Malformed Claude answer

- **Given** Claude Sonnet 5.5 answers but the answer fails Speaking JSON validation
- **When** the grader performs its one corrective retry
- **Then** the retry is sent to Gemini 3.8 Flash, not to Claude Sonnet 5.5, and the
  learner receives the result only if that answer validates.

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

- **Given** feedback or metrics show a Claude Sonnet 5.5 Speaking regression
- **When** operations set `AI_PROVIDER_ORDER_SPEAKING_GRADING=gemini` and restart
  the backend
- **Then** new primary attempts use `SPEAKING_GRADING_MODEL` (Gemini 3.8 Flash),
  Haiku 4.5 then Sonnet 5 remain the fallbacks, and existing ledger history
  remains intact; additionally setting `SPEAKING_GRADING_MODEL=gemini-3.5-flash`
  restores the earlier Gemini rollback target.

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
- An environment that already sets `AI_PROVIDER_ORDER_SPEAKING_GRADING=gemini`
  keeps the Gemini-primary chain despite the new code default; the rollout reads
  the effective value instead of assuming the default.

## Success criteria

- All changed backend and frontend contract tests pass after rebase onto staging.
- Staging smoke calls produce one truthful row per provider attempt with no duplicate
  `usage_event_id` values.
- The dashboard reports zero unexplained Writing double-counts and no silent legacy
  or truncation state.
- Speaking can be reverted from Claude Sonnet 5.5 to the Gemini-primary chain, and
  from Gemini 3.8 to 3.5, through configuration without code or schema change.
- A passing constitution §6 Speaking gold-set report (Claude Sonnet 5.5 against
  the Gemini 3.8 Flash baseline) is recorded before the Claude default serves
  production learners.
- No usage row contains learner prompt, transcript, essay, audio, or credential data.

## FR-005 revision — Claude Sonnet 5.5 primary Speaking grader (2026-10-26)

The product owner approved this change on 2026-10-26; the decision record is
[`approval-fr005-2026-10-26.md`](approval-fr005-2026-10-26.md).

### Fallback order

`claude-sonnet-5-5` → `gemini-3.8-flash` → `claude-haiku-4-5-20251001` →
`claude-sonnet-5`.

- **Sonnet 5.5 first.** It is the router's grading-tier Claude model, the owner's
  Anthropic credit covers it, and its 512-token cache minimum means the static
  Speaking system prompt (about 3k tokens) is actually cached.
- **Gemini 3.8 Flash second.** It is the current default grader and a different
  vendor. A Claude outage, Anthropic rate limit or spend-limit 4xx is
  therefore not correlated with the next rung. The malformed-JSON retry goes to
  the provider after the one that answered, so a bad Sonnet 5.5 answer gets an
  independent second opinion from Gemini, not a second roll of the same model.
- **Haiku 4.5 third, Sonnet 5 last.** This keeps the existing fallback chain
  exactly as it was behind the Gemini rung. Haiku 4.5 is the cheaper and faster recovery when both primary vendors fail.
  Sonnet 5 is the final safety net.

### Haiku decision

Haiku 4.5 is not made a primary for any mode. Practice and test grading both
return bands and grammar feedback that are persisted to
`grammar_recommendations`, so the truthfulness bar is the same for both. The
2026-07-02 audit moved the grader off Haiku because it was the weakest tier.
Haiku 4.5 costs half as much as Sonnet 5.5 per token ($1/$5 versus $2/$10), but
its 4096-token cache minimum means the Speaking prompt does not cache on it. At
current volume the Sonnet 5.5 cost (about $0.015 per grade) fits the owner's
credit. A per-mode model would also need a new configuration knob. For these
reasons Haiku stays only as the third rung. `ANTHROPIC_MODEL_SPEAKING_GRADING`
remains the operator override for the primary model.

### Constitution §6 gate (blocks production, not staging)

- **Gold cohort:** the `gold_speaking` table (migration 144) from
  `docs/TECH_DEBT_gold_set_A1.md`. It needs at least 20 items, each graded
  independently by two or more teachers, and at least 5 items in each of the
  low, mid and high band buckets. As of 2026-10-26 that gold set is parked, so
  populating it is a prerequisite.
- **Baseline:** `gemini-3.8-flash` as the Gemini-primary chain
  (`AI_PROVIDER_ORDER_SPEAKING_GRADING=gemini`).
- **Candidate:** `claude-sonnet-5-5` as the default chain.
- **Runs:** both configurations run on the same gold items and the same code
  SHA, three runs each, using `python -m eval.run --module speaking --source db`
  (`docs/EVAL_HARNESS.md`).
- **Quality metrics:** compare the mean of the three runs for each criterion
  (FC, LR, GRA, overall): MAE, bias, ±0.5 rate, QWK and 6/7-boundary
  confusion. The human inter-rater QWK is the ceiling.
- **Pass thresholds** (candidate compared with the baseline):
  - overall MAE is no more than 0.10 worse, and at most 0.75
  - overall QWK is no more than 0.05 lower
  - overall ±0.5 rate is no more than 5 percentage points lower
  - absolute overall bias is at most 0.30
  - FC, LR and GRA MAE are each no more than 0.15 worse
  - 6/7-boundary confusions increase by at most one item
- **Run validity:** every run grades every item. The ledger shows that Claude
  Sonnet 5.5 served at least 95% of the candidate grades; otherwise the run
  measured the fallback and is invalid.
- **False-positive risk:** a teacher reviews grammar feedback for at least 10
  gold items per configuration, in both test and practice modes, without
  knowing which model produced it. The candidate's false-positive grammar
  flags must not exceed the baseline's. The harness scores only bands, and
  practice mode is not exercised by `eval.run`.
- **Reliability and cost:** record the following.
  - The candidate's first-attempt JSON-validation failure rate must not exceed
    the baseline's.
  - Candidate success p95 latency must be at most 30 s.
  - Mean ledger cost per candidate grade must be at most $0.03.
- **Fallback behaviour:** see FR-005 and the scenarios above. The gate's report
  JSON files and the ledger query result are recorded in `verification.md`
  before production promotion.

## Cross-reference: AIBUDGET-0033 budget refusals (2026-10-28)

FR-005's automatic fallback covers provider failures only. Once
[AIBUDGET-0033](../0033-ai-budget-hard-cap/spec.md) is implemented, a budget
refusal (`monthly_cap`, `daily_cap`, `kill_switch`, `config_invalid`,
`budget_unavailable`) and a provider spend-limit response
(`provider_spend_limit`, for example Anthropic 402 `billing_error`) stop
the chain without trying the next provider (AIBUDGET-0033 FR-008/FR-009).
Rate limits, overload, 5xx and timeouts keep falling back as FR-005 says.
This note does not change FR-005's text.

## Open questions

- None for approval; production promotion depends on the rollout evidence in
  `rollout.md` and the FR-005 §6 gate above, and may be stopped or reverted by
  the product owner.

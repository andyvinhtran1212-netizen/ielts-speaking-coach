---
id: AIOPS-0024
title: Admin AI dashboard with model control, token spend and failure log
status: implementing
risk: high
owner: product
---

# Admin AI dashboard with model control, token spend and failure log

Approval: approved by Vinh on 2026-10-27 at 07:14 for merge into `staging`
after CI and review (see [`approval-decision.md`](approval-decision.md)).
Locked migration number: **322** (`backend/migrations/README.md`).

Parent context: [AI-0004](../0004-ai-model-usage-observability/spec.md) (usage
ledger, price catalog, Speaking FR-005) and the Anthropic-primary router from
PR #1711 (`backend/services/ai_router.py`, `docs/AI_PROVIDER_ROUTING.md`). This
spec adds an operator surface and a runtime control on top of them. It does not
re-approve or change any AI-0004 requirement.

## Problem

On 2026-10-26 the owner asked (verbatim): "ở trang dashboard của admin tổng hiển
thị thêm các model đang dùng cho web, tổng token gọi và có nút toggle để chọn
model ưu tiên thực hiện nhiệm vụ, cũng như log lại số lần gọi fail".

Today an administrator cannot answer four operational questions without reading
Railway variables and querying the database by hand:

1. Which provider and model actually serve each AI feature right now, and why
   (environment variable or code default)?
2. How many tokens each feature and provider consumed today, this week or this
   month, and what that cost is estimated to be?
3. How to make one feature prefer Claude or Gemini without a Railway variable
   change and a backend restart.
4. How often provider calls fail or fall back, with which error, for which
   feature.

The only existing AI view (`/admin/system/ai-usage`) is a per-user cost report
capped at 10,000 rows; it shows neither configuration, failures nor fallbacks,
and the main dashboard (`/admin`) shows only a single token total.

## Scope

- An "AI" section on the main admin dashboard (`/admin`) with three panels:
  models in use, token usage and cost, and failed calls.
- A per-feature control for the six routed feature keys of `ai_router`
  (`speaking_grading`, `writing_grading`, `course_writing`,
  `advanced_vocab_rewrite`, `question_generation`, `listening_audit`): the
  preferred provider (Claude or the feature's existing provider) and the Claude
  model, persisted in the database and applied without a redeploy.
- An append-only audit of every control change.
- A routing-layer failure/fallback log written by `ai_router` and by the
  Speaking grading orchestrator chain.
- One additive migration and admin-only read/write endpoints.

## Non-goals

- Changing any default provider, model or fallback chain. With no database
  override every feature behaves exactly as today. In particular this spec does
  not revise AI-0004 FR-005 (Speaking's default primary).
- Changing Gemini/OpenAI model identifiers (`SPEAKING_GRADING_MODEL`,
  `COURSE_WRITING_MODEL`, `WRITING_FLASH_MODEL`, ...) from the dashboard. They
  are displayed read-only with their source.
- Removing a provider from a chain, or disabling a feature. The control only
  reorders; every fallback that exists today stays reachable.
- Routing speech-to-text, text-to-speech, pronunciation assessment or the
  Claude-only paths (off-topic judge, D1, Listening gist, sample regeneration).
- Replacing `/admin/system/ai-usage` (per-user cost) or provider invoices as the
  billing source of truth.
- Storing prompts, model outputs, transcripts, essays, provider error messages,
  user ids, session ids or any other learner data in the new tables.
- Retention/archival jobs for the failure log, alerting and paging.
- Running paid provider calls or quality evaluations as part of this change.

## Users and journeys

- **Owner/administrator (role `admin`)** opens `/admin`, scrolls to "AI", sees
  per feature which provider and model run first and what follows as fallback,
  with each value labelled "DB override", "env" or "mặc định code".
- The administrator switches the usage window between "Hôm nay", "7 ngày" and
  "30 ngày" and reads tokens and estimated USD cost per feature and provider.
- The administrator changes `writing_grading` to prefer Gemini, saves, sees the
  canonical refetched configuration and an audit line naming them and the time;
  within the cache window new Writing grades try Gemini first and Claude second.
- The administrator reads the failure panel: counts per provider and feature,
  and the latest 50 failures/fallbacks with error type and Saigon time.
- A learner or instructor never sees the section; direct API calls return
  401/403.

## Requirements

- **FR-001:** For each routed feature key the admin models endpoint returns the effective provider order after availability rules (a missing `ANTHROPIC_API_KEY` removes Claude), the model each provider in that order will call (for `speaking_grading`, every orchestrator slot in order), the feature's existing provider and model, and for the preferred provider, the Claude model and the existing-provider model the source of the value: `db_override`, `env` or `code_default`.
- **FR-002:** The admin usage endpoint aggregates every `ai_usage_logs` row in the selected window — `today`, `7d` or `30d`, where windows start at 00:00 Asia/Saigon of the current day, 6 days earlier or 29 days earlier and end at request time — and returns calls, failed attempts, input, output, thinking, cache-read and cache-write tokens and estimated USD cost per feature, per provider and in total; cost comes from the stored ledger estimate or the `ai_pricing` catalog, unpriced and legacy rows are counted and flagged instead of shown as zero cost, rows without a feature are grouped as unattributed, and no row cap can truncate the totals silently.
- **FR-003:** A migration creates `ai_model_overrides` (one row per feature: preferred provider, Claude model, actor, time), an append-only `ai_model_override_audit` written by a database trigger with old and new values, actor and time, and `ai_provider_failures`; each table has row-level security enabled, no `anon`/`authenticated` privileges and no client policies, is written only by the backend service role, and the migration is idempotent and safe to re-apply.
- **FR-004:** `PATCH /admin/ai/models/{feature}` is restricted by the existing `require_admin` check; it accepts a preferred provider that is either Claude or the feature's existing provider, a Claude model from a server-side allowlist whose entries all exist in the `ai_pricing` catalog, or null for either value to inherit env/code defaults; any other feature, provider or model is rejected with 422 and nothing is written; a successful change records the acting admin in the audit trail and returns the refetched canonical configuration.
- **FR-005:** `ai_router` resolves each feature's preferred provider and Claude model with the precedence valid database override, then environment variable, then code default; a preferred provider is placed first and every other provider of the env/code-default effective order follows in its existing order as fallback, the feature's existing provider always remains in the chain, and for `speaking_grading` the Claude preference places the existing `anthropic_primary` slot before the existing orchestrator chain while the Gemini preference keeps that chain first, with the slot after it only when the env/code-default order includes Claude.
- **FR-006:** Request paths read overrides only from an in-process snapshot, never waiting on the database; the snapshot is refreshed in the background at least every 30–60 seconds (default 30) and immediately in the process that saved a change; when the read fails, times out, the table is missing or a stored value is outside the allowlist, the affected features use env/code defaults and grading, generation and audits proceed; the models endpoint reports the store state and the last successful refresh.
- **FR-007:** Each failed provider attempt at the routing layer is recorded best-effort, off the request path, in `ai_provider_failures`: Claude attempts made through `ai_router`, provider failures inside `ai_router.with_fallback`, existing-provider failures that hand over to Claude configured after them, and every non-success attempt of the Speaking grading orchestrator chain; a record holds only feature, provider, model, route slot, normalized error type (`timeout`, `rate_limit`, `overloaded`, `server_error`, `api_error`, `network`, `invalid_json`, `empty_response`, `missing_key`, `not_configured`, `unknown`), a short raw error code, outcome (`retry`, `fallback`, `final`) and time, and never prompt, output, message text, user or session identifiers; a failed write never affects the provider call.
- **FR-008:** The admin failures endpoint returns, for the same windows as FR-002, failure counts per provider and feature split by outcome and error type, plus the 50 most recent records newest first with UTC timestamps that the dashboard renders in Asia/Saigon.
- **FR-009:** The `/admin` dashboard shows an "AI" section with the models table and per-feature control, the usage panel with a today/7d/30d selector and the failure panel; each panel has loading, empty, success and error-with-retry states independent of the others, a save shows pending and then the canonical refetched state or a visible error without optimistic divergence, the store-unavailable state is visible, non-admins cannot reach it, and it is keyboard operable, responsive and legible in both themes.
- **FR-010:** The migration reaches staging before any dependent code merges and production through the advisory-locked runner before promotion; code deployed before the migration keeps env/code-default routing and shows a visible "migration not applied" state instead of failing, and removing all override rows restores today's behavior without a deploy.

## Acceptance scenarios

### Models in use with sources

- **Given** `AI_PROVIDER_ORDER_WRITING_GRADING` is unset, `AI_PROVIDER_ORDER`
  is set on Railway and no override row exists
- **When** the administrator opens `/admin`
- **Then** Writing shows Claude Sonnet 5.5 first and Gemini after it, the order
  is labelled `env` and the Claude model is labelled `env` or `code_default`
  according to whether `ANTHROPIC_MODEL_GRADING` is set.

### Prefer Gemini for one feature

- **Given** Writing prefers Claude by default
- **When** the administrator selects Gemini for `writing_grading` and saves
- **Then** the response shows Gemini first and Claude as fallback labelled
  `db_override`, an audit row names the administrator, and within 60 seconds
  new Writing grades try Gemini first on every backend instance.

### Invalid value

- **Given** an admin API client
- **When** it sends `anthropic_model: "claude-unknown"` or
  `preferred_provider: "openai"` for `course_writing`
- **Then** the response is 422, no override or audit row changes and routing is
  unchanged.

### Database unavailable

- **Given** an override prefers Gemini for Writing and the database read fails
- **When** the next refresh runs and a Writing grade starts
- **Then** Writing uses its env/code-default order, the grade completes, and the
  models panel shows the store as unavailable.

### Failure log

- **Given** Claude returns 429 for a course-writing batch with Claude first
- **When** the Gemini fallback serves the batch
- **Then** one `ai_provider_failures` row records `course_writing`, `anthropic`,
  the Claude model, `rate_limit`, outcome `fallback`, and no prompt or user data;
  the failure panel shows it with Saigon time.

### Non-admin

- **Given** a signed-in learner or instructor
- **When** they call any `/admin/ai/*` endpoint
- **Then** the response is 403 (401 without a token) and nothing is read or
  written.

## Edge cases

- `ANTHROPIC_API_KEY` blank while an override prefers Claude: Claude is removed
  from the effective order (as today) and the models panel says the key is
  missing.
- Two administrators save the same feature concurrently: last write wins, both
  changes are audited, and both screens refetch canonical state.
- An override row is edited by hand in SQL with a value outside the allowlist:
  the router ignores that field, the panel flags it as invalid, and the audit
  trigger still records the edit.
- A feature key not routed by `ai_router` cannot be written.
- Window boundaries at 23:59/00:00 Saigon, and rows logged before migration 286
  (no feature, no pricing version).
- An outage producing many failure rows: counts are aggregated in the database
  and the recent list is bounded to 50.
- The AI-0004 FR-005 revision (#1715/#1718, 2026-10-26) made Speaking inherit
  `AI_PROVIDER_ORDER` (Claude Sonnet 5.5 first) while production keeps
  `AI_PROVIDER_ORDER_SPEAKING_GRADING=gemini` until the §6 gate passes. The
  dashboard derives the Speaking chain from settings, so it shows whichever
  default is configured; a DB preference wins over that env pin (see Open
  questions).

## Success criteria

- An administrator can answer "what serves feature X and why" and "what did AI
  cost today/7d/30d per feature and provider" from `/admin` without SQL.
- A preference change takes effect on every instance within 60 seconds without a
  restart and is attributable to an administrator in the audit trail.
- No grading, generation or audit request fails or waits because the override
  store or failure log is unavailable.
- Zero prompt, output or learner identifiers in the new tables.
- With no override rows, routing is byte-for-byte the current behavior
  (regression tests unchanged).

## Open questions

- None blocking approval. Owner decisions recorded here for approval:
  - The Claude-model allowlist is `claude-sonnet-5-5` and `claude-haiku-5-5`
    (both priced in `ai_pricing`); adding a model is a code change.
  - `speaking_grading` is controllable like the other features. Because a DB
    preference wins over env, selecting Claude for Speaking in production
    overrides the `AI_PROVIDER_ORDER_SPEAKING_GRADING=gemini` pin that the
    AI-0004 FR-005 revision keeps until its constitution §6 gold-set gate
    passes. That selection is an owner decision bound by the §6 gate; this
    spec only provides the switch.

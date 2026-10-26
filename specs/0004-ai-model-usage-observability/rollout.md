# Rollout and rollback

## Preconditions

- AI-0004 is approved on staging before implementation commits are rebased for
  merge.
- Provider credentials remain environment-scoped and are never copied into source,
  logs, specs, tests, or review artifacts.
- Migration 284 is additive and validated against the current `ai_usage_logs` shape.
- The configured provider accounts expose every selected model in the deployment
  region before the default is promoted.

## Staging

- Rebase the implementation branch onto the exact staging revision containing the
  approved spec and require all repository workflows to pass.
- Apply migration 284 before deploying backend code; verify all new columns and the
  non-partial unique `usage_event_id` index through schema queries.
- Ensure `SPEAKING_GRADING_MODEL` is unset or explicitly `gemini-3.8-flash`; an old
  environment override takes precedence over the code default.
- FR-005 revision (2026-10-26): confirm that `AI_PROVIDER_ORDER_SPEAKING_GRADING`
  is unset, empty or `anthropic`, that `AI_PROVIDER_ORDER` keeps `anthropic`
  before `gemini`, and that `ANTHROPIC_API_KEY` is set. An explicit `gemini`
  value keeps the old Gemini-primary chain. Grade one test-mode and one
  practice-mode Speaking response and confirm `speaking_grading` ledger rows
  with `model=claude-sonnet-5-5`. Then force a Claude failure (for example
  a temporarily blank key on a QA instance) and confirm that Gemini 3.8 Flash
  serves the grade with the same result shape.
- Run representative Speaking, Writing, Listening audit, course writing, STT, TTS,
  ElevenLabs, and Azure calls. Verify success/error rows, actual model, user/resource
  attribution, and one row per attempt.
- Compare dashboard totals with sampled provider responses and billing data. Require
  legacy/truncation warnings to be false before production promotion.
- Monitor 24–48 hours for schema/JSON failure, retry/fallback rate, p50/p95 latency,
  cost per feature, rating changes, regrade requests, and unpriced calls.

## Production

- Require explicit owner authorization after staging evidence is complete.
- Do not promote the Claude Sonnet 5.5 Speaking default until the FR-005
  constitution §6 gold-set report (spec.md, "FR-005 revision") passes and is
  recorded in `verification.md`. If the report is missing or failing, promote
  only with `AI_PROVIDER_ORDER_SPEAKING_GRADING=gemini` set on production.
- Apply and verify migration 284 before promoting the application release.
- Confirm the production environment model setting and run bounded smoke calls after
  deployment without submitting synthetic learner content to real users.
- Compare first-hour ledger totals and provider dashboards, then continue daily
  quality/cost review during the initial feedback period.

## Rollback and repair

- For a Speaking quality or reliability regression on the Claude primary, set
  `AI_PROVIDER_ORDER_SPEAKING_GRADING=gemini` and restart backend instances.
  Gemini 3.8 Flash then serves first, followed by Haiku 4.5 and Sonnet 5.
  For a Gemini 3.8 regression, additionally set
  `SPEAKING_GRADING_MODEL=gemini-3.5-flash`. Confirm the next usage event
  records the restored model before declaring rollback complete.
- For broader application regressions, deploy the previous application SHA while
  retaining migration 284 and its history. Do not drop columns or delete usage rows.
- If a ledger writer is faulty, disable or revert the writer path without retrying
  already completed provider calls; reconcile gaps from provider billing where
  possible and label the affected interval as incomplete.
- Repair duplicate or incorrectly priced estimates only through auditable migration
  or reconciliation tooling; never rewrite provider invoice truth.

## Observability

- Watch provider/model/feature status counts, retry/fallback rate, missing usage,
  unpriced resources, duplicate conflicts, latency p50/p95, and daily estimated cost.
- For the Speaking primary (Claude Sonnet 5.5 after the FR-005 revision), watch
  rating/note trends, admin regrades, repeated schema failures, the share of
  grades served by a fallback (`[orchestrator] served_by=`), Anthropic 429 or
  spend-limit errors, and reports of band or grammar false positives.
  Repeated systematic failures or a material quality regression trigger the
  model rollback.
- Azure estimates remain explicitly unpriced until regional invoice rates are
  reconciled.
- Product owner owns grading-quality go/no-go; platform operator owns migration,
  provider availability, cost reconciliation, and rollback execution.

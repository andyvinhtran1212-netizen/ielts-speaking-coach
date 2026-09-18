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
- Run representative Speaking, Writing, Listening audit, course writing, STT, TTS,
  ElevenLabs, and Azure calls. Verify success/error rows, actual model, user/resource
  attribution, and one row per attempt.
- Compare dashboard totals with sampled provider responses and billing data. Require
  legacy/truncation warnings to be false before production promotion.
- Monitor 24–48 hours for schema/JSON failure, retry/fallback rate, p50/p95 latency,
  cost per feature, rating changes, regrade requests, and unpriced calls.

## Production

- Require explicit owner authorization after staging evidence is complete.
- Apply and verify migration 284 before promoting the application release.
- Confirm the production environment model setting and run bounded smoke calls after
  deployment without submitting synthetic learner content to real users.
- Compare first-hour ledger totals and provider dashboards, then continue daily
  quality/cost review during the initial feedback period.

## Rollback and repair

- For a Speaking quality or reliability regression, set
  `SPEAKING_GRADING_MODEL=gemini-3.5-flash` and restart backend instances. Confirm the
  next usage event records the restored model before declaring rollback complete.
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
- For Speaking 3.8, watch rating/note trends, admin regrades, repeated schema failures,
  and reports of band or grammar false positives. Repeated systematic failures or a
  material quality regression trigger the model rollback.
- Azure estimates remain explicitly unpriced until regional invoice rates are
  reconciled.
- Product owner owns grading-quality go/no-go; platform operator owns migration,
  provider availability, cost reconciliation, and rollback execution.

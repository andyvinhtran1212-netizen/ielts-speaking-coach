# AI provider routing (Anthropic primary)

Current runbook for `backend/services/ai_router.py`. Text/JSON LLM features try
Claude first and fall back **automatically** to the feature's existing provider
and model, with that path's behaviour unchanged. The fallback runs when Claude:

- returns an API error, including 429 rate limits and 5xx/529 overload
- times out or has a network failure
- refuses, truncates (`max_tokens`), or returns an empty answer
- returns output that the feature's existing parser/validator rejects

It also runs when `ANTHROPIC_API_KEY` is blank.

Speech-to-text (Whisper), text-to-speech (OpenAI/ElevenLabs/Kokoro) and Azure
pronunciation assessment have no Claude equivalent, so they are not routed.

## Routed features

| Feature key | Code path | Claude model (default) | Fallback (unchanged) |
| --- | --- | --- | --- |
| `speaking_grading` | `grading_orchestrator` slot `anthropic_primary` | `claude-sonnet-5-5` | `SPEAKING_GRADING_MODEL` (Gemini 3.8 Flash), then Haiku 4.5, then Sonnet 5. See below |
| `writing_grading` | `gemini_writing_grader._call_with_retry` (Standard and Instructor grading, Deep pass 1) | `claude-sonnet-5-5` | Same Gemini model and retry loop |
| `course_writing` | `course_writing_grader._grade_batch` | `claude-haiku-5-5` | `COURSE_WRITING_MODEL` |
| `advanced_vocab_rewrite` | `advanced_vocab_rewrite_grader.grade_rewrites` | `claude-haiku-5-5` | `ADVANCED_VOCAB_REWRITE_MODEL` |
| `question_generation` | `gemini._call_gemini` (Part 1/2/3) | `claude-haiku-5-5` | `gemini-2.5-flash` |
| `listening_audit` | `routers/listening._audit_provider` | `claude-haiku-5-5` | `LISTENING_AUDIT_MODEL` |

Off-topic judge, D1 questions, Listening gist and Speaking sample regeneration
already use Claude as their primary model and are unchanged.

These paths stay on Gemini in this revision:

- Deep passes 2/3, because their time budgets sit inside the 600 s Deep reaper
- Task 1 chart-fact extraction
- Admin D1 pool generation and vocabulary enrichment, because they are synchronous
- Offline content scripts

## Admin overrides (AIOPS-0024)

The "AI" section on `/admin` shows, per feature key above, the effective order
and model of every provider, each labelled `db_override`, `env` or
`code_default` (shown as DB override / env / mặc định code). An administrator can set a preferred provider (Claude or the
feature's existing provider) and a Claude model (allowlist:
`claude-sonnet-5-5`, `claude-haiku-5-5`). They are stored in
`ai_model_overrides` (migration 322); every change is audited by trigger in
`ai_model_override_audit`.

Precedence: **DB override > environment variable > code default**. A
preferred provider is placed first and the env/code-default order follows as
fallback; a preference never removes a provider. A blank `ANTHROPIC_API_KEY`
still removes Claude. For `speaking_grading` the Claude preference puts the
`anthropic_primary` slot before the existing orchestrator chain and the Gemini
preference puts that chain first (the slot follows it only when the env/code
order includes Claude). A DB preference wins over the production pin
`AI_PROVIDER_ORDER_SPEAKING_GRADING=gemini`, so choosing Claude for Speaking in
production is bound by the same constitution §6 gate described below.
`listening_audit` is controllable only while `LISTENING_AUDIT_MODEL` is a Gemini
model; any other model is called directly (not through the router), so the
dashboard shows it as `direct` and refuses an override for it.

Each backend process reads the table into memory at startup and then every
`AI_MODEL_OVERRIDE_TTL_SECONDS` (default 30, clamped to 30–60) in a background
task. Request paths only read the in-memory copy. If the read fails, times
out, the table is missing, a stored value is outside the allowlist, or the
copy is older than three refresh windows, the affected features use the
env/code defaults; the dashboard shows the store state.

To return to env/code defaults: choose "Mặc định" for both selects and save,
or `DELETE FROM ai_model_overrides;` (also audited). Applies within one refresh
window, no restart.

### Failure log

`ai_provider_failures` records each failed provider attempt at the routing
layer: Claude attempts through `call_anthropic`, provider failures inside
`with_fallback`, Gemini failures that hand over to a Claude fallback configured
after them, and every non-success attempt of the Speaking orchestrator chain.
Rows hold only feature, provider, model, slot, attempt, normalized error type
(`timeout`, `rate_limit`, `overloaded`, `server_error`, `api_error`,
`network`, `invalid_json`, `empty_response`, `missing_key`, `not_configured`,
`unknown`), a short raw error code and outcome (`retry`, `fallback`, `final`) —
no prompt, output, message text, user or session id. Token and cost figures
on the dashboard come from `ai_usage_logs`, not from this table.

## Speaking grading

AI-0004 FR-005 (revised 2026-10-26) makes Claude Sonnet 5.5 the default primary
Speaking grader for practice and test modes. Every earlier option stays behind
it as an automatic fallback. `AI_PROVIDER_ORDER_SPEAKING_GRADING` is empty by
default, so it inherits `AI_PROVIDER_ORDER`, and the order is:

| Slot | Model | Why it is here |
| --- | --- | --- |
| `anthropic_primary` | `claude-sonnet-5-5` (`ANTHROPIC_MODEL_SPEAKING_GRADING` / `ANTHROPIC_MODEL_GRADING`) | Primary |
| `grading_primary` | `SPEAKING_GRADING_MODEL`, default `gemini-3.8-flash` | Different vendor, so it is independent of Anthropic outages and limits |
| `claude_haiku` | `claude-haiku-4-5-20251001` | Unchanged fallback |
| `claude_sonnet` | `claude-sonnet-5` | Unchanged last resort |

- The Claude slot gets one attempt, with no retry. Its time is added to the
  orchestrator's total budget, so a 429 or timeout does not shorten the
  existing chain.
- When an answer fails JSON validation, the single corrective retry goes to the
  provider *after* the one that answered. A malformed Sonnet 5.5 answer is
  therefore retried on Gemini 3.8 Flash, never on Sonnet 5.5 again.
- A blank `ANTHROPIC_API_KEY` drops every Claude slot, and Gemini 3.8 Flash
  grades alone.
- The static Speaking system prompt (about 3k tokens) is sent with
  `cache_control: ephemeral`. Sonnet 5.5 caches prefixes from 512 tokens, so
  repeat grades read it from cache. Haiku 4.5 needs 4096 tokens, so it does
  not cache this prompt; that is unchanged from before.
- The learner result JSON is validated by the same `_parse_and_validate` /
  `_parse_and_validate_practice` and post-processing whichever provider
  serves, so its schema is unchanged.

To restore the Gemini-primary chain
(`grading_primary → claude_haiku → claude_sonnet`), set
`AI_PROVIDER_ORDER_SPEAKING_GRADING=gemini` and restart. Setting
`gemini,anthropic` puts Claude last instead.

**Production gate:** the Claude default must not serve production learners
until the constitution §6 Speaking gold-set comparison against the Gemini 3.8
Flash baseline passes. The gate and its thresholds are in
`specs/0004-ai-model-usage-observability/spec.md` ("FR-005 revision"). Until
then, production keeps `AI_PROVIDER_ORDER_SPEAKING_GRADING=gemini`.

## Environment variables

All of these are FastAPI backend settings (`backend/config.py`). Set them on
the Railway backend service per environment: staging first, then production
only through the release flow.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | empty | Secret. Blank disables every Claude attempt, so all features use their existing provider |
| `AI_PROVIDER_ORDER` | `anthropic,openai,gemini` | Global order; unknown names are ignored. The feature's existing provider is always kept as the last fallback |
| `AI_PROVIDER_ORDER_SPEAKING_GRADING` | empty, so the global order applies (Claude first) | `gemini` restores the Gemini-primary chain; see above |
| `AI_PROVIDER_ORDER_WRITING_GRADING` | empty, so the global order applies | Per-feature override |
| `AI_PROVIDER_ORDER_COURSE_WRITING` | empty | Per-feature override |
| `AI_PROVIDER_ORDER_ADVANCED_VOCAB_REWRITE` | empty | Per-feature override |
| `AI_PROVIDER_ORDER_QUESTION_GENERATION` | empty | Per-feature override |
| `AI_PROVIDER_ORDER_LISTENING_AUDIT` | empty | Per-feature override |
| `ANTHROPIC_MODEL_GRADING` | `claude-sonnet-5-5` | Model for grading features |
| `ANTHROPIC_MODEL_FAST` | `claude-haiku-5-5` | Model for short structured tasks |
| `ANTHROPIC_MODEL_<FEATURE>` | empty | Per-feature model, for example `ANTHROPIC_MODEL_WRITING_GRADING` |
| `ANTHROPIC_TIMEOUT_SECONDS` | `60` | Default per-attempt bound. Writing uses 120 s; course writing uses 30 s |
| `GEMINI_API_KEY`, `OPENAI_API_KEY` | unchanged | Still required for the fallbacks, STT and TTS |

Other platforms need nothing new:

- **Vercel:** nothing. The Next.js frontend makes no provider calls.
- **GitHub Actions:** nothing. CI tests mock every provider, and the suite
  refuses outbound network.
- **Supabase edge functions:** none exist.

Putting `anthropic` after the existing provider, for example `gemini,anthropic`,
reverses the roles. The existing path runs first, unchanged, and Claude runs
only when that path fails: an exception, a failed batch, or a failed request.

To roll back one feature, set `AI_PROVIDER_ORDER_<FEATURE>=gemini` and restart.
To roll back everything, set `AI_PROVIDER_ORDER=gemini,openai` or blank
`ANTHROPIC_API_KEY`. No schema change or migration is involved.

## Request shape and cost controls

- The static system prompt or rubric is sent as a `cache_control: ephemeral`
  block. Volatile content (transcript, essay, payload) goes in the user turn.
- `claude-haiku-5-5` runs with thinking disabled. `claude-sonnet-5-5` uses
  `thinking: between_tools`, because it rejects `disabled`. Neither model
  receives `temperature`.
- `max_tokens` is set per feature, with SDK retries disabled. On a 429 the
  request goes straight to the fallback instead of waiting.

## Verifying on staging

Every attempt writes one `ai_usage_logs` row. Claude-primary rows carry
`metadata.route = "anthropic_primary"`. The backend log also shows
`[ai_router] feature=<key> served_by=<provider>`, or `... failed (<code>) —
falling back to gemini`, and `[orchestrator] served_by=...` for Speaking.

```sql
select feature, service, model, status, error_code,
       metadata->>'route' as route, count(*)
from ai_usage_logs
where created_at > now() - interval '1 hour'
group by 1, 2, 3, 4, 5, 6
order by 1, 7 desc;
```

Writing results persist the serving model in `writing_feedback.model_used`.
Course writing and vocabulary rewrite persist it in their stored `model` field.
Admin cost views read the ledger, so Claude-served Writing is counted once.

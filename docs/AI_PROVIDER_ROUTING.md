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
| `speaking_grading` | `grading_orchestrator` slot `anthropic_primary` | `claude-sonnet-5-5` | `SPEAKING_GRADING_MODEL` (Gemini 3.8 Flash), then Haiku 4.5, then Sonnet 5. **Opt-in**: see below |
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

## Speaking grading opt-in

Approved requirement AI-0004 FR-005 makes Gemini 3.8 Flash the default primary
Speaking grader. `AI_PROVIDER_ORDER_SPEAKING_GRADING` therefore defaults to
`gemini`.

After that requirement is revised and approved, set the variable to `anthropic`
and restart the backend. The order then becomes
`anthropic_primary → grading_primary → claude_haiku → claude_sonnet`.

The Claude slot gets one attempt, with no retry. Its time is added to the
orchestrator's total budget, so a 429 or timeout does not shorten the existing
chain.

When Claude's answer fails JSON validation, the existing retry path asks the
next provider instead of retrying Claude.

## Environment variables

All of these are FastAPI backend settings (`backend/config.py`). Set them on
the Railway backend service per environment: staging first, then production
only through the release flow.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | empty | Secret. Blank disables every Claude attempt, so all features use their existing provider |
| `AI_PROVIDER_ORDER` | `anthropic,openai,gemini` | Global order; unknown names are ignored. The feature's existing provider is always kept as the last fallback |
| `AI_PROVIDER_ORDER_SPEAKING_GRADING` | `gemini` | See the opt-in above |
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

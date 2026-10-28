# Research: paid AI call sites, fallbacks and fail-open paths

Surveyed on `staging` @ `33b171454` (2026-10-27). The survey is read-only:
no provider was called, no database was read and no environment value was
printed. Paths are relative to `backend/` unless shown otherwise. Line
numbers are from that commit.

## 1. Inventory of paid provider calls

"SDK retries=2" means the client is built without `max_retries`, so the
SDK's hidden default of 2 retries applies. Each hidden retry is an
unreserved billable request. Only `services/ai_router.py:223` and
`services/grading_providers/claude.py:71` set `max_retries=0` today.

| Call site | Provider / model | Ledger `feature` | Trigger | Who | Fallback / retry today | Per-user cap today |
| --- | --- | --- | --- | --- | --- | --- |
| `services/ai_router.py:348` `call_anthropic` | Anthropic, `ANTHROPIC_MODEL_GRADING`/`_FAST` (`config.py:85-86`) | caller's | shared helper | — | `with_fallback` `ai_router.py:412-448` moves to the next provider on **any** exception. The order comes from `effective_order` `:101-117`, with `AI_PROVIDER_ORDER` `config.py:71`. Retries=0. | — |
| `services/grading_providers/claude.py:113` | Anthropic: Sonnet 5.5 primary, Haiku 4.5, Sonnet 5 (`grading_orchestrator.py:276,285,306-314`) | `speaking_grading`, `off_topic_judge` | `POST /sessions/{id}/responses` (`routers/grading.py:472`); admin regrade `routers/admin.py:4373,4483` | learner, admin | orchestrator chain, §2. Retries=0. | `MAX_GRADINGS_PER_USER_PER_DAY` (learner route only; admin regrade has none) |
| `services/grading_providers/gemini.py:134` | Gemini `SPEAKING_GRADING_MODEL` (`config.py:111`) | as above | as above | learner, admin | orchestrator. An unknown `GoogleAPIError` counts as retryable (`:165-175`). | as above |
| `services/claude_grader.py:1450` | Haiku 4.5; client `:417` with SDK retries=2 | `speaking_grading` / `regenerate_grounded_answer` | inside Speaking grading | learner, admin | none; returns None on failure | grading cap |
| `services/off_topic_judge.py:287` | orchestrator: Haiku → Gemini → Sonnet (`grading_orchestrator.py:44-48`) | `off_topic_judge` | runs in parallel inside grading (`routers/grading.py:799`) | learner | chain | grading cap |
| `services/whisper.py:240` | OpenAI `WHISPER_STT_MODEL` (`config.py:142`); client `:120` with SDK retries=2 | `speaking_stt` | `routers/grading.py:600`; admin regrade `routers/admin.py:4303` | learner, admin | none | grading cap |
| `services/azure_pronunciation.py:369` | Azure Speech pronunciation assessment (**unpriced** in `ai_pricing.py` today; tier S0, §7) | `pronunciation` | `routers/grading.py:314`; `POST /sessions/{id}/pronunciation/full` (`routers/pronunciation.py:213`); course pronunciation submit (`routers/course_pronunciation.py:36` → `services/course_pronunciation.py:351`) | learner | none | grading cap on the first route only |
| `services/tts_audio.py:62` | OpenAI `tts-1`, SDK retries=2 | `question_tts` | `POST /tts` (`routers/tts.py:171`) | learner | none (502) | `TTS_DAILY_LIMIT_PER_USER`, `TTS_IP_MAX_PER_MINUTE` |
| `services/tts_audio.py:181,208` | OpenAI `tts-1` / ElevenLabs | `speaking_question_tts`, `vocab_tts` | admin render-audio (`routers/admin.py:3227` → `services/speaking_question_audio.py:187`); scripts | admin, script | none; skipped when the content hash already exists | none |
| `services/listening_renderer.py:103` (`:160` unreachable) | ElevenLabs `eleven_multilingual_v2` | `listening_tts` | `POST /admin/listening/tests/{id}/audio/assemble` (`routers/listening.py:4457` → `services/listening_audio.py:248`) | admin | none | none |
| `services/listening_gist_grader.py:192` | Anthropic `LISTENING_GIST_MODEL` (`config.py:229`); sync client `:94` with SDK retries=2 | `listening_gist` | `POST /api/listening/attempts` mode=gist (`routers/listening.py:841,888`) | learner | 3 attempts with 429 backoff (`services/d1_question_generator.py:288`), then a keyword fallback | `LISTENING_GIST_DAILY_LIMIT_PER_USER`, `LISTENING_GIST_MAX_PER_MINUTE` |
| `routers/listening.py:3880` | Claude fast → `LISTENING_AUDIT_MODEL` (Gemini) | `listening_audit` | `POST /admin/listening/tests/{id}/audit/run` (`:3933,3959`) | admin, script | `with_fallback` `:3894` | none |
| `services/gemini.py:150,186` | Claude fast → `gemini-2.5-flash` | `question_generation` | `POST /sessions/{id}/questions/generate` (`routers/questions.py:243`), `/sessions/cuecard/generate` (`:634`); admin topic generate/rotate/bulk (`routers/admin.py:3306,3329,3342`) | learner, admin | `with_fallback` `gemini.py:162` | none |
| `services/gemini_writing_grader.py:1006` (Gemini), `:1169` (Claude) | Claude grading; Gemini level-aware; `WRITING_FALLBACK_MODEL` | `writing_grading` | background job, §3 | learner, instructor, admin | Claude + 1 repair (`:1119-1219`), then Gemini `MAX_RETRIES=3` (`:81,1001-1117`), plus job retries | **none** |
| `services/writing_prompt_analysis.py:184` | Gemini `WRITING_ANALYSIS_MODEL` (`config.py:193`) | *unset* | background job on admin prompt create/update/reanalyze (`routers/admin_writing_prompts.py:212,438,457`) | admin | Gemini ×3 | none |
| `services/course_writing_grader.py:258,370` | Claude fast → `COURSE_WRITING_MODEL` | `course_writing` | `POST /api/quiz/course/writing` (`routers/quiz.py:234`); script `regrade_failed_course_writing.py` | learner, script | custom order (`:320-348`) and batch-split recursion (`:442+`) | none |
| `services/advanced_vocab_rewrite_grader.py:175,206` | Claude fast → `ADVANCED_VOCAB_REWRITE_MODEL` | `advanced_vocab_rewrite` | `POST /api/advanced-vocab/controlled-rewrite/complete` (`routers/advanced_vocab.py:168`) | learner | custom order (`:156-166`) | none |
| `services/d1_question_generator.py:479,558` | Haiku `D1_QUESTION_MODEL` (sync, SDK retries=2) → `D1_GENERATION_MODEL` | `d1_question_generation` | background job after vocabulary confirm (`routers/vocabulary_bank.py:464,510,565,605`) | learner | `_call_with_retry` ×3 per provider | none |
| `services/d1_content_gen.py:170` | `gemini-2.5-flash` | `d1_content_generation` | `POST /admin/exercises/d1/generate-batch` (`routers/exercises.py:1530`) | admin | per chunk | none |
| `services/vocab_enrichment.py:226` | `gemini-2.5-flash` | `vocab_enrichment` | `POST /admin/vocab/backfill-enrichment` (`routers/admin.py:4961`) | admin | per chunk | none |
| Operator scripts | various | — | `audit_listening`, `backfill_d1_questions(_mcq)`, `backfill_quiz_why_wrong`, `gen_quiz_why_wrong`, `gen_reading_solutions`, `gen_d1_distractor_review`, `calibration_harness`/`multimodel_router`, `pregen_course_question_audio`, `pregen_vocab_audio`, `setup_course_pronunciation`, `regrade_failed_course_writing` (under `backend/scripts/`) | script | — | — |

The following have no live caller. The FR-001 gate must still cover them
or they must be deleted, which is a separate `small` change:

- `claude_grader.py:972` `_call_claude`;
- `whisper.py:156` `transcribe_audio`;
- `vocab_extractor.py:113`, because `_run_vocab_extraction` is no longer
  scheduled (`routers/grading.py:1210-1214`);
- `listening_renderer.py:160`;
- `vocab_enrichment` from `grading.py:1848`.

`services/grammar_check.py` makes no paid call. It uses local LanguageTool,
and the online fallback is disabled (`:141-148`).
`routers/admin_class_assignments.py` imports a provider helper only for
lookups.

## 2. Fallback paths that would move spend across providers

- **`ai_router.with_fallback`** (`ai_router.py:412-448`) catches every
  exception except `CancelledError` and calls the next provider.
  `call_anthropic` maps `RateLimitError` to `rate_limited` (`:353-356`),
  and maps every other `APIStatusError`, including **402 `billing_error`**,
  to its status code (`:361-364`). All of these fall back.
- **The Speaking orchestrator.** The chain is built by
  `grading_provider_order` (`grading_orchestrator.py:69-78`). With the
  defaults it is `anthropic_primary` (Sonnet 5.5) → `grading_primary`
  (`gemini-3.8-flash`) → `claude_haiku` → `claude_sonnet`.
  - Retryable errors (429/5xx/529, timeout, network; `claude.py:36,127-154`)
    get one retry on the same provider (`RETRY_ATTEMPTS_PER_PROVIDER=1`,
    `grading_orchestrator.py:83,209-233`) and then move to the next rung.
  - Non-retryable errors (400/401/403/404/422, refusal, empty body;
    `claude.py:37,131-196`) move to the next rung immediately.
  - A JSON-validation failure runs the chain again, starting after the
    provider that answered (`claude_grader.py:577-583`).
  - **So an exhausted Anthropic account falls to Gemini, then back to two
    more Anthropic rungs.**
- **Custom chains.** Course Writing (`course_writing_grader.py:320-348`),
  Advanced Vocabulary (`advanced_vocab_rewrite_grader.py:156-166`), D1
  generation (`d1_question_generator.py:288`) and the Writing grader
  (`gemini_writing_grader.py:1001-1219`) each retry and switch providers on
  their own.
- **Writing job retries.** `WRITING_GRADING_MAX_ATTEMPTS=3`
  (`config.py:321`, read at `essay_service.py:839,852`). Failure requeues
  through `_schedule_requeue` with backoff `3s·2^(n-1)`
  (`essay_service.py:118,209-271`). The last attempt switches model
  (`:121-139`). The worst case is about 2 Claude calls and 3 Gemini calls
  per attempt, times 3 attempts.

## 3. Persistence order relevant to "save first"

- **Speaking** (`routers/grading.py:472-1160`): the steps run in this
  order:
  - auth, session, entitlement (`:487-517`);
  - quota (`:538-541` for first submits, `:583-586` for retry-safe
    submits);
  - Whisper (`:592-607`);
  - storage upload (`:609-645`; a retry-safe submit without an upload
    returns 503 `{"code": "recording_storage_unavailable"}`, `:642-645`).
    That detail carries `code`, not `error_code`, so the 5xx sanitizer
    replaces it with `internal_error`. FR-011 moves it to `error_code` for the
    deferred path;
  - grader, judge and pronunciation in parallel (`:745-830`);
  - the `responses` row (`:1010-1118`).

  `responses.grading_status` and `stt_status` are TEXT with default
  `'completed'` and no CHECK. The values in use are `completed` and
  `failed` (`migrations/003_admin_session_tracking.sql:16-17`). Speaking
  has no queue. Failed rows are regraded by admins
  (`routers/admin.py:4483,4540`).
- **Writing** (`routers/writing_student.py:1555`): the essay is inserted as
  `pending` (`:1723` → `services/essay_service.py:375`). Then `writing_jobs`
  gets a `queued` row (`essay_service.py:424-430`). Then grading runs in an
  in-process `BackgroundTasks` job (`writing_student.py:1864-1867` →
  `essay_service.py:983`).
  - The status CHECKs are `writing_essays.status`
    (`migrations/033_writing_coach_tables.sql:104-111`) and
    `writing_jobs.status IN ('queued','running','completed','failed')`
    (`:194`).
  - The in-process reaper (`main.py:706-725` →
    `essay_service.py:1245-1340`) requeues `queued` and `running` jobs
    whose essay is `pending` or `grading`.
  - Other grading triggers: `routers/admin_writing.py:239,310,940`,
    `routers/instructor.py:494`, `routers/mock_exams.py:227`,
    `routers/admin_mock_exams.py:327,495`.
- **Session aggregate.** `PATCH /sessions/{id}/complete`
  (`routers/sessions.py:2057`) already recomputes when the session is
  completed but `overall_band` is null (`:2094-2105`).

## 4. Fail-open paths named in the brief

| Path | Current behaviour | Spec |
| --- | --- | --- |
| `services/rate_limit.py:237-250` `count_gradings_today` | DB error → 0 | FR-006: refuse (`budget_unavailable`) |
| `services/rate_limit.py:253-258` | `daily_limit <= 0` disables the cap | FR-006: `config_invalid` |
| `services/rate_limit.py:279-284` `record_grading_attempt` | best-effort insert | Superseded for cost by FR-002. Kept as a per-user counter only. |
| `services/rate_limit.py:55-78` exercise counter | DB error → 0 | Unchanged: these exercises make no paid AI call |
| `routers/tts.py:109-122` daily TTS count | DB error → 0; counts ledger rows written in the background, so concurrent requests overshoot | FR-006 plus FR-002 (the reservation bounds cost) |
| `routers/tts.py:71-98`, `routers/listening.py:1130-1184` minute windows | per worker, in memory; `<= 0` disables | FR-006: `<= 0` means `config_invalid`. Distributed limiting is a non-goal. |
| `routers/listening.py:1125-1138` gist daily count | DB error → 0 | FR-006 |
| `services/ai_usage_logger.py:22-37,421-447` | ledger writes best-effort, off the request path | Kept (AI-0004 FR-002). Budget accounting moves to the new tables (FR-005). |
| `services/runtime_flags.py:52-66` | read error → caller's default | FR-006 for flags that gate paid AI. FR-007 env kill switch independent of the DB. |
| `services/ai_router.py:412-448` and the orchestrator | fallback on any error, including billing | FR-008/FR-009 |

## 5. Existing pieces to reuse

- `services/ai_pricing.py`: the effective-dated token and unit price
  catalog. It has no Azure row yet; T001 adds the S0 row (§7).
- `ai_usage_logs`, idempotent through `usage_event_id`
  (`migrations/286_ai_usage_ledger.sql:21-28`). The reservation id becomes
  the `usage_event_id` prefix, so settlement and ledger rows join.
- `services/errors.py:61-78` `safe_detail`: a 5xx dict detail with
  `error_code` passes to clients.
- The frontend Speaking classifier
  (`frontend/public/js/speaking-submission-controller.mjs:95-158`) treats an
  unmapped 5xx as `ambiguous_commit` and reads back. The new 503 needs an
  explicit branch before that.
- Practice question TTS already falls back to browser speech when `/tts`
  fails (`frontend/public/js/practice.js:2846-2868`).
- ADMINAAL2-0032 (sibling draft, branch `q/15-spec-admin-aal2`) proposes
  `OWNER_ALERT_EMAILS`, `services/owner_alerts.py` (an HTTPS email API) and
  a 5-minute Railway cron. Its `owner_alert_outbox.audit_id` is a required
  reference to `staff_security_audit`, so budget alerts cannot reuse that
  table. They share the email transport and recipient variable instead.
- AIOPS-0024 (draft #1716) owns the model and provider preference and the
  `ai_provider_failures` log. A budget refusal is not a provider failure.
  The FR-007 log of that spec should record it as outcome `final` with the
  error type `budget` only if 0024 is amended. Otherwise budget refusals
  stay out of that table.

## 6. Provider spend-limit signals (for FR-009 fixtures)

- **Anthropic:** HTTP 402, error type `billing_error` ("billing or payment
  problem", non-retryable). 429 `rate_limit_error` and 529
  `overloaded_error` are transient. The Anthropic Python SDK exposes
  `.type` on `APIStatusError`. The exact error that a reached Console
  workspace spend limit returns must be captured on staging, or from
  provider docs, as a fixture in T003. Until it is captured, only 402 is
  classified.
- **OpenAI:** 429 with error code `insufficient_quota` is a budget signal;
  other 429s are transient.
- **Gemini and ElevenLabs:** the billing and quota-exhausted signals are
  captured as fixtures in T003. An unclassified error stays transient. That
  is safe because the app's own caps still bound it.

## 7. Azure Speech pricing tier: S0 (owner decision, 2026-10-28 16:26)

Vinh confirmed that the Azure Speech resource is on the **S0** tier
(standard, paid). Azure cost estimation and reservation sizing use S0
pricing. The free F0 tier is not assumed anywhere, and there is no longer a
caveat that Speaking is graded without P until the tier is known.

- **What is billed.** `services/azure_pronunciation.py` calls the
  real-time REST endpoint (`{region}.stt.speech.microsoft.com`) with
  Pronunciation Assessment enabled. Prosody is requested for `en-US`,
  except for course pronunciation (`services/course_pronunciation.py:358`,
  `enable_prosody=False`). S0 bills real-time speech to text per hour of
  audio sent, in one-second increments, and Pronunciation Assessment as an
  add-on per hour of audio per feature.
- **Catalog row (T001).** One effective-dated `ai_pricing` unit row for
  `azure` pronunciation, priced per audio second. It is the S0 real-time
  speech-to-text rate plus the Pronunciation Assessment add-on rate for the
  resource's region, copied from the Azure Speech price page on the day
  T001 lands. If that page bills prosody as a separate add-on feature, the
  row for prosody-enabled calls includes it as well. The `pricing_version`
  names the S0 tier and the source date.
- **Working figures for sizing.** These come from the public US list price
  and are not a decided value, because the T001 row is authoritative. S0
  real-time speech to text is about $1.00 per audio hour, and the
  Pronunciation Assessment add-on about $0.30 per audio hour per feature.
  That gives about $1.30 per hour, or $1.60 if prosody counts as a second
  feature.
- **Reservation sizing.** FR-004 reserves at `MAX_AUDIO_DURATION_SECONDS`
  (300 s), so one Azure line costs about $0.11 at $1.30 per hour, or $0.13
  at $1.60. Settlement uses the real audio duration (`audio_seconds`), so a
  one-minute answer settles at about $0.02. With the $1.33 daily cap, about
  10–12 maximum-length estimates fit open at once, and about 50–60
  one-minute answers settle in a day. The $20 monthly cap covers about
  12.5–15 audio hours. The Full Test `POST /sessions/{id}/pronunciation/full`
  route assesses up to three samples, one per part, and reserves each
  sample as its own Azure line.
- **Spend-limit signal.** An S0 resource has no free-quota exhaustion
  response. FR-009 classifies only an Azure spend or quota refusal that a
  T003 fixture has captured, and every other error stays transient under
  the app's own cap.

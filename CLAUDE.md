# IELTS Speaking Coach — Project Guide for Claude

@AGENTS.md

Read `AGENTS.md` for the shared working agreement and domain invariants; it is
imported above and is the only home of the conventions this file points to.
`docs/AGENT_WORKFLOW.md` covers worktrees, authorization, verification and
completion evidence; this file provides code navigation only. Tool-specific
guidance follows that agreement.

## What this project is

IELTS Speaking Coach **began** as a Speaking practice app and is now a
comprehensive IELTS-prep platform covering Speaking, Writing, Reading, and
Listening. The production frontend is Next.js 16 App Router on Vercel; FastAPI
on Railway remains the canonical business backend, with Supabase providing
PostgreSQL, Auth, and Storage. Legacy HTML bodies live under test fixtures;
root-level compatibility aliases are symlinks into that archive and are not
deployed. Product direction (2026-06-27 pivot) and quality bars: `AGENTS.md` ›
Project. Release flow: `AGENTS.md` › Staging-first release flow and
`docs/STAGING_FIRST_RELEASE_FLOW.md`.

---

## File structure (source of truth)

| What | File |
|------|------|
| Landing | `frontend/app/(marketing)/page.tsx` |
| Login / auth callback | `frontend/app/(public-auth)/login/page.tsx` |
| Student home | `frontend/app/(authed-home)/home/page.tsx` |
| Speaking practice session | `frontend/app/(authed-practice)/practice/session/page.tsx` |
| Speaking result | `frontend/app/(authed-speaking-result)/speaking/result/page.tsx` |
| Full Test / result | `frontend/app/(authed-full-test)/full-test/page.tsx`, `frontend/app/(authed-full-test-result)/full-test-result/page.tsx` |
| Grammar Wiki | `frontend/app/(public-content)/grammar/` |
| Admin dashboard | `frontend/app/(authed-admin)/(overview)/admin/page.tsx` |
| Typed browser API | `frontend/lib/browser-api.ts`, `frontend/lib/openapi-contract.ts` |
| Generated API contract | `frontend/types/api.d.ts` |
| FastAPI entry point | `backend/main.py` |

Retired HTML snapshots live under `frontend/tests/fixtures/legacy-html-retired/`
and are regression evidence only. Some `frontend/*.html` and `frontend/pages`
paths remain as symlinks into that archive for old tests; they are not deploy
sources. Do not reintroduce them into deploy paths.

---

## Routing rule

Speaking practice sessions use the Next route and a canonical `session_id`,
never a standalone `?part=` route.

```
Speaking chooser → POST /sessions → /practice/session?session_id=<uuid>
```

Use `admitCorePlayer('speaking', { session_id })` when admission affinity matters.
The session route fails visibly when `session_id` is missing.

---

## Backend routes

| Route | Router file | Purpose |
|-------|-------------|---------|
| `POST /sessions` | `sessions.py` | Create session, returns `session_id` |
| `GET /sessions/{id}` | `sessions.py` | Load session data |
| `PATCH /sessions/{id}/complete` | `sessions.py` | Mark session done, compute band avg |
| `GET /sessions/{id}/questions` | `questions.py` | Load existing questions |
| `POST /sessions/{id}/questions/generate` | `questions.py` | Generate questions via Gemini |
| **`POST /sessions/{id}/responses`** | **`grading.py`** | **Official grading (STT + `SPEAKING_GRADING_MODEL` via `grading_orchestrator.py`)** |

The frontend always uses the `grading.py` route for submitting recordings.

---

## Config / environment

- Server Components resolve the FastAPI base in `frontend/lib/backend.ts` from
  `AVER_API_BASE`, Vercel environment, and the local default.
- Client Components use the shared authenticated `window.api` transport loaded
  by `frontend/components/supabase-runtime-boundary.tsx`; new typed consumers
  should bind it through `frontend/lib/browser-api.ts` and generated OpenAPI
  types.
- Never hardcode a local or production backend URL inside a route component.
- Supabase client ownership remains centralized by the runtime boundary. Use
  the shared auth provider or `getSupabase()` compatibility bridge; do not create
  an independent browser client.

**Key `.env` values (backend):**
- `MAX_SESSIONS_PER_USER_PER_DAY` — default is `24` (`config.py`); override in `.env` for local development
- `MAX_AUDIO_DURATION_SECONDS=300`
- `OPENAI_API_KEY` — required for Whisper STT
- `GEMINI_API_KEY` — required for the Speaking Gemini fallback, Writing grader and content audits
- `SPEAKING_GRADING_MODEL` — default `gemini-3.8-flash`, the first Speaking fallback behind the Claude primary; the `gemini-*` / `claude-*` prefix selects the provider, empty string skips that rung
- `ANTHROPIC_API_KEY` — required for the Claude Speaking primary (`claude-sonnet-5-5`), the Claude fallback chain, off-topic judge and grammar-check in `claude_grader.py`; blank → Speaking grades on Gemini
- `AI_PROVIDER_ORDER` (default `anthropic,openai,gemini`), `AI_PROVIDER_ORDER_<FEATURE>`, `ANTHROPIC_MODEL_GRADING` / `ANTHROPIC_MODEL_FAST` — Claude-first routing with automatic fallback (`services/ai_router.py`, `docs/AI_PROVIDER_ROUTING.md`); Speaking grading is Claude-primary too (AI-0004 FR-005), and `AI_PROVIDER_ORDER_SPEAKING_GRADING=gemini` restores the Gemini-primary chain. An admin override set on `/admin` (AIOPS-0024, table `ai_model_overrides`) wins over env and code defaults and is re-read every `AI_MODEL_OVERRIDE_TTL_SECONDS` (30–60 s)

---

## Frontend state machine (speaking practice)

The rendered state is owned by `practice-player-lifecycle.mjs` and
`practice-page-shell.tsx`; `frontend/public/js/practice.js` still coordinates
the compatibility workflow through the installed controller:

```
loading → error
loading → prep → recording → processing → feedback
                              ↑               |
                         (re-record)    nextQuestion()
                                              ↓
                                         prep (next Q)
```

Recorder lifecycle is bridged by `practice-recorder-bridge.tsx`. Preserve the
observable progression and verify the Next shell rather than editing a retired
HTML document.

---

## High-priority standing rules

See `AGENTS.md` › Working style (patch scope, backend/frontend contract) and
`AGENTS.md` › Source of truth expectations (canonical truth, immutable
redemption fields, frozen course-exercise weights).

### Feedback-related bugs — inspection checklist
When debugging a feedback-quality issue, inspect all five layers in order:
1. **Prompt layer** — what the grading model is instructed to return (provider selected by `SPEAKING_GRADING_MODEL`)
2. **Post-processing layer** — `_filter_false_article_flags`, recommendation cap, dedup logic in `claude_grader.py`
3. **Mapping/ranking layer** — how issues are scored, filtered, and prioritized
4. **Persistence layer** — `_save_grammar_recommendations()` in `grading.py` writes to `grammar_recommendations` table; backend recs are the primary source for the frontend
5. **Frontend rendering layer** — how `practice-page-shell.tsx`,
   `session-result-behavior.tsx`, and the live compatibility orchestration in
   `frontend/public/js/practice.js` display feedback (backend recommendations
   first, keyword-match fallback second)

A prompt-only fix is insufficient if the real problem is in post-processing or persistence.

### Grammar Wiki changes — inspection checklist
Check content body and frontmatter per `AGENTS.md` › Grammar Wiki conventions,
then confirm the App Router grammar pages under
`frontend/app/(public-content)/grammar/` resolve category/slug correctly.

---

## Current product realities (do not regress these)

Grammar Wiki, feedback-quality and admin access-code invariants: see
`AGENTS.md` › Grammar Wiki conventions, › Feedback-quality conventions and
› Admin conventions.

### Practice and result flows
- The grading pipeline (`grading.py`) is the only official route for submitting recordings. (The unused legacy `responses.py` audio-only route was removed in cleanup.)
- Full-test chaining uses `_ftAllSessionIds` in the frontend and `extra_session_ids` in pronunciation endpoint calls.
- Band aggregation happens at `PATCH /sessions/{id}/complete` — not inline during grading.
- These flows have been iteratively stabilized. Change them carefully with explicit before/after contract analysis.

---

## Expected output style

See `AGENTS.md` › Review / audit output format.

---

## Skills (invoke with /skill-name)

Canonical files are versioned under `backend/scripts/agent-config/skills/`. Run
`python3 backend/scripts/agent-config/install.py` to back up local customizations and
install both ignored agent entry points. Personal settings remain ignored.

| Skill | Path | When to use |
|-------|------|-------------|
| `/new-feature` | `backend/scripts/agent-config/skills/new-feature/SKILL.md` | Implement an approved feature using the existing product contracts |
| `/db-migrate` | `backend/scripts/agent-config/skills/db-migrate/SKILL.md` | Create a forward migration with ledger and staging checks |
| `/api-route` | `backend/scripts/agent-config/skills/api-route/SKILL.md` | Add a FastAPI route with the domain's auth and data boundary |
| `/review` | `backend/scripts/agent-config/skills/review/SKILL.md` | Review contracts, security, schema and release evidence |
| `/ui-review` | `backend/scripts/agent-config/skills/ui-review/SKILL.md` | Review Next UI, design tokens, theme and accessibility |
| `/test` | `backend/scripts/agent-config/skills/test/SKILL.md` | Run relevant verification in the current worktree |

---

## Known limitations / tech debt

- Full Test: the player and result are Next routes; when changing aggregation,
  verify the complete session chain and persisted finalization contract.
- PDF export: `GET /sessions/{session_id}/export/pdf` — works. Uses ReportLab (`backend/services/pdf_generator.py`), pure Python, zero system deps (`fonts-dejavu-core` must be present in the Railway image for Vietnamese glyphs — Railway builds with Railpack, which does not read `backend/nixpacks.toml`; see README "Local setup"). Migrated off WeasyPrint in commit `a1208a2b`; keep its content aligned with the current Next result surface.
- Progress surfaces differ by domain; inspect the relevant dashboard/progress
  route and persisted aggregates before claiming a feature is absent.
- `sessions.tokens_used` column must exist in Supabase for token tracking to work
- Grammar recommendations and the private `audio-responses` / `writing-images`
  buckets: see `AGENTS.md` › Source of truth expectations.

---

## Definition of Done (trước khi báo "xong")
- Chạy kiểm tra theo lớp bị ảnh hưởng và lệnh chuẩn trong
  `docs/AGENT_WORKFLOW.md`, trên đúng worktree/commit đang thay đổi.
- Ghi rõ test pass/fail/skip và phần chưa kiểm chứng; release phải gắn đúng SHA.
- Không sửa/skip/xfail/--ignore test để che lỗi. Nếu contract thay đổi có chủ ý,
  cập nhật test cùng thay đổi đó và giải thích.
- Trong Plan Mode: nêu thay đổi người-dùng-thấy bằng tiếng Việt TRƯỚC, rồi mới tới phần kỹ thuật.

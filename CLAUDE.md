# IELTS Speaking Coach — Project Guide for Claude

Read `AGENTS.md` for the shared working agreement and domain invariants.
`docs/AGENT_WORKFLOW.md` covers worktrees, authorization, verification and
completion evidence; this file provides implementation context. Tool-specific
guidance follows that agreement.

## What this project is

IELTS Speaking Coach **began** as a Speaking practice app and is now a
comprehensive IELTS-prep platform covering Speaking, Writing, Reading, and
Listening. The production frontend is Next.js 16 App Router on Vercel; FastAPI
on Railway remains the canonical business backend, with Supabase providing
PostgreSQL, Auth, and Storage. Legacy HTML bodies live under test fixtures;
root-level compatibility aliases are symlinks into that archive and are not
deployed.

**Most important quality expectations:**
- Feedback must be truthful and non-misleading. False-positive grammar flags harm user trust.
- Admin must see accurate, canonical data — especially for access-code ownership.
- Grading and session-persistence flows must not fail silently.
- Grammar Wiki metadata must be internally consistent. Stale links must not exist.

### Release flow

- Create normal work from `origin/staging` and open the PR against `staging`.
- Wait for the merged staging SHA to pass integrated CI and live Staging E2E.
- Release production only through a `staging` → `main` promotion PR. Direct feature PRs to `main` are rejected by CI.
- Database migrations go to staging first, then production under the advisory lock before dependent code is promoted.
- Full procedure: `docs/STAGING_FIRST_RELEASE_FLOW.md`.

### Product direction (pivot — 2026-06-27)
- **Scope is no longer Speaking-only.** Speaking, Writing, Reading and Listening
  are live product areas. Grammar content may support any of these skills;
  consult the active spec for the scope of a particular change.
- This **supersedes the "FREEZE non-Speaking content" gate** in `docs/GRAMMAR_HANDOFF_consolidated_2026-06-27.md` §I.3, which was written for the Speaking-only era. Grammar Wiki articles targeting Writing (e.g. Task 1 / Task 2 grammar) are valid, intended content — not scope-creep.
- The pivot **widens scope without lowering quality bars**: truthful feedback, canonical admin data, no silent failures, and internally-consistent Grammar Wiki metadata all still hold.

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
| Admin dashboard | `frontend/app/(authed-admin-overview)/admin/page.tsx` |
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
| **`POST /sessions/{id}/responses`** | **`grading.py`** | **Official grading (Whisper + Claude)** |

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
- `ANTHROPIC_API_KEY` — required for Claude grading

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

### Patch scope
- Keep every patch scoped to its stated task.
- Do not mix unrelated cleanup, style fixes, or refactors into a task patch.
- One issue = one patch. Audit review becomes impossible if patches are broad.

### Backend/frontend contract
- When a UI bug is reported, always inspect both backend output shape and frontend consumption together.
- Shape mismatches (e.g., `assignments[]` vs `assigned_users[]`) and silent failures are the most common root cause.
- Never fix only the rendering layer when the data source is wrong.

### Canonical truth
- Prefer fixing the source of truth (database write, backend response) over patching the display.
- Do not use optimistic local state that can diverge from backend truth. After mutations, refetch canonical state.
- `access_codes.is_used`, `used_by`, and `used_at` are immutable after activation. Never clear them.
- Course-exercise weighting is frozen per assignment in `content_config`
  (`weight_policy`, `section_counts`, `section_weights`). Completed attempts keep
  their stored section weights, and a revision must not derive new weights from
  its smaller question sample.

### Feedback-related bugs — inspection checklist
When debugging a feedback-quality issue, inspect all five layers in order:
1. **Prompt layer** — what Claude is instructed to return
2. **Post-processing layer** — `_filter_false_article_flags`, recommendation cap, dedup logic in `claude_grader.py`
3. **Mapping/ranking layer** — how issues are scored, filtered, and prioritized
4. **Persistence layer** — `_save_grammar_recommendations()` in `grading.py` writes to `grammar_recommendations` table; backend recs are the primary source for the frontend
5. **Frontend rendering layer** — how `practice-page-shell.tsx`,
   `session-result-behavior.tsx`, and the live compatibility orchestration in
   `frontend/public/js/practice.js` display feedback (backend recommendations
   first, keyword-match fallback second)

A prompt-only fix is insufficient if the real problem is in post-processing or persistence.

### Grammar Wiki changes — inspection checklist
When editing Grammar Wiki content or metadata, always check:
1. **Content body** — accuracy, clarity, IELTS relevance
2. **Frontmatter metadata** — `category`, `slug`, `related_pages`, `next_articles`, `compare_with`, `prerequisites`, `pathways`
3. **Progression graph** — do referenced slugs exist as real files?
4. **Frontend routes/rendering** — do the App Router grammar pages under
   `frontend/app/(public-content)/grammar/` resolve category/slug correctly?

---

## Current product realities (do not regress these)

### Grammar Wiki
- Has gone through multiple remediation batches (A–E, April 2026). Metadata is now substantially cleaned.
- All slug references in frontmatter must point to real files. Verify before adding new cross-links. (`test_grammar_wiki_ref_drift` fails CI if any `related_pages`/`next_articles`/`compare_with`/`prerequisites` slug doesn't resolve to a live article.)
- Category values must match the actual filesystem directory the file lives in.
- **Serves all skills, not Speaking-only.** Articles may target Writing (`grammar-for-writing` category), Reading, etc. Use `speaking_relevance` / `writing_relevance` frontmatter to flag the skill; a Writing-focused article with `writing_relevance: high` is intended content. Categories auto-derive from the directory and auto-humanise via `_prettify` (`grammar-for-writing` → "Grammar For Writing") — there is no category map to maintain.

### Feedback quality
- `_filter_false_article_flags` in `claude_grader.py` has been carefully tuned.
- `_QUOTE_RE` uses a four-alternation regex with possessive-aware lookahead — do not simplify it.
- Group extraction uses `next(g for g in m.groups() if g is not None)` — not `or`-chaining, which fails on empty strings.
- There is a hard cap on article-family recommendations per response. Do not remove it without understanding the false-positive rate it controls.

### Admin access-code ownership
- Modern codes: canonical ownership is in `user_code_assignments` (active rows).
- Legacy codes: fallback is `access_codes.used_by` — synthesized by both list and detail endpoints when no active assignment row exists.
- The fallback synthesis condition in the **detail endpoint** is: **no active assignment rows** (not: no rows at all). This matters after a remove-user operation leaves only inactive rows. It also must NOT fire when the assignment lookup itself errored — the detail endpoint now sets `association_lookup_failed: true` in that case (audit 2026-07-03 L5) rather than synthesizing stale ownership.
- Admin production surfaces are Next routes under `frontend/app/(authed-admin-*)/`. Access-code ownership rendering is owned by `admin-access-codes-panel.tsx`; it refetches the canonical list through `loadCodes()` after mutations rather than transforming the detail shape in place.
- `association_lookup_failed: true` is returned by **both** the list and detail endpoints on DB failure. Render as `⚠ lookup failed`, never as `—`.

### Practice and result flows
- The grading pipeline (`grading.py`) is the only official route for submitting recordings. (The unused legacy `responses.py` audio-only route was removed in cleanup.)
- Full-test chaining uses `_ftAllSessionIds` in the frontend and `extra_session_ids` in pronunciation endpoint calls.
- Band aggregation happens at `PATCH /sessions/{id}/complete` — not inline during grading.
- These flows have been iteratively stabilized. Change them carefully with explicit before/after contract analysis.

---

## Expected output style

For any non-trivial fix, Claude's response should include:

1. **Root cause** — exact, not vague ("the fallback condition checked `not assignments` but should check `not has_active`")
2. **Exact files changed** — file paths, function names
3. **Backend/frontend contract — before vs after** — what shape did the backend return, what did the frontend expect, how does it differ now
4. **Verification steps** — concrete steps to confirm the fix works (specific URL to hit, specific UI action to take, specific DB query to run)
5. **Changes minimal and reviewable** — no unrequested refactors included

Keep fixes reviewable. A 5-line diff with a clear explanation is better than a 50-line diff with a vague summary.

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
- PDF export: `GET /sessions/{session_id}/export/pdf` — works. Uses ReportLab (`backend/services/pdf_generator.py`), pure Python, zero system deps (`fonts-dejavu-core` installed via `backend/nixpacks.toml` for Vietnamese glyphs). Migrated off WeasyPrint in commit `a1208a2b`; keep its content aligned with the current Next result surface.
- Grammar recommendations: server-side (`grammar_recommendations` table, persisted per practice response); frontend keyword matching in `frontend/public/js/practice.js` is fallback only
- Progress surfaces differ by domain; inspect the relevant dashboard/progress
  route and persisted aggregates before claiming a feature is absent.
- `sessions.tokens_used` column must exist in Supabase for token tracking to work
- `audio-responses` is private. Authorized playback uses short-lived signed URLs
  from `backend/services/recording_audio.py`; never restore public-bucket access
  or use a persisted public URL as an error fallback.

---

## Definition of Done (trước khi báo "xong")
- Chạy kiểm tra theo lớp bị ảnh hưởng và lệnh chuẩn trong
  `docs/AGENT_WORKFLOW.md`, trên đúng worktree/commit đang thay đổi.
- Ghi rõ test pass/fail/skip và phần chưa kiểm chứng; release phải gắn đúng SHA.
- Không sửa/skip/xfail/--ignore test để che lỗi. Nếu contract thay đổi có chủ ý,
  cập nhật test cùng thay đổi đó và giải thích.
- Trong Plan Mode: nêu thay đổi người-dùng-thấy bằng tiếng Việt TRƯỚC, rồi mới tới phần kỹ thuật.

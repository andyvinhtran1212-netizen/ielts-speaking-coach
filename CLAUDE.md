# IELTS Speaking Coach — Project Guide for Claude

## What this project is

IELTS Speaking Coach is a web app for IELTS Speaking exam preparation. Users record spoken answers to IELTS-style questions, get AI-scored feedback (Whisper STT + Claude grading), and can practice full 3-part tests. The system also includes a Grammar Wiki, pronunciation assessment (Azure), a topic library, and an admin dashboard.

**Most important quality expectations:**
- Feedback must be truthful and non-misleading. False-positive grammar flags harm user trust.
- Admin must see accurate, canonical data — especially for access-code ownership.
- Grading and session-persistence flows must not fail silently.
- Grammar Wiki metadata must be internally consistent. Stale links must not exist.

---

## File structure (source of truth)

| What | File |
|------|------|
| Landing / Login / Activation | `frontend/index.html` |
| Dashboard | `frontend/pages/dashboard.html` |
| **Practice page** (main) | `frontend/pages/practice.html` ← real one |
| Result page | `frontend/pages/result.html` |
| Full Test result | `frontend/pages/full-test-result.html` |
| Grammar Wiki home | `frontend/grammar.html` |
| Grammar article | `frontend/pages/grammar-article.html` |
| Grammar compare | `frontend/pages/grammar-compare.html` |
| Grammar roadmap | `frontend/pages/grammar-roadmap.html` |
| Admin dashboard | `frontend/admin.html` |
| Practice JS logic | `frontend/js/practice.js` |
| API client + Supabase | `frontend/js/api.js` |
| FastAPI entry point | `backend/main.py` |

`frontend/practice.legacy.html` — old root-level file, kept for reference only. **Do not edit.**

---

## Routing rule

All practice sessions use `session_id`, never `?part=`.

```
Dashboard → POST /sessions → practice.html?session_id=<uuid>
```

Never link to `practice.html?part=1`. The practice page will show an error if `session_id` is missing.

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
| `POST /sessions/{id}/responses/{qid}/audio` | `responses.py` | Legacy audio-only upload (unused) |

The frontend always uses the `grading.py` route for submitting recordings.

---

## Config / environment

- API base URL is resolved **automatically** in `js/api.js`:
  - `localhost` or `127.0.0.1` → `http://localhost:8000`
  - anything else → production Railway URL
- **Never hardcode `http://localhost:8000`** in HTML inline scripts — use `window.api.base` instead.
- Supabase is initialised once via `initSupabase(SUPABASE_URL, SUPABASE_ANON)` from `api.js`. Use `getSupabase()` to get the client. Never call `window.supabase.createClient()` directly.

**Key `.env` values (backend):**
- `MAX_SESSIONS_PER_USER_PER_DAY` — default is `10`; override in `.env` for local development
- `MAX_AUDIO_DURATION_SECONDS=300`
- `OPENAI_API_KEY` — required for Whisper STT
- `ANTHROPIC_API_KEY` — required for Claude grading

---

## Frontend state machine (practice page)

States controlled by `showState(name)` in `practice.js`:

```
loading → error
loading → prep → recording → processing → feedback
                              ↑               |
                         (re-record)    nextQuestion()
                                              ↓
                                         prep (next Q)
```

Recording has 3 sub-states managed by `_showRecSub(name)`:
`idle` → `recording` → `recorded`

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

### Feedback-related bugs — inspection checklist
When debugging a feedback-quality issue, inspect all five layers in order:
1. **Prompt layer** — what Claude is instructed to return
2. **Post-processing layer** — `_filter_false_article_flags`, recommendation cap, dedup logic in `claude_grader.py`
3. **Mapping/ranking layer** — how issues are scored, filtered, and prioritized
4. **Persistence layer** — `_save_grammar_recommendations()` in `grading.py` writes to `grammar_recommendations` table; backend recs are the primary source for the frontend
5. **Frontend rendering layer** — how `practice.js` / `result.html` display the feedback (backend recs first, keyword-match fallback second)

A prompt-only fix is insufficient if the real problem is in post-processing or persistence.

### Grammar Wiki changes — inspection checklist
When editing Grammar Wiki content or metadata, always check:
1. **Content body** — accuracy, clarity, IELTS relevance
2. **Frontmatter metadata** — `category`, `slug`, `related_pages`, `next_articles`, `compare_with`, `prerequisites`, `pathways`
3. **Progression graph** — do referenced slugs exist as real files?
4. **Frontend routes/rendering** — does `grammar.js` resolve the category/slug correctly?

---

## Current product realities (do not regress these)

### Grammar Wiki
- Has gone through multiple remediation batches (A–E, April 2026). Metadata is now substantially cleaned.
- All slug references in frontmatter must point to real files. Verify before adding new cross-links.
- Category values must match the actual filesystem directory the file lives in.

### Feedback quality
- `_filter_false_article_flags` in `claude_grader.py` has been carefully tuned.
- `_QUOTE_RE` uses a four-alternation regex with possessive-aware lookahead — do not simplify it.
- Group extraction uses `next(g for g in m.groups() if g is not None)` — not `or`-chaining, which fails on empty strings.
- There is a hard cap on article-family recommendations per response. Do not remove it without understanding the false-positive rate it controls.

### Admin access-code ownership
- Modern codes: canonical ownership is in `user_code_assignments` (active rows).
- Legacy codes: fallback is `access_codes.used_by` — synthesized by both list and detail endpoints when no active assignment row exists.
- The fallback synthesis condition in the **detail endpoint** is: **no active assignment rows** (not: no rows at all). This matters after a remove-user operation leaves only inactive rows.
- The `detailToTableShape()` function in `admin.html` converts detail-endpoint shape to list-endpoint shape for re-rendering after mutations. Both shapes must go through this transform before updating `_codesData`.
- `association_lookup_failed: true` is returned by the list endpoint on DB failure. Render as `⚠ lookup failed`, never as `—`.

### Practice and result flows
- The grading pipeline (`grading.py`) is the only official route for submitting recordings. `responses.py` is unused.
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

| Skill | Path | When to use |
|-------|------|-------------|
| `/new-feature` | `.claude/skills/new-feature/SKILL.md` | Add a new feature: migration + service + router + frontend |
| `/db-migrate` | `.claude/skills/db-migrate/SKILL.md` | Create a new SQL migration, auto-detect sequence number |
| `/api-route` | `.claude/skills/api-route/SKILL.md` | Scaffold FastAPI route with correct auth/Supabase pattern |
| `/review` | `.claude/skills/review/SKILL.md` | Review code before commit/deploy: security, schema, AI calls |

---

## Known limitations / tech debt

- Full Test: `full-test-result.html` exists — verify integration completeness before relying on it
- PDF export: `GET /sessions/{session_id}/export/pdf` — WeasyPrint system deps (cairocffi, pango) not installed on Railway; fails in the current production environment
- Grammar recommendations: server-side (`grammar_recommendations` table, persisted per practice response); frontend keyword matching in `grammar.js` is fallback only
- Progress tracking: none — no band trend charts, no weakness tracking across sessions
- `sessions.tokens_used` column must exist in Supabase for token tracking to work
- `audio-responses` bucket must be public in Supabase Storage for audio replay to work
- The `/ 100` sessions-today display in the dashboard is hardcoded — update if `MAX_SESSIONS_PER_USER_PER_DAY` changes

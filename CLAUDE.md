# IELTS Speaking Coach — Project Guide for Claude

## File structure (source of truth)

| What                  | File                                    |
|-----------------------|-----------------------------------------|
| **Landing page**      | **`frontend/index.html`** ← public root |
| Login / activation    | `frontend/login.html`                   |
| Dashboard             | `frontend/pages/dashboard.html`         |
| **Practice page**     | **`frontend/pages/practice.html`** ← real one |
| Practice JS logic     | `frontend/js/practice.js`               |
| API client + Supabase | `frontend/js/api.js`                    |
| FastAPI entry point   | `backend/main.py`                       |

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

| Route                                         | Router file        | Purpose                              |
|-----------------------------------------------|--------------------|--------------------------------------|
| `POST /sessions`                              | `sessions.py`      | Create session, returns `session_id` |
| `GET  /sessions/{id}`                         | `sessions.py`      | Load session data                    |
| `PATCH /sessions/{id}/complete`               | `sessions.py`      | Mark session done, compute band avg  |
| `GET  /sessions/{id}/questions`               | `questions.py`     | Load existing questions              |
| `POST /sessions/{id}/questions/generate`      | `questions.py`     | Generate questions via Gemini        |
| **`POST /sessions/{id}/responses`**           | **`grading.py`**   | **Official grading (Whisper+Claude)**|
| `POST /sessions/{id}/responses/{qid}/audio`   | `responses.py`     | Legacy audio-only upload (unused)    |

The frontend always uses the `grading.py` route for submitting recordings.

---

## Config / environment

- API base URL is resolved **automatically** in `js/api.js`:
  - `localhost` or `127.0.0.1` → `http://localhost:8000`
  - anything else → production Railway URL
- **Never hardcode `http://localhost:8000`** in HTML inline scripts — use `window.api.base` instead.
- Supabase is initialised once via `initSupabase(SUPABASE_URL, SUPABASE_ANON)` from `api.js`.
  Use `getSupabase()` to get the client. Never call `window.supabase.createClient()` directly.

### Key `.env` values (backend)
- `MAX_SESSIONS_PER_USER_PER_DAY=100` (raised from 10 for development)
- `MAX_AUDIO_DURATION_SECONDS=300`
- `OPENAI_API_KEY` — needs a real key for Whisper STT
- `ANTHROPIC_API_KEY` — needs a real key for Claude grading

---

## Frontend state machine (practice page)

States (controlled by `showState(name)` in `practice.js`):

```
loading → error
loading → prep → recording → processing → feedback
                              ↑               |
                         (re-record)    nextQuestion()
                                              ↓
                                         prep (next Q)
```

Recording has 3 sub-states managed by `_showRecSub(name)`:
- `idle` → `recording` → `recorded`

---

## Skills (invoke with /skill-name)

| Skill | Path | When to use |
|-------|------|-------------|
| `/new-feature` | `.claude/skills/new-feature/SKILL.md` | Thêm tính năng mới: migration + service + router + frontend |
| `/db-migrate` | `.claude/skills/db-migrate/SKILL.md` | Tạo migration SQL mới, auto-detect số thứ tự |
| `/api-route` | `.claude/skills/api-route/SKILL.md` | Scaffold FastAPI route theo đúng auth/Supabase pattern |
| `/review` | `.claude/skills/review/SKILL.md` | Review code trước commit/deploy: security, schema, AI calls |

---

## Known limitations / future work

- Full Test multi-part chaining: **đã implement** — 3 sessions riêng (p1/p2/p3), frontend chain qua `_ftAllSessionIds`.
- PDF export: endpoint tồn tại nhưng trả 503 cho đến khi WeasyPrint system deps được cài trên Railway.
- `sessions.tokens_used` column must exist in Supabase for token tracking to work.
- `audio-responses` bucket must be public in Supabase Storage.
- The `/ 100` sessions-today display in the dashboard is hardcoded — update if `MAX_SESSIONS_PER_USER_PER_DAY` changes.

# IELTS Speaking Coach

AI-powered IELTS Speaking practice platform — record answers, get Whisper +
Claude grading, build a personal vocab bank, and reinforce retention with
SRS flashcards and fill-blank exercises.

- **Production:** [averlearning.com](https://averlearning.com)
- **Stack:** Vanilla JS + Tailwind CDN · FastAPI · Supabase (Postgres +
  Auth + Storage) · Railway (backend) · Vercel/GitHub Pages (frontend) ·
  Anthropic Claude · OpenAI Whisper · Google Gemini · Azure Speech (PA)

> Day-to-day collaboration rules live in `CLAUDE.md` (project guide for
> Claude Code).  This README is the high-level orientation.

---

## Features shipped

### Speaking practice (core)
- IELTS Speaking topic library (Part 1 / 2 / 3) + sample answers.
- In-browser audio recording with Whisper STT.
- Claude grading: band scores (Fluency, Lexical, Grammar, Pronunciation),
  per-criterion feedback, grammar recommendations.
- Session history + result page; full-test mode with band aggregation.
- Pronunciation Assessment via Azure Speech.

### Phase B — Personal Vocab Bank
- AI vocab extractor (Claude Haiku) reads transcripts after grading.
- Three categories: `used_well`, `needs_review`, `upgrade_suggested`.
- "My Vocabulary" page with filter, search, archive, and per-row report.
- Admin monitoring dashboard with FP-rate gate before broader rollout.
- Default-deny per-user feature flag (`vocab_enabled`).

### Phase D Wave 1 — Vocabulary Exercises
- D1 fill-blank, session-based (10 cards/session).
- Local grading for instant feedback; backend re-grades for analytics +
  rate limit (50 D1 attempts/day).
- Admin tool generates exercises via Gemini with batch chunking; never
  auto-publishes — every draft passes through manual review (Draft /
  Published / Rejected filter).
- End-of-session summary with "Review wrong answers" loop.

### Phase D Wave 2 — Flashcard system + SRS
- Stack types: 3 auto-stacks (All vocab / Recent / Needs review) +
  user-curated manual stacks filtered by topic / category / search /
  added_after.
- Simplified SM-2 SRS with per-(user, vocabulary) state shared across
  stacks (review word X in stack A → progress carries into stack B).
- 4-rating self-grade (Quên / Khó / Tốt / Dễ) + hotkeys 1-4 + Space-flip.
- Optimistic UI: rating advances immediately, sync runs in background.
- IPA pronunciation + AI-generated example sentence on the back face
  (Gemini Flash); the user's transcript stays behind an opt-in
  "Xem câu gốc" overlay with a grammar-error caveat.
- Daily-due badge on the dashboard nav.
- "📚 +Stack" entry point from My Vocabulary for one-tap add.

### Infrastructure
- **Default-deny** feature flags per user (`vocab_enabled`, `d1_enabled`,
  `flashcard_enabled`); strict `is True` checks across backend + frontend.
- **RLS** with `USING + WITH CHECK` on every UPDATE policy; live 2-JWT
  cross-user tests run in CI (no skips).
- **Daily backups** at 03:00 via launchd → `backups/` (script:
  `backend/scripts/backup_production.sh`).
- **Page parity** check (`backend/scripts/verify_page_parity.sh`) blocks
  PRs that ship a page missing the Supabase + api.js init triplet.
- **Hardcoded URLs banned** — every fetch routes through `window.api.base`,
  set once in `frontend/js/api.js` from the localhost/Railway switch.

---

## Architecture at a glance

```
backend/
  main.py                  FastAPI app entry; mounts every router below.
  config.py                Pydantic settings (env vars + feature flags).
  database.py              Supabase service-role client (admin/background only).
  routers/
    auth.py                /auth/* — login, /me, profile, activate.
    sessions.py            /sessions/* — practice session lifecycle.
    grading.py             POST /sessions/{id}/responses (Whisper + Claude).
    questions.py           Topic question library (per session).
    vocabulary_bank.py     /api/vocabulary/bank/* — Phase B user surface.
    exercises.py           /api/exercises/* + /admin/exercises/* (D1).
    flashcards.py          /api/flashcards/* (Wave 2).
    admin.py               /admin/* (access codes, vocab flags, backfill jobs).
    grammar.py, pronunciation.py, analytics.py, …
  services/
    claude_grader.py       Band-score grading prompt + post-processing.
    whisper.py             OpenAI Whisper STT.
    vocab_extractor.py     Claude Haiku — Phase B vocab categorisation.
    vocab_enrichment.py    Gemini Flash — IPA + example sentence (Wave 2 RC).
    d1_content_gen.py      Gemini — D1 fill-blank generator (Phase D).
    feature_flags.py       Strict default-deny per-user flag reads.
    rate_limit.py          Per-user-per-day attempt counters + decorators.
    srs.py                 Pure-function SM-2 (no DB).
  migrations/              Numbered SQL with -- ROLLBACK SCRIPT (commented).
  tests/                   pytest — pure-function suites + live 2-JWT RLS.
  scripts/
    setup_phase_b_test_env.sh
    setup_phase_d_test_env.sh
    setup_phase_d_wave_2_test_env.sh
    verify_page_parity.sh
    backup_production.sh

frontend/
  index.html               Landing + login + activation.
  pages/
    dashboard.html         Hub (practice CTA + nav to all surfaces).
    practice.html          Recording page (session_id-driven).
    result.html            Per-response feedback.
    full-test-result.html  Full-test band aggregation.
    my-vocabulary.html     Vocab bank (Phase B).
    exercises.html         Exercise hub (Phase D).
    d1-exercise.html       Fill-blank session (Wave 1).
    flashcards.html        Stack list + create modal (Wave 2).
    flashcard-study.html   Study session with flip + 4-rating (Wave 2).
  grammar.html             Grammar Wiki home + article pages.
  admin.html               Admin dashboard.
  js/                      One controller per page; api.js holds the
                           single localhost/Railway base-URL switch.
  css/ds.css               Design system tokens used across pages.
```

---

## Local setup

Prerequisites: Python 3.11+, Node 18+ (only for tooling — frontend is
served as static files), a Supabase project, and a Railway env file.

```bash
# Clone + venv
git clone <repo>
cd ielts-speaking-coach/backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Configure
cp .env.example .env   # fill SUPABASE_URL/KEYS, ANTHROPIC_API_KEY,
                       # OPENAI_API_KEY, GEMINI_API_KEY, AZURE keys, …

# Apply migrations against your Supabase Postgres
psql "$DATABASE_URL" -f migrations/001_add_audio_storage_path.sql
# (… continue through the latest numbered migration; see DEPLOY_CHECKLIST
#  for which migrations are required for which phase)

# Run
uvicorn main:app --reload --port 8000
```

Frontend runs as plain static files — open `frontend/index.html` directly,
serve with `python3 -m http.server` from the `frontend/` directory, or
just point Vercel/GitHub Pages at the directory.  `frontend/js/api.js`
auto-detects localhost vs production and points fetches accordingly; do
not hardcode an API base URL anywhere else.

---

## Development workflow

The team uses a four-stage pattern that has hardened across Phase B and
Phase D:

1. **Plan** — Antigravity drafts a step-by-step plan (`*_PLAN.md`).
2. **Execute** — Claude Code implements step-by-step with per-step
   commits and explicit checkpoints; the user reviews before unblocking
   the next step.
3. **Audit** — Codex audits the full diff (looking for cross-file
   forgets, RLS WITH CHECK, hardcoded URLs, default-deny strictness).
4. **Deploy + dogfood** — Migrations apply manually against production
   Postgres after a backup; the feature ships behind a default-OFF flag;
   one admin dogfoods for ≥1 day before broader rollout.

Hard rules (also in `CLAUDE.md`):

- Migrations are **always manual** — auto-deploy never touches the DB.
  Backup → migrate → deploy in that order.
- Live test infrastructure (`backend/scripts/setup_*_test_env.sh` +
  `tests/test_*_rls.py`) ships **before** the feature code.
- Patches stay scoped to their stated task; mixed cleanups land in
  separate PRs.
- Default-deny strictness — `is True` / `=== true`, exception → False,
  default OFF in env.

---

## Reference docs

| Doc | What |
|---|---|
| `CLAUDE.md` | Project source-of-truth + standing rules for Claude Code. |
| `DEPLOY_CHECKLIST.md` | Per-phase production deploy + rollback steps. |
| `TECH_DEBT.md` | Current debt + improvement opportunities, prioritised. |
| `PHASE_A_V3_PLAN.md` | Speaking + Grammar core (shipped). |
| `PHASE_B_V3_PLAN.md` | Personal Vocab Bank (shipped). |
| `PHASE_D_V3_PLAN.md` | Vocabulary Exercises Wave 1 + the deferred D3. |
| `PHASE_D_WAVE_2_PLAN.md` | Flashcard system + SRS (shipped). |
| `AUDIT_*.md` | Frozen audit reports, kept for traceability. |
| `frontend/CLAUDE.md` | Frontend-specific conventions + graphify pointer. |
| `frontend/known_bugs_and_failures.md` | Current frontend bug log. |

---

## License + status

Internal project; not currently open-source.  See `AGENTS.md` for the
list of agent personas + their scopes if you're collaborating via tooling.

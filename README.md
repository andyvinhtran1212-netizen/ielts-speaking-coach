# IELTS Speaking Coach

AI-powered IELTS Speaking practice platform — record answers, get Whisper +
Claude grading, build a personal vocab bank, and reinforce retention with
SRS flashcards and fill-blank exercises.

- **Production:** [averlearning.com](https://averlearning.com)
- **Stack:** Vanilla JS + Tailwind CDN · FastAPI · Supabase (Postgres +
  Auth + Storage) · Railway (backend) · Vercel (frontend) ·
  Anthropic Claude · OpenAI Whisper · Google Gemini · Azure Speech (PA)

> Day-to-day collaboration rules live in `CLAUDE.md` (project guide for
> Claude Code).  This README is the high-level orientation.
>
> For the full product map — every module, how they relate, and what each
> sub-page does (purpose · audience · operation) — see
> [`docs/SITE_OVERVIEW.md`](docs/SITE_OVERVIEW.md).

---

## What it includes

A multi-skill IELTS prep platform. Each skill follows the same shape — admin
authors content, students (or, via shared reading links, anonymous visitors)
practice, the system grades / auto-scores, students review, and admins see
analytics.

- **Speaking** — record → Whisper STT → Claude band grading + per-criterion
  feedback + grammar recommendations; single-question and full 3-part test;
  Azure pronunciation.
- **Writing** — Gemini-graded essays (levels × tiers); instructor grade
  workflow, prompts, assignments, cohorts.
- **Listening** — dictation / gist / true-false / MCQ / mini- and full tests
  with AI-rendered audio.
- **Reading** — L1 vocab passages + L2 skill exercises (glossary · VI
  translation · grammar toggle) + L3 full tests (auto-scored, band + skill
  breakdown, solution review); per-test lock + shareable links + anonymous take.
- **Vocabulary** — personal bank, SRS flashcards, fill-blank exercises.
- **Grammar Wiki** — articles, compare pairs, roadmap, search; feeds the
  speaking grammar recommendations.
- **Admin + dashboards** — per-skill content authoring, access-code / cohort
  management, ops + reading-attempts dashboards.

> **Full detail lives in [`docs/SITE_OVERVIEW.md`](docs/SITE_OVERVIEW.md)** — the
> single source of truth for every module, how they relate, and what each
> sub-page does (purpose · audience · operation + key endpoints). This README
> stays a thin intro on purpose: per-page / feature detail belongs in
> SITE_OVERVIEW so it can't drift in two competing places.

---

## Repo layout

- `backend/` — FastAPI app (`main.py`); one router per domain under `routers/`,
  AI + domain logic under `services/`, numbered SQL in `migrations/`, pytest in
  `tests/`.
- `frontend/` — static HTML/CSS/JS, no build step; pages under `pages/`, one
  controller per page in `js/`, `js/api.js` holds the single localhost↔Railway
  base-URL switch, `aver-design` tokens in `css/`.

For the current router + per-sub-page inventory, see `docs/SITE_OVERVIEW.md`
(§ "Backend router map" + the per-sub-page tables).

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
just point Vercel at the directory.  `frontend/js/api.js`
auto-detects localhost vs production and points fetches accordingly; do
not hardcode an API base URL anywhere else.

---

## Development workflow

The team uses a four-stage pattern that has hardened across Phase B and
Phase D:

1. **Plan** — Antigravity drafts a step-by-step plan (`*_PLAN.md`).
   Prompt template: [`docs/templates/PROMPT_TEMPLATE_ANTIGRAVITY_PLAN.md`](docs/templates/PROMPT_TEMPLATE_ANTIGRAVITY_PLAN.md).
2. **Execute** — Claude Code implements step-by-step with per-step
   commits and explicit checkpoints; the user reviews before unblocking
   the next step.
   Prompt template: [`docs/templates/PROMPT_TEMPLATE_CLAUDE_CODE_EXECUTION.md`](docs/templates/PROMPT_TEMPLATE_CLAUDE_CODE_EXECUTION.md).
3. **Audit** — Codex audits the full diff (looking for cross-file
   forgets, RLS WITH CHECK, hardcoded URLs, default-deny strictness).
   Prompt template: [`docs/templates/PROMPT_TEMPLATE_CODEX_AUDIT.md`](docs/templates/PROMPT_TEMPLATE_CODEX_AUDIT.md).
4. **Deploy + dogfood** — Migrations apply manually against production
   Postgres after a backup; the feature ships behind a default-OFF flag;
   one admin dogfoods for ≥1 day before broader rollout.
   Checklist: [`DEPLOY_CHECKLIST.md`](DEPLOY_CHECKLIST.md).

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
| `docs/SITE_OVERVIEW.md` | **Product map** — modules, relations, every sub-page (single source of truth). |
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

# Aver Learning · IELTS Speaking Coach

IELTS and English practice across Speaking, Writing, Reading, Listening,
Vocabulary, Grammar Wiki, Courses and Mock Tests. The repository retains its
original Speaking Coach name.

- **Production:** [averlearning.com](https://averlearning.com)
- **Staging:** [staging.averlearning.com](https://staging.averlearning.com)
- **Stack:** Next.js 16 App Router + React 19 + TypeScript on Vercel; FastAPI
  on Railway; Supabase PostgreSQL, Auth and Storage.
- **Product map:** [docs/SITE_OVERVIEW.md](docs/SITE_OVERVIEW.md).

## Start here

| Document | Purpose |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Shared working agreement and domain invariants for every agent |
| [CLAUDE.md](CLAUDE.md) | Project navigation and implementation context |
| [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md) | Worktrees, verification, handoff and completion evidence |
| [specs/README.md](specs/README.md) | Active feature intent, change classes and spec lifecycle |
| [docs/STAGING_FIRST_RELEASE_FLOW.md](docs/STAGING_FIRST_RELEASE_FLOW.md) | Staging verification and production promotion |
| [backend/migrations/README.md](backend/migrations/README.md) | Migration numbering, forward policy and ledger |

Historical plans and audits explain earlier decisions. Current instructions,
active specs, code and executable tests govern new work; a historical checklist
does not prove that a release is pending or complete.

## Repository layout

- `frontend/app/` — deployed App Router pages and route groups.
- `frontend/components/`, `frontend/lib/`, `frontend/types/` — shared React UI,
  API/auth boundaries and generated OpenAPI types.
- `frontend/public/` — static assets and remaining compatibility controllers.
  Retired HTML under `frontend/tests/fixtures/legacy-html-retired/` is test
  evidence; root HTML aliases are not deployment sources.
- `backend/main.py`, `backend/routers/`, `backend/services/` — FastAPI entry,
  authenticated domain APIs and business logic.
- `backend/content/`, `backend/migrations/`, `backend/tests/` — content, schema
  changes and backend tests.
- `specs/` — active specifications; `docs/` — runbooks, product map and history.
- `.agents/skills/` — versioned project skills; `.claude/skills` points to the
  same files so the two agent entry points share one source.

## Local setup

Use **Node.js 24+** (`frontend/package.json`). Backend CI uses **Python 3.11**;
Railway pins **Python 3.12** (`backend/nixpacks.toml`). Use either of those
Python versions locally. Audio processing also requires `ffmpeg`; the Railway
config lists the production font/JRE dependencies.

Configure a development or staging Supabase project and the provider keys
needed for the flow you are exercising. Keep service credentials in ignored
environment files. The browser receives only the Supabase public/anon key.

Backend, from the repository root:

```bash
python3 -m venv backend/venv
source backend/venv/bin/activate
python -m pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
# Edit backend/.env for the intended non-production environment.
cd backend
python -m uvicorn main:app --reload --port 8000
```

Frontend, in a separate terminal from the repository root:

```bash
cd frontend
npm ci
export AVER_ENVIRONMENT=test
export AVER_API_BASE=http://localhost:8000
export AVER_SUPABASE_URL=https://YOUR-DEV-PROJECT.supabase.co
export AVER_SUPABASE_ANON_KEY=YOUR-DEV-PUBLIC-KEY
node tooling/generate-runtime-config.mjs
npm run dev
```

Open `http://localhost:3000`. `AVER_ENVIRONMENT=test` admits the local API origin
in the development CSP. The generator receives shell variables; it does not
load `.env.local` itself. Use the same Supabase project as the backend. `predev`
copies vendor bundles but does not regenerate runtime config. After local use,
restore the committed unconfigured default before committing:

```bash
env -u VERCEL_ENV -u VERCEL_GIT_COMMIT_SHA -u VERCEL_GIT_COMMIT_REF \
  -u AVER_ENVIRONMENT -u AVER_API_BASE -u AVER_SUPABASE_URL \
  -u AVER_SUPABASE_ANON_KEY -u AVER_CORE_OPERATION_CORRELATION_ENABLED \
  -u AVER_WRITING_ADMISSION_ENABLED -u AVER_RUNTIME_CONFIG_OUT \
  node tooling/generate-runtime-config.mjs
```

Database setup depends on the target's schema and migration ledger. Follow the
[migration guide](backend/migrations/README.md) and use
`backend/scripts/apply_migrations.sh` for forward changes. Do not replay the
numbered directory with a shell loop or baseline an existing database to hide
drift. Migrations are separate from application auto-deploys.

## Development and verification

1. Inspect the working tree, applicable agent instructions and existing
   implementation before editing. Start normal work from `origin/staging` on a
   scoped `codex/<task>` branch.
2. Classify the change using [specs/README.md](specs/README.md). Feature/high-risk
   implementation requires the approved spec on the base branch first.
3. Make a focused patch and run the affected local checks. Commands and test
   boundaries are in [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md).
4. Consolidate review findings before pushing. Open the PR against `staging`.
5. For an authorized production release, verify the merged staging SHA, then
   promote `staging` to `main` and verify production using the release runbook.

Project skills cover `/new-feature`, `/api-route`, `/db-migrate`, `/review`,
`/ui-review` and `/test`. Shared instructions apply regardless of which agent
executes a task. Personal settings, credentials, generated graphs and local
verification artifacts stay ignored.

Internal project; not currently open-source.

# Working with agents

This is the operational companion to [AGENTS.md](../AGENTS.md). It applies to
Codex, Claude Code and other agents working in this repository. Tool-specific
entry points and prompt templates follow the same agreement.

## Read order and authority

1. Read the user's current task and retained authorization, root `AGENTS.md`,
   and instructions in the directories being changed.
2. Use [README.md](../README.md) for setup and [CLAUDE.md](../CLAUDE.md) for
   navigation. Read only the domain references needed for the task.
3. Check [specs/README.md](../specs/README.md) and the applicable approved spec.
   The constitution governs the spec lifecycle. Historical plans under `docs/`
   are evidence, not replacement approval or current implementation truth.
4. Verify assumptions against code, migrations and executable tests. If intent
   and implementation disagree, report the mismatch and resolve it within the
   requested scope; do not silently redefine an approved requirement.

Continue routine, reversible work already authorized by the user. Ask only for
missing decisions or authorization that materially changes scope or permits an
otherwise unauthorized external action. A template does not require a new
checkpoint after every step. Delegate only when the user explicitly requests
parallel agents. Existing task authorization does not authorize unrelated work.

## Starting and preserving work

From the current checkout, inspect:

```bash
git status --short --branch
git worktree list --porcelain
git stash list
git remote -v
```

Fetch the remote before choosing a base. Normal work starts from
`origin/staging`, with a `codex/<task>` branch and a PR targeting `staging`.
Use an isolated worktree when another task owns the current checkout or there
is unrelated work. Inspect available task/session status when coordinating
shared work; directory age alone does not establish abandonment.

Preserve pre-existing changes, untracked files, stashes and local-only commits.
Do not reset, clean, overwrite or delete them as a convenience. When cleanup is
authorized, first establish ownership and recoverability; record the branch,
HEAD, dirty files and backup location before removing a worktree. A squash merge
can leave source commits outside the target's ancestry: compare the actual
patch/PR evidence before declaring such a branch unmerged or safe to discard.

Keep task notes in the applicable spec's tasks/verification files, or in the PR
for `Spec: N/A` changes. Include the checkout, branch, PR, latest SHA, checks,
remaining work and concrete blocker in a handoff. Secrets and temporary logs
do not belong in commits.

## Local verification

Run commands from the current worktree, never a hardcoded main checkout. Install
the versions from the lockfiles and use the configured backend virtualenv.
Select focused tests first, then the full suites for the affected layers before
pushing. Documentation-only changes need link/path/config validation and any
existing contract tests that read those documents; they do not inherently need
paid AI calls or live database mutations.

Canonical commands (from repository root unless a `cd` is shown):

```bash
# Backend; activate this checkout's backend environment first.
cd backend
python -m pytest tests/ -q
# Return to repository root before the following commands.
cd ..

# All frontend contract tests, including the retired-fixture loader used in CI.
node --import ./frontend/tests/fixtures/legacy-html-retired/loader.mjs --test \
  frontend/tests/*.test.mjs frontend/tests/*.test.js

# React interactions and both typecheck boundaries.
npm --prefix frontend run test:react
cd frontend
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.legacy.json
npm run build
cd ..

# Spec structure/lifecycle (requires PyYAML from backend requirements).
python backend/scripts/validate_specs.py
git diff --check
```

Use the relevant browser journey under `frontend/tooling/verify-*-flow.mjs` or
the configured Playwright suite for UI changes. Follow the environment and
server setup in `.github/workflows/next-native-browser.yml`. The fixture modal
suite (`npm --prefix frontend run test:e2e`) alone does not verify deployed Next
pages. Live Staging E2E is a separate release gate and mutates synthetic data in
the shared staging environment; coordinate it through the release workflow.

The backend's `--run-smoke` flag explicitly enables paid provider calls. Live
RLS/integration tests require their own credentials; a skipped test is not proof
that the corresponding contract passed. Report missing prerequisites and skip
counts. Do not remove, skip, xfail or narrow tests just to hide a regression.
An intentional behavior change may update its tests with the contract change.

GitHub CI verifies the consolidated patch. Preserve the three-round reset and
five-round limit in `AGENTS.md`; do not use successive pushes as a debugging
loop. Install the repository pre-push gate with `./scripts/hooks/install.sh`.
The shared wrapper resolves the checkout being pushed and clears Git's
repository-local environment before running tests that create temporary repos.
It remains usable after the worktree used to install it is removed. Personal
stop hooks are not the authoritative verification record.

## Review, release and completion

Review the whole affected contract before merge. Record root cause, severity,
locations, minimal fix and verification for each actionable finding. Use
[STAGING_FIRST_RELEASE_FLOW.md](STAGING_FIRST_RELEASE_FLOW.md) for migration
ordering, staging checks and production promotion.

Report these states separately:

- Patch: branch, commit/PR head and local verification results.
- Integration: PR merge state and checks for the exact merged staging SHA.
- Production, if requested: promotion PR, resulting main SHA, frontend/backend
  deployment SHA and affected live journey evidence.
- Product/spec: completed requirement evidence and any outstanding manual or
  operational acceptance work.

A successful deployment does not complete an unevidenced requirement. An old
unchecked pre-release task does not prove that the currently deployed code is
unreleased. Reconcile release evidence and requirement evidence explicitly.
Update stale current-status text instead of accumulating contradictory notes.

After completion, remove a task-owned temporary worktree only when it is clean,
its work is recoverable and cleanup is authorized. Preserve unrelated branches
and stashes. Verify the final working-tree status and report any retained work.

## Maintaining agent files

`AGENTS.md` owns shared rules; `CLAUDE.md` provides project context;
`frontend/AGENTS.md` owns frontend-specific guidance. Keep those roles distinct.
Shared skills and templates live in `backend/scripts/agent-config/`. The legacy local
paths `.agents/`, `.claude/` and `frontend/CLAUDE.md` remain ignored and are
never adopted as tracked files, so checkout/pull preserves local customizations.

Run `python3 backend/scripts/agent-config/install.py` explicitly from a prepared checkout.
It first moves every displaced target into a unique ignored
`.agent-config-backups/install-*/` directory, then links both skills directories
to the shared source and copies the launcher/frontend guide. It preserves
unrelated settings and does nothing on an unchanged repeat run. Inspect backed
up differences before reapplying personal customizations. To restore a prior
file, move its saved copy back to the original path after removing only the
installed replacement. Keep backups until those differences are reconciled.

The installer refuses symlinked target parents or backup directories instead of
writing through them. Resolve such a local layout explicitly before installing.
The launcher assumes the backend venv and frontend runtime config have been
prepared using `README.md`. Environment files, caches and generated knowledge
graphs remain outside version control.

Prompt templates in `docs/templates/` are entry points into this workflow, not
independent release policies. Generated Next.js instruction blocks in frontend
agent files should be preserved. A local knowledge graph is optional navigation
and must be checked against current source; its absence does not block work.

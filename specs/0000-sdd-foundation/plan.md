# Implementation plan

## Architecture impact

- Add canonical governance artifacts under `specs/`.
- Add a read-only Python validator under `backend/scripts/` and run it in a
  dedicated unfiltered workflow consumed by production promotion.
- Keep TypeScript/OpenAPI checks in their original workflow so an edited PR
  body cannot replace a failing check with a skipped-success conclusion.
- Update only stale architecture pointers in `AGENTS.md` and `CLAUDE.md`.

No application runtime module, API, database, or deployment-topology change.
The intended release-gate change is limited to requiring spec governance.

## Data and contracts

- Feature metadata is YAML frontmatter in `spec.md`.
- Directory prefix and spec-ID suffix must match.
- Functional requirements use `FR-NNN` and must be represented in
  `verification.md`.
- GitHub PR events provide the machine-readable `Change class` and `Spec`
  fields; staging-to-main promotion is explicitly exempt.
- There is no database migration or API contract change.

## UI and interaction

No product UI changes. `ui-states.md` is a template for future user-facing work.

## Work decomposition

- Governance documents and templates own `specs/**`.
- Validator and tests own `backend/scripts/validate_specs.py` and
  `backend/tests/test_validate_specs.py`.
- CI integration owns `.github/workflows/spec-governance.yml`,
  `.github/workflows/typecheck.yml`, `.github/workflows/backend-tests.yml`,
  `.github/workflows/staging-promotion-gate.yml`, and the PR template.
- Architecture correction owns only the stale top-level sections of
  `AGENTS.md` and `CLAUDE.md`.

These files do not overlap the active product worktrees observed before branch
creation.

## Rollout and rollback

- Merge through the normal PR-to-`staging` flow.
- The change affects only repository governance. Rollback is a normal revert.
- The validator is exercised by its own PR before it can govern later PRs.
- Production promotion remains governed by the existing exact-SHA gate.

## Verification strategy

- Unit-test repository structure, lifecycle, evidence, PR classification, and
  promotion exemption.
- Run the validator against this worktree.
- Run focused pytest for the validator.
- Run workflow/path coverage tests affected by the CI path-filter change.
- Review the final diff for product/runtime files and confirm none changed.

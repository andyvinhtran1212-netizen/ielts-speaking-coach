# Documentation map

Use this index to distinguish current instructions from historical evidence.
The date in a report describes its observation window, not today's deployment.

## Start here

| Need | Canonical reference |
| --- | --- |
| Install and run locally | [Root README](../README.md) |
| Shared agent agreement | [AGENTS.md](../AGENTS.md) and [agent workflow](AGENT_WORKFLOW.md) |
| Code navigation | [CLAUDE.md](../CLAUDE.md), [site overview](SITE_OVERVIEW.md) |
| Product intent and acceptance | [Spec index](../specs/README.md), [implementation status](../specs/IMPLEMENTATION_STATUS.md) |
| Release and rollback | [Staging-first release flow](STAGING_FIRST_RELEASE_FLOW.md) |
| Database and migrations | [Data models](data-models.md), [migration guide](../backend/migrations/README.md) |
| Verification | [Backend tests](../backend/tests/README.md), [browser tests](../frontend/tests/e2e/README.md), [AI evaluation](EVAL_HARNESS.md) |
| Durable design decisions | [Architecture decisions](adr/README.md) |
| Listening architecture | [Listening architecture](listening-architecture.md) |
| Brand | [Brand index](brand/README.md) |
| Repository maintenance | [Maintenance and scale](REPOSITORY_MAINTENANCE.md) |

## Document lifecycle

- Active requirements, task progress and acceptance evidence belong in the
  applicable `specs/NNNN-*/` directory. Update the spec index when status changes.
- Current runbooks describe repeatable operations; replace obsolete instructions
  in place, with Git preserving the previous version.
- Dated audits, sprint reports, cutover notes, incident records and completed
  implementation plans under `docs/` or at the repository root are historical
  evidence unless explicitly maintained as a current runbook above. They do not
  override the constitution, current code or executable tests.
- `specs/general/` is historical planning context. New feature intent uses the
  canonical spec lifecycle.
- Keep historical paths stable for existing links. When revisiting a report,
  label its date/scope and link the current replacement rather than copying its
  old instructions into a new active plan.
- Temporary logs, local backups, dependency directories and generated audit
  manifests stay outside tracked documentation. Record their location in the
  task handoff when needed for recovery.

Domain documents beyond this navigation table remain useful references; verify
their statements against the current implementation before acting on them.

# Spec-driven development

This directory is the canonical home for active product and platform intent.
Historical discovery, audit, migration, and incident evidence remains under
`docs/`; it is useful context, but it does not override an active feature spec,
the project constitution, shipped code, or executable tests.
The pre-existing `general/` directory is retained as legacy planning context and
is intentionally excluded from the canonical feature lifecycle.

## Workflow

1. Classify the change in the pull request as `hotfix`, `small`, `content`,
   `feature`, or `high-risk`.
2. `hotfix`, `small`, and `content` changes may use `Spec: N/A` when the PR body
   states the problem, expected behavior, scope, and verification. These details
   remain required if the PR elects to cite an existing spec.
3. `feature` and `high-risk` changes require a feature directory approved on
   the base branch before implementation starts. Land the approved spec first;
   do not self-approve it inside the implementation PR. Adding, removing, or
   changing a requirement—or raising its risk class—requires a spec approval
   change on the base branch before the implementation PR. An approved spec
   with `high` or `critical` risk must use the `high-risk` PR change class.
4. Refine `spec.md` before implementation details are committed to `plan.md`.
5. Derive dependency-ordered work in `tasks.md` and map every requirement to
   evidence in `verification.md`.
6. A feature may become `verified` or `shipped` only when required tasks are
   complete and every functional requirement has passing evidence, an
   explicitly recorded manual verification, or a reasoned non-applicability
   record.

The governing rules are in [`_meta/constitution.md`](_meta/constitution.md).
Templates are under [`_templates/`](_templates/).

## Risk profiles

| Change class | Required artifacts |
| --- | --- |
| `hotfix` | PR problem statement, root cause, expected behavior, focused test |
| `small` | PR scope/non-goals, acceptance notes, verification |
| `content` | Source provenance, rendering check, content validation |
| `feature` | `spec.md`, `plan.md`, `tasks.md`, `verification.md` |
| `high-risk` | Feature artifacts plus the relevant contract, data, UI-state, rollout, observability, and repair details |

High-risk includes grading, result persistence, auth/RLS, access-code truth,
mock/full-test finalization, schema migrations, regrade/rebuild flows, and paid
AI behavior changes. Unambiguous migration paths are checked against the Git
diff and cannot be downgraded through PR metadata.

## Naming and lifecycle

Feature directories use `NNNN-kebab-case` and their spec ID must end with the
same four digits. Allowed states are:

```text
draft -> approved -> implementing -> verified -> shipped
                                      \
                                       -> superseded
```

## Active index

| ID | Feature | Status | Risk | Spec |
| --- | --- | --- | --- | --- |
| SDD-0000 | Lean spec-driven development foundation | shipped | medium | [spec](0000-sdd-foundation/spec.md) |
| GRAMMAR-0001 | Timed grammar midterm assessment banks | approved | high | [spec](0001-timed-grammar-midterm-assessments/spec.md) |
| AVOC-0002 | Advanced Vocabulary self-paced core 30 | approved | high | [spec](0002-advanced-vocabulary-self-paced/spec.md) |
| MASTER30-0003 | MASTER30 Grammar Diagnostic and Adaptive Review | approved | high | [spec](0003-master30-grammar-diagnostic/spec.md) |
| AI-0004 | AI model usage observability and controlled model rollout | approved | high | [spec](0004-ai-model-usage-observability/spec.md) |
| LISTENING-0005 | Listening content programmes, import and learner hub | approved | high | [spec](0005-listening-content-programmes/spec.md) |
| LISTENING-0006 | Guided per-question Listening feedback | approved | high | [spec](0006-listening-guided-feedback/spec.md) |
| MOCKOPS-0006 | Admin Mock Test operations workspace at scale | approved | high | [spec](0006-admin-mock-test-operations/spec.md) |
| WRITING-NAV-0007 | Canonical admin Writing navigation context | approved | high | [spec](0007-writing-navigation-contract/spec.md) |

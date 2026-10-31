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
| GRAMMAR-0001 | Timed grammar midterm assessment banks | implementing | high | [spec](0001-timed-grammar-midterm-assessments/spec.md) |
| AVOC-0002 | Advanced Vocabulary self-paced core 30 | implementing | high | [spec](0002-advanced-vocabulary-self-paced/spec.md) |
| MASTER30-0003 | MASTER30 Grammar Diagnostic and Adaptive Review | implementing | high | [spec](0003-master30-grammar-diagnostic/spec.md) |
| GRAMMARLESSON-0017 | Assign individual MASTER30 Grammar lessons to Course 5 learners | approved | high | [spec](0017-grammar-lesson-assignments/spec.md) |
| MASTER30FULL-0018 | Assign the complete original MASTER30 Grammar banks | shipped | high | [spec](0018-master30-full-bank-assignments/spec.md) |
| AI-0004 | AI model usage observability and controlled model rollout | implementing | high | [spec](0004-ai-model-usage-observability/spec.md) |
| AIBUDGET-0033 | Paid AI stops at hard budgets, Claude alerts on a soft budget, and learner work waits safely for grading | approved | critical | [spec](0033-ai-budget-hard-cap/spec.md) |
| LISTENING-0005 | Listening content programmes, import and learner hub | implementing | high | [spec](0005-listening-content-programmes/spec.md) |
| LISTENING-0006 | Guided per-question Listening feedback | implementing | high | [spec](0006-listening-guided-feedback/spec.md) |
| LISTENING-0007 | Versioned Listening editorial revision and bilingual questions | implementing | high | [spec](0007-listening-editorial-revision/spec.md) |
| MOCKOPS-0006 | Admin Mock Test operations workspace at scale | implementing | high | [spec](0006-admin-mock-test-operations/spec.md) |
| WRITINGNAV-0007 | Canonical admin Writing navigation context | implementing | high | [spec](0007-writing-navigation-contract/spec.md) |
| MOCKATTACH-0008 | Mock Reading and Listening attempt integrity | implementing | high | [spec](0008-mock-attempt-integrity/spec.md) |
| LISTENING80-0009 | Source-faithful 80-day Listening practice collection | approved | high | [spec](0009-listening-80-days/spec.md) |

| DICTATIONTOKEN-0011 | Version dictation word grading and distinguish punctuation in reports | approved | high | [spec](0011-versioned-dictation-token-grading/spec.md) |

| READINGGRAMMAR-0012 | Correct L1 Reading grammar analysis without replacing passage questions | implementing | medium | [spec](0012-reading-grammar-focus-edit/spec.md) |

| WRITINGMODAL-0013 | Make Writing content dialogs follow browser history and keyboard focus | implementing | medium | [spec](0013-writing-content-modal-history/spec.md) |

| GRAMMARCUTOVER-0014 | Preserve Grammar quiz history during bounded bank revision cutover | approved | high | [spec](0014-grammar-bank-revision-cutover/spec.md) |

| GRAMMARTEXT-0015 | Require exact authored forms for bounded Grammar questions while preserving old work | approved | high | [spec](0015-grammar-exact-form-policy/spec.md) |

| MOCKREPAIR-0016 | Preserve mock paper security and repair Reading and Listening work truthfully | approved | critical | [spec](0016-mock-content-remediation/spec.md) |

Progress and remaining acceptance are reconciled in [the implementation status ledger](IMPLEMENTATION_STATUS.md). A deployed application does not by itself close a feature acceptance gate.

| LEARNERDRAFT-0010 | Preserve Reading answers and Speaking preparation within a browser tab | implementing | medium | [spec](0010-learner-draft-preservation/spec.md) |

| GRAMMARAUDIT-0019 | Close the October Grammar audit while preserving every learner revision | approved | high | [spec](0019-grammar-audit-remediation/spec.md) |

| VOCABSETS-0020 | Vocabulary class sets and unified learning workspace | approved | high | [spec](0020-vocabulary-class-sets/spec.md) |

| READINGPRACTICE-0021 | Repair Reading practice and support sentence translation in place | implementing | high | [spec](0021-reading-practice-support/spec.md) |

| REVEXPLAIN-0022 | Bind reviewed interactive explanations to Cambridge revision papers and name approval refusals | implementing | high | [spec](0022-revision-explanation-binding/spec.md) |

| SECWRITE-0022 | Client roles cannot write privilege, score or session data | approved | critical | [spec](0022-client-write-privilege-lockdown/spec.md) |

| AIOPS-0024 | Admin AI dashboard with model control, token spend and failure log | approved | high | [spec](0024-admin-ai-model-control/spec.md) |

| REVEXPLAIN-0023 | Bind Cambridge REV papers by marking-equivalent keys and document accepted forms | implementing | high | [spec](0023-revision-explanation-key-equivalence/spec.md) |

| WRITINGRATE-0025 | Repair writing_grade_ratings drift so admin grade ratings key on the graded run | approved | high | [spec](0025-writing-grade-ratings-feedback-version/spec.md) |

| ROLECHECK-0026 | Admins can make a user an instructor because users.role has one correct CHECK | approved | high | [spec](0026-users-role-single-check/spec.md) |

| ASSIGNDRAFT-0027 | Deleting a writing assignment can never erase a learner's draft | approved | high | [spec](0027-writing-draft-assignment-delete-guard/spec.md) |

| CODEUNIQ-0028 | Access codes are unique and canonical in the repository schema | approved | high | [spec](0028-access-code-unique-canonical/spec.md) |

| STUDENTARCHIVE-0029 | Admin student delete archives the learner with an audit trail instead of erasing their work | approved | critical | [spec](0029-student-archive/spec.md) |
| CLASSARCHIVE-0030 | An archived class is hidden from learners, takes no new learners or work, and closes its open work without losing it | approved | high | [spec](0030-class-archive/spec.md) |

| GIVEARCHIVE-0031 | A Writing give can never create work for an archived learner, even when the archive lands mid-request | approved | high | [spec](0031-archived-learner-give-guard/spec.md) |

| ADMINAAL2-0032 | Admin powers require a verified second factor and a suspended or demoted staff account loses access on its next request | approved | critical | [spec](0032-admin-aal2-staff-guard/spec.md) |

| ACTIVATELIMIT-0034 | Access-code activation attempts are limited per learner across every backend worker, and the limit fails closed | approved | high | [spec](0034-activate-attempt-rate-limit/spec.md) |

| INACTIVEWRITE-0035 | An inactive account cannot write Vocabulary or flashcard rows through any path, including direct Supabase REST | approved | high | [spec](0035-inactive-learner-rest-write-guard/spec.md) |

| ASYNCAUTH-0036 | Per-request auth and permission checks can run on the async DB client behind USE_ASYNC_DB without changing any access decision | approved | high | [spec](0036-async-db-auth-layer/spec.md) |

| PAPERUPDATEDAT-0037 | Every change to a Reading or Listening paper advances updated_at, and admins see that a Mock Test hides its public source | approved | high | [spec](0037-mock-paper-updated-at-and-hide-warning/spec.md) |

| STORAGELIMITS-0038 | Each Storage bucket accepts only the file sizes and types the app writes, and an oversize or wrong-type upload gets a clear 413 or 415 | approved | high | [spec](0038-storage-bucket-limits/spec.md) |

| RLSCLEANUP-0039 | No RLS policy depends on the revoked admin or instructor helper functions, and learner or instructor JWTs have no direct access to the 21 admin-managed tables | approved | high | [spec](0039-rls-admin-policy-cleanup/spec.md) |

| VOCABGUARD-0040 | A review or task of a published curated vocabulary version can never be moved to another version | approved | high | [spec](0040-vocab-curated-published-child-guard/spec.md) |

| CALAPPEND-0041 | The class action log is append-only for every role, and no role can wipe it with TRUNCATE | approved | high | [spec](0041-class-action-log-append-only/spec.md) |

| SVCPRIV-0042 | service_role loses public table maintenance privileges and schema CREATE, and unpinned public functions get a fixed search_path, to block owner-run planted triggers, function overloads and temp-object shadowing | draft | critical | [spec](0042-service-role-table-maintenance-revoke/spec.md) |

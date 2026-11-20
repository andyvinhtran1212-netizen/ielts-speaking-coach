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
| Database and migrations | [Migration guide](../backend/migrations/README.md), [backend tests](../backend/tests/README.md) |
| Verification | [Backend tests](../backend/tests/README.md), [browser tests](../frontend/tests/e2e/README.md), [AI evaluation](EVAL_HARNESS.md) |
| Durable design decisions | [Architecture decisions](adr/README.md) |
| Listening architecture | [Listening architecture](listening-architecture.md) |
| AI provider routing and env vars | [AI provider routing](AI_PROVIDER_ROUTING.md) |
| Content-Security-Policy | [CSP runbook](CONTENT_SECURITY_POLICY.md) |
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
- Historical files stay at a stable path while anything in this repository
  links to them; unreferenced historical files may move to `docs/history/` with
  an index row. When revisiting a report, label its date/scope and link the
  current replacement rather than copying its old instructions into a new
  active plan.
- Temporary logs, local backups, dependency directories and generated audit
  manifests stay outside tracked documentation. Record their location in the
  task handoff when needed for recovery.

## Historical evidence

Dated reports and plans in the top level of `docs/` or, when nothing else in
the repository links to them, under `docs/history/<family>/`, grouped by family. They
record what was observed or planned on the date shown; current code, tests,
specs and the runbooks under "Start here" take precedence. "Superseded by" is
filled only where the file itself names its replacement. A date marked
"last commit" comes from `git log -1 --format=%cs` because the file name has no
date.

| Family | File | Date | Superseded by |
| --- | --- | --- | --- |
| Gate B | [GATE_B_EVIDENCE_2026-07-13.md](GATE_B_EVIDENCE_2026-07-13.md) | 2026-07-13 | - |
| Gate C | [GATE_C_EVIDENCE_2026-08-02.md](history/gate/GATE_C_EVIDENCE_2026-08-02.md) | 2026-08-02 | - |
| Gate D | [GATE_D_RETROSPECTIVE_2026-08-08.md](history/gate/GATE_D_RETROSPECTIVE_2026-08-08.md) | 2026-08-08 | `.github/workflows/next-native-browser.yml` (self-declared 2026-09-12) |
| Gate E | [GATE_E_ACTIVE_SESSION_AFFINITY_2026-08-09.md](history/gate/GATE_E_ACTIVE_SESSION_AFFINITY_2026-08-09.md) | 2026-08-09 | - |
| Gate E | [GATE_E_DEVICE_MATRIX_2026-08-09.md](GATE_E_DEVICE_MATRIX_2026-08-09.md) | 2026-08-09 | - |
| Gate E | [GATE_E_PREFLIGHT_2026-08-09.md](GATE_E_PREFLIGHT_2026-08-09.md) | 2026-08-09 | - |
| Gate E | [GATE_E_SPEAKING_CORE_2026-08-09.md](GATE_E_SPEAKING_CORE_2026-08-09.md) | 2026-08-09 | - |
| Gate E | [GATE_E_STREAK_LEDGER_2026-08-09.md](history/gate/GATE_E_STREAK_LEDGER_2026-08-09.md) | 2026-08-09 | - |
| Gate E | [GATE_E_READING_CORE_2026-08-11.md](history/gate/GATE_E_READING_CORE_2026-08-11.md) | 2026-08-11 | - |
| Gate E | [GATE_E_SPEAKING_REAL_DEVICE_RUNBOOK_2026-08-11.md](GATE_E_SPEAKING_REAL_DEVICE_RUNBOOK_2026-08-11.md) | 2026-08-11 (dated runbook) | - |
| Gate E | [GATE_E_LISTENING_CORE_2026-08-12.md](history/gate/GATE_E_LISTENING_CORE_2026-08-12.md) | 2026-08-12 | - |
| Gate E | [GATE_E_WRITING_CORE_2026-08-14.md](history/gate/GATE_E_WRITING_CORE_2026-08-14.md) | 2026-08-14 | - |
| Gate E | [GATE_E_REAL_DEVICE_EVIDENCE_2026-08-19.md](GATE_E_REAL_DEVICE_EVIDENCE_2026-08-19.md) | 2026-08-19 | - |
| Gate E | [GATE_E_REAL_DEVICE_REPIN_2026-08-19.md](GATE_E_REAL_DEVICE_REPIN_2026-08-19.md) | 2026-08-19 | - |
| Gate E | [GATE_E_CORE_CUTOVER_EVIDENCE_2026-08-24.md](history/gate/GATE_E_CORE_CUTOVER_EVIDENCE_2026-08-24.md) | 2026-08-24 | - |
| Gate F | [GATE_F_LEGACY_RETIREMENT_RUNBOOK_2026-08-16.md](GATE_F_LEGACY_RETIREMENT_RUNBOOK_2026-08-16.md) | 2026-08-16 (dated runbook) | [Next.js migration status](NEXTJS_MIGRATION_STATUS.md) |
| Gate F | [GATE_F_OBSERVATION_START_EVIDENCE_2026-08-17.md](GATE_F_OBSERVATION_START_EVIDENCE_2026-08-17.md) | 2026-08-17 | - |
| Gate F | [GATE_F_REDIRECT_SOAK_PREFLIGHT_2026-09-01.md](GATE_F_REDIRECT_SOAK_PREFLIGHT_2026-09-01.md) | 2026-09-01 | - |
| Cutover | [CUTOVER_GRAMMAR_HOME_2026-08-03.md](history/cutover/CUTOVER_GRAMMAR_HOME_2026-08-03.md) | 2026-08-03 | `.github/workflows/next-native-browser.yml` (self-declared 2026-09-12) |
| Cutover | [CUTOVER_HOME_2026-08-05.md](history/cutover/CUTOVER_HOME_2026-08-05.md) | 2026-08-05 | `.github/workflows/next-native-browser.yml` (self-declared 2026-09-12) |
| Cutover | [CUTOVER_SPEAKING_2026-08-05.md](history/cutover/CUTOVER_SPEAKING_2026-08-05.md) | 2026-08-05 | - |
| Spike | [SPIKE_1_MEDIARECORDER_2026-07-14.md](history/spike/SPIKE_1_MEDIARECORDER_2026-07-14.md) | 2026-07-14 | - |
| Spike | [SPIKE_2_PRACTICE_STATE_MACHINE_2026-07-14.md](history/spike/SPIKE_2_PRACTICE_STATE_MACHINE_2026-07-14.md) | 2026-07-14 | - |
| Spike | [SPIKE_3_CROSS_STACK_RESUME_2026-07-14.md](history/spike/SPIKE_3_CROSS_STACK_RESUME_2026-07-14.md) | 2026-07-14 | - |
| Spike | [SPIKE_4_GRADING_FAULT_PARITY_2026-07-14.md](history/spike/SPIKE_4_GRADING_FAULT_PARITY_2026-07-14.md) | 2026-07-14 | - |
| Pilot | [PILOT_ENTRY_CHECKLIST_2026-07-13.md](PILOT_ENTRY_CHECKLIST_2026-07-13.md) | 2026-07-13 | - |
| Pilot | [PILOT_1_BASELINE_2026-07-14.md](PILOT_1_BASELINE_2026-07-14.md) | 2026-07-14 | - |
| Pilot | [PILOT_1_CUTOVER_SHEET.md](PILOT_1_CUTOVER_SHEET.md) | 2026-07-14 (last commit) | - |
| Pilot | [SOAK_DECLARATION_PILOT_1.md](SOAK_DECLARATION_PILOT_1.md) | 2026-07-25 (last commit) | - |
| Pilot | [PILOT_2_CUTOVER_SHEET.md](PILOT_2_CUTOVER_SHEET.md) | 2026-07-31 (last commit) | - |
| Pilot | [PILOT_3_4_CUTOVER_SHEET.md](PILOT_3_4_CUTOVER_SHEET.md) | 2026-08-04 (last commit) | - |
| Sprint | [sprint-6-14-admin-prework.md](history/sprint/sprint-6-14-admin-prework.md) | 2026-05-11 (last commit) | - |
| Sprint | [sprint-7-1-vocab-iframe-discovery.md](sprint-7-1-vocab-iframe-discovery.md) | 2026-05-13 (last commit) | - |
| Sprint | [sprint-7-11-prompt-aver-chrome-build.md](sprint-7-11-prompt-aver-chrome-build.md) | 2026-05-13 (last commit) | - |
| Sprint | [sprint-7-3-prompt-my-vocab-module.md](sprint-7-3-prompt-my-vocab-module.md) | 2026-05-13 (last commit) | - |
| Sprint | [sprint-7-9-chrome-web-component-discovery.md](sprint-7-9-chrome-web-component-discovery.md) | 2026-05-13 (last commit) | - |
| Sprint | [sprint-9-0-vocab-subpages-discovery.md](history/sprint/sprint-9-0-vocab-subpages-discovery.md) | 2026-05-14 (last commit) | - |
| Sprint | [sprint-10-0-vocab-workflow-discovery.md](sprint-10-0-vocab-workflow-discovery.md) | 2026-05-15 (last commit) | - |
| Sprint | [sprint-11-0-listening-discovery.md](sprint-11-0-listening-discovery.md) | 2026-05-17 (last commit) | - |
| Sprint | [sprint-11-1-listening-data-model-prompt.md](sprint-11-1-listening-data-model-prompt.md) | 2026-05-17 (last commit) | - |
| Sprint | [sprint-11-6-phase-b-trigger-criteria.md](sprint-11-6-phase-b-trigger-criteria.md) | 2026-05-18 (last commit) | - |
| Sprint | [sprint-12-0-admin-discovery.md](sprint-12-0-admin-discovery.md) | 2026-05-19 (last commit) | - |
| Sprint | [sprint-12-8-cluster-closure-retrospective.md](sprint-12-8-cluster-closure-retrospective.md) | 2026-05-19 (last commit) | - |
| Sprint | [sprint-12-b-phase-b-triggers.md](sprint-12-b-phase-b-triggers.md) | 2026-05-19 (last commit) | - |
| Sprint | [sprint-13-0-listening-authoring-discovery.md](sprint-13-0-listening-authoring-discovery.md) | 2026-05-20 (last commit) | - |
| Sprint | [sprint-13-1-listening-content-management-prompt.md](sprint-13-1-listening-content-management-prompt.md) | 2026-05-20 (last commit) | - |
| Sprint | [sprint-13-6-cluster-closure-retrospective.md](sprint-13-6-cluster-closure-retrospective.md) | 2026-05-22 (last commit) | - |
| Handoff | [HANDOFF_PROJECT_FULL_2026_05_25.md](HANDOFF_PROJECT_FULL_2026_05_25.md) | 2026-05-25 | - |
| Handoff | [HANDOFF_PROJECT_FULL_2026-05-26-post-18.md](history/handoff/HANDOFF_PROJECT_FULL_2026-05-26-post-18.md) | 2026-05-26 | - |
| Handoff | [HANDOFF_PROJECT_FULL_2026-05-26.md](history/handoff/HANDOFF_PROJECT_FULL_2026-05-26.md) | 2026-05-26 | - |
| Handoff | [GRAMMAR_HANDOFF_consolidated_2026-06-27.md](GRAMMAR_HANDOFF_consolidated_2026-06-27.md) | 2026-06-27 | - |
| Audit / QA | [GRAMMAR_CONTENT_AUDIT_2026-07-02.md](history/audit/GRAMMAR_CONTENT_AUDIT_2026-07-02.md) | 2026-07-02 | - |
| Audit / QA | [QA2_REPORT.md](history/audit/QA2_REPORT.md) | 2026-07-02 (last commit) | - |
| Audit / QA | [QA2_REVIEWER_PROMPT.md](QA2_REVIEWER_PROMPT.md) | 2026-07-02 (last commit) | - |
| Audit / QA | [AUDIT_VOCAB_AUDIO_PRACTICE_2026-07-28.md](AUDIT_VOCAB_AUDIO_PRACTICE_2026-07-28.md) | 2026-07-28 | - |
| Audit / QA | [AUDIT_VOCAB_FIXES_2026-07-28.md](AUDIT_VOCAB_FIXES_2026-07-28.md) | 2026-07-28 | - |
| Audit / QA | [LISTENING_AUDIT_PLAN.md](history/audit/LISTENING_AUDIT_PLAN.md) | 2026-08-14 (last commit) | - |
| Plan / proposal | [PHASE_B_BACKLOG_2026_05_25.md](PHASE_B_BACKLOG_2026_05_25.md) | 2026-05-25 | - |
| Plan / proposal | [admin_dashboard_redesign_proposal.md](history/plan/admin_dashboard_redesign_proposal.md) | 2026-05-30 (last commit) | - |
| Plan / proposal | [GRAMMAR_CHECKUP_PLAN.md](GRAMMAR_CHECKUP_PLAN.md) | 2026-07-02 (last commit) | - |
| Plan / proposal | [MOCK_TEST_4KY_NANG_PLAN_2026-07-11.md](history/plan/MOCK_TEST_4KY_NANG_PLAN_2026-07-11.md) | 2026-07-11 | - |
| Plan / proposal | [FE_NEXTJS_MIGRATION_MASTER_PLAN_2026-07-12.md](FE_NEXTJS_MIGRATION_MASTER_PLAN_2026-07-12.md) | 2026-07-12 | - |
| Plan / proposal | [DESIGN_SYSTEM_CONSOLIDATION_PLAN.md](DESIGN_SYSTEM_CONSOLIDATION_PLAN.md) | 2026-07-25 (last commit) | - |
| Plan / proposal | [FULL_TEST_REMEDIATION_PLAN_2026-07-25.md](history/plan/FULL_TEST_REMEDIATION_PLAN_2026-07-25.md) | 2026-07-25 | - |
| Plan / proposal | [CLASS_MANAGEMENT_PLAN_2026-08-02.md](CLASS_MANAGEMENT_PLAN_2026-08-02.md) | 2026-08-02 | - |
| Plan / proposal | [SPEAKING_LESSON_HOMEWORK_PLAN_2026-08-04.md](history/plan/SPEAKING_LESSON_HOMEWORK_PLAN_2026-08-04.md) | 2026-08-04 | - |
| Plan / proposal | [SOCIAL_FANPAGE_PLAN_2026-08-09.md](SOCIAL_FANPAGE_PLAN_2026-08-09.md) | 2026-08-09 | - |
| Incident | [QUIZ_PROGRESS_INCIDENT.md](history/incident/QUIZ_PROGRESS_INCIDENT.md) | 2026-07-03 (last commit) | - |
| Other dated report | [FE_MIGRATION_DECISION_2026-07-11.md](FE_MIGRATION_DECISION_2026-07-11.md) | 2026-07-11 | - |
| Other dated report | [ENV_CERTIFICATION_STAGING_2026-07-13.md](ENV_CERTIFICATION_STAGING_2026-07-13.md) | 2026-07-13 | - |
| Other dated report | [TRAFFIC_BASELINE_2026-07-13.md](TRAFFIC_BASELINE_2026-07-13.md) | 2026-07-13 | - |
| Other dated report | [PARITY_WRITING_PAIR_2026-08-05.md](history/other/PARITY_WRITING_PAIR_2026-08-05.md) | 2026-08-05 | `.github/workflows/next-native-browser.yml` (self-declared 2026-09-12) |
| Other dated report | [CLASS_UI_REDESIGN_2026-08-06.md](history/other/CLASS_UI_REDESIGN_2026-08-06.md) | 2026-08-06 | - |

Domain documents beyond this navigation table remain useful references; verify
their statements against the current implementation before acting on them.

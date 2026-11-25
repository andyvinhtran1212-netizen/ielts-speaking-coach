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
| AI-0004 | AI model usage observability and controlled model rollout | implementing | high | [spec](0004-ai-model-usage-observability/spec.md) |
| LISTENING-0005 | Listening content programmes, import and learner hub | implementing | high | [spec](0005-listening-content-programmes/spec.md) |
| LISTENING-0006 | Guided per-question Listening feedback | implementing | high | [spec](0006-listening-guided-feedback/spec.md) |
| MOCKOPS-0006 | Admin Mock Test operations workspace at scale | implementing | high | [spec](0006-admin-mock-test-operations/spec.md) |
| LISTENING-0007 | Versioned Listening editorial revision and bilingual questions | implementing | high | [spec](0007-listening-editorial-revision/spec.md) |
| WRITINGNAV-0007 | Canonical admin Writing navigation context | implementing | high | [spec](0007-writing-navigation-contract/spec.md) |
| MOCKATTACH-0008 | Mock Reading and Listening attempt integrity | implementing | high | [spec](0008-mock-attempt-integrity/spec.md) |
| LISTENING80-0009 | Source-faithful 80-day Listening practice collection | implementing | high | [spec](0009-listening-80-days/spec.md) |
| LEARNERDRAFT-0010 | Preserve Reading answers and Speaking preparation within a browser tab | implementing | medium | [spec](0010-learner-draft-preservation/spec.md) |
| DICTATIONTOKEN-0011 | Version dictation word grading and distinguish punctuation in reports | implementing | high | [spec](0011-versioned-dictation-token-grading/spec.md) |
| READINGGRAMMAR-0012 | Correct L1 Reading grammar analysis without replacing passage questions | implementing | medium | [spec](0012-reading-grammar-focus-edit/spec.md) |
| WRITINGMODAL-0013 | Make Writing content dialogs follow browser history and keyboard focus | implementing | medium | [spec](0013-writing-content-modal-history/spec.md) |
| GRAMMARCUTOVER-0014 | Preserve Grammar quiz history during bounded bank revision cutover | approved | high | [spec](0014-grammar-bank-revision-cutover/spec.md) |
| GRAMMARTEXT-0015 | Require exact authored forms for bounded Grammar questions while preserving old work | implementing | high | [spec](0015-grammar-exact-form-policy/spec.md) |
| MOCKREPAIR-0016 | Preserve mock paper security and repair Reading and Listening work truthfully | implementing | critical | [spec](0016-mock-content-remediation/spec.md) |
| GRAMMARLESSON-0017 | Assign individual MASTER30 Grammar lessons to Course 5 learners | shipped | high | [spec](0017-grammar-lesson-assignments/spec.md) |
| MASTER30FULL-0018 | Assign the complete original MASTER30 Grammar banks | shipped | high | [spec](0018-master30-full-bank-assignments/spec.md) |
| GRAMMARAUDIT-0019 | Close the October Grammar audit while preserving every learner revision | implementing | high | [spec](0019-grammar-audit-remediation/spec.md) |
| VOCABSETS-0020 | Vocabulary class sets and unified learning workspace | implementing | high | [spec](0020-vocabulary-class-sets/spec.md) |
| READINGPRACTICE-0021 | Repair Reading practice and support sentence translation in place | implementing | high | [spec](0021-reading-practice-support/spec.md) |
| REVEXPLAIN-0022 | Bind reviewed interactive explanations to Cambridge revision papers and name approval refusals | implementing | high | [spec](0022-revision-explanation-binding/spec.md) |
| SECWRITE-0022 | Client roles cannot write privilege, score or session data | implementing | critical | [spec](0022-client-write-privilege-lockdown/spec.md) |
| REVEXPLAIN-0023 | Bind Cambridge REV papers by marking-equivalent keys and document accepted forms | verified | high | [spec](0023-revision-explanation-key-equivalence/spec.md) |
| AIOPS-0024 | Admin AI dashboard with model control, token spend and failure log | implementing | high | [spec](0024-admin-ai-model-control/spec.md) |
| WRITINGRATE-0025 | Repair writing_grade_ratings drift so admin grade ratings key on the graded run | implementing | high | [spec](0025-writing-grade-ratings-feedback-version/spec.md) |
| ROLECHECK-0026 | Admins can make a user an instructor because users.role has one correct CHECK | implementing | high | [spec](0026-users-role-single-check/spec.md) |
| ASSIGNDRAFT-0027 | Deleting a writing assignment can never erase a learner's draft | verified | high | [spec](0027-writing-draft-assignment-delete-guard/spec.md) |
| CODEUNIQ-0028 | Access codes are unique and canonical in the repository schema | verified | high | [spec](0028-access-code-unique-canonical/spec.md) |
| STUDENTARCHIVE-0029 | Admin student delete archives the learner with an audit trail instead of erasing their work | implementing | critical | [spec](0029-student-archive/spec.md) |
| CLASSARCHIVE-0030 | An archived class is hidden from learners, takes no new learners or work, and closes its open work without losing it | approved | high | [spec](0030-class-archive/spec.md) |
| GIVEARCHIVE-0031 | A Writing give can never create work for an archived learner, even when the archive lands mid-request | implementing | high | [spec](0031-archived-learner-give-guard/spec.md) |
| ADMINAAL2-0032 | Admin powers require a verified second factor and a suspended or demoted staff account loses access on its next request | approved | critical | [spec](0032-admin-aal2-staff-guard/spec.md) |
| AIBUDGET-0033 | Paid AI stops at hard budgets, Claude alerts on a soft budget, and learner work waits safely for grading | approved | critical | [spec](0033-ai-budget-hard-cap/spec.md) |
| ACTIVATELIMIT-0034 | Access-code activation attempts are limited per learner across every backend worker, and the limit fails closed | implementing | high | [spec](0034-activate-attempt-rate-limit/spec.md) |
| INACTIVEWRITE-0035 | An inactive account cannot write Vocabulary or flashcard rows through any path, including direct Supabase REST | implementing | high | [spec](0035-inactive-learner-rest-write-guard/spec.md) |
| ASYNCAUTH-0036 | Per-request auth and permission checks can run on the async DB client behind USE_ASYNC_DB without changing any access decision | approved | high | [spec](0036-async-db-auth-layer/spec.md) |
| PAPERUPDATEDAT-0037 | Every change to a Reading or Listening paper advances updated_at, and admins see that a Mock Test hides its public source | implementing | high | [spec](0037-mock-paper-updated-at-and-hide-warning/spec.md) |
| STORAGELIMITS-0038 | Each Storage bucket accepts only the file sizes and types the app writes, and an oversize or wrong-type upload gets a clear 413 or 415 | approved | high | [spec](0038-storage-bucket-limits/spec.md) |
| RLSCLEANUP-0039 | No RLS policy depends on the revoked admin or instructor helper functions, and learner or instructor JWTs have no direct access to the 21 admin-managed tables | approved | high | [spec](0039-rls-admin-policy-cleanup/spec.md) |
| VOCABGUARD-0040 | A review or task of a published curated vocabulary version can never be moved to another version | approved | high | [spec](0040-vocab-curated-published-child-guard/spec.md) |
| CALAPPEND-0041 | The class action log is append-only for every role, and no role can wipe it with TRUNCATE | approved | high | [spec](0041-class-action-log-append-only/spec.md) |
| SVCPRIV-0042 | service_role loses public table maintenance privileges and schema CREATE, and unpinned public functions get a fixed search_path, to block owner-run planted triggers, function overloads and temp-object shadowing | approved | critical | [spec](0042-service-role-table-maintenance-revoke/spec.md) |
| LESSONREPORT-0043 | Teachers see a course assessment's results per lesson for each learner and the whole class, with the weakest lessons highlighted | approved | high | [spec](0043-course-assessment-lesson-report/spec.md) |
| INSTRUCTORGIVE-0044 | A teacher's repeated or retried Writing give from /instructor creates the homework once | approved | high | [spec](0044-instructor-give-idempotency/spec.md) |
| FNEXEC-0045 | A new database function cannot be called by anonymous or signed-in clients unless a migration grants it explicitly, and only the two functions clients really use stay callable | draft | high | [spec](0045-function-default-execute-lockdown/spec.md) |
| SERVERCHECK-0046 | Self-study quiz answers are graded on the server one question at a time, no learner can forge a correct answer, and a one-sitting assessment key stays closed until the class deadline | draft | high | [spec](0046-quiz-server-check-key-release/spec.md) |
| FREETRIAL-0047 | Accounts outside classes can try free Speaking and Writing grading within quotas without affecting class learners | approved | high | [spec](0047-free-trial-grading/spec.md) |
| FLASHCARD-0048 | Flashcard kiểu Quizlet bản MVP — admin dán hàng loạt thẻ vào bộ từ, gán lớp hoặc thư viện chung, học viên lật thẻ và tự đánh dấu Đã nhớ/Chưa nhớ | draft | high | [spec](0048-flashcards-mvp/spec.md) |
| WRITINGBAND-0050 | Saving reviewed Writing criteria keeps the total and feedback consistent | approved | high | [spec](0050-writing-band-save-consistency/spec.md) |
| AUDIODEPR-0051 | Speaking read-aloud and Speaking transcription keep working after OpenAI retires tts-1 and whisper-1 | approved | high | [spec](0051-openai-tts-stt-deprecation/spec.md) |
| BLACKEYE-0052 | Black Eye Listening Unit 1 exercises are assigned to a class, reviewed after submission and stay locked until each gate passes | approved | high | [spec](0052-blackeye-u1/spec.md) |
| SKILLDRILLS-0054 | Assign published Listening Skill Drills across courses | approved | high | [spec](0054-listening-skill-drill-homework/spec.md) |
| COURSEACCESS-0055 | Learners get course access, one shared AI grading credit pool and bank-transfer enrollment orders confirmed by an admin, while existing access codes keep working | approved | critical | [spec](0055-course-access-credits-enrollment/spec.md) |
| UIBASE-0056 | New pages share one Ban in design foundation of tokens, fonts, components and four page shells, while every existing page keeps its current look | approved | medium | [spec](0056-ui-foundation/spec.md) |
| TESTPOLICY-0057 | New tests check behaviour instead of source text, and an advisory visual baseline shows every intended or accidental change to key screens | draft | medium | [spec](0057-test-policy-visual-baseline/spec.md) |
| MIGNUM-0058 | Each work package takes migration numbers only from its own block, and the migration register test rejects a number outside or in another package's block | draft | high | [spec](0058-migration-number-blocks/spec.md) |
| LIBRARY-0061 | Anyone can read the public Library of Writing samples, Writing guides, Speaking questions with synthetic-voice model answers, Grammar and Vocabulary without an account, and signed-in learners keep read and saved marks | approved | high | [spec](0061-public-library/spec.md) |
| LEARNERCORE-0063 | Signed-in learners open Today to see what to do now in one of five states, from one read API, behind a per-learner switch that an admin can turn off in seconds | approved | high | [spec](0063-learner-core/spec.md) |
| LEARNERNAV-0062 | Signed-in learners find every page under the same five sections, and 17 old learner URLs move to their new home while every bookmark and shared link still opens the right page | approved | high | [spec](0062-learner-navigation/spec.md) |
| LEGACYJS-0075 | Legacy public scripts that no page loads are removed in reviewed batches, each file backed by reference and request evidence, without any page losing a script it needs | approved | high | [spec](0075-legacy-public-js-retirement/spec.md) |
| ADMINIA-0074 | Admins and the class teacher run daily work from one admin frame with eight sidebar groups, a unified learner directory and profile, and canonical queues | approved | high | [spec](0074-admin-ia/spec.md) |
| BACKENDSPLIT-0076 | The three largest backend modules are split into packages without changing any route, import, OpenAPI contract or test patch target | approved | high | [spec](0076-backend-module-split/spec.md) |
| NOTIFY-0079 | Learners see one bell of in-app notifications and an overdue count, and staff send reminders to a class or chosen learners exactly once | draft | high | [spec](0079-learner-notifications/spec.md) |
| ADMINGROUP-0077 | Admin pages share one route group and one shell layout while every page keeps its URL, its stylesheets in the same cascade order and its current look | approved | medium | [spec](0077-admin-route-group-consolidation/spec.md) |
| TRIALCAP-0080 | Free trial grading stops at configurable per-person, per-day and site-wide daily cost caps that admins change and pause from Settings with an audit log | draft | high | [spec](0080-free-trial-caps-settings/spec.md) |
| MEDIAOUT-0078 | Advanced Vocabulary media leaves the Git working tree while every existing media URL keeps playing, seeking and loading | approved | high | [spec](0078-advanced-vocab-media-delivery/spec.md) |
| EXAMROOM-0066 | Learners take every timed test and practice in one exam room that saves visibly, asks before submitting and never loses work to a dropped connection or expired session | approved | high | [spec](0066-exam-room-shell/spec.md) |
| EXAMREAD-0067 | Reading full tests and mini tests run in the shared exam room behind a flag, with the same requests, answers and results as today | draft | high | [spec](0067-exam-room-reading/spec.md) |
| EXAMWRITE-0068 | Learners write class Writing assignments in the shared practice room, with in-page submit checks, visible saving and draft recovery instead of browser dialogs | draft | high | [spec](0068-exam-room-writing/spec.md) |
| EXAMLISTENP-0069 | Listening practice forms and 80-day lessons ask before finishing, show when answers were saved and keep the learner's work in the shared practice room | approved | high | [spec](0069-exam-room-listening-practice/spec.md) |
| EXAMLISTENT-0070 | Listening full tests, mini tests and drills run in the shared exam room behind a flag, with the same requests, audio rules and results as today | approved | high | [spec](0070-exam-room-listening-test/spec.md) |
| EXAMMOCK-0071 | Assigned mock tests run in the shared exam room behind a flag, with the runner as the only clock and submit owner, the same collection order and a learner side that follows the exam audience and run mode | approved | high | [spec](0071-exam-room-mock/spec.md) |
| EXAMSPEAK-0072 | Speaking practice shows clear microphone and recording states, blocks too-short answers with a reason, and asks in the page before discarding unsent recordings, behind a flag and with the same uploads and grading | approved | high | [spec](0072-exam-room-speaking/spec.md) |
| EXAMDRILL-0073 | Quick Check and flashcards run in the shared practice room behind a flag, with rating only after the card is flipped, the flip and rating buttons on the first screen, in-page confirmations and no internal codes | approved | high | [spec](0073-exam-room-vocab-grammar/spec.md) |
| PHONEGATE-0081 | Full tests open only on screens at least the configured width, while mini tests, practice and course tests stay available on phones | draft | medium | [spec](0081-full-test-phone-gate/spec.md) |
| COURSETESTRELEASE-0082 | Course test results stay sealed on every learner read path until a teacher releases them at a chosen level, unless the test returns results on submit | draft | critical | [spec](0082-course-test-result-release/spec.md) |
| BRANDMARK-0083 | The An ky mark is the one logo, favicon, app icon and link preview image of the site, generated from a single geometry source | draft | medium | [spec](0083-brand-mark-an-ky/spec.md) |
| GRAMMARFIG-0084 | Grammar Wiki articles show numbered, accessible sentence diagrams written as semantic figure blocks, and a malformed block never hides the article | draft | medium | [spec](0084-grammar-wiki-figures/spec.md) |
| CLASSRESULT-0085 | Teachers open one result page per class assignment with five blocks from one aggregate API, and give work to saved learner groups through one shared component | draft | high | [spec](0085-class-assignment-result/spec.md) |
| MOCKORG-0086 | Admins organise assigned mock exams for classes, single learners and saved groups, run live or self-paced sittings without breaks, and release results from one tab | approved | high | [spec](0086-mock-exam-organisation/spec.md) |
| CONTENTBATCH-0087 | Admins see every content import script run as a read-only batch and work one review queue per question on the four-tab content pages | draft | high | [spec](0087-content-import-batches/spec.md) |
| WRITINGGPT-0088 | Writing grades that Claude cannot serve fall back to GPT before Gemini | draft | high | [spec](0088-writing-gpt-fallback/spec.md) |
| SENTLAB-0101 | Course 5 learners practise 45 sentence-writing sessions with AI coaching that never reveals the answer before they rewrite | approved | high | [spec](0101-course5-sentence-lab/spec.md) |
| REGIVE-0103 | A teacher can give a class a course lesson bank it already received, and a retried give still creates it once | draft | high | [spec](0103-course-bank-regive/spec.md) |

Progress and remaining acceptance are reconciled in [the implementation status ledger](IMPLEMENTATION_STATUS.md). A deployed application does not by itself close a feature acceptance gate.

Spec numbers 0006, 0007 and 0022 are each used by two features; the ID, not the
number, is unique. 0049 is reserved by closed PR #2254 (ADMINSIMPLE-0049, superseded by
ADMINIA-0074); 0053 is unused.

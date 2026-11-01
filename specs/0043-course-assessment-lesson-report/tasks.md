# Tasks

Tasks are in dependency order. `[P]` marks work that can run in parallel with
the task before it.

- [x] T000 Owner approval and number: Vinh approved LESSONREPORT-0043 on 2026-10-30 17:20 (UTC+7), card `t931s2961`, answering Q1–Q5; the Leader confirmed number 0043. The spec-only PR lands this on `staging` (see `SPEC-PR.md`). `owns: specs/0043-course-assessment-lesson-report/*, specs/README.md`
- [ ] T001 Extract the per-qid duplicate rule and the qid:answer key fingerprint from `course_verdict` into shared helpers, with no behaviour change. `owns: backend/services/quiz_service.py, backend/tests/test_course_verdict_shared_helpers.py` `depends: T000`
- [ ] T002 Add the `course_lesson_report` service, the `CourseLessonReport` models and the admin route (FR-001, FR-003–FR-009, FR-011, FR-014). `owns: backend/services/course_lesson_report.py, backend/models/course_lesson_report.py, backend/routers/admin_class_assignments.py, backend/tests/test_course_lesson_report.py` `depends: T001`
- [ ] T003 Add the instructor routes and the `instructor_owned_cohort` helper (FR-010, plus the FR-013 list endpoint), with IDOR and impersonation-audit tests. `owns: backend/routers/instructor.py, backend/services/instructor_access.py, backend/tests/test_instructor_lesson_report.py` `depends: T002`
- [ ] T004 [P] Store `meta.lesson_map` and `meta.lesson_counts` in the importer (FR-002). This ships in the 0043 implementation job (Leader decision), not in PR #2062. If #2062 has not merged by then, rebase on it. `owns: backend/scripts/import_course_assessment_bank.py, backend/tests/test_course_assessment_import.py` `depends: T000`
- [ ] T005 Regenerate OpenAPI and build the admin "Theo buổi" tab (FR-012). `owns: frontend/lib/openapi-contract.ts, frontend/lib/course-lesson-report-model.mjs, frontend/app/(authed-admin-classes)/admin/classes/[cohortId]/admin-class-submissions.tsx, frontend/app/(authed-admin-classes)/admin/classes/[cohortId]/admin-class-lesson-report.tsx, frontend/tests/react/admin-class-lesson-report.test.tsx, frontend/tests/course-lesson-report-openapi-contract.test.mjs` `depends: T002`
- [ ] T006 Build the instructor entry point (FR-013, kept by owner decision 2). `owns: frontend/app/(authed-instructor)/instructor/*` `depends: T003, T005`
- [ ] T007 Staging QA rehearsal per `rollout.md`: create a QA C1 class, import the final, give it, have QA learners sit it, then check the report, IDOR and timing. Record MANUAL evidence. `depends: T002–T005`
- [ ] T008 Independent security review (IDOR, payload minimisation, impersonation) and a convergence audit against this spec. `depends: T007`

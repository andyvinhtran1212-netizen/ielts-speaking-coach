# Tasks

Tasks are dependency ordered and remain unchecked until an implementation PR is
based on the approved specification.

- [ ] T001 Restore the 34 missing working-source targets or formally archive them with an explicit external-source registry and revised validator scope; rerun the official Content Hub and publish-package validators. `owns: /Users/trantrongvinh/Downloads/Listening-Content/01_WORKING, /Users/trantrongvinh/Downloads/Listening-Content/tools/validate_content_hub.py`
- [ ] T002 Fix the stale Listening analytics regression fixture path and rerun the targeted Listening frontend/backend baseline to full green. `owns: frontend/tests/listening-analytics-next-behavior.test.mjs`
- [ ] T003 Add additive package, lesson, programme/scoring provenance, immutable-source, and package publication schema plus transactional RPCs. `depends: T001,T002; owns: backend/migrations/287_listening_content_programmes.sql`
- [ ] T004 Publish typed FastAPI/OpenAPI contracts for overview, programme lessons, lesson detail, form detail/result, publish/archive, and backward-compatible test filtering. `depends: T003; owns: backend/routers/listening.py, backend/models/listening*.py`
- [ ] T005 Implement fail-closed package validation, dry run, deterministic form-audio assembly, idempotent commit/reconciliation, and package-scoped publish/archive. `depends: T003,T004; owns: backend/services/listening_package_import.py, backend/scripts/import_listening_content_package.py`
- [ ] T006 Implement report-only attempt/result behavior and analytics separation without changing existing diagnostic, full-test, dictation, or mock behavior. `depends: T003,T004; owns: backend/routers/listening.py, backend/services/listening_test_grader.py`
- [ ] T007 Add generated frontend wire types and build `/listening`, `/listening/general`, `/listening/general/[lessonId]`, and `/listening/ielts` against canonical contracts. `depends: T004; owns: frontend/app/(authed-listening)/listening/, frontend/lib/generated/`
- [ ] T008 Synchronize Listening-local headers, back links, cards, state panels, shell spacing, wording, themes, responsiveness, focus, targets, and reduced motion while preserving exam skins. `depends: T007; owns: frontend/app/(authed-listening)/listening/_components/, frontend/public/css/listening*.css`
- [ ] T009 Add requirement-linked backend, frontend source, browser, storage, migration, idempotency, answer-leak, regression, and visual tests. `depends: T004,T005,T006,T007,T008; owns: backend/tests/, frontend/tests/, frontend/tooling/`
- [ ] T010 Import both packages as non-public on staging and reconcile 2 packages, 66 lessons/groups, 159 forms, 1,045 items, 390 source stimuli/media/timing files, 1,474 timing segments, and 2 visuals. `depends: T005,T006,T009`
- [ ] T011 Complete independent review, exact-SHA staging checks, representative learner journeys, package-level publish/rollback drills, and observation before production authorization. `depends: T010`

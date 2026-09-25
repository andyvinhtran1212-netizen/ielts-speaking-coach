# Tasks

- [x] T001 Land the approved spec on staging. `owns: specs/0008-mock-attempt-integrity/**, specs/README.md`
- [x] T002 Rebase the implementation after T001; gate native Reading and Listening entry on attach. `depends: T001; owns: frontend/app/(authed-reading-player)/reading/exam/session/reading-exam-session.tsx, frontend/app/(authed-listening-player)/listening/test/session/listening-test-session.tsx`
- [x] T003 Add collection preflight without automatic relink. `depends: T001; owns: backend/services/mock_exam_service.py`
- [x] T004 Verify backend and frontend behavior, error paths, local full suites, and independent review. `depends: T002,T003`
- [x] T005 Merge to staging only after PR checks; record exact-SHA integrated CI and live E2E. `depends: T004`
- [ ] T006 Promote staging to main through the required gate and verify production marker and focused journey. `depends: T005`

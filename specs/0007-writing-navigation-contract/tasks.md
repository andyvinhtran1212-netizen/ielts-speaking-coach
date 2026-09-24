# Tasks

Implementation starts only after this approved spec is on the staging base.

- [ ] T001 Define one Writing navigation parser/serializer and tests. `owns: frontend/lib/admin-writing-navigation-model.mjs, frontend/tests/admin-writing-navigation.test.mjs`
- [ ] T002 Move Queue pagination and filter state to the URL; integrate shared links in Queue, Status, Grade, and Instructor Queue. `depends: T001; owns: frontend/app/(authed-admin-writing-queue)/admin/writing/queue/, frontend/app/(authed-admin-writing-status)/admin/writing/status/, frontend/app/(authed-admin-writing-grade)/admin/writing/grade/, frontend/lib/admin-writing-{queue,status,instructor-queue}-model.mjs`
- [ ] T003 Add focused browser journeys and run affected contract, TypeScript, build, and browser checks; complete independent review. `depends: T002`
- [ ] T004 Verify final implementation SHA on staging and promote only through the exact-SHA gate after required production migrations. `depends: T003`

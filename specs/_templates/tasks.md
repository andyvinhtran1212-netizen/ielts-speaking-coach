# Tasks

Tasks are dependency ordered. Add `[P]` only when work is safe to run in
parallel and declare non-overlapping file ownership.

- [ ] T001 Establish or update executable contracts. `owns: ...`
- [ ] T002 Implement canonical backend/data behavior. `depends: T001`
- [ ] T003 Implement frontend behavior and complete UI states. `depends: T001`
- [ ] T004 Add requirement-linked tests and verification evidence.
- [ ] T005 Run independent review and convergence audit.

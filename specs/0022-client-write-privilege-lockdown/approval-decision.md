# Approval decisions — SECWRITE-0022

## Amendment 1 — client privileges on dashboard RPCs and RLS tables without policies

**State: Owner approval recorded for (b) and (c); (d) DEFERRED and outside
this pull request.** Vinh decides each item independently (Leader list
Q-0600-SPEC0022; Feature Developer questions (b), (c) and (d) of 2026-10-30
02:50). An item is approved only when Vinh approves its exact FR text and
the spec-only pull request that adds it is merged into `staging` with a
merge commit. Approving an item authorizes writing and testing its migration
only. It authorizes no migration apply: the Leader/RM applies staging
migrations under the advisory lock, production only at a promotion approved
by Vinh, and migration 350 additionally needs Vinh's direct approval to be
applied anywhere.

| Item | Requirement | Migration (job) | State |
| --- | --- | --- | --- |
| (b) | FR-011 — client EXECUTE on the four migration-139 dashboard aggregates | 351 (1cr, PC-J220R) | APPROVED by Vinh 2026-10-30 06:58 (UTC+7), verbatim "Ok theo đề xuất", relayed by the Leader |
| (c) | FR-012 — no client privilege on RLS-enabled tables without policies | 349 (1bh, PC-J217 B) | APPROVED by Vinh 2026-10-30 06:58 (UTC+7), verbatim "Ok theo đề xuất", relayed by the Leader |
| (d) | FR-013 — postgres default privileges give client roles nothing | 350 (19v, PC-J170) | DEFERRED by Vinh 2026-10-30, not in this pull request |

### Why the approved spec has to change

Every SQL migration is a `high-risk` change and must cite a requirement that was
already approved on the base branch (`backend/scripts/validate_specs.py:1316-1322`,
`:1378-1379`, `:1429-1471`, `:1571-1591`). Before Amendment 1, no approved
requirement covered migrations 351 and 349: SECWRITE-0022 FR-009 covers
SECURITY DEFINER functions only, FR-003/FR-004/FR-006 cover writes, and the
non-goals exclude read access (spec.md:56) and default function EXECUTE
(spec.md:59-61). Citing an unrelated requirement or weakening the validator
was ruled out by the Leader.

### What each approved item changes in this spec, and nothing else

- (b): one Scope bullet, the FR-011 fragment of the read-access non-goal,
  FR-011, its verification row, T009 and rollout "(b)".
- (c): one Scope bullet, the FR-012 fragment of the read-access non-goal,
  FR-012, its verification row, T010 and rollout "(c)" (exceptions: none).

Item (d) adds no requirement, task or rollout section in this pull request.
Job 19v stays on HOLD indefinitely; migration 350 must not be written, tested
or applied in this round. If Vinh approves (d) later, a second spec-only pull
request must add its requirement before implementation starts.

FR-001 to FR-010, the title, the status `approved`, the risk `critical` and
the default-EXECUTE non-goal are unchanged.

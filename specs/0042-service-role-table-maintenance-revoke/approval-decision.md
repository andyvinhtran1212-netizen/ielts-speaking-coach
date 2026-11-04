# Approved intent decision

**State: APPROVED by direct human owner reply.** Vinh (repository owner)
approved this spec in his own words at **2026-11-02 06:37 (Asia/Saigon,
UTC+7)**, relay t1246u: "Ok hết theo đề xuất". The reply approved all 13
items of the 01/11 22:45 batch as the Leader recommended
(`process/questions-for-vinh.md`, "ANSWERED 2026-11-02 06:37 UTC+7
(t1246u, verbatim)"). Item 4 (Q-0600-SPEC0042, Q-0600-FR010-TEXT,
Q-0600-PGTEMP) and item 5 (Q-0815-FR009) cover SVCPRIV-0042.

Approval note: approved by Vinh 2026-11-02 06:37 UTC+7 (t1246u).

This approves the intent in `spec.md` (FR-001…FR-010) and the rollout in
`rollout.md`, with the two FR-010 amendments below. It does not authorize
running any production query or apply. Production apply needs its own
authorization at release time (T003), and Q-J357-3 stays a blocking gate for
production promotion and for closing P2-SA-1.

## FR-010 amendment 1: "function/procedure (routine)" (FR010 text a)

Q-0600-FR010-TEXT, Leader recommendation (a), approved: the FR-010 text
matches migration 358 with no behaviour change. 358 uses `ALTER ROUTINE`
and so also pins procedures (`prokind IN ('f','p')`), and it raises
`unpinned_function_not_owned_by_runner` and rolls back if a target routine
is not owned by the runner. FR-010 now says "function/procedure (routine)",
`ALTER ROUTINE`, and names that precondition.

## FR-010 amendment 2: PGTEMP option a

Q-0600-PGTEMP, option a, approved: migration 358 is widened before it is
applied. Every function/procedure defined by project migrations in `public`
and `app_private` gets a `search_path` that ends with `pg_temp`:

- no `search_path` → `public, pg_temp`;
- `pg_catalog, public` → `pg_catalog, public, pg_temp`; `public` →
  `public, pg_temp`;
- `''` → `pg_catalog, pg_temp`.

The CI guard rejects `''` and requires `pg_temp` to be the last entry. The
FR-010 text is the Feature Developer amendment text, section A of
`/workspace/specs-drafts/20261102-fd-amendments-0042-0038-0037.md`
(handoff `handoff/leader/20261102-0950-feature-developer-amendment-texts-t1246u.md`),
copied verbatim. REVOKE TEMP and other CREATE grants are out of scope and
are decided later (PC-J407); the production catalog read is SA's step
before promotion.

FR-010 was earlier approved on its own at 2026-10-30 22:13 UTC+7 (t1098u,
"FR010 ok", `process/vinh-decisions-20261030.md`). That approval covered
only the four 283 trigger functions; the wording above replaces it.

## FR-009 / migration 357

Q-0815-FR009 approved: FR-009 / mig 357 approved t1246u; staging first,
prod via normal promote. Migration 357 (PC-J365, job 1h1) is
`REVOKE CREATE ON SCHEMA public FROM service_role, anon, authenticated,
PUBLIC`, keeping USAGE, applied before 358. The table-privilege migration of
FR-001…FR-008 (T001) keeps the placeholder `NNN` until the Leader numbers
it.

Q-J357-4, answered by Vinh on 2026-11-02 in the Claude Code session that
reviewed this PR: 341 (already applied on staging) and 341b reach production
only after 357 is applied on production and its postcheck passes. The gate
is step 5 of the Production section in [rollout.md](rollout.md). Vinh also
confirmed in that session that he gave the t1246u approval recorded above.

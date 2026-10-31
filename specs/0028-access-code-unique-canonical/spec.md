---
id: CODEUNIQ-0028
title: Access codes are unique and canonical in the repository schema
status: verified
risk: high
owner: product
---

# Access codes are unique and canonical in the repository schema

Approval: approved by Vinh 2026-10-27 07:14 UTC+7 (see
[`approval-decision.md`](approval-decision.md)). Security finding F07
(uniqueness part, "F07-UNIQUE"). The code-generation part of F07 merged to
`staging` in #1733 (`f489d9296`). Locked migration number: **325**
(`325_access_codes_code_unique_canonical.sql`). Evidence record with citations,
staging queries and full SQL: [`research.md`](research.md) (written before
#1733 merged; this spec is the canonical contract).

## Problem

Access codes are bearer credentials ("access-code truth" is high-risk in
`specs/README.md`). `/auth/activate` looks a code up with an exact match after
`strip().upper()` (`backend/routers/auth.py:393-402`) and takes `.limit(1)`; two
rows with the same code would activate an arbitrary one (wrong role, class or
instructor).

- Staging has `access_codes_code_key UNIQUE (code)`, but **no repository
  migration creates `access_codes` or that constraint** (009, 062 and 106 only
  alter the table). It is schema drift: a database built from the repository
  has no uniqueness, and production is unverified.
- The constraint is case- and whitespace-sensitive, while lookup normalizes
  input; a lower-case or padded row could coexist with its canonical twin and
  could never be activated.
- After #1733, admin minting uses `secrets` with collision retry
  (`backend/services/access_code_gen.py`), but instructor minting
  (`backend/routers/instructor.py` `mint_codes`) still inserts a batch of
  `_gen_code()` values with no 23505 retry.

Staging (read-only, 2026-10-27): 503 codes; zero duplicate groups exact,
`lower(code)` or `upper(btrim(code))`; zero padded, non-upper-case or empty
codes. No dedupe is needed on staging.

## Scope

- Migration 325: codify `access_codes_code_key UNIQUE (code)` (built
  `CONCURRENTLY IF NOT EXISTS`, no-op where present) and add
  `chk_access_codes_code_canonical CHECK (code = upper(btrim(code)) AND code <> '')`,
  with prechecks that abort on duplicates or non-canonical codes and a
  postcondition.
- Instructor mint uses the #1733 collision-safe insert helper.
- Tests and migrations README.
- A reviewed, dry-run-first dedupe procedure only if production has duplicates.

## Non-goals

- An expression unique index on `lower(code)` (rejected in `research.md` §4).
- Changing the code format, alphabet or activation lookup (#1733 owns these).
- The drifted `"Admin only"` policy on `access_codes` (recorded, out of scope).
- Any automatic data rewrite inside 325.

## Users and journeys

- Admin and instructor mint codes; learners and instructors activate them, including class codes (#1693).

## Requirements

- **FR-001:** Every environment built from the repository has a valid unique constraint `access_codes_code_key` on `access_codes(code)`; migration 325 is a no-op for the index where it already exists and aborts if a concurrent build left it invalid.
- **FR-002:** The database rejects any access code that is not in canonical form (`code = upper(btrim(code))` and non-empty), so plain uniqueness equals uniqueness of every way a user can type the code.
- **FR-003:** Migration 325 changes no row and aborts with counts when exact or normalized duplicates or non-canonical codes exist; any dedupe is a separate, reviewed, dry-run-first data step.
- **FR-004:** Instructor code minting dedupes the batch, pre-checks existing codes and retries on a 23505 collision for `code` like the admin paths; a collision never surfaces as a 500.
- **FR-005:** Activation behavior is unchanged: a correct code typed in lower case or with spaces still activates, and legacy 8-character codes keep working.

## Acceptance scenarios

### Scenario 1 — schema

- **Given** 325 is applied on staging
- **When** the catalog is queried
- **Then** `access_codes_code_key` is a valid unique single-column index exposed as a constraint and `chk_access_codes_code_canonical` is validated, with no duplicate index

### Scenario 2 — minting

- **Given** an admin and an E2E instructor
- **When** they mint 100 and 5 codes
- **Then** all codes are canonical `XXXX-XXXX-XXXX`, inserts succeed and the code count rises by exactly that amount

### Scenario 3 — activation

- **Given** a real code `ABCD-EFGH-JKMN`
- **When** a learner types `  abcd-efgh-jkmn `
- **Then** activation succeeds as before

## Edge cases

- Production has a unique index on `code` under another name: 325 would add a redundant index, so P1 runs first and the file is adjusted if needed.
- A failed `CREATE INDEX CONCURRENTLY` leaves an invalid index: 325 aborts with a hint to drop it concurrently and re-run.
- `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block: the file has no outer `BEGIN`; the CHECK is added in its own transaction.

## Success criteria

- Zero duplicate or non-canonical codes possible in any environment; zero 500s from code minting caused by 23505.

## Open questions

- None block implementation. Production read-only checks P1–P6 (`research.md` §8) are pending Vinh's read-only permission (chờ anh Vinh cho phép chạy chỉ đọc); if they show duplicates, the dedupe plan in `research.md` §6 needs a separate review before 325 is applied there.

---
version: 1.0.0
ratified: 2026-09-15
---

# Aver Learning engineering constitution

These rules govern how product intent becomes implementation. They complement
`AGENTS.md` and `CLAUDE.md`; when guidance conflicts, current architecture,
persisted truth, executable contracts, and this constitution take precedence
over historical migration or sprint notes.

## 1. Canonical system boundaries

- Next.js App Router is the production frontend and Vercel deployment unit.
- FastAPI is the only business backend and Railway deployment unit.
- Supabase PostgreSQL, Auth, and Storage own persisted truth.
- Frontend state must not claim a result that a canonical backend refetch would
  contradict.

## 2. Proportional specification

- `feature` and `high-risk` changes MUST have an approved feature spec on the
  base branch before implementation. A spec cannot be introduced, marked
  approved, and implemented in the same pull request. Approved requirement
  definitions and risk level are immutable within an implementation PR; revise
  and approve intent on the base branch first. A spec approved with `high` or
  `critical` risk MUST be implemented through a `high-risk` pull request.
- `SDD-0000` is the one-time bootstrap exception: it may establish this
  constitution only when the base revision does not yet contain the
  constitution. Once landed, the exception cannot recur.
- Hotfixes and small/content changes MAY use `Spec: N/A`, but MUST still state
  the problem, expected behavior, scope, and verification in the PR.
- Specification depth MUST follow risk; paperwork must not be used to make a
  small fix artificially broad.

## 3. Executable contracts

- Every new or shape-changing FastAPI endpoint MUST publish concrete request
  and success-response schemas when the transport permits it.
- New frontend consumers MUST derive wire types from the generated OpenAPI
  contract rather than duplicating response interfaces by hand.
- Runtime validation or explicit guards MUST protect untrusted or AI-generated
  payloads where static types alone cannot establish truth.
- Backward compatibility with the currently deployed consumer MUST be stated
  for contract changes.

## 4. Data and migration safety

- Code MUST NOT depend on a table, column, routine, bucket, or policy before its
  migration exists and is staged.
- Schema changes MUST be backward-compatible with the currently deployed code.
- High-risk mutations MUST specify idempotency, retry, reconciliation, and data
  repair behavior where applicable.
- Production migrations use the repository advisory-locked runner and ledger.

## 5. Complete user states

- User-facing specs MUST cover loading, empty, success, error, retry, and
  permission-denied states that apply to the flow.
- Responsive behavior, keyboard access, focus, reduced motion, and both themes
  MUST be acceptance criteria for affected UI surfaces.
- Admin surfaces MUST present canonical backend truth, including lookup errors
  and partial operational states.

## 6. AI quality is behavioral, not only structural

- A valid JSON shape is not sufficient evidence for grading or feedback quality.
- Prompt, model, or grading changes MUST name the relevant gold cohort, baseline,
  quality metrics, false-positive risks, cost, and fallback behavior.
- Paid evaluation MAY run outside per-PR CI, but its required report and passing
  thresholds MUST be recorded before release.

## 7. Traceability and convergence

- Functional requirements use stable `FR-NNN` identifiers.
- Every requirement MUST map to an automated test, manual evidence, or an
  explicit non-applicability rationale.
- Review MUST compare implementation against the current spec, not only against
  the previous diff.
- A feature cannot be `verified` while required tasks or requirement evidence
  remain incomplete.

## 8. Scoped parallel work

- Each feature branch/worktree MUST have a named scope and owner.
- Parallel tasks SHOULD declare file ownership; overlapping edits MUST be
  sequenced rather than merged optimistically.
- Unrelated cleanup, generated artifacts, and debug files MUST stay outside a
  focused feature patch.

## 9. Staging-first release

- Normal work starts from `origin/staging` and merges back to `staging`.
- Production accepts only an exact-SHA promotion from `staging` to `main` after
  required integrated CI and live staging evidence pass.
- Database changes go to staging first and production only with explicit
  authorization before dependent code promotion.

## 10. Documentation lifecycle

- Active intent lives under `specs/`; durable architectural decisions live in
  ADRs; historical evidence remains under `docs/`.
- Superseded documents MUST be labeled or indexed as historical instead of
  silently competing with current truth.
- Amendments to this constitution require a PR rationale and a semantic version
  change: major for removed/redefined obligations, minor for new obligations,
  patch for clarification.
- A machine-classified patch clarification MUST use separate non-normative prose
  without changing an existing obligation string. Any obligation-text edit is
  classified conservatively as major; a new obligation is minor.
- Normative-language examples outside obligation lists MUST use the standalone
  form `Example: \`...\`` or a fenced code block. The marker exempts only its
  inline-code span; any following prose containing `MUST`, `SHOULD`, or `MAY`
  participates independently in versioning.

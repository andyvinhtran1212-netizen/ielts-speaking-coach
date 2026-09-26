# Template: audit prompt

Use with Codex or another reviewer before merge.

## Prompt

Branch/PR: <branch and PR URL>
Base: staging
Head SHA: <current PR head>
Change class / Spec: <class and approved ID or N/A>
Requested scope: <flows and acceptance criteria>

Read `AGENTS.md`, `docs/AGENT_WORKFLOW.md`, the applicable spec and the complete
diff against the actual base. Check current review comments and verification
evidence for this head.

Audit the layers touched by the change:

- Backend/frontend shapes, canonical writes, aggregates, error and reload states.
- Authentication, resource ownership, admin authorization and the chosen
  RLS/service-role boundary; backend-only tables must remain inaccessible to
  public clients.
- Schema compatibility, immutable applied migrations, ledger/forward policy,
  staging-first ordering and rollback/repair path.
- Next route ownership, shared auth/runtime/API boundaries, design tokens and
  relevant browser behavior. Retired HTML parity alone is insufficient.
- Tests that prove the behavior, including failure/race paths where relevant.
  Distinguish local results, intentionally gated/skipped live checks, and actual
  release evidence. Missing required evidence remains unresolved.
- AI costs/timeouts, data privacy and failure handling when provider calls change.

For each actionable finding report:
1. Root cause and impact.
2. Severity: Critical / Medium / Low.
3. Exact file and line/function.
4. Minimal suggested fix.
5. Concrete verification.

Summarize checks actually performed, remaining evidence gaps and merge
readiness. Unresolved correctness/security regressions block closure regardless
of their count. Do not invent findings to fill a quota. Consolidate related
findings and follow the review-round limits in `AGENTS.md`.

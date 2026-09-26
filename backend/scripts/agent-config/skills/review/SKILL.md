---
name: review
description: Review Aver Learning changes for contract completeness, authorization, data integrity, frontend behavior and release evidence before commit or merge.
---

Read `AGENTS.md`, `docs/AGENT_WORKFLOW.md`, the applicable spec and the complete
requested diff. For local work inspect staged and unstaged changes; for a PR
compare its current head to its actual base.

Prioritize the layers touched:

- Auth, ownership and entitlement checks across every entry point. Service-role
  queries bypass RLS; verify explicit authorization and transactional guards.
- Backend/frontend shape agreement, canonical writes, aggregates, immediate UI
  state and reload behavior. Preserve the domain invariants in `AGENTS.md`.
- Schema names, migration order, immutable applied files, retention, RLS/grants
  and concurrency. The ledger and hosted postconditions prove deployment.
- Next.js route ownership, shared API/Supabase runtime, visible failures and
  design tokens. Read `frontend/AGENTS.md`; retired HTML is test evidence only.
- AI timeouts, cost controls, failure handling and transcript/privacy boundaries.
  Do not require a provider fallback that contradicts the product contract.
- Tests for behavior and failure paths, relevant local suites, current review
  findings and exact-SHA CI. Treat missing or skipped required checks as gaps.

Report each actionable finding with root cause, Critical/Medium/Low severity,
exact file/line/function, minimal fix and verification. State what was actually
checked and what remains unverified. Do not manufacture findings or claim a
deployment from an unrelated green run. Follow the three-round reset and
five-round hard limit; unresolved correctness or security issues block closure.

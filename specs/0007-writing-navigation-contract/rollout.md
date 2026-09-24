# Rollout and rollback

## Preconditions

- This approved spec is merged to staging before a separate implementation PR.
- The prior MOCKOPS-0006 implementation PR remains unmerged and receives no
  sixth review round; the replacement includes it with the new contract.
- No new migration is introduced here. Confirm the parent release's additive
  migrations remain staged and compatible before deploying dependent code.

## Staging

- Run Writing navigation model, Queue/Status/Grade/Instructor contract tests,
  strict TypeScript, production build, and relevant fixture browser journeys
  locally before pushing the implementation.
- Merge the implementation to staging only after review convergence. Record
  the exact staging SHA and require integrated CI plus live Staging E2E on it.
- Exercise 50-row page 2, all active filters, Status → Grade → save/return,
  reload and Back/Forward, Instructor return, direct deep link, embedded Mock,
  and exact versus incomplete pagination.

## Production

- Confirm staging has not moved since its green exact-SHA evidence.
- Apply any still-pending parent-release migrations with the advisory-locked
  runner before promotion; this navigation contract itself has none.
- Promote only staging → main through its promotion PR and gate. Verify the
  deployed frontend/backend revisions equal the approved staging SHA and smoke
  the Writing navigation without changing real essay data.

## Rollback and repair

- Revert the frontend implementation if a navigation regression occurs; no
  stored data or backend contract needs repair, and legacy links still load.
- Preserve parent-release additive migrations during rollback. Do not clear
  grading or session state to mask a wrong return destination.

## Observability

- Watch frontend navigation errors, Queue page response errors, visible stale
  warnings, live Staging E2E, and Vercel/Railway health at each deployment.
- Treat a mismatched URL versus request offset/limit, a fabricated Queue return,
  or failed exact-SHA gate as release-blocking. Release owner is the product/
  engineering operator performing staging-first promotion.

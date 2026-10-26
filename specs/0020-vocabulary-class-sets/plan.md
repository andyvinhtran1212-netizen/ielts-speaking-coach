# Implementation plan

## Architecture impact

Keep Next App Router, FastAPI and Supabase as owners. Replace the Vocabulary
hub's peer mode cards with the approved layout, add shared-set detail/player
routes in the owning route group, and add an admin set console. Keep Wiki and
legacy personal/quiz/D1 controllers available; reuse maintained design tokens.

## Data and contracts

Add only the shared content/distribution, per-card progress and frozen session
records required by FR-002 through FR-006. Canonical cards reference vocab_cards.
Published snapshots and session answer keys are backend-owned; admin drafts
and ordered membership are edited with expected revision checks.

New tables enable RLS and deny direct anon/authenticated mutation. Backend
routes enforce admin role or active course/cohort membership before using the
service client. Public-library visibility is explicit and never inferred from
CEFR or from a missing course. Learner receipts are unique by user/client ID;
same payload replays, changed payload conflicts. Progress updates and attempt
receipts commit atomically under row locks or version checks.

New endpoints publish concrete Pydantic request/response models and regenerate
OpenAPI-derived frontend wire types. Existing APIs keep their current shapes.
The SRS module remains the algorithm owner. No old review/attempt row is
rewritten. Sessions retain their content revision and answers when cards change.

## UI and interaction

Persistent local navigation; main action before metrics. Library filters use
course names and class context; topic/exam collections remain discoverable.
Set detail offers modes and exact membership; unavailable modes explain missing
content. Player return links are validated internal destinations.
Use real links/buttons, visible focus, correct active/inactive card accessibility,
and theme tokens. Admin save/publish refetches canonical truth.

## Work decomposition

1. Add typed contracts, additive migration and permission/atomicity behavior.
2. Implement admin set authoring/distribution and learner set/session APIs.
3. Implement the new hub, set views and study modes; integrate legacy return paths.
4. Run requirement-linked route, persistence, React and browser checks.
One agent owns the scoped worktree; no parallel agents are authorized.

## Rollout and rollback

Follow rollout.md. Additive schema first, application second, staging acceptance
third. Retain legacy routes and all evidence; code rollback disables new entry
points without deleting new tables or learner work. Production promotion and
production migrations require explicit release authorization.

## Verification strategy

Permission matrix, set membership, immutable session content, replay/concurrency
and backend grading tests; meaningful React interactions; real Next browser
journeys at mobile/desktop and both themes; typed OpenAPI and local suite gates.
Verify immediate admin acknowledgement against reload and record exact staging SHA.

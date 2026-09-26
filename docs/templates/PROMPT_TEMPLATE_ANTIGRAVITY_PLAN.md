# Template: planning prompt

Use with Antigravity or another planning agent. Active feature intent belongs in
`specs/`; historical `PHASE_*_PLAN.md` documents are context.

## Prompt

Read `AGENTS.md`, `docs/AGENT_WORKFLOW.md`, `specs/README.md` and the applicable
spec before planning. Inspect the existing implementation and describe the
user-visible outcome in Vietnamese before technical details.

Task: <requested outcome>
Change class: <hotfix | small | content | feature | high-risk>
Spec: <existing spec ID or N/A where permitted>
Target: origin/staging

- Identify the root cause or missing behavior, affected contracts and minimal
  scope. Avoid new architecture when the current contract supports the task.
- Verify referenced tables/columns against migrations and actual query paths.
  Distinguish schema definitions from proof that a target database applied them.
- Trace backend output, frontend consumption, authorization and persisted
  aggregates together. Name affected domains and regression risks.
- For schema changes, follow `backend/migrations/README.md`: forward-only
  changes, immutable applied migrations, data retention and staging-first
  rollout. Design RLS/ACLs for intended access; backend-only tables need not
  grant client CRUD policies.
- Plan frontend work in Next App Router using existing route groups, shared
  components, auth/API boundaries and design tokens.
- Define verification per changed layer, required environment, rollback/repair
  approach and any provider cost. Identify manual evidence separately.
- For feature/high-risk work, prepare the required spec artifacts and obtain
  approval on the base branch before implementation. Do not self-approve.
  Small changes use the PR problem/behavior/scope/verification fields.

List only decisions that actually require user input. Keep routine implementation
choices inside the authorized task.

# Template: implementation prompt

Use with Claude Code or another implementation agent.

## Prompt

Task: <requested outcome>
Branch: codex/<descriptive-name>
Base and PR target: staging (start from freshly fetched origin/staging)
Change class: <hotfix | small | content | feature | high-risk>
Spec: <approved spec ID or N/A where permitted>

Read `AGENTS.md`, `docs/AGENT_WORKFLOW.md`, the applicable directory instructions
and approved spec. Inspect worktree status and preserve unrelated work.

Implement the smallest complete change. Verify backend/frontend shapes, resource
ownership and persisted truth together. Use Next App Router for frontend work;
retired HTML fixtures are regression evidence. Follow the existing domain's
authenticated DB boundary; a service-role query requires explicit authorization
and ownership checks because it bypasses RLS.

Apply these task-specific requirements:
<acceptance criteria and explicit boundaries>

Before pushing, inspect the complete diff, consolidate related findings, and run
targeted checks followed by the affected local suites from
`docs/AGENT_WORKFLOW.md`. Report skips and missing prerequisites honestly.
Do not push after every numbered step or use CI to discover known local failures.
Observe the three-round reset and five-round limit in `AGENTS.md`.

Continue already authorized routine work. Ask when a material scope decision,
missing prerequisite or unauthorized action blocks completion; do not add a
checkpoint solely because this is an agent task.

Open the PR against staging. If production release is included in the user's
authorization, follow `docs/STAGING_FIRST_RELEASE_FLOW.md` and verify each exact
SHA. Report changed files, verification, PR/SHA, remaining work and retained WIP.

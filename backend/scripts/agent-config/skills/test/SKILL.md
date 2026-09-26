---
name: test
description: Run and report Aver Learning verification for the affected layers in the current worktree, distinguishing failures, skips and unavailable prerequisites.
---

Resolve the current repository with `git rev-parse --show-toplevel`. Read
`docs/AGENT_WORKFLOW.md` for canonical commands and the applicable CI workflow
for required environment/setup. Never run a hardcoded personal checkout.

- Identify changed layers and run focused checks first. Run the affected full
  local suites before pushing. If the user explicitly asks for the full suite,
  include backend, frontend contracts and the applicable React/type/build gates.
- The frontend contract suite requires the retired-fixture loader shown in the
  workflow. Bare `node --test` is not the canonical suite invocation.
- Use the configured Python environment. Missing pytest/dependencies or no tests
  collected is “not run”, not a product test failure or a pass.
- Preserve exit codes when saving/trimming output. Report command, worktree/SHA,
  passed/failed/skipped counts and failing cases.
- Paid smoke tests require explicit `--run-smoke`; live integration tests need
  credentials and suitable target authorization. Do not enable either merely
  to reduce the skip count. A skipped contract remains unverified.
- Do not suppress failures by adding ignore/skip/xfail options. Investigate the
  root cause within scope and consolidate fixes before another full run.

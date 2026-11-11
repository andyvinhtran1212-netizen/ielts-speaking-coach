# Frontend agent guide

Read root `AGENTS.md` and `docs/AGENT_WORKFLOW.md` first.

- Production UI is Next.js App Router under `frontend/app/`. Retired HTML
  fixtures and root compatibility symlinks are not deployment sources.
- Reuse the owning route group, shared shell and existing React components.
  Verify route ownership before changing redirects or adding a route.
- Server public-content reads use `frontend/lib/backend.ts`; browser requests
  use the shared transport through `frontend/lib/browser-api.ts` and generated
  OpenAPI types. Supabase client ownership stays in
  `frontend/components/supabase-runtime-boundary.tsx` and
  `frontend/lib/supabase-browser.ts`.
- Preserve canonical persisted state, visible failure handling and the existing
  player lifecycle. Reconcile immediate post-action state with reload behavior.
- Use the maintained `--av-*` tokens and shared components under
  `frontend/css/aver-design/`; inspect the current design system before styling.
- Node 24+ and `npm ci` are required. Use the fixture loader for contract tests
  and the relevant React/browser journey for UI behavior. Commands are in
  `docs/AGENT_WORKFLOW.md`; the modal fixture suite alone is not a Next UI test.
- Local runtime generation requires explicit development/staging Supabase
  values; see `README.md`. Restore the unconfigured generated file before commit.
- Knowledge graphs are optional navigation aids. Verify against current source;
  do not require a missing graph or regenerate it for unrelated edits.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

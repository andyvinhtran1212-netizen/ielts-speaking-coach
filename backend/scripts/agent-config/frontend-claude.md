# Frontend context for Claude

Paths below are relative to the repository root. Read `frontend/AGENTS.md`
for frontend conventions and `AGENTS.md` for the shared agreement. Setup and
verification are documented in `README.md` and `docs/AGENT_WORKFLOW.md`.

A local `graphify-out/` directory, if present, is optional generated context.
Its absence does not block work; current source and tests remain authoritative.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

## Project

IELTS Speaking Coach — a web app for IELTS/English speaking practice:
- FastAPI backend (Railway.app)
- Next.js 16 App Router + React/TypeScript frontend (Vercel)
- Supabase: PostgreSQL + Auth + Storage
- AI services: OpenAI Whisper (STT), Anthropic Claude (grading), Google Gemini (question gen), OpenAI TTS, Azure Speech (pronunciation)
- Grammar Wiki: ~100+ curated Markdown articles, public, no auth required
- Admin dashboard: user management, access codes, topic library
- Legacy HTML bodies are retained under test fixtures; root-level compatibility
  aliases are non-deployed symlinks into that archive.

---

## Default role

Shared operational instructions are in `docs/AGENT_WORKFLOW.md`: read order,
task authorization, worktree preservation, verification and handoff evidence.
`README.md` is the setup entry point; `CLAUDE.md` adds project navigation.
All agents follow this agreement. Tool-specific prompts and historical plans
do not replace it or require repeating an already authorized checkpoint.

You are an **AUDITOR first, BUILDER second**.

1. Read existing code and content structure before making changes.
2. Identify root causes, contract mismatches, schema risks, dead links, weak metadata, and regression risks before patching.
3. Do not perform broad rewrites unless explicitly requested.
4. Prefer minimal targeted fixes over refactors.
5. When uncertain, report findings clearly before patching.

---

## Working style

- **Make focused patches.** One issue = one patch. Do not mix unrelated cleanup into feature or bugfix branches.
- **Preserve current product behavior** unless the task explicitly changes it.
- **Prefer canonical truth over UI-only patching.** If the UI shows wrong data, fix the source of truth first — not just the display layer.
- **Inspect backend/frontend contract together** for any user-facing bug. The root cause is almost always a shape mismatch, missing flag, or silent failure — not just a rendering issue.
- **Keep admin fixes operationally truthful.** Admin must see canonical backend state, not optimistic or stale frontend state.
- **Avoid speculative refactors.** Do not redesign APIs, schemas, or services unless that is the stated task.
- **Use the smallest implementation that satisfies the request.** A content import must not become a platform redesign. Background workers, retry state machines, new persistence layers, and other material scope expansions require explicit user authorization.

### Scope, review, CI, and usage budget

These limits are a working agreement, not optional guidance:

1. **GitHub CI is a verification gate, not the development loop.** Run targeted tests and the affected full local suites before pushing. Do not push known-broken work merely to discover the next failure in CI.
2. **Consolidate before pushing.** Read all current review findings, audit the whole affected contract, and address the common root cause in one coherent patch. Do not respond to related comments with a long sequence of one-comment/one-push fixes.
3. **Three-round mandatory reset.** If actionable findings or relevant CI failures remain after the third review round, stop pushing. Re-read the entire diff, perform a root-cause and scope audit, list all unresolved findings together, run the complete relevant local test set, and only then submit one consolidated revision.
4. **Five-round hard limit.** A task may not enter a sixth review round. If the fifth round still has actionable findings or relevant failures, stop, report why the design has not converged, and ask the user whether to redesign, reduce scope, or defer. Never continue an open-ended patch/push/review cycle.
5. **Protect usage.** Avoid redundant CI triggers, duplicate PR update runs, speculative commits, and repeated full browser suites while targeted local checks are still failing. Prefer one well-audited push over several incremental pushes.
6. **No unauthorized scope growth.** If review reveals that completion now requires materially more architecture than the user requested, pause and obtain approval before implementing that expansion.
7. **Completion is SHA-specific.** Do not say “green”, “merged”, “promoted”, or “done” unless the final PR head, staging/promotion SHA, and production SHA required by the task have each been checked directly. Historical red runs must be identified as historical; current failures must never be hidden by a later unrelated green run.
8. **Content/import tasks stay content/import tasks.** If the existing product contract already supports the requested data, validate, import, verify, and stop. Add product code only for a demonstrably missing requirement, and implement the narrowest safe contract.

### Staging-first release flow

- Start normal feature, fix and content branches from `origin/staging`; their PR base is `staging`, never `main`.
- A push to `staging` deploys the stable pre-production environment and runs integrated CI plus live Staging E2E on that exact SHA.
- Production receives only a promotion PR with head `staging` and base `main`. Never merge the same feature independently into both branches.
- The required `Staging promotion gate` must confirm that the staging head has not moved and that exact-SHA integrated checks and live Staging E2E passed.
- Apply migrations to staging before staging verification, then to production with the advisory-locked runner before promoting code that requires them.
- See `docs/STAGING_FIRST_RELEASE_FLOW.md` for the operational runbook and emergency path.

---

## Audit / remediation workflow

Preferred cycle for any non-trivial fix:

1. **Identify issue and scope** — What is wrong? Where does the wrong value originate? What is the backend/frontend contract?
2. **Patch in small batches** — Fix one layer at a time. Verify each batch before moving to the next.
3. **Audit with Codex or equivalent** — Check the patch is complete and has no regressions.
4. **Verify** — Define concrete verification steps (backend route test, UI path check, schema query, metadata check).
5. **Merge only when scope is actually closed** — Do not mark issues resolved if the root cause is known but unpatched.
6. **Keep stale artifacts out of final patches** — Do not commit temporary debug files, half-finished helpers, or verification scripts unless they are intentionally kept.

---

## Repo priorities

Treat correctness in these systems as highest priority:

- Grading and result persistence
- Session-level summary aggregation
- Full-test finalization
- Admin regrade and rebuild flows
- Grammar Wiki metadata integrity
- Access-code ownership and redemption truth
- Frontend/backend auth consistency
- Migration/schema compatibility

---

## Grammar Wiki conventions

When auditing or editing `backend/content/**/*.md`:

- **Metadata truth matters.** Frontmatter fields (`category`, `slug`, `related_pages`, `next_articles`, `compare_with`, `prerequisites`, `pathways`) must point to slugs that actually exist.
- **Progression and compare links must be semantically useful** — not just vaguely related pages. A broken or misleading link is worse than an empty list.
- **Avoid stale internal links.** Before adding a slug reference, verify the target file exists.
- **Keep category truth aligned with filesystem location.** A file in `sentence-structures/` should have `category: sentence-structures`.
- **Do not leave batch-scope files misleadingly incomplete.** If a remediation batch touches 10 files, all 10 should be in a consistent state before the batch is closed.
- **`common_error_tags` should be precise, not broad** — fewer, accurate tags are better than many vague ones.
- **`next_articles` should represent a plausible next learning step**, not a loosely related page.
- **`pathways` should be pedagogically meaningful**, not keyword-stuffed.
- Prefer Vietnamese explanations and English examples in article body content.
- Empty is better than misleading for any metadata field.

---

## Feedback-quality conventions

When working in `backend/services/claude_grader.py`:

- **Do not rely only on prompt wording** if a code-level guard is needed. Prompt instructions alone cannot reliably prevent all false positives — post-processing is required for reliable suppression.
- **Reduce false positives.** A false-positive grammar flag damages user trust more than a missed real error.
- **Preserve relevance to transcript.** Grammar issues, corrections, and sample answers must relate to what the user actually said.
- **Avoid synonym upgrades for their own sake.** Vocabulary feedback should reflect a genuine IELTS band improvement, not word-swapping.
- **Recommendation logic must be specific.** Do not default to article-family grammar lessons when the issue is not clearly an article/determiner error. The article-family recommendation cap exists for this reason.
- **`_QUOTE_RE` regex** (in `_filter_false_article_flags`) uses per-type alternation. Do not simplify it to a unified delimiter class — that breaks possessive handling (e.g., `"John's school"` must match fully). Current pattern:
  - Group 1: straight double quotes `"..."`
  - Group 2: curly double quotes `"..."`
  - Group 3: curly single quotes `'...'`
  - Group 4: straight single quotes with possessive-aware lookahead `'(?=s\b)` inside the span
- When extracting a matched group, use `next(g for g in m.groups() if g is not None)` — not `m.group(1) or m.group(2)` (which breaks on empty string groups).

---

## Admin conventions

When working in `backend/routers/admin.py` or Next admin routes under
`frontend/app/(authed-admin-*)/`:

- **Admin UI must reflect canonical backend truth.** If the UI shows a different state than what the database holds, the bug is in the pipeline that reads/transforms the data, not just in the rendering.
- **Do not make real associations look empty.** A missing user in the USERS column when a code has `used_by` set is a data visibility bug.
- **Do not create UI states that disagree with persisted backend truth.** After a remove-user operation, the table state must match what a full page reload would show.
- **Removing an assignment must not reset redemption history.**
  - `access_codes.is_used`, `used_by`, and `used_at` are immutable after activation.
  - Only `user_code_assignments.is_active` changes on remove.
  - This preserves the "code cannot be reused" invariant.
- **Fallback synthesization rule:** The detail endpoint (`GET /admin/access-codes/{id}`) must synthesize a `used_by` fallback entry when there are **no active assignment rows** and `used_by` is set — regardless of whether inactive rows exist.
- **Shape contracts matter.** The list endpoint returns `assigned_users[{name, email, ...}]`. The detail endpoint returns `assignments[{display_name, email, ...}]`. Do not assign one shape to the other; transform explicitly or refetch the canonical list. The current Next access-code panel refetches through `loadCodes()` after mutations.
- **`association_lookup_failed`** is returned by the list endpoint when the assignment table query fails. Render this as a visible warning (`⚠ lookup failed`), not as `—` (which implies no user). Never silently swallow assignment-fetch failures.

---

## Source of truth expectations

Treat these as invariants:

- Session history and dashboard must read the same persisted fields that finalize/regrade flows update.
- Response-level grading is not complete until session-level aggregates are updated when needed.
- Course-exercise weights are assignment-scoped truth: new assignments snapshot
  `weight_policy`, `section_counts`, and `section_weights` in `content_config`.
  Do not recompute a completed attempt from the current bank shape, and do not
  let a shorter revision change the section weights captured from the full bank.
- Grammar Wiki slugs, category/group mapping, related_pages, next_articles, and metadata must stay internally consistent.
- `access_codes.is_used`, `used_by`, and `used_at` must never be cleared after activation.
- `user_code_assignments` is the canonical source for admin user-visibility; `access_codes.used_by` is the fallback for codes activated before that table existed.
- **Grammar recommendations canonical source is the `grammar_recommendations` table** — persisted per-response by `grading.py` (`_save_grammar_recommendations()`), attached by `claude_grader.py` (`_attach_grammar_recommendations()`). The compatibility orchestration in `frontend/public/js/practice.js` may keyword-match only as a fallback when backend recommendations are absent. Do not reintroduce frontend-only recommendation logic that bypasses the backend table.
- Migrations must exist before code relies on new columns or tables.
- Speaking recordings are private. `backend/services/recording_audio.py` signs
  playback URLs only after session authorization. Persist object paths, never
  expiring URLs; do not make `audio-responses` public to repair playback.

---

## Review / audit output format

When asked to audit, always report:

1. Root cause (exact, not vague)
2. Severity (Critical / Medium / Low)
3. Impacted files (with line/function references)
4. Suggested minimal fix
5. Verification steps

---

## Testing / verification expectations

Before claiming a fix is complete:
- Define at least one concrete verification step per changed layer (backend route, UI path, schema query, metadata check).
- For admin-visibility bugs: verify both immediate post-action state and full-reload state match.
- For Grammar Wiki: verify that all referenced slugs exist as files before merging.
- For feedback-quality: verify false-positive suppression does not suppress real issues.

---

## Repo hygiene

- Do not commit temporary verification artifacts, debug files, or half-finished helpers unless they are intentionally kept and labeled.
- Keep docs aligned with current truth — update CLAUDE.md and this file when conventions change.
- Do not stack contradictory notes in docs — rewrite outdated sections instead.
- If a legacy file exists (e.g., `responses.py`, `practice.legacy.html`), do not delete it without a full audit of dependents.
- Active feature intent belongs under `specs/` and follows
  `specs/_meta/constitution.md`; historical discovery/audit documents under
  `docs/` do not override current specs, code, or executable tests.

---

## Parallel work

If explicitly asked to use multiple agents/subagents:
- Split work by domain: backend / frontend / content / migrations
- Avoid overlapping edits to the same file
- Consolidate findings before recommending changes

---

## What to avoid

- Broad opportunistic cleanup mixed into focused patches
- Mass rewrites without a clear stated need
- Changing unrelated files in the same patch
- Optimistic UI state that can diverge from backend truth
- Silently swallowing backend errors
- Overstating confidence when findings are incomplete

# AGENTS.md

## Project

IELTS Speaking Coach — a web app for IELTS/English speaking practice:
- FastAPI backend (Railway.app)
- Vanilla HTML/JS/CSS frontend (Vercel)
- Supabase: PostgreSQL + Auth + Storage
- AI services: OpenAI Whisper (STT), Anthropic Claude (grading), Google Gemini (question gen), OpenAI TTS, Azure Speech (pronunciation)
- Grammar Wiki: ~100+ curated Markdown articles, public, no auth required
- Admin dashboard: user management, access codes, topic library

---

## Default role

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

When working in `backend/routers/admin.py` or `frontend/admin.html`:

- **Admin UI must reflect canonical backend truth.** If the UI shows a different state than what the database holds, the bug is in the pipeline that reads/transforms the data, not just in the rendering.
- **Do not make real associations look empty.** A missing user in the USERS column when a code has `used_by` set is a data visibility bug.
- **Do not create UI states that disagree with persisted backend truth.** After a remove-user operation, the table state must match what a full page reload would show.
- **Removing an assignment must not reset redemption history.**
  - `access_codes.is_used`, `used_by`, and `used_at` are immutable after activation.
  - Only `user_code_assignments.is_active` changes on remove.
  - This preserves the "code cannot be reused" invariant.
- **Fallback synthesization rule:** The detail endpoint (`GET /admin/access-codes/{id}`) must synthesize a `used_by` fallback entry when there are **no active assignment rows** and `used_by` is set — regardless of whether inactive rows exist.
- **Shape contracts matter.** The list endpoint returns `assigned_users[{name, email, ...}]`. The detail endpoint returns `assignments[{display_name, email, ...}]`. When using detail data to update list state, transform explicitly via a shape-conversion function (currently `detailToTableShape()` in admin.html).
- **`association_lookup_failed`** is returned by the list endpoint when the assignment table query fails. Render this as a visible warning (`⚠ lookup failed`), not as `—` (which implies no user). Never silently swallow assignment-fetch failures.

---

## Source of truth expectations

Treat these as invariants:

- Session history and dashboard must read the same persisted fields that finalize/regrade flows update.
- Response-level grading is not complete until session-level aggregates are updated when needed.
- Grammar Wiki slugs, category/group mapping, related_pages, next_articles, and metadata must stay internally consistent.
- `access_codes.is_used`, `used_by`, and `used_at` must never be cleared after activation.
- `user_code_assignments` is the canonical source for admin user-visibility; `access_codes.used_by` is the fallback for codes activated before that table existed.
- **Grammar recommendations canonical source is the `grammar_recommendations` table** — persisted per-response by `grading.py` (`_save_grammar_recommendations()`), attached by `claude_grader.py` (`_attach_grammar_recommendations()`). The frontend client-side keyword-matching in `grammar.js` is a fallback for cases where backend recs are absent. Do not reintroduce frontend-only recommendation logic that bypasses the backend table.
- Migrations must exist before code relies on new columns or tables.

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

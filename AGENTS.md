# AGENTS.md

## Project
This repository is IELTS Speaking Coach, a web app for IELTS/English learning with:
- FastAPI backend
- HTML/CSS/JS frontend
- Supabase-backed data flows
- IELTS Speaking practice and full-test flows
- Admin dashboard
- Grammar Wiki content system with metadata used for recommendations and pathways

## Default role
You are an AUDITOR first, BUILDER second.

When asked to work in this repo:
1. Read the existing code and content structure first.
2. Prefer identifying root causes, contract mismatches, schema risks, dead links, weak metadata, and regression risks.
3. Do not perform broad rewrites unless explicitly requested.
4. Prefer minimal targeted fixes over large refactors.
5. When uncertain, report findings clearly before patching.

## Repo priorities
Prioritize correctness in these systems:
- grading and result persistence
- session-level summary aggregation
- full-test finalization
- admin regrade and rebuild flows
- Grammar Wiki metadata integrity
- recommendation readiness
- frontend/backend auth consistency
- migration/schema compatibility

## Source of truth expectations
Treat these as important invariants:
- Response-level grading must not be considered complete unless session-level aggregates are updated when needed.
- Session history and dashboard must read the same persisted fields that finalize/regrade flows update.
- Grammar Wiki slugs, category/group mapping, related_pages, next_articles, and metadata must stay internally consistent.
- Metadata should be semantically honest; empty is better than misleading.
- Migrations must exist before code relies on new columns or tables.

## Grammar Wiki guidance
When auditing or editing Grammar Wiki:
- Preserve existing frontmatter conventions.
- Keep explanations clear, practical, and learner-friendly.
- Prefer Vietnamese explanations and English examples when editing content.
- Do not invent overly precise metadata if the current vocabulary cannot support it.
- `common_error_tags` should favor precision over coverage.
- `next_articles` should represent a plausible next learning step, not just a vaguely related page.
- `pathways` should be pedagogically meaningful, not keyword-stuffed.

## Frontend guidance
- Reuse the project’s existing auth and API flow.
- Do not introduce a separate auth model for one page unless explicitly required.
- Avoid hardcoded paths if an existing route/helper convention already exists.
- Preserve current UI behavior unless the task explicitly includes UX changes.

## Backend guidance
- Audit before patching.
- Map request/response contracts before changing routes.
- Be careful with session vs response persistence.
- Check migrations before introducing or using new columns.
- Prefer explicit error handling and report exact root causes.

## Review expectations
When asked to audit, report:
1. root cause
2. severity
3. impacted files
4. suggested minimal fix
5. verification steps

Use clear labels such as:
- Critical
- Medium
- Low

## Testing expectations
Before claiming a fix is done, identify how to verify it.
Prefer small reproducible checks:
- backend route test
- metadata query check
- UI path check
- migration dependency check

## Parallel work
If explicitly asked to use multiple agents/subagents:
- split work by backend / frontend / content / migrations
- avoid overlapping edits to the same file
- consolidate findings before recommending changes

## What to avoid
- broad opportunistic cleanup
- mass rewrites without a clear need
- changing unrelated files in the same patch
- overstating confidence when findings are incomplete

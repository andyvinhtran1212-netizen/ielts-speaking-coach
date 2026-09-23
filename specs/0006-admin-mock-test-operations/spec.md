---
id: MOCKOPS-0006
title: Admin Mock Test operations workspace at scale
status: approved
risk: high
owner: product
---

# Admin Mock Test operations workspace at scale

## Problem

The admin Mock Test cockpit combines exam creation, the exam list, a large
Reading/Listening/Writing content bank, live-room operations, review, and Mock
Writing grading in one long surface. Operators must scroll past creation and
duplicated lifecycle context before reaching the current task. At production
scale, the content bank and Writing queue also load or render broad result sets,
so filters can miss records outside an arbitrary client snapshot and totals do
not reliably describe the canonical dataset.

## Scope

- Separate exam management, explicit exam creation, and the large content bank
  into distinct task workspaces under the existing admin routes.
- Make Live, Review, and Mock Writing select and present task-appropriate scope.
- Add bounded server-side search, filters, pagination, and exact totals for the
  content bank and Mock Writing queue.
- Preserve filter context across Writing status/grading journeys and reconcile
  mutations against canonical backend state.
- Bring the touched surfaces into the Aver design system with complete compact,
  responsive, keyboard, theme, loading, empty, warning, and retry states.

## Non-goals

- Changing Mock Test grading, section finalization, result release, assignment,
  or exam-create payload semantics.
- Adding exam identity to Writing essays where the canonical contract does not
  already provide it.
- Automatically assigning course levels to existing content records.
- Replacing same-origin embedded workspaces with a new route architecture.
- Refactoring unrelated admin pages or legacy fixtures.

## Users and journeys

- An operator opens Mock Test management and reaches the existing exam list
  immediately, then deliberately opens either creation or the content bank.
- An operator searches and filters hundreds of content records while only one
  bounded page is fetched and rendered.
- A live proctor opens the Live workspace and sees an open exam or a purposeful
  no-open-room state rather than an unrelated closed exam.
- A reviewer opens Review on a completed/actionable exam without losing an
  explicit valid deep link.
- A marker filters the Mock Writing queue, opens status or grading, saves, and
  returns to the same canonical query context.

## Requirements

- **FR-001:** Mock Test management opens on the canonical exam list; exam creation and the Reading/Listening/Writing content bank are explicit separate workspaces, and embedded management removes duplicated global hero and lifecycle content.
- **FR-002:** The content-bank API and UI provide bounded search, preserve the existing `kind`, `course_level`, `cohort_id`, `exam_only`, and `is_public` filters, add defined dataset-wide attention filters, and support limit/offset pagination with an exact canonical total when every requested source succeeds. Every existing and new filter predicate is applied before counting and offsetting, including in compatibility mode. A partial source read carries an explicit incomplete-total signal and the UI never labels its surviving subtotal as canonical. Only the requested page is enriched and rendered, repeated row actions have contextual accessible names, and level edits require explicit save or cancel with canonical readback.
- **FR-003:** Exam creation retains its existing payload contract while its large content selectors support keyboard search, selected-item visibility, and a clear no-result state.
- **FR-004:** Live defaults to the first published, open exam in canonical newest-first order or a purposeful no-open-room action. Review defaults to the first published, closed exam whose canonical `active_section` is `done`, in the same newest-first order, or a purposeful no-completed-exam state. A valid explicit deep link is always honored even when that exam is not the default candidate, and the Writing workspace does not display an exam rail that does not scope its data.
- **FR-005:** A new additive Mock Writing page endpoint applies student query, backend status, cohort, Mock scope, and overdue filters in PostgreSQL before limit/offset pagination, returns an exact total, and fetches and enriches only the page IDs; the existing array endpoint remains unchanged. Student query is trimmed to 100 characters, matches a case-insensitive literal substring of canonical student full name or student code, or a case-insensitive exact UUID; `%`, `_`, and punctuation are literal characters. `overdue=true` means status is not `delivered` and the earliest non-null deadline across duplicate/historical assignment rows is strictly earlier than PostgreSQL `now()`; the displayed deadline, database predicate, enrichment, and fallback use that same earliest-deadline rule without duplicating essays. A new-frontend/old-backend compatibility fallback applies unsupported active query and overdue predicates locally to the bounded legacy snapshot and is visibly incomplete rather than presented as canonical truth.
- **FR-006:** Writing queue query context is preserved through status, grading, save-and-return, browser navigation, and automatic page correction; grading starts from an exact canonical status read and refreshes the active filtered page until a processing row leaves that status.
- **FR-007:** Touched Mock Test surfaces expose truthful loading, empty, partial/error/retry, stale-readback, and permission states, localize canonical enums with a visible unknown fallback, work at 390/768/1440 widths in both themes, retain visible keyboard focus and 44px targets, and respect reduced motion.

## Acceptance scenarios

### Manage, create, and content bank separation

- **Given** an operator opens `/admin/mock-tests` and selects management
- **When** the embedded management workspace loads
- **Then** the exam list is the first operational content and creation plus the
  content bank are separate explicit actions rather than preceding one another
  in one long page.

### Bounded content bank

- **Given** at least 500 mixed content records
- **When** the operator searches, applies an attention filter, and changes page
- **Then** the API total covers the complete matching dataset while the browser
  mounts only the selected 25/50-row page and a reload returns the same results;
  a record matching the active existing filters plus search/attention beyond
  page 1 changes both the total and the returned page.

### Task-aware workspaces

- **Given** there are no open exams
- **When** the operator selects Live
- **Then** the page shows a purposeful no-open-room state and does not silently
  select a closed exam; a valid explicit closed-exam deep link is still honored.

- **Given** Review has several closed exams, including one not at `done` and two
  completed exams
- **When** the operator opens Review without an exam deep link
- **Then** the first published, closed, `done` exam in canonical newest-first
  order is selected; if no eligible exam exists the purposeful empty state is
  shown, while any valid explicit exam deep link remains selected.

### Canonical Writing pagination

- **Given** a matching learner or pending essay exists beyond the newest 200
  rows
- **When** the operator applies student/status/cohort/overdue filters
- **Then** PostgreSQL filters before pagination, the exact total includes that
  essay, and only the requested ordered page is fetched and enriched. Mixed-case
  queries and literal `%`, `_`, or punctuation follow the defined query rule;
  duplicate assignments neither duplicate the essay nor change the displayed
  earliest deadline, and overdue uses that same earliest non-null deadline.

### Partial content source

- **Given** one Reading, Listening, or Writing source fails while the others
  return records
- **When** the content bank renders the surviving page
- **Then** it displays the failed source and retry action, marks the count as
  incomplete, and does not describe the surviving subtotal as the exact total.

### Independent deployment order

- **Given** Railway and Vercel may deploy the same release at different times
- **When** either the old frontend meets the new backend or the new frontend
  temporarily meets the old backend
- **Then** the old exam-content and Writing array endpoints still work, while
  the new frontend falls back to visibly incomplete legacy results until the
  non-colliding paginated endpoints are available; neither order renders an
  invalid response as an empty catalog or queue, and active Writing `q` plus
  overdue filters never show a nonmatching fallback row.

### Writing round trip

- **Given** a marker is on page 2 with active query filters
- **When** the marker grades an essay and saves or returns
- **Then** the queue restores the same query context, reconciles canonical
  status, and corrects an invalid page without discarding the user-visible
  outcome notice.

## Edge cases

- A picker, progress endpoint, content enrichment, or canonical mutation
  readback fails while a previous snapshot exists.
- A filter yields no rows, the current page becomes empty after mutation, or a
  query contains `%`, `_`, punctuation, or mixed case.
- Cohort membership changes between query and reload, duplicate relationship
  rows exist, or a learner has historical assignments but no active membership.
- A Writing grading request loses its acknowledgement or remains processing
  across several polling intervals.
- An unknown section/sitting enum reaches the UI.
- The operator changes account, filters, task tabs, or browser history while a
  request is in flight.

## Success criteria

- Only the active task and bounded page are mounted at production-like scale;
  totals and filter results match direct database evidence.
- Manage/Create/Content, Live, Review, and Writing journeys preserve canonical
  state through reload, back/forward, and mutation readback.
- Affected backend, contract, browser, TypeScript, and production-build suites
  pass, followed by exact-SHA staging journeys before promotion.

## Open questions

- None. Product approval to proceed with the database-backed bounded queue and
  separated admin workspaces was recorded before this implementation release.

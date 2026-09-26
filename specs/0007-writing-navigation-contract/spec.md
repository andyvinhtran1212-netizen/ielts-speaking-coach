---
id: WRITINGNAV-0007
title: Canonical admin Writing navigation context
status: implementing
risk: high
owner: product
---

# Canonical admin Writing navigation context

## Problem

Writing Queue stores page size only in component memory while page number and
filters live in the URL. Status and Grade independently reconstruct return
links, so a 50-row page 2 can reopen as 25-row page 2 after grading, refresh,
or browser navigation. Grade can also mistake a prior session's Queue sequence
for the source of an essay opened from Instructor Queue or another admin page.
This is a follow-on design for the Writing portion of MOCKOPS-0006 FR-006; it
does not reopen that release's completed review rounds.

## Scope

- Define one canonical, shareable URL context for Writing Queue, Status, and
  Grade, including page size and explicit source ownership.
- Make every Queue control and Queue → Status → Grade → Queue/next transition
  use that context without reconstructing parameters independently.
- Distinguish Instructor Queue entry from ordinary Queue entry, and treat
  source-less external Grade links as direct entries rather than inventing a
  Queue session.
- Keep current canonical backend readback, incomplete-total handling, and
  embedded Mock workspace behavior.

## Non-goals

- Changing essay status, grading, save, release, or backend API semantics.
- Adding a general-purpose return-URL parameter or allowing arbitrary redirect
  destinations.
- Moving Mock Review, learner directory, cohort, assignment, or regrade screens
  into the Writing Queue, or redesigning their own navigation.
- Changing legacy HTML fixtures or creating new persistence for navigation.

## Users and journeys

- A marker filters the ordinary or Mock Queue, chooses 50 rows, opens a job's
  Status and Grade, saves, and returns to the exact same Queue view.
- An instructor claims or opens an essay from Instructor Queue, works in Grade,
  and returns to Instructor Queue without a stale ordinary-Queue sequence.
- An admin opens Grade from a student, cohort, regrade, assignment, or Mock
  Review deep link and can work without fabricated Queue filters or next essay.

## Requirements

- **FR-001:** The Writing Queue URL is the source of truth for lane (`status` or `mocklane`), `queue_status`, `cohort_id`, `overdue`, `q`, `embed`, `page`, and `page_size`. `page_size` accepts 25 or 50, defaults to 25, and remains in the URL when 50; page defaults to 1. Queue fetch limit, offset, page indicator, and links use the same normalized page and size. Changing a filter or page size resets page to 1 in the URL; changing page preserves all other normalized fields. Reload and browser Back/Forward restore both controls and requested data. Invalid, duplicate, or unsupported values normalize deterministically without creating an unsafe URL.
- **FR-002:** A single shared parser/serializer owns the Queue context and generates native Queue, Status, and Grade URLs. A Queue-origin Status or Grade link carries an explicit, fixed `from=queue` marker and the complete normalized context. Status → Grade, Grade → next essay, Grade → Queue, and save-and-return preserve the same context. No component manually assembles a competing subset of query parameters. The essay ID is separate from the return context and is never taken from a stale session value.
- **FR-003:** Instructor Queue → Grade carries `from=instructor` plus only its own supported view and embed/Mock cockpit flags; Grade's return and release actions target Instructor Queue with that view. A source-less or invalid-source Grade deep link does not infer Queue ownership from `sessionStorage`; it retains the existing canonical essay load and provides a safe Writing workspace fallback. A Queue sequence may drive “save & next” only if its essay IDs include the current essay and the active URL says `from=queue`. External Grade links remain valid without adding navigation parameters.
- **FR-004:** Embedded Mock Writing remains within the embedded routes and preserves `embed=1` and `mocklane=1` across Queue/Status/Grade hops. Page correction happens only after an exact `total_complete=true` page response; incomplete compatibility snapshots preserve requested page and size even when locally empty. Existing mutation reconciliation and status polling continue to use the active canonical filter/page context.
- **FR-005:** All applicable loading, empty, success, stale/error, retry, and permission states offer a valid return destination. Navigation remains keyboard-operable with visible focus, readable at 390/768/1440 widths in light/dark themes, and respectful of reduced motion. No new surface may imply a count or page is canonical when the backend reports an incomplete total.

## Acceptance scenarios

### Full Queue round trip

- **Given** Mock Queue has `q=Lan`, `cohort_id=c1`, `queue_status=grading`,
  `overdue=1`, `embed=1`, `page=2`, and `page_size=50`
- **When** the marker opens Status, then Grade, saves and returns, reloads, or
  navigates Back/Forward
- **Then** the same normalized filters, page 2, and 50-row request are restored
  at every hop; neither page 2 at 25 rows nor a default Queue appears.

### Changes and compatibility

- **Given** a Queue URL requests page 4 at 50 rows
- **When** the operator changes a filter or selects 25 rows
- **Then** the new URL requests page 1 with the new filter or size, and Back
  restores the previous view. An exact total may correct an out-of-range page;
  an incomplete compatibility snapshot may not.

### Instructor and direct links

- **Given** a previous ordinary Queue sequence remains in session storage
- **When** an instructor opens the same essay from Instructor Queue or an admin
  opens it through a direct Grade link
- **Then** no ordinary-Queue “save & next” or return appears. Instructor return
  restores its own view; direct entry has a safe workspace fallback.

### Invalid links and operational states

- **Given** a malformed page, page size, source, filter, or missing essay ID
- **When** Queue, Status, or Grade loads, including an error/permission state
- **Then** the UI does not crash or redirect externally, preserves valid fields,
  offers a safe in-app return, and does not issue a mutation from bad context.

## Edge cases

- Query punctuation and URL encoding; old links without `from` or `page_size`;
  a stale/foreign-account Queue sequence; a row changing status while Status is
  open; an empty exact page after mutation; an empty incomplete fallback page;
  embedded navigation and a new-tab direct Grade link.

## Success criteria

- One round-trip contract suite covers every producer/consumer and a browser
  journey confirms 50-row page 2 before and after Status/Grade/save/reload.
- No Grade return or next-essay action is derived solely from session storage.
- Existing backend contracts, canonical readback, and other admin entry routes
  remain unchanged.

## Open questions

- None. The source marker is a fixed enum, not a caller-provided return URL.

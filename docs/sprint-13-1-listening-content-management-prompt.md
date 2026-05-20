# Sprint 13.1 — Listening Content Management (commission prompt)

> Ready-to-commission prompt for the FIRST sprint in cluster
> DEBT-ADMIN-LISTENING-AUTHORING. Sprint 13.0 discovery (see
> `docs/sprint-13-0-listening-authoring-discovery.md`) catalogued
> 22 UX gaps + 8 architecture decisions. Andy picks Option A / B / C
> before commissioning.

---

## Commission (Option B — recommended)

**Goal.** Ship the listening content list page + metadata-edit page +
publish/archive controls, so Andy never has to touch Supabase
Dashboard to manage existing listening_content rows. Defer "create
new content via upload" to Sprint 13.2 and "render via ElevenLabs" to
Sprint 13.3.

**Branch:** `sprint-13-1-listening-content-management`
**Expected PR:** #230
**Estimated effort:** ~700 LOC (split frontend ~500 + backend ~200) + tests

### Scope — IN

**Backend (2 endpoints + tests)**

1. `PATCH /admin/listening/content/{id}` — update editable metadata
   fields. Allow-list: `title`, `transcript`, `accent_tag`,
   `cefr_level`, `ielts_section`, `topic_tags`, `is_premium`,
   `external_license`, `external_source_url`. Validate same as
   existing POST /upload (CEFR enum, accent enum, ielts_section 1-4,
   premium+NC license combo blocked). 422 on bad inputs. 404 on
   missing row.
2. `PATCH /admin/listening/content/{id}/status` — body
   `{"status": "draft" | "published" | "archived"}`. Validates the
   transition is allowed (any → any; no special workflow). 422 on
   unknown status. 404 on missing row.

Both endpoints `require_admin(authorization)`. Both return the
updated row.

**Backend tests (~10 cases)**

- PATCH metadata happy path (`backend/tests/test_admin_listening_content_patch.py`)
- PATCH metadata 422 on bad accent_tag, bad cefr_level, premium+NC
  combo
- PATCH metadata 404 on unknown id
- PATCH status happy path each direction (draft↔published↔archived)
- PATCH status 422 on unknown status
- Auth checks (401 on missing token, 403 on non-admin)

**Frontend (2 new pages + content list promotion)**

3. Promote `frontend/pages/admin/listening/index.html` from card-grid
   landing → content list (architecture decision D1 in discovery doc).
   - Heading + subtitle stays
   - Card-grid becomes a secondary "Tạo bài mới" row at top with two
     placeholder cards: "Tải MP3" (links to Sprint 13.2 page once it
     lands; for Sprint 13.1, link to `#` with a "Sắp ra mắt" tooltip)
     and "Render ElevenLabs" (same)
   - Below: paginated table consuming GET /admin/listening/content
     with columns: Title, Accent, CEFR, Section, Status, Audio
     duration, Exercises (count + types badges), Created at, Actions
   - Status filter dropdown (all / draft / published / archived)
   - Each row's Title links to a new `content-detail.html` (see #4)
   - "Edit meta" link in Actions column points to `content-meta.html?id=`
   - "Open editor" submenu links to segments/gist/tf/mcq each with
     `?content_id=<row.id>` pre-baked
4. New `frontend/pages/admin/listening/content-detail.html` — single-
   content overview. Shows metadata read-only at top + a 4-row table
   of exercise types (dictation / gist / true_false / mcq), each row
   shows `status` if authored OR "Chưa có" with a "Tạo bài" link to
   the editor with `?content_id=` pre-baked. Below: a "Trạng thái nội
   dung" panel with Publish / Archive buttons calling PATCH
   .../status. Below: an "Edit metadata" link to content-meta.html.
5. New `frontend/pages/admin/listening/content-meta.html` — editable
   form for the 9 metadata fields. PATCH on submit. Returns to
   content-detail.html on success with a success banner.

**Frontend JS (3 new modules)**

- `frontend/js/admin-listening-content-list.js` — fetch + render +
  filter + status badge map
- `frontend/js/admin-listening-content-detail.js` — fetch row + fetch
  exercises + render exercise type matrix + Publish/Archive handlers
- `frontend/js/admin-listening-content-meta.js` — form binding +
  client-side validation + PATCH

**Frontend tests (~25 sentinels)**

- `frontend/tests/admin-listening-content-management.test.mjs`
- List page sentinels: GET endpoint called, status filter wired,
  table columns present, edit-meta link, editor deep-links carry
  `?content_id=`
- Detail page sentinels: exercise matrix rendered with all 4 types,
  Publish/Archive PATCH calls, "Chưa có" → editor link with
  `?content_id=` pre-baked
- Meta page sentinels: PATCH endpoint called, client-side validation
  blocks bad accent_tag, premium+NC combo blocks at submit
- Cancel-link fix: all 4 editors now point to
  `/pages/admin/listening/index.html` not `/admin.html`

**Chrome (1 edit)**

- `frontend/js/components/aver-admin-chrome.js` — extend NAV_GROUPS
  listening sub-items with new slugs: `content` (list) and `create`
  (placeholder for Sprint 13.2). Existing 5 editor slugs stay.

### Scope — OUT (defer to later sprints)

- ❌ MP3 upload UI (Sprint 13.2)
- ❌ ElevenLabs render UI (Sprint 13.3)
- ❌ Bulk operations (Phase B candidate)
- ❌ Render job status endpoint (covered by polling content list per
  discovery D6)
- ❌ Mini-test session editing
- ❌ Author-experience polish (autosave, keyboard shortcuts, diff)
- ❌ Archived-exercise restore

### Constraints

- **Vanilla static HTML on Vercel.** No Next.js, no React. Match the
  Sprint 12.x admin IA pattern.
- **`<aver-admin-chrome>` for chrome.** All new pages set
  `active="listening"` and a `subsection=` slug.
- **`window.api.get/post/patch`** for API calls.
- **Backend tests must run under in-memory fake Supabase** — match
  the Sprint 11.x admin endpoint test pattern. No real DB.
- **No breaking changes to existing user-side listening routes** —
  `/api/listening/content/{id}` (user) still hard-filters published.

### Acceptance criteria

1. Andy can open `/pages/admin/listening/index.html` and browse
   listening_content rows without leaving the page
2. Andy can filter to drafts only
3. Andy can click a row and see all 4 exercise type statuses for that
   content
4. Andy can publish a draft from the detail page in one click
5. Andy can edit the title of a content row without SQL
6. Andy can deep-link from the detail page into the right editor with
   `?content_id=` pre-baked
7. Cancel buttons on editor pages return to listening landing, not
   the dead `/admin.html` redirect
8. Backend pytest at 1271 + new tests (target ≥1281)
9. Frontend node-test at 2687 + new sentinels (target ≥2712)
10. CI 4-of-4 green required checks
11. PR description includes the before/after sentinel delta per
    Sprint 12.4 lesson "test count delta verification"

### Out-of-band

- If the PATCH content endpoint has a hidden Sprint 11.x intent that
  this commission missed, audit before commit.
- If Sprint 12.x left an "admin-listening-content" surface skeleton
  somewhere (none found in Sprint 13.0 discovery), check
  `frontend/pages/admin/listening/` for any half-finished page before
  scaffolding new HTML.

---

## Alternative commissions

### Option A — Minimal Entry Layer

Drop everything except: content list + 4 editor deep-links + cancel-
button fix. NO new backend endpoints. NO `content-meta.html`. NO
`content-detail.html` (the list row Actions column becomes the only
surface).

**Estimated effort:** ~400 LOC.
**Trade-off:** Andy still touches Supabase Dashboard for publish +
metadata edits.

### Option C — Full Lifecycle + AI Render

Same as Option B for Sprint 13.1. Then Sprint 13.2 adds Upload tab
on `create.html`. Sprint 13.3 adds Render tab.

**Estimated total:** Sprint 13.1 ~700 LOC + Sprint 13.2 ~800 LOC +
Sprint 13.3 ~800 LOC.

---

**Andy: pick Option A / B / C. Default recommendation is B.**

# Sprint 13.0 — DEBT-ADMIN-LISTENING-AUTHORING Discovery

**Cluster:** DEBT-ADMIN-LISTENING-AUTHORING (new)
**Sprint:** 13.0 — Discovery only (no production code)
**Branch:** `sprint-13-0-listening-authoring-discovery`
**Author:** Code
**Date:** 2026-05-19
**Estimated effort:** ~2h (doc-only)

---

## TL;DR

The DEBT-ADMIN-IA-REFACTOR cluster closed on Sprint 12.8 with `admin.html`
flipped to a pure 91-LOC redirect. That flip exposed a long-buried gap:
the **Listening module never got an admin authoring layer**. The five
editor pages under `/pages/admin/listening/` (segments, gist, tf, mcq,
mini-test) all require `?content_id=<UUID>` as a precondition but the
ONLY way to obtain that UUID is the Supabase Dashboard or a now-gone
legacy panel in `admin.html`. There is no content list, no upload UI, no
render UI, no publish UI, no metadata-edit UI.

The Listening backend admin routes are mature (9 endpoints across
upload + render + content + exercises + sessions), and Sprint 11.5
closed the user-facing experience. The remaining work is a frontend
authoring entry layer that sits ABOVE the 5 single-entity editors and
fills the entry/lifecycle gaps.

This document inventories the gap, locks ~8 architecture decisions, and
proposes a 3-sprint roadmap (Sprint 13.1 → 13.3) with option A
(Minimal entry layer), option B (Full lifecycle), option C
(Full lifecycle + AI render UI). Andy will pick the option that opens
Sprint 13.1.

---

## 1. Background — how we got here

### Module status pre-cluster

Sprint 11 series shipped the Listening module end-to-end:

| Sprint | Outcome |
|---|---|
| 11.0–11.2 | Data model + user dictation surface + ElevenLabs render plumbing |
| 11.3 | Segmented dictation authoring (admin) |
| 11.4 | Gist + True/False + MCQ authoring (admin) |
| 11.5 | Mini-test builder + user runner + analytics |
| 11.5.1 | Hotfix |

That work shipped **five editor pages** in `/pages/admin/listening/`:

| Page | Purpose | Requires `?content_id=` |
|---|---|---|
| `segments.html` | Dictation: split transcript → segments + timestamps | Yes |
| `gist.html` | Gist: prompt + model answer + rubric keywords | Yes |
| `tf.html` | True/False/NG: 3-12 statements + answers | Yes |
| `mcq.html` | MCQ: 1-20 questions with 4 options A-D | Yes |
| `mini-test.html` | Builder: lineup of published exercises | No |

Plus `index.html` as a card grid linking to those five.

### What was assumed, and what shipped

The Sprint 11.0 discovery doc and the inline comment on
`/pages/admin/listening/index.html:69` BOTH promised that a content
listing UI would land in "Sprint 12.x":

> Cần `?content_id=<UUID>` khi mở editor cho một bài cụ thể (lấy ID từ
> `admin.html` legacy hoặc Supabase dashboard **cho tới khi Sprint 12.x
> ship content listing**).

The Sprint 12 cluster (12.0–12.8) was scoped to **admin IA refactor** —
carving the `admin.html` monolith. It successfully extracted Speaking,
Vocab, Grammar, Users, System (AI Usage + Alerts), Access Codes, and
Error Logs into the new IA. But the **Listening authoring layer was
never on the carve list** — because the editors already existed under
the new IA path. The Sprint 12.x promise on listening/index.html was
inherited as silent debt and never delivered.

The Sprint 12.8 closure flipped `admin.html` to a redirect, so the
escape hatch ("lấy ID từ admin.html legacy") no longer exists. The
**Supabase dashboard is now the only path** for content lifecycle
management.

### The user-visible pain (verbatim from Andy)

> "Tôi muốn ship listening content nhưng phải login Supabase dashboard,
> copy UUID, paste vào URL bar mỗi lần edit. Đó không phải là tooling."

Confirmed by the live page copy at `listening/index.html:67-70` (admin
literally tells admin to go fetch UUIDs from Supabase).

---

## 2. Phase A — Frontend audit

### 2.1 Page inventory

| File | Size | Role | Entry method | Create vs Edit |
|---|---|---|---|---|
| `pages/admin/listening/index.html` | 4.5KB | Card-grid landing | Sidebar `Listening` | N/A — links only |
| `pages/admin/listening/segments.html` | 9.2KB | Dictation editor | `?content_id=<UUID>` | EDIT only — can't create content here |
| `pages/admin/listening/gist.html` | 6.8KB | Gist editor | `?content_id=<UUID>` | EDIT only |
| `pages/admin/listening/tf.html` | 7.2KB | True/False editor | `?content_id=<UUID>` | EDIT only |
| `pages/admin/listening/mcq.html` | 7.9KB | MCQ editor | `?content_id=<UUID>` | EDIT only |
| `pages/admin/listening/mini-test.html` | 6.7KB | Mini-test builder | No content_id needed | CREATE only (no edit existing) |
| `js/admin-listening-segments.js` | 21KB | Segments controller | — | — |
| `js/admin-listening-gist.js` | 4.4KB | Gist controller | — | — |
| `js/admin-listening-tf.js` | 7.5KB | TF controller | — | — |
| `js/admin-listening-mcq.js` | 8.4KB | MCQ controller | — | — |
| `js/admin-listening-mini-test.js` | 7.8KB | Mini-test controller | — | — |

### 2.2 Entry-point dead ends

| Surface | Where the entry breaks |
|---|---|
| **Cancel button** in all 4 editors | Links to `/admin.html` — now a 91-LOC redirect to `/pages/admin/index.html`. Lands admin on overview, not on listening |
| **"← Admin" breadcrumb** in all 4 editors | Same `/admin.html` link |
| **`?content_id=` query param** | No UI surface produces it; Supabase Dashboard is the only source |
| **Mini-test pool selector** | Does consume `/admin/listening/content?status=published` but ONLY surfaces published content (admin can't author against a draft via the mini-test pool) |

### 2.3 Workflows that work today

- ✅ **Edit existing dictation/gist/tf/mcq** — if admin already has the
  content UUID, the editor loads cleanly + saves cleanly via
  POST /admin/listening/exercises
- ✅ **Build a mini-test** — admin sees published exercises pool +
  reorders + saves via POST /admin/listening/sessions
- ✅ **Render polling visual** — none, but mini-test builder lists
  existing sessions so admin can confirm a render landed

### 2.4 Workflows that DON'T work today

- ❌ **Browse listening content** — no UI surface, must use Supabase Dashboard
- ❌ **Create new content via MP3 upload** — backend route exists
  (POST /admin/listening/upload) but ZERO frontend consumers
- ❌ **Create new content via ElevenLabs render** — backend route exists
  (POST /admin/listening/render, feature-flag gated) but ZERO frontend
  consumers
- ❌ **Poll render job status** — render returns a `job_id` but no
  endpoint exposes job state; admin polls /admin/listening/content
  paginated and watches for the draft row to land (~10-30s)
- ❌ **Edit content metadata** (title, transcript, accent_tag,
  cefr_level, topic_tags, is_premium) — NO backend route, NO frontend
  UI. Once content is created, metadata is immutable from the admin UI
- ❌ **Publish a draft** (status: draft → published) — NO backend route,
  NO frontend UI. Only via direct SQL or Supabase Dashboard
- ❌ **Archive content** (status: published → archived) — NO backend
  route, NO frontend UI
- ❌ **Delete content** — NO backend route, NO frontend UI
- ❌ **View exercise list per content** — backend route exists
  (GET /admin/listening/exercises?content_id=) but only used internally
  by editors to seed re-edit; no UI surfaces a per-content overview
- ❌ **Discover content without exercises** — admin can't tell which
  uploaded content needs exercises authored
- ❌ **Discover stale drafts** — no surface lists drafts pending publish

### 2.5 Navigation chrome

The shadow-DOM `<aver-admin-chrome active="listening">` correctly
renders the listening sidebar with 5 sub-items (segments / gist / tf /
mcq / mini-test) per `aver-admin-chrome.js:370-377`. Sidebar nav works.
But **all 5 sub-items link to editors that require `?content_id=`** —
clicking them lands on an empty editor with a "Thiếu ?content_id"
error banner.

---

## 3. Phase B — Backend audit

### 3.1 Admin endpoint roster

The Listening admin router (`backend/routers/listening.py`, prefix
`/admin/listening`) exposes 9 endpoints:

| # | Method | Path | Purpose | Frontend consumer |
|---|---|---|---|---|
| 1 | POST | `/upload` | MP3 + transcript multipart upload | **NONE** |
| 2 | POST | `/render` | ElevenLabs render (FF-gated) | **NONE** |
| 3 | GET | `/content/{id}` | Single content (drafts visible) | 4 editors |
| 4 | GET | `/content?status=&limit=&offset=` | Paginated list, status filter | mini-test (pool only) |
| 5 | POST | `/exercises` | Upsert dictation/gist/tf/mcq | 4 editors |
| 6 | GET | `/exercises?content_id=&exercise_type=` | List exercises per content | 4 editors + mini-test |
| 7 | DELETE | `/exercises/{id}` | Soft-archive exercise | **NONE** |
| 8 | POST | `/sessions` | Create mini-test session | mini-test |
| 9 | GET | `/sessions?limit=&offset=` | List mini-test sessions | mini-test |

### 3.2 Endpoints missing

| Need | Endpoint that doesn't exist | Effort |
|---|---|---|
| Publish draft | `PATCH /admin/listening/content/{id}/status` | Small (~30 LOC) |
| Edit metadata | `PATCH /admin/listening/content/{id}` | Small (~50 LOC) |
| Delete/archive content | `PATCH .../status=archived` (covered by ⬆) | — |
| Render job status poll | `GET /admin/listening/render-jobs/{job_id}` | Medium (~80 LOC + table?) |
| Bulk publish | n/a | Out of scope |

The "render job status poll" gap is the most awkward — admin currently
polls `/admin/listening/content` repeatedly to watch the draft row
land. A dedicated polling endpoint would be cleaner but isn't blocking.

### 3.3 Validation + authorization patterns

- All admin routes call `await require_admin(authorization)` — Sprint
  11.x pattern, consistent.
- POST /exercises has rich server-side validation via four pure helpers
  (`_validate_gist_payload`, `_validate_true_false_payload`,
  `_validate_mcq_payload`, `_validate_dictation_segments`). 422 errors
  are admin-facing and useful.
- POST /upload + POST /render derive `source_type` from license
  presence. Premium + NC-license combo is blocked at 422 (Sprint 11.0
  §4E).
- POST /sessions validates every exercise_id is published before save —
  draft exercises in a mini-test lineup are rejected.

### 3.4 Data model recap (relevant tables)

| Table | Key columns | Notes |
|---|---|---|
| `listening_content` | id, title, transcript, audio_storage_path, audio_duration_seconds, accent_tag, cefr_level, ielts_section, topic_tags, source_type, status, alignment_data | `status ∈ {draft, published, archived}`. `alignment_data` only set on ElevenLabs renders |
| `listening_exercises` | id, content_id, exercise_type, payload, segments, order_num, status | `exercise_type ∈ {dictation, gist, true_false, mcq}`. `segments[]` only used by dictation. `payload` jsonb holds gist/tf/mcq shape |
| `listening_sessions` | id, user_id, session_type, exercise_ids[], ordered_position[], section_content_ids[] | `session_type='mini_test'` for admin-authored. User free-practice rows live here too |
| `listening_attempts` | per-question attempt rows | FK CASCADE drives the "soft-archive only" stance on exercises |

---

## 4. Phase C — Sample file audit

**Status:** PENDING SAMPLES

I searched the repo for sample authoring inputs (DOCX, JSON,
structured-text scripts, transcript files) and found NONE. The closest
artifacts are:

- `backend/scripts/elevenlabs_seed.py` (Sprint 11.2) — single-shot
  render-by-CLI script, not a sample doc
- Backend tests use inline string transcripts, not external files

Andy has not yet handed over sample DOCX/structured-text inputs in the
form authors would actually use. The Sprint 13.x roadmap **cannot lock
the upload/render UX flow** until samples are reviewed. Sprint 13.1
should default to the existing Sprint 11.0 spec shape
(multipart/form-data with title + transcript + accent_tag + cefr_level
+ ielts_section + optional external_license + external_source_url +
topic_tags + is_premium) and revisit when samples arrive.

**Trigger to revisit:** Andy provides ≥3 sample authoring files
representative of real BBC/TED/IELTS-mock workflows.

---

## 5. Phase D — Synthesis

### 5.1 UX gap catalog

Numbered for traceability into Sprint 13.1+ acceptance criteria.

**Entry layer (highest pain)**

1. No content list page — admin cannot browse content rows
2. No "create new content" affordance from any listening admin page
3. No upload UI (POST /admin/listening/upload has zero consumers)
4. No render UI (POST /admin/listening/render has zero consumers)
5. Editor cancel buttons + breadcrumb point to dead `/admin.html`
6. No way to obtain `?content_id=<UUID>` without Supabase Dashboard

**Lifecycle layer (high pain)**

7. No publish/archive UI — drafts forever pending without SQL
8. No metadata edit UI — typo in title? SQL only
9. No render job status surface — admin polls /content blind
10. No per-content overview showing which exercise types are
    authored vs missing (admin can't tell that a content has gist
    + mcq but no tf yet)

**Discovery layer (medium pain)**

11. No "stale drafts" surface — drafts can languish unnoticed
12. No "content without exercises" surface — uploads can sit unused
13. No filter/search across content (title, accent_tag, cefr_level,
    topic_tags) — list endpoint supports `status` only
14. No bulk operations (publish 5 drafts at once)

**Quality layer (medium pain)**

15. No preview of finished exercise from the editor (admin saves
    blind; only a separate user route reveals the rendering)
16. Mini-test builder can't reorder published exercises within a
    saved session (mini-test sessions are immutable once created)
17. No archived-exercise restore (soft-delete is one-way via UI)

**Author-experience polish (low pain)**

18. No keyboard shortcuts on segments editor (Andy authors 47-
    sentence dictations regularly)
19. No autosave on editors (browser refresh = lose work)
20. No diff/history when re-editing existing exercises
21. No "duplicate exercise" affordance (build T/F variant from MCQ
    transcript)
22. No CEFR/accent-tag bulk re-tagging

### 5.2 Architecture decisions

Eight decisions for Sprint 13.x to lock before writing code.

**D1. Content list page placement**

- Option a: New `/pages/admin/listening/content.html` standalone list
- **Option b (recommended):** Promote `/pages/admin/listening/index.html`
  from card grid to list-first surface (cards become a secondary nav)
- Option c: Inline content list as sidebar third-level

Rationale for (b): The index page IS the listening landing; making it
the content browser collapses two clicks into one and matches the
vocab pattern (`/pages/admin/vocab/index.html` is the stats hub).

**D2. Upload vs render — separate pages or one?**

- Option a: Two pages (`upload.html` + `render.html`)
- **Option b (recommended):** One `create.html` page with tab toggle
  between "Upload MP3" / "Render via ElevenLabs"
- Option c: Modal launched from content list

Rationale for (b): The destination row (listening_content draft) is
identical; only the source differs. A single page collapses cognitive
load. Modal (c) is rejected because admin needs space for transcript
authoring.

**D3. ElevenLabs FF gating**

The render endpoint is feature-flag gated. If the FF is off in prod
when Sprint 13.1 ships, the render tab should:

- **Option a (recommended):** Render the tab but show a 503 banner +
  link to Andy's "enable AI render" runbook
- Option b: Hide the tab entirely

Rationale: Andy can flip the FF independently of a deploy; a hidden
tab is harder to re-discover.

**D4. Metadata edit — inline or modal?**

- Option a: Inline editable fields on the editor pages
- **Option b (recommended):** Dedicated `content-meta.html` page
  reachable from content list "Edit metadata" link
- Option c: Modal on content list

Rationale for (b): Editor pages are already dense; metadata is rare
enough that a dedicated surface is cleaner. Backend PATCH needed.

**D5. Publish/archive — button placement**

- **Option a (recommended):** Two buttons on content-meta.html
  (Publish, Archive). Save buttons on editor pages also gain
  `Publish exercise` semantics (already exist).
- Option b: Status dropdown on content list

Rationale for (a): Status transition has consequence (drafts hidden
from users); explicit button avoids fat-finger drops on the list.

**D6. Render job status surface**

- Option a: Add backend `GET /admin/listening/render-jobs/{job_id}` +
  render-jobs table
- **Option b (recommended):** Reuse content list with a banner that
  surfaces "Render đang chạy (~30s) — refresh để xem draft." after
  POST /render returns
- Option c: WebSocket / SSE (overkill)

Rationale for (b): Sprint 13.x should not block on a new table. The
content list paginated by `created_at desc` surfaces the new draft
within one refresh.

**D7. "Per-content exercise overview" placement**

The "content has gist + mcq but no T/F" question is most naturally
answered by promoting `index.html` (D1 above) to include an
"exercises authored" column per content row. Decision: bake into D1.

**D8. Cancel/back navigation**

All editor pages currently link to `/admin.html` which is a redirect.
Sprint 13.1 fixes these in-flight:

- "← Admin" link → `/pages/admin/listening/index.html`
- "Hủy" cancel button → `/pages/admin/listening/index.html` (or
  the content's overview if D7 lands)

### 5.3 Three-sprint roadmap

#### Option A — Minimal Entry Layer (Sprint 13.1 only, ~700 LOC)

**Sprint 13.1 scope:** Promote `index.html` → content list. Wire
content list to GET /admin/listening/content (already exists). Add
status filter. Add `?content_id=` links to each row that deep-link to
each of the 4 editors. Fix dead `/admin.html` cancel links.

**Stops there.** Andy still needs Supabase Dashboard for: create
content, publish/archive, edit metadata. But the daily edit loop is
unblocked.

**Pros:** Smallest patch, zero backend changes, ships in 1 session.
**Cons:** Doesn't address create/publish/metadata pains.

#### Option B — Full Lifecycle (Sprint 13.1 → 13.2, ~1500 LOC)

**Sprint 13.1 (~700 LOC):** Option A scope + backend `PATCH
/admin/listening/content/{id}` (metadata) + `PATCH .../status`
(publish/archive). Frontend `content-meta.html` page.

**Sprint 13.2 (~800 LOC):** `create.html` with Upload MP3 tab only
(POST /admin/listening/upload consumer). Multipart form, validation,
landing-on-edit-meta after success. Skip render tab — defer to Sprint
13.3.

**Pros:** Removes Supabase Dashboard for 90% of workflows. Stops at
upload (the path Andy uses today via direct DB inserts).
**Cons:** Two PRs.

#### Option C — Full Lifecycle + AI Render (Sprint 13.1 → 13.3, ~2300 LOC)

**Sprint 13.1 + 13.2:** Same as Option B.

**Sprint 13.3 (~800 LOC):** Add Render tab to `create.html` (POST
/admin/listening/render consumer). FF-aware UI per D3. Script-text
textarea + voice picker + accent dropdown + model dropdown. Refresh
banner per D6.

**Pros:** Closes the listening authoring loop end-to-end. Supabase
Dashboard becomes optional.
**Cons:** Three PRs; render tab depends on ELEVENLABS_API_KEY +
LISTENING_AI_RENDER_ENABLED in prod, which may not be ready.

### 5.4 Recommendation

**Option B.** Reasoning:

- Option A leaves create + publish in Supabase Dashboard — too small
  to justify a cluster opening.
- Option C's render tab is high-leverage but blocked on ElevenLabs
  budget approval + Andy hasn't validated the rendered audio quality
  is good enough to ship at scale.
- Option B closes the upload + edit + publish loop in two sprints,
  matches the depth of the Sprint 12.x carve cluster, and leaves
  render as a clean Sprint 13.3 opt-in.

Trigger to upgrade to Option C mid-cluster: Andy ships ≥3 ElevenLabs-
rendered listening sessions to a real user cohort and confirms the
quality bar.

### 5.5 Anti-triggers — what is NOT in this cluster

- ❌ User-facing listening UI changes (Sprint 11 closed that)
- ❌ Backend grader changes (`_grade_and_save_dictation` etc. are
  stable)
- ❌ Mini-test session editing (immutable per D7-aside; defer until
  user reports pain)
- ❌ ElevenLabs voice catalog UI (Sprint 13.3 if option C)
- ❌ Bulk operations (Phase B candidate, gate on >50 content rows)
- ❌ Render job status table + endpoint (D6 — defer)

---

## 6. Sprint 13.1 ready-to-commission prompt

See `docs/sprint-13-1-listening-content-management-prompt.md`.

---

## 7. Acceptance for Sprint 13.0

- ✅ All five listening admin pages inventoried with entry-point notes
- ✅ All nine backend admin endpoints catalogued with frontend-consumer
  status
- ✅ Twenty-two UX gaps catalogued, numbered for downstream traceability
- ✅ Eight architecture decisions named with recommended option +
  rationale
- ✅ Three-option roadmap with effort estimates
- ✅ Andy can pick Option A/B/C → Sprint 13.1 commission is ready
- ✅ PENDING SAMPLES marker added in §4 (Phase C)
- ✅ Zero production code changes (doc-only sprint)
- ✅ Backend pytest unchanged at 1271
- ✅ Frontend node-test unchanged at 2687
- ✅ Hotfix count unchanged at 28

# Independent Codex Audit — Sprint 18.3.2 Students Chrome Migration (#304)

**Date:** 2026-05-26  
**Auditor:** Codex  
**Method:** repo source audit + deployed artifact diff + targeted sentinel run

## Executive summary

Sprint 18.3.2 is **structurally clean**. The live page at `/pages/admin/students/index.html` is byte-identical to repo source, the page is off the old Writing-Coach chrome stack, and the inline auth/CRUD wiring still points at the canonical admin routes. I did **not** find a P0/P1 regression in the migrated page.

The main residual concern is **verification strength**, not shipped logic. Current proof for the 11 workflows is dominated by source-scan sentinels rather than browser/runtime checks, and one of the new tests contains stale narrative truth ("Andy dogfood confirms visuals") even though this independent audit was explicitly commissioned before Andy dogfood.

---

## 1. Removal verification

| Item to remove | Evidence | Result |
|---|---|---|
| `WC.bootstrap` call | No call in [frontend/pages/admin/students/index.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:223) or inline script body [234-539](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:234) | ✅ PASS |
| `aw-*` CSS classes | Page markup uses `.st-*` and `.adm-*`; no live `class="...aw-"` tokens in [frontend/pages/admin/students/index.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:94) | ✅ PASS |
| Tailwind CDN script | No `cdn.tailwindcss.com` reference in [frontend/pages/admin/students/index.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:1) | ✅ PASS |
| `lucide` icon import | No `lucide` import/use in [frontend/pages/admin/students/index.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:1) | ✅ PASS |
| `writing-admin.js` module | No `writing-admin.js` `<script>` in [frontend/pages/admin/students/index.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:223) | ✅ PASS |
| `admin-writing.css` stylesheet | Page links only tokens/components/admin-components at [32-34](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:32) | ✅ PASS |

Notes:
- The strings `WC.bootstrap`, `aw-*`, and `admin-writing.css` still appear in the explanatory migration comment at [36-39](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:36), but not as live runtime dependencies.
- I fetched production `https://www.averlearning.com/pages/admin/students/index.html` and diffed it against repo HEAD; diff was empty.

---

## 2. Replacement verification

| Replacement contract | Evidence | Result |
|---|---|---|
| `<aver-admin-chrome>` wrapper | [frontend/pages/admin/students/index.html:95](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:95) | ✅ PASS |
| `av-*` token stack | Tokens/components/admin-components loaded at [32-34](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:32); page-local styles use `var(--av-...)` throughout [41-91](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:41) | ✅ PASS |
| Shared `admin-components.css` primitives | `.adm-table`, `.adm-btn-*`, `.adm-card`, `.adm-modal`, `.adm-field`, `.adm-banner` used in markup [119-220](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:119) | ✅ PASS |
| Inline auth gate (`/auth/me` → state-ready/state-denied) | `_boot()` at [521-539](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:521) | ✅ PASS |
| Local `esc()` / `debounce()` helpers | [235-247](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:235) | ✅ PASS |

Backend truth check:
- The page’s frontend gate is backed by real admin-protected routes in [backend/routers/admin_students.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/admin_students.py:54), where create/import/list/get/update/delete all call `require_admin(...)`.

---

## 3. 11-workflow preservation matrix

| # | Workflow | Evidence | Status |
|---|---|---|---|
| 1 | Page render with aver-admin chrome | `<aver-admin-chrome active="students">` + module load at [543](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:543) | ✅ PASS |
| 2 | Admin auth gate (deny non-admin) | `_boot()` checks `/auth/me`, branches to `#state-denied` / `#state-ready` at [521-539](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:521) | ✅ PASS |
| 3 | Students list render | `loadStudents()` + `renderRows()` at [259-297](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:259) | ✅ PASS |
| 4 | Search (debounced) | local `debounce()` [241-247](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:241) bound to `#search-input` at [512-516](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:512) | ✅ PASS |
| 5 | Create student modal | `#btn-new` + `openModal(null)` + `POST /admin/students` at [123](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:123), [299-343](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:299) | ✅ PASS |
| 6 | Edit student modal | `data-act="edit"` row action + `GET /admin/students/{id}` + `PATCH` at [281](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:281), [359-363](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:359), [331-332](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:331) | ✅ PASS |
| 7 | Delete student | `data-act="delete"` + confirm + `DELETE /admin/students/{id}` at [282](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:282), [366-373](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:366) | ✅ PASS |
| 8 | Tổng quan summary modal | modal shell at [153-182](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:153) + fetch/render at [397-466](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:397) | ✅ PASS |
| 9 | CSV import | file input at [119-122](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:119) + handler at [468-487](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:468) | ✅ PASS |
| 10 | "New Essay" link | row action redirects to `/pages/admin/writing/new.html?student_id=...` at [280](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:280), [355-357](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:355) | ✅ PASS |
| 11 | Lớp ↔ Học viên tab integration | subtab bar at [97-101](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/students/index.html:97) | ✅ PASS |

Important scope note:
- These are **structural preservation findings**. They prove the migrated page still wires the same routes/handlers and embeds the same modal/search/CSV paths.
- They are **not** a substitute for browser-level dogfood of create/edit/delete/import flows.

---

## 4. Cluster 18.x non-regression check

### Targeted checks run

```bash
node --test \
  frontend/tests/sprint-18-3-2-students-chrome.test.mjs \
  frontend/tests/admin-access-codes.test.mjs \
  frontend/tests/sprint-17-3-cohorts.test.mjs \
  frontend/tests/sprint-18-2-dashboard.test.mjs
```

Result:
- `68 pass`
- `2 fail`

### Interpretation

| Surface | Evidence | Result |
|---|---|---|
| Students migration | `frontend/tests/sprint-18-3-2-students-chrome.test.mjs` all passing | ✅ PASS |
| Cohorts page / Sprint 18.1 tab integration | `frontend/tests/sprint-17-3-cohorts.test.mjs` passing | ✅ PASS |
| Dashboard page / Sprint 18.2 route/nav consolidation | `frontend/tests/sprint-18-2-dashboard.test.mjs` passing | ✅ PASS |
| Access-codes page | Two stale header assertions fail because headers are now sortable (`Trạng thái ↕`, `Hết hạn ↕`) in [frontend/pages/admin/access-codes/index.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/access-codes/index.html:169) | ⚠️ CONCERN |

The two failing assertions are in [frontend/tests/admin-access-codes.test.mjs:60](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/tests/admin-access-codes.test.mjs:60). They check exact `<th>Trạng thái</th>` / `<th>Hết hạn</th>` string matches and therefore no longer reflect the live markup.

---

## 5. Issues surfaced

### P2 — Workflow preservation is structurally proven, but runtime proof is still thin
- **Root cause:** current #304 verification is dominated by static source-scan sentinels, not browser-level workflow tests.
- **Evidence:** [frontend/tests/sprint-18-3-2-students-chrome.test.mjs](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/tests/sprint-18-3-2-students-chrome.test.mjs:17) reads the HTML file from disk and asserts strings/regexes; it does not execute modal/search/import flows.
- **Impact:** if a regression exists in actual browser interaction timing or modal wiring, current sentinel coverage is weaker than the report language suggests.
- **Suggested minimal fix:** add one lightweight browser/runtime sentinel later for create modal open/close, search debounce hook, and summary modal open path.
- **Verification step:** run a browser-level smoke on live `/pages/admin/students/index.html` with admin auth and exercise open modal, close modal, search, summary modal.

### P3 — Test narrative truth drift: "#304 visuals already dogfooded"
- **Root cause:** the sentinel file narrates a stronger verification state than currently exists.
- **Evidence:** [frontend/tests/sprint-18-3-2-students-chrome.test.mjs:8](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/tests/sprint-18-3-2-students-chrome.test.mjs:8) says `Andy dogfood confirms visuals`.
- **Impact:** weakens auditability. A future reviewer could mistake source-scan coverage for already-completed product dogfood.
- **Suggested minimal fix:** change that comment to reflect source-scan only, or update it only after actual dogfood happens.
- **Verification step:** comment/docs review only.

### P3 — Access-codes sentinel is stale, reducing cluster-wide non-regression confidence
- **Root cause:** exact header-string assertions were not updated after sortable arrows shipped.
- **Evidence:** [frontend/tests/admin-access-codes.test.mjs:60-68](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/tests/admin-access-codes.test.mjs:60) still expects bare `<th>Trạng thái</th>` and `<th>Hết hạn</th>`, while live markup is `Trạng thái ↕` / `Hết hạn ↕` at [frontend/pages/admin/access-codes/index.html:169-172](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/access-codes/index.html:169).
- **Impact:** this does not indicate a product regression, but it does mean the current sentinel bundle contains stale assertions.
- **Suggested minimal fix:** loosen those checks to assert semantic header presence rather than exact raw HTML.
- **Verification step:** rerun the targeted node bundle after updating the test.

---

## Bottom line

Sprint 18.3.2 itself looks **clean and safe to dogfood**. The page is truly migrated off the Writing-Coach chrome stack, the canonical admin chrome is in place, backend auth guards remain intact, and the main risk I found is **verification truth drift**, not a functional defect in the shipped page.

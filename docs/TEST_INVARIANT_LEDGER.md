# TEST INVARIANT LEDGER — Frontend Migration to Next.js

**Status:** DRAFT (2026-07-13, requires human review before Gate A)  
**Historical scope (2026-07-13):** Cataloged 225 frontend test files (214 node:test + 4 Playwright e2e + 7 archived); not a current total.
**Method:** Section 11.4 (test retirement rule) + sections 7.4/B7 (ledger backbone)  
**Baseline commit:** `3f031d17` (HEAD) + 11 commits after `9047e09f`  

> **Note to reviewers:** This is a clerical inventory. Each entry is a **suggestion** for migration disposition based on test type, not a commitment. Disposition changes per architectural decision in Phase 1 (ADR-001/002/etc.) and Route Ledger priority. Entries formerly marked **UNCLEAR** were re-read and finalized 2026-07-14 (durable invariant + disposition per row; see "## UNCLEAR resolution" appendix at the end).

---

## Current retirement checkpoint — 2026-09-10

ADR-005 still requires per-invariant replacement or reviewed retirement. The
July CI counts below are historical: CI now runs both `frontend/tests/*.test.mjs`
and `frontend/tests/*.test.js` globs, including new files. Do not use historical
"not in CI" or "retire-immediately" labels as deletion approval.

Pricing was revalidated against current source. The Next owner
`frontend/app/(marketing)/pricing/page.tsx` deliberately redirects to `/` before
launch. `pricing-next-behavior.test.mjs` now protects this native contract without
reading public Pricing or landing HTML, including execution of the actual page
with Next's redirect implementation. `verify-pricing-redirect-flow.mjs` remains
the HTTP boundary check. The old Pricing controls and landing assertions now
characterize immutable snapshots in `gate-f-pricing-fixtures.test.mjs`, not
mutations of public HTML; all `pricing-redesign.test.mjs` assertions
remain against hash-pinned, non-public HTML/CSS. Dormant launch content is
preserved, not discarded or approved for launch.

The live HTML sentinel is intentionally superseded by server interception:
`/pricing.html` permanently redirects to `/pricing`, whose Next owner returns
307 to `/`; `/index.html` permanently redirects to `/`. These rules are emitted
by `next.config.ts` before public-file serving and are guarded by the compiled
config and 139-rule golden tests in `gate-f-retirement-redirects.test.mjs`.
Both HTML URL redirects were also verified with production GET requests.

The two dedicated suites also pass in an isolated checkout without `public`.
Wave 5 also moves only the Pricing inputs in the shared anti-flash, theme and
payment-copy suites to the same archive; all 209 cases and other source reads
remain. A separate isolated execution proves those suites pass without public
Pricing, then each detects a deliberately broken current HTML source copy. These
Pricing assertions are historical, not theme/copy requirements on the redirect-only
native route. Source-inventory, CSS-budget and generic scan consumers still need
disposition before physical retirement. No test was deleted or skipped and no
public file was removed. See [wave 4 mapping](audits/GATE_F_PRICING_TEST_DECOUPLING_2026-09-10.md)
and [wave 5 mapping](audits/GATE_F_PRICING_SHARED_TESTS_2026-09-10.md).

Wave 6 replaces the SITE_OVERVIEW physical-HTML denominator with product App
Router pages. Replaying the old walker proved it counted just seven root HTML
files because the pages directory is a symlink; it also explicitly excluded
app. The unchanged 85% floor now measures 130 native route patterns, with all
130 documented. The original nine obligations remain: dead-reference guard,
coverage floor, README link and six canonical spine surfaces. Historical HTML
mentions are checked against durable redirect identities and native owners,
not physical files. The real sentinel runs in isolation without any public or
legacy tree; helper regressions cover dead routes and misleading denominators.
See [wave 6 mapping](audits/GATE_F_NATIVE_SITE_OVERVIEW_2026-09-10.md).

Wave 7 aligns six redirect-test consumers and the central redirect suite with
the durable URL manifest, and separates replacement identities from physical
HTML totals in the status test. The physical-set freeze is retained as its own
test. A source-only candidate-removal rehearsal now fails only that freeze and
the intentionally stale Pricing CSS budget, rather than aborting unrelated
suites. Six generated Pricing scan cases would disappear after deletion; their
three historical UI obligations are explicitly identified, not silently marked
replaced. No physical deletion or scanner retirement is approved by this wave.
See [wave 7 mapping and evidence](audits/GATE_F_PRICING_RETIREMENT_REHEARSAL_2026-09-10.md).

See [wave 3 asset audit](audits/GATE_F_ASSET_AUDIT_2026-09-10.md) for the current
read-only inventory; it grants no deletion approval.

## LEGACYJS-0075 W4b — 2026-11-23

Spec `specs/0075-legacy-public-js-retirement` T005 (G10-T07-W4b) deletes 11
error-log, grammar, speaking, vocab and writing-queue scripts in
`frontend/public/js/` (3,175 lines): `admin-error-logs.js` (566),
`admin-speaking-sessions.js` (483), `admin-writing-queue.js` (438),
`admin-speaking-topics.js` (404), `admin-vocab-exercises.js` (271),
`admin-vocab-d1.js` (249), `admin-grammar-analytics.js` (191),
`admin-grammar-articles.js` (160), `admin-vocab-lemmas.js` (159),
`admin-vocab-stats.js` (153) and `admin-grammar-recommend.js` (101). Their
pages are Next routes under `frontend/app/(authed-admin)/(error-logs)/`,
`(authed-admin-grammar-*)`, `(authed-admin-speaking-*)`, `(authed-admin-vocab)`
and `(authed-admin-writing-queue)`, with their `lib/admin-*-model.mjs` models;
no Next code, kept `public/js` file or browser flow loads these scripts. The CI
path filter drops the 9 lines naming them, and
`tooling/verify-admin-grammar-analytics-flow.mjs` drops its rollback-page block
(CI already ran it with `--next-only`, now a no-op). Retired HTML fixtures stay
(ADR-005); assertions on them are kept. One row per test edited (FR-002):

| Test file | Assertions removed (only those reading a deleted script) | Disposition | Replacement that holds the invariant now |
|---|---|---|---|
| `admin-error-logs-humanize.test.mjs` | ran `humanizeError` from `admin-error-logs.js` in a VM | port | same 19 cases now import `humanizeError` from `lib/admin-error-logs-model.mjs` (the function the Next page uses) |
| `rollback-exposure-line.test.mjs` | ran `_exposureLine()` from `admin-error-logs.js` in a VM; panel wiring pin | port | executed `normalizeRollbackPayload` (clamp flag, requested vs measured minutes, no exposure → `null`) and `formatWindow`; pins on the Next `<ExposureLine>` (evaluated cohort only, `ít nhất` + `cận dưới` + `is-warning` when not exact, clamp note with both numbers, other cohorts listed as "Không tính vào sàn"), the Next window picker (30 phút / 24 giờ / 7 ngày / 30 ngày) and `<ExposureLine metrics={rollback} />`; fixture option pins kept. Clamp copy is now "không thuộc cửa sổ đã yêu cầu" |
| `admin-error-logs.test.mjs` | controller pins (stats, list, dismiss/undismiss, test error, `escapeHtml`, vi-VN, noise filter, `generateTestError`, `humanizeError`) | port | `admin-error-logs.tsx`: same endpoints through `window.api`, no `dangerouslySetInnerHTML`, `hideNoise` default on and filtering by `humanizeError(row).noise`, `generateTestError` → `setHideNoise(false)`; model `formatLogTime` vi-VN and the humanize categories; fixture pins kept |
| `adr-012-telemetry.test.mjs` | triage refresh, migration-stats and rollback-metrics pins on `admin-error-logs.js` | port | dismiss/undismiss and the test error each refresh `loadLogs`, `loadStats`, `loadMigration`; migration truncation note; rollback query built with `URLSearchParams` (route encoded); model reads `error_verdict`/`vitals_verdict` and the page renders both `VerdictLine`s; `insufficient-sample` surfaced |
| `admin-progressive-loading-toggle.test.mjs` | 5 wrapper pins (`logs-table-wrap`, `top-wrap`, `saved-wrap`, `zero-wrap`, `gra-table-wrap`) | retire | Next owners render from React state with no hidden-toggle wrapper: `admin-error-logs-next-behavior`, `admin-grammar-analytics-next-behavior`, `admin-grammar-articles-next-behavior` |
| `admin-toast.test.mjs` | 8 scripts in the showBanner list; speaking-sessions 5 s and writing-queue hybrid timing | port | list keeps `admin-reading-attempts.js` (W4c); Next speaking sessions and writing queue use `<StatusBanner>` with errors kept until the next action and no native dialogs. **Difference:** success banners no longer auto-dismiss after 5 s |
| `admin-daily-board.test.mjs` | `?session=` deep link and `feedbackReport` pins on `admin-speaking-sessions.js` | port | Next sessions page reads `params.get('session')` and loads the detail; `<FeedbackReport feedback={response.feedback} />`; the model reads `fc_feedback`, `lr_feedback`, `gra_feedback`, `p_feedback`, `strengths`, `improvements`, `grammar_issues` |
| `admin-speaking-extract.test.mjs` | sessions/topics controller pins (page limit, endpoints, vi-VN, state, `initSupabase`) | port | `PAGE_LIMIT = 50` with offset paging; typed client `lib/admin-speaking-sessions-api.ts` names `/admin/sessions`, detail, both regrades and rebuild-summary; Asia/Ho_Chi_Minh vi-VN format; topics state (list snapshot, `part` default 1, question snapshot) and `/admin/topics`, `/questions`, `/generate-questions`; both read the account from `useAdminProfile`, no own Supabase client. **Difference:** the user filter sends `user_email` instead of reading `/admin/users` first |
| `admin-grammar-extract.test.mjs` | endpoint pins on the 3 grammar controllers | port | Next articles list + `/{slug}/preview`, analytics `?days=${nextDays}`, recommend POST with `draft_suppressed` and the `seq` stale guard |
| `admin-grammar-analytics-next-behavior.test.mjs` | 5 rollback-client pins | retire | the same file's Next pins (`requestId === sequence.current`, "Dấu — không có nghĩa là 0", per-section empty copy) |
| `admin-grammar-articles-next-behavior.test.mjs` | rollback-client test (analytics status, stale guard, learner link) | retire | the same file's Next pins: contradictory `analytics_status` rejected, `requestId` guards, executed `grammarStudentHref` |
| `admin-grammar-recommend-next-behavior.test.mjs` | `requestId !== runSequence` on the rollback client | retire | same test's Next `id === seq.current` and edit-invalidation pins |
| `admin-vocab-extract.test.mjs` | stats, D1 and lemma controller pins | port | Next `/admin/vocab/stats`, `/admin/flashcards/stats?days=`, `vocab-flag`; D1 `PAGE_LIMIT = 50` offset paging and GET/PATCH/DELETE `/admin/vocab/d1-questions`; lemma GET/POST/DELETE `/admin/vocab/lemmas/overrides`; vi-VN dates. Lemma pages now load 100 rows per page |
| `admin-system-extract.test.mjs` | `admin-vocab-exercises.js` endpoint pins | port | Next exercises list, per-item `/${action}`, `/bulk`, `/d1/generate-batch` |
| `admin-writing-status-next-behavior.test.mjs` | rollback queue link to `/admin/writing/status?essay_id=` | port | executed `writingQueueDestination` sends a pending essay to `/admin/writing/status?essay_id=…` |
| `assignment-analysis-level.test.mjs` | queue level pill pins on `admin-writing-queue.js` | port | Next row renders `L{row.analysisLevel}`; executed `normalizeWritingQueueRow` keeps L4 and rejects L9; fixture CSS pin kept |
| `grade-queue.test.mjs` | 20 controller pins (overdue, poll, row open, queue context, no-image badge, list endpoint, bulk deliver, selection, mock lane, mock minimum, grade-anyway/skip, `?status=` deep link) | port | executed `isWritingEssayOverdue`, `shouldPollWritingQueue`, `writingQueueDestination`, `writingQueueApiPath` (`mock=false`/`mock=true`), `normalizeBulkDelivery` (counts must match), `writingMockMinimum`, `normalizeWritingQueueFilters` (lanes, `''` → all, default graded); Next pins on `gradeQueue` sessionStorage, "Thiếu hình", bulk POST then canonical re-read, `bulkable` on reviewed only, select-all, grade/skip behind a confirm dialog, start-grading and mock skip-grading paths. **Difference:** list reads the paged `/admin/writing/essay-queue` (25 per page) instead of `/admin/writing/essays?limit=200`; grade opens `/admin/writing/grade` |
| `mock-tests-cockpit.test.mjs` | `mocklane`/embed hooks, `_stripEmbedChrome`, `openEssay`, `_withEmbed` on `admin-writing-queue.js` | port | `mocklane=1` → mock lane, `embed=1` drops header and lane rail, lane change never sets embed; executed `writingQueueDestination` carries `mocklane=1&embed=1` to status and grade and drops them off the cockpit. **Difference:** in the cockpit the filter toolbar stays visible (only header and lanes are dropped). Fixture pins for grade/status/instructor pages kept |

## LEGACYJS-0075 W4a — 2026-11-23

Spec `specs/0075-legacy-public-js-retirement` T005 (G10-T07-W4a) deletes 10
overview/system/traffic scripts in `frontend/public/js/` (1,360 lines):
`admin-overview.js` (249), `admin-dashboard.js` (200), `admin-feedback.js`
(277), `admin-alerts.js` (134), `admin-ai-usage.js` (132), `admin-usage.js`
(128), `admin-foot-traffic.js` (98), `admin-usage-util.js` (58),
`admin-instructors.js` (47) and `admin-embed.js` (37). `/admin`,
`/admin/usage`, `/admin/system/alerts`, `/admin/system/ai-usage`,
`/admin/foot-traffic`, `/admin/feedback`, `/admin/instructors` and the three
embedded mock pages are owned by Next routes with their `lib/admin-*-model.mjs`
models; no Next code, kept `public/js` file or browser flow loads these
scripts. `admin-usage-util.js` loses its last consumers (`admin-classes.js` in
W3b, `admin-usage.js` here). The CI path filter drops the two deleted paths.
`tooling/verify-admin-feedback-flow.mjs` drops its rollback-page block (it
opened `/pages/admin/feedback/index.html`, whose script is deleted; CI already
ran the flow with `--next-only`, now a no-op).
Retired HTML fixtures stay (ADR-005); assertions on them are kept. Gaps are
recorded, not built. One row per test edited in the same PR (FR-002):

| Test file | Assertions removed (only those reading a deleted script) | Disposition | Replacement that holds the invariant now |
|---|---|---|---|
| `admin-dashboard-redesign.test.mjs` | `before()` read `admin-dashboard.js`, so all 14 tests failed; JS pins on dual fetch, `renderSpark`/`renderDelta`/`renderChart`, `_trends` cache | port | same file: fixture describe kept as is; new pins on `admin-overview.tsx` (native `Sparkline`/`AreaChart` with `currentColor`, six tiles, series + `Delta` slots, trend tablist, "Cần chú ý" counts, `getAdminDashboardOverview`/`Trends`, trends failure → `setTrends(null)` only, tab switch reads cached `trends[seriesKey]`), the overview layout stylesheets, `admin-overview.css` banner token, and executed `periodDelta`/`chartPoints`. `charts/sparkline.js` pins unchanged |
| `dashboard-tweaks.test.mjs` | `before()` read `admin-dashboard.js`; JS pins on `load('windowed')`, `.db-card--windowed`, `fmtTokens`, `setLoading`, `_reqId` | port | same file: fixture and backend pins kept; all-time tiles shimmer only on `loadingScope === 'all'`, the 2 windowed tiles on any load, window change → `loadOps(windowDays, 'windowed')`, refresh → `loadAll('all')`, `opsSequence` stale guard, `db-refresh` disabled while loading; executed `formatTokens` (K/M/B, `—`) and `normalizeTrendsPayload` |
| `viewers-anonymous.test.mjs` | `before()` read `admin-dashboard.js`; JS pins on the visitors split | port | same file: backend + fixture pins kept; tile renders `formatInteger(ops.visitors.count)` with "đăng nhập · … lượt ẩn danh" split; executed `normalizeOpsPayload` keeps `count/authenticated/anonymous/windowDays` |
| `sprint-18-2-dashboard.test.mjs` | controller slot ids, listener wiring, `/admin/dashboard/overview?visitors_window=`, `v == null → '—'`, no inline colour in `admin-dashboard.js` | port | same file: fixture + chrome pins kept; six rendered values, 7/30/90 options, windowed reload, refresh, `getAdminDashboardOverview(days)`, executed `formatInteger(null)`/`formatTokens(undefined)` → `—`, no inline colour/bg in `admin-overview.tsx` |
| `admin-overview.test.mjs` | 7 controller pins on `admin-overview.js` (GET, 5-min refresh, visibility pause, stale refocus, `escapeHtml`, vi-VN, `is-warning`) | port | same file: Next `admin-overview.tsx` (`getAdminContentOverview`, `REFRESH_MS`, visible-only interval, `visibilitychange` stop, `lastContentAt` ≥ `REFRESH_MS`, no `dangerouslySetInnerHTML`, vi-VN, `is-warning` when undismissed > 0); fixture pins kept |
| `admin-listening-reporting-wave2.test.mjs` | Listening tile pins on `admin-overview.js` | port | same file: `SkillStat` "Đúng TB" formats `avg_score_7d` as `Math.round(value * 100)%` (no `toFixed(2)`) and "Chép ch.tả 7d" reads `dictation_7d` in `admin-overview.tsx` |
| `admin-reading-next-behavior.test.mjs` | `skills.reading?.avg_score_7d` pin on rollback `admin-overview.js` | port | same file: Next card formats Reading accuracy as a percentage; fixture slot pins kept |
| `admin-progressive-loading-toggle.test.mjs` | 6 wrapper pins (`users-wrap`, `alr-sessions-wrap`, `alr-grading-wrap`, `ft-body`, `usage-table-wrap`, `code-usage-table-wrap`) | retire | Next owners render tables from React state with no hidden-toggle wrapper: `admin-ai-usage-next-behavior`, `admin-alerts-next-behavior`, `admin-foot-traffic-next-behavior`, `admin-usage-next-behavior` |
| `admin-toast.test.mjs` | `admin-dashboard.js` in the showBanner list; "dashboard keeps persist:true" | port | list drops to 9 kept scripts; overview load error is an inline `role="alert"` `db-banner` cleared only by the next load (one `setOpsError(null)`, no timer) |
| `feedback-admin-inbox.test.mjs` | endpoint, optimistic toggle, coverage and identity pins on `admin-feedback.js`; helpers extracted from it in a VM | port | same file: `admin-feedback.tsx` GET/PATCH, waits for the server echo then re-reads canonical state (no optimistic flip, per AGENTS › Source of truth), unavailable/partial copy and `≥` lower bound; executed `normalizeFeedbackFilters`, `groupFeedbackItems`, `feedbackDeepLink`, `averageRating`, `normalizeFeedbackInbox` (unavailable ≠ empty, partial needs `truncated`); fixture/CSS/chrome pins kept. Deep links now go to `/admin/reading/preview?test_id=…#qN` and `/admin/listening/tests` (no `?test=` on Listening: the list has no test-id search yet) |
| `feedback-widgets.test.mjs` | `^(practice\|exercise):` pin on `admin-feedback.js` | port | executed `feedbackDeepLink` returns `null` for `practice:`/`exercise:` ids |
| `foot-traffic-truncated-banner.test.mjs` | ran `render()` of `admin-foot-traffic.js` on a stub DOM | port | executed `normalizeFootTrafficPayload` + `formatTrafficCount` (`≥` when partial) and the `partial && aft-banner is-warning` pin in `admin-foot-traffic.tsx`; the backend sets `data_status: "partial"` whenever it sets `truncated` (`backend/routers/admin.py` `foot_traffic`). A payload without `data_status` is now rejected instead of shown as complete. Fixture pin kept |
| `sprint-17-4-foot-traffic.test.mjs` | endpoint, summary ids, `esc(p.path)`, inline-style pins on `admin-foot-traffic.js` | port | `admin-foot-traffic.tsx`: `/admin/analytics/foot-traffic?${params}`, three summary counts, top pages, `DailyChart`, path as React text, only height/width inline styles |
| `sprint-17-2-usage.test.mjs` | `admin-usage-util.js` helpers; `admin-usage.js` wiring | port | executed `formatUsageCost`/`Count`/`Date`, `filterUsageRows`, `sortUsageRows` (nulls last, email fallback); `admin-usage.tsx` `code_id` branch, both endpoints, no injected HTML or inline colour, both empty states. Cost `0` now shows `$0.0000` (was `$0`). **Gap:** sort is a select with one fixed direction per field (no asc/desc toggle) |
| `sprint-17-3-cohorts.test.mjs` | "reused usage-util still exports formatters" | retire | util has no consumer left; class formatting is pinned in the same file's Next class wiring tests (W3b) |
| `sprint-18-3-components.test.mjs` | no-inline-colour pins on `admin-usage.js` and `admin-foot-traffic.js` | port | same check on `admin-usage.tsx` and `admin-foot-traffic.tsx`, plus a JSX `style={{…}}` colour/background guard |
| `admin-system-extract.test.mjs` | `/admin/ai-usage?days=` and `/admin/alerts` pins on the deleted controllers | port | `admin-ai-usage.tsx` builds `/admin/ai-usage` with optional `?days=`; `admin-alerts.tsx` reads `/admin/alerts?limit=30` |
| `mock-cockpit-consolidation.test.mjs` | `admin-embed.js` adds `is-embedded` and returns early without `?embed=1` | port | Next `mock-exams` reads `embed === '1'`, `mock-live`/`mock-reviews` pages pass `params.embed === '1'`, and all three owners drop their hero behind `{!embedded && <>`; fixture pins (helper tag order, `data-embed-hide`) kept |

## LEGACYJS-0075 W3b — 2026-11-23

Spec `specs/0075-legacy-public-js-retirement` T004 (G10-T07-W3b) deletes the 2
class/student scripts in `frontend/public/js/`: `admin-classes.js` (4,053
lines) and `admin-students-panel.js` (644). `/admin/classes`,
`/admin/classes/[cohortId]` and `/admin/students` are owned by the Next routes
under `frontend/app/(authed-admin-classes)/` and
`frontend/app/(authed-admin-students)/`, with `lib/admin-classes-model.mjs`,
`lib/admin-class-{detail,homework,submissions,student-work}-model.mjs` and
`lib/admin-students-model.mjs`; no Next code, kept `public/js` file or browser
flow loads these scripts. The helpers they imported (`admin-usage-util.js`,
`course-explanation-format.js`, `course-report.js`) keep other consumers.
Retired HTML fixtures stay (ADR-005); assertions on them are kept. Where a
legacy feature has no Next counterpart the row says **Gap**; gaps are recorded,
not built, in a retirement wave. One row per test edited in the same PR
(FR-002):

| Test file | Assertions removed (only those reading a deleted script) | Disposition | Replacement that holds the invariant now |
|---|---|---|---|
| `admin-action-log.test.mjs` | all tests ran the log slice of `admin-classes.js` in a VM or read its wiring | port | same file, now on `admin-class-homework.tsx` (before → after due text, flip counts, student + assignment names, "Không khôi phục được câu nào", Asia/Ho_Chi_Minh, no injected HTML, error ≠ empty, "Xem thao tác cũ hơn" only with `has_more` + `next_before`, append on paging, `logSequence` stale guard, load on first open, reload after a due change, `audit_logged === false` banners on both write paths) and `normalizeActionLog`. **Gap:** an open log is not reloaded after "Trả bài" (that write lives in the submissions panel); legacy reloaded it |
| `admin-assign-subgroup.test.mjs` | all tests read `admin-classes.js` (give payloads, `whoRecipients`, backfill picker, effort modal) or its retired page ids | port | same file, now on `validateHomeworkDraft` / `homeworkDraft` (one payload builder: `student_ids` null for the class, the picked ids for a group, empty group refused, dialog starts on the class) and the panels: recipient select + member checkboxes from the loaded roster, "Giao cho N học viên" / "Giao cho cả lớp", backfill POST (empty body for the class, ids for a group), tick list for group assignments, "Chọn ít nhất một học viên cần thêm", "Mọi học viên phù hợp đều đã có bài này.", effort report by bank + assignment, Vietnamese state labels, unactivated marker, stale ≠ empty, sections/combined %/total minutes, unsubmitted essay message |
| `admin-course-writing-form-errors.test.mjs` | `renderStudentWriting` run from `admin-classes.js` | port | same file, now on `WritingReport` in `admin-class-submissions.tsx` (`formOnly = ok === true && issues.length > 0`, `data-ok` / `data-form`, "Đúng ngữ pháp, còn lỗi trình bày — tính là đúng", the issue note, `ISSUE_KIND` "hình thức", "Không có lỗi…" only when clean, `clean / total câu đúng ngữ pháp`, `ok` read as stored). **Gap:** no line counting the form-only sentences ("N câu đúng ngữ pháp nhưng còn lỗi trình bày") |
| `course-explanation-format.test.mjs` | `admin-classes.js` in the "every renderer uses `formatCourseExplanation`" list | retire (deleted surface) | the learner renderers keep the pin. **Gap:** the Next admin submissions panel renders explanations with its own React-escaped `InlineMd` (bold only), not the shared formatter's paragraphs and lists |
| `admin-students-next-behavior.test.mjs` | "legacy panel confirm no longer claims essays are erased" read `admin-students-panel.js` | port | same test, now on the native archive dialog ("Bài làm, điểm và lịch sử được giữ nguyên.", no erase claim) plus `existsSync(admin-students-panel.js) === false` |
| `admin-a11y-labels.test.mjs` | students toolbar / bulk / row-checkbox labels read the merged page + `admin-students-panel.js` | port | same describe, now on `admin-students-directory.tsx`: search input inside `<Field label="Tìm học viên">` (a real `<label>`), bulk select `aria-label="Lớp cần thêm"`, per-row and select-all checkbox labels. grade.html pins unchanged |
| `admin-student-listening.test.mjs` | drawer Listening stats, reset and deep links in `admin-students-panel.js` | port | same file, now on the profile dialog: four stats from `detail.listening`, accuracy `null` → "—", unactivated and failed-read messages. **Gap:** no deep links to the Listening attempts / dictation reports filtered by the learner, and "Bỏ dở" has no warning style |
| `sprint-18-3-2-students-chrome.test.mjs` | merged page + `admin-students-panel.js` (no WC chrome, adm-* use, CRUD, summary, CSV, search, tabs) | port | same file, now on `/admin/students` `page.tsx` + directory: no WC/aw-/Tailwind/lucide, `aver-admin-chrome active="classes" subsection="students"`, shared Dialog/Field, no inline colour, `AdminAccessGate`, POST/PATCH/archive DELETE, writing summary, CSV upload, new-essay link, search, the two tabs |
| `student-hub-drawer.test.mjs` | drawer markup, endpoints, header, assign deep link and focus trap in `admin-students-panel.js` | port | same file, now on `ProfileDialog` + the shared `Dialog` (role/aria-modal/labelledby, Tab trap, Esc unless busy, focus returns to opener), both endpoints via `Promise.allSettled` with visible failure, `essay_history`, bands line, `assignmentHref` → `?assign_student`. assignments.html pins unchanged. **Gap:** the profile is a centred dialog, not a right slide-over |
| `admin-students-redesign.test.mjs` | merged page + `admin-students-panel.js` (WC.bootstrap, 36 DOM ids, thead, goal cell, row actions, endpoints, payload, summary, debounce, English microcopy, WF-1 bulk) | port (surviving invariants) / retire (legacy-only pins) | same file, now on the directory: panel file absent, thead = selection + Học viên/Lớp/Tài khoản/Mục tiêu/Thao tác, `formatBandGoal` executed (one "Chưa đặt" when empty), Vietnamese actions and no English, no decorative emoji, all seven endpoints, 300 ms debounce, canonical summary fields, multi-cohort cell with `⚠ lookup failed`, bulk POST, one active-cohort read. admin-writing.css and admin/users WF-1 pins unchanged. Retired with the file: WC.bootstrap/IIFE/fonts, the 36 ids, `data-act` values, legacy microcopy list (replacement: `admin-students-next-behavior.test.mjs`, `verify-admin-students-flow.mjs`). **Gap:** the name button that opens the profile has no label saying it opens the profile (screen readers hear only name + code) |
| `admin-confirm-danger.test.mjs` | cohort `removeMember` via `confirmDanger` read `admin-classes.js`; the archive confirm read `admin-students-panel.js` | port | same tests, now on `admin-class-detail.tsx` (remove-member button opens the confirm dialog, the action runs only from it, DELETE then `loadOverview(true)`, no native `confirm(`) and `admin-students-directory.tsx` (archive opens its own reason dialog, no `confirm(` / `confirmDanger`). Helper and legacy-fixture pins unchanged |
| `admin-progressive-loading-toggle.test.mjs` | `#list-table-wrap` and `#roster-table-wrap` rows read `admin-classes.js` | retire (deleted surface) | the two rows are dropped; the Next directory and class detail render tables from React state with no hidden wrapper (`admin-classes-next-behavior`, `admin-class-detail-next-behavior` cover the empty and failed states). Other rows unchanged |
| `admin-toast.test.mjs` | "admin-classes.js routes messages through showToast" and "students setAlert delegates" read the two deleted files | port | now on the Next owners: `StatusBanner` (`role="alert"` for errors) used by the class directory, detail, homework and submissions panels with no native `alert(`/`confirm(`; the students directory error banner has no timer. Helper, other pages and the HTML-fixture `toast.js` pins unchanged |
| `sprint-17-5-reassignment.test.mjs` | cohort add/remove member wiring, confirm gate and Pattern #26 read `admin-classes.js` | port | same describe, now on `admin-class-detail.tsx`: POST `/students` with `student_id`, DELETE `/students/{id}`, remove-member confirm dialog, no inline colour, add-member Dialog + form + "Học viên" field. Codes describe and HTML-fixture pins unchanged |
| `sprint-18-1-ia.test.mjs` | `COHORTS_JS` (`populateStudentPicker`, GET `/admin/students`, Pattern #26) read `admin-classes.js` | port | now on `admin-class-detail.tsx`: picker is a `<select>` inside the "Học viên" Field, filled from GET `/admin/students?limit=200` through `normalizeStudentOptions`, no inline colour. Other describes unchanged |
| `sprint-18-3-components.test.mjs` | `admin-classes.js` entry in the no-inline-colour list | retire (deleted surface) | the entry is dropped; the Next class detail's no-inline-colour pin lives in `sprint-17-5-reassignment` and `sprint-18-1-ia` |
| `sprint-17-3-cohorts.test.mjs` | class controller wiring (cohort_id branch, members endpoint, create/archive, roster formatters, Pattern #26) read `admin-classes.js` | port | same describe, now on the directory + `[cohortId]` route: roster route keyed by `cohortId` reading `/members`, list via `getAdminCohorts({ withRollup: true })`, POST create, PATCH `is_active`, `student_code` cell, unreadable sessions stay "Không đọc được", `formatMoney(ai_cost_usd)`, no inline colour. Usage-util, chrome and HTML-fixture pins unchanged |
| `admin-due-date-edit.test.mjs` | the "Đổi hạn nộp" slice of `admin-classes.js` run in a VM (Vietnam-time parts, first press without confirm flag, flip counts, second press, invalidation on date/time change, reopen forgets, conflict) plus page ids | port | same file: `dueParts` executed (19:00 VN, past-midnight UTC, empty/invalid → "" / 19:00) and `saveDue` / `openDue` / the due Dialog in `admin-class-homework.tsx` pinned (flag only when date and time equal the warned pair, `expected_due_at`, cleared date → null, close + `canonicalMutation`, both flip counts and stale note, "Vẫn đổi hạn", date/time edits clear the confirmation, reopen resets it, conflict loads `current_due_at` and reloads). Round-trip and conflict execution stay in `admin-class-homework-next-behavior`. **Gap:** none found; behaviour change: on conflict the Next dialog stays open on the canonical due instead of closing |
| `admin-return-student-work.test.mjs` | `returnStudentWork` from `admin-classes.js` run with fake `confirmDanger` / `api` / `toast`, plus the `cw-return` button gate | port | same file: `canReturnSubmission` executed (published + `sealed === false` only; unknown seal stays closed) and `returnWork` / the return Dialog in `admin-class-submissions.tsx` pinned (button only opens the dialog, the one `/return/` POST is in the dialog action, the copy says work is kept and drafts restored, canonical `loadTally(true)` + `onMutation()` after the write, restored-count vs "phải viết lại" error, server message kept verbatim, no reload on failure, blocked reasons for closed or sealed assignments). The open-log reload gap is recorded on `admin-action-log` |
| `admin-classes-course-truth.test.mjs` | `courseLabel` / picker helpers lifted from `admin-classes.js` and run with stubs, `loadCourses` filter, GĐ 1b `showTab` / lazy students panel | port (course truth) / retire (merged-page tabs) | same file: `CourseCell` order (unresolved id → "Không đọc được khoá" / "Khoá không còn trong danh mục" before "Chưa gán khoá"), code chip + archived mark, `courseOptionLabel`, unknown course kept as its own option, `cohortDraft` → `validateCohortDraft` keeps the course id on rename and sends null only when unassigned, `getAdminCourses()` without `is_active`, picker locked when the catalogue fails. The tab-sync and lazy-panel pins retired: Lớp and Học viên are separate routes with static `subsection` (pinned in `sprint-18-3-2-students-chrome`, `admin-students-next-behavior`) |
| `admin-question-picker.test.mjs` | `toggleQpick` / `renderQpick` from `admin-classes.js` run with a fake DOM, plus wiring, page ids and `speaking-assignment.css` rules for the legacy picker | port | same file: `validateHomeworkDraft` executed (question_ids keep click order, wrong count or unready question refused with "Chọn đúng N câu đã sẵn sàng.", random mode sends null) and `normalizeQuestions` (giveable=false stays listed with its voice/audio reason); the homework panel pinned for the visible order number with sr-only label, de-select reflow, radiogroup default "Web bốc ngẫu nhiên", mode change clears picks, stale-response guard, reload on topic/Part, preview button outside the label, one shared player, stop on second press, error releases it, no button without audio. **Gap:** over-picking is blocked (disabled) instead of replacing the first pick; no difficulty chip; no footer saying how many are still missing |
| `admin-classes-homework.test.mjs` | `dueLabel` … `renderHomework` helpers, give flow, mode picker, delete guard, load latch, paper picker and late-response guard from `admin-classes.js` run with stubs | port / retire (superseded) | same file on `admin-class-homework.tsx` + model: one warning style only for "chưa nộp, đã quá hạn", late shown neutral, null or partial progress → "Không đọc được", `no_account` line, `formatDue` (Không hạn / Hạn không đọc được / Vietnam time), unactivated banner after a give, `due_date` + `due_time` sent (no `due_at`), `defaultVietnamDueDate` executed at the 19:00 and midnight edges, no browser-local getters, Speaking modes only practice/test_part, Đóng bài instead of Xóa when submitted / timed start / unknown progress, Mở lại, error ≠ empty, `reconcile_failed` banner. Paper picker and late-library pins retired in favour of `admin-class-homework-next-behavior` ("keeps protected Cambridge papers assignable only through controlled practice", "does not turn a failed exam library into an empty catalog", "preview uses generated API types and drops stale bank responses"): leaving exam-only papers out was replaced on purpose by controlled practice |
| `admin-tally.test.mjs` | `renderTally` / `tallyRow` / `hhmm` from `admin-classes.js` run with stubs, workspace tabs, generation guard, retry wiring and `speaking-assignment.css` grid rules for the legacy tally | port / retire (deleted markup CSS) | same file on `admin-class-submissions.tsx` + `normalizeTally`: one text per status, missing status → "Chưa nộp", null score "—" vs real 0 → "0.0", course in %, Vietnam time with "Không rõ" for bad stamps, `sealed` only on `true`, "Đang nhận bài / Đã chốt / Đã đóng bài", submitted/total with flagged counted apart, stale and unknown-shape warnings, malformed payload → null, tablist, request-sequence guard, wired "Thử lại". Course pass/near-pass/retake, effort and per-student report stay in `admin-class-submissions-next-behavior`. The legacy CSS grid pins (`minmax(0, 1fr)` etc.) retired with the markup they styled. **Gap:** "Thử lại" shows for every error; the legacy screen offered it only for transient errors |
| `admin-lesson-homework.test.mjs` | kind switch, due-days preview, lesson-set list, question subtraction, give payload, event wiring, page markup, cue-card preview, tally flags and the Speaking performance board, all run from `admin-classes.js` with a fake DOM | port / retire (feature not migrated) | same file on `admin-class-homework.tsx` + model: kind radiogroup, lesson forces Speaking and hides Kỹ năng, lesson-set endpoint, kind change clears picks, day count (1–90) instead of a date, `normalizeCatalog` keeps given / missing-audio sets listed and disabled with separate reasons, malformed catalogue → error, payload `kind: lesson` + `due_days` and never `due_date`, full set → `question_ids: null`, subset keeps order, no cap for lessons, empty / given / out-of-range refused before the request, busy released on failure; on `admin-class-submissions.tsx` each flag shows label + why + "→ action", first flag under the name, flagged not subtracted from submitted, no raw HTML. **Gap:** no absolute due preview ("7 ngày" → weekday + date in Vietnam time); no Part 2 cue-card preview (prompt, hints, explanation) before giving; the Speaking performance board (per-learner warning level, grouped repeated flags, fixed 3–9 band line, unactivated footer) has no Next counterpart |
| `admin-daily-board.test.mjs` | `renderDailyBoard` / `boardDay` / `tallyRow` run from `admin-classes.js`, board wiring, stale-warning banner, writing reader, shared formatter, board CSS | port (open-work links, writing reader) / retire (feature not migrated) | same file: `openArtifact` in `admin-class-submissions.tsx` (Speaking `?session=` link, per-skill routes, no link without an artifact), "Nghe & xem", "Học viên này chưa nộp phần tự luận.", has_writing gate, prompt via `InlineMd` and learner answer as plain text, no raw HTML; `admin-speaking-sessions.js` deep-link and feedback-report pins unchanged. **Gap:** the per-assignment daily grid (done / late / missing / unactivated cells, break-streak alarm, legend, sticky name and total columns, its stale-data warning) has no Next counterpart; the Next progress tab shows four-skill rollups and on-time rate only. The formatter gap is recorded on `course-explanation-format` |
| `admin-classes-workspace-redesign.test.mjs` | `renderList` / roster harnesses lifted from `admin-classes.js`, students panel sources, merged page ids and `admin-classes-workspace.css` | port (behaviour) / retire (legacy layout) | same file on the native models + owners: `cohortSummary` (archived excluded, failed rollup → null), `foldVietnamese` / `selectCohorts`, load failure ≠ empty and "Chưa đọc được" counts, required class name, breadcrumb, `rosterSummary` / `selectRoster` with "x / y học viên" and separate empty / no-match states, `assignmentSummary` (expired never open), `studentSummary`, `cohortTruth` (failed lookup never unassigned), local-date targets, "Bỏ chọn". Page ids, sticky/header CSS, the four-step wizard and drawer layout retired; native layouts are pinned in `admin-classes-next-behavior`, `admin-class-detail-next-behavior`, `admin-class-homework-next-behavior`, `admin-students-next-behavior` |
| `admin-classes-progress.test.mjs` | `skillCell` / `punctualityCell` / `lastAcrossSkills` / `strip` from `admin-classes.js` run with stubs, plus the progress drawer, cache, banner, skill colour tokens, sticky name column and keyboard pins on the merged page and its CSS | port / retire (legacy drawer + layout) | same file on `admin-class-detail.tsx` + model: `normalizeProgressPayload` keeps failed or absent skills null, attempts 0 apart, `recent_bands` / `target_band` read as sent with missing bands dropped; `SkillCell` "Không đọc được" / "Chưa có lượt" / count + last band; `latestSkillActivity` executed; error ≠ empty with wired "Thử lại" and stale label; lazy first load; first-level tab; "Xem bài" button per row; `invalidateProgress` (sequence bump, rows cleared, open tab reloads) on add, remove and homework mutations; late-response guard; on-time % null vs "Chưa có bài nộp"; stale banner without flag or skill names; band strip last 8, own-target highlight, labelled `role="img"`, text count beside colour, token colours. The legacy drawer (list of work, per-learner cache with expiry, focus return, scroll-into-view) retired for the student-work dialog pinned in `admin-class-student-work-next-behavior`. **Gap:** failed skills are listed by raw key (`speaking`) without a "Tải lại" hint; skill columns have no per-skill colour token; the name column is not sticky |

## LEGACYJS-0075 W3a — 2026-11-23

Spec `specs/0075-legacy-public-js-retirement` T004 (G10-T07-W3a) deletes the 3
users/codes scripts in `frontend/public/js/`: `admin-users.js`,
`admin-access-codes.js` and `admin-codes-util.js`. `/admin/users` (both tabs)
is owned by the Next panels under `frontend/app/(authed-admin-users)/` with
`lib/admin-users-model.mjs`, and `/admin/access-codes` redirects to
`/admin/users?tab=codes`; no Next code, kept `public/js` file or browser flow
loads these scripts. Retired HTML fixtures stay (ADR-005); assertions on them
are kept. `tsconfig.legacy.json` now names only `api.js` as `// @ts-check`.
One row per test edited in the same PR (FR-002):

| Test file | Assertions removed (only those reading a deleted script) | Disposition | Replacement that holds the invariant now |
|---|---|---|---|
| `admin-access-codes.test.mjs` | the controller pins (cohort/list/generate endpoints, direct-needs-cohort guard, revoke/remove-user toasts, silent refetch, edit-perms PATCH shape, session-limit validation) and the retired page's markup pins | port, part retire | same file: the deletion, the edit PATCH (`permissions` + `session_limit` only, no redemption field), remove-user copy and DELETE, revoke toast + `loadCodes(true)`, no full reload, all on `admin-access-codes-panel.tsx`; page shape and endpoints are in `admin-users-next-behavior.test.mjs`; the direct/cohort guard is `validateCodeDraft` there. The Amendment 2 step-up block is unchanged |
| `admin-users-next-behavior.test.mjs` | "legacy controllers still exist" | flip | same assertion, now `existsSync(...) === false` for `admin-users.js` and `admin-access-codes.js` |
| `design-fix-1-admin-primitives.test.mjs` | access-code chip, status pills and row-action pins on `admin-access-codes.js` | port | same tests on `admin-access-codes-panel.tsx` (`adm-chip` + `is-direct`, the three `adm-status-pill` states, `adm-btn-secondary adm-btn-sm`); the row-action wrapper is `.au-row-actions` (was `.adm-action-group`) |
| `sprint-17-1-admin-codes.test.mjs` | `quotaLabel` / `codeMatchesSearch` / `compareCodesBy` / `statusRank` imported from `admin-codes-util.js`, controller wiring pins | port | same cases on `quotaLabel`, `selectCodes` (search, sort, null `expires_at` last) and `codeStatusRank` in `lib/admin-users-model.mjs`, and the panel wiring (model import, email + quota + lookup-failure + "Chưa gán", no injected HTML, no inline colour) |
| `sprint-17-2-usage.test.mjs` | codes UI drills into usage via `/pages/admin/usage/index.html?code_id=` | port | same test: the panel links `/admin/usage?code_id=<encoded id>` |
| `admin-confirm-danger.test.mjs` | `window.confirmDanger` pins on the two controllers; native `confirm()` kept for refill and role change; the retired access-codes and users pages loading `confirm-danger.js` | port | revoke and remove-user (codes tab) and remove-from-code (users tab) go through the shared React dialog with `danger: true` and the action only in `run`; refill is a non-danger confirm; a role change is danger only for self-demotion; no native `confirm()` in either panel. The classes assertions are unchanged (W3b) |
| `admin-progressive-loading-toggle.test.mjs` | `#codes-table-wrap` and `#usr-table-wrap` toggle-back rows | retire (Next owner) | the Next panels render their tables from React state with no hidden-toggle wrapper; empty and error states are pinned in `admin-users-next-behavior.test.mjs` |
| `admin-toast.test.mjs` | `showBanner → showToast` delegation for the two controllers, the 4 s access-codes timing, the retired access-codes page loading `toast.js` | retire (Next owner) | the Next panels show inline `role="status"` / `role="alert"` banners (`admin-users-next-behavior.test.mjs`); the 10 remaining legacy files keep their pins |
| `admin-students-redesign.test.mjs` | `admin-users.js` renders `cohort_name` with "—" | port | same test on `admin-users-panel.tsx` (`Lớp` sort header, `user.cohort_name \|\| '—'`) |
| `admin-system-extract.test.mjs` | `admin-users.js` wires GET `/admin/users` + PATCH role | port | same test: `getBrowserJson('/admin/users')` in `lib/admin-users-api.ts`, `getAdminUsers()` and the role PATCH on `/admin/users/${encodeURIComponent(user.id)}/role` in the panel |
| `admin-users-codes-reskin.test.mjs` | revoked-hidden filter, util exports, `reflectSort` aria-sort, keydown sort activation, generate/convert/remove delegation attributes, code-tab hazard pins on the controllers | port | same tests on the model (`!status && code.is_revoked`, `codeStatusRank`, `selectCodes`) and panels (`SortButton` with "Sắp xếp theo" label and ↑/↓/↕ state, native `<button>` for keyboard, generate/convert/remove handlers, lookup failure, `loadCodes(true)`, `user.removable`, "tất cả người dùng" scope warning). **Gap:** the Next sort header does not set `aria-sort` on the `<th>`; recorded here, not fixed in a retirement wave |
| `generate-and-assign-code.test.mjs` | button-visibility, delegation, POST body, direct/cohort guard, refetch and cohort-source pins on `admin-users.js` | port | same tests on the panel (`!summary.has_active_code` gate, `setGenerate`, `user_id: generate.user.id`, `validateCodeDraft`, `await loadUsers(true)`) and shell (`getAdminCohorts({ isActive: true })`) |
| `merge-codes-users-tabs.test.mjs` | user-tab code columns, no code-wide mutation, remove-from-code, two-criteria sort on `admin-users.js` | port | same tests on the panel (`code_summary`, "Không có mã active", no refill / code PATCH / code-wide DELETE, remove-from-code DELETE + `loadUsers(true)`) and `selectUsers` (`code_type`, `code_status`) |
| `sprint-17-5-reassignment.test.mjs` | reassign absent, refill wiring and no inline colour on `admin-access-codes.js` | port | same tests on the codes panel ("Cấp mã mới" → POST `/refill`, edit-perms opener, no `reassign`, no inline colour) |
| `sprint-18-1-ia.test.mjs` | convert button, POST `/admin/students` with `user_id`, 409 handling, no inline colour on `admin-users.js` | port | same tests on the users panel (`setConvert`, `submitConvert`, `user_id: convert.user.id`, "đã là học viên") |
| `sprint-18-3-components.test.mjs` | `admin-access-codes.js` in the no-inline-colour list | retire (covered) | the codes panel's no-inline-colour pin in `sprint-17-5-reassignment.test.mjs` |

## LEGACYJS-0075 W2 — 2026-11-23

Spec `specs/0075-legacy-public-js-retirement` T003 (G10-T07-W2) deletes the 7
mock-cockpit scripts in `frontend/public/js/`: `admin-exam-content.js`,
`admin-mock-exams.js`, `admin-mock-live.js`, `admin-mock-pacing.js`,
`admin-mock-report.js`, `admin-mock-reviews.js` and `admin-mock-tests.js`.
Every `/admin/mock-*` URL has been owned by a Next route under
`frontend/app/(authed-admin-mock-*)/` since the cutover; no Next code, kept
`public/js` file or browser flow loads these scripts. Retired HTML fixtures stay
(ADR-005). One row per test edited or retired in the same PR (FR-002):

| Test file | Assertions removed (only those reading a deleted script) | Disposition | Replacement that holds the invariant now |
|---|---|---|---|
| `admin-exam-content-ui.test.mjs` | **whole file retired** (read only `admin-exam-content.js` and the retired HTML fixture's script tag) | retire (Next owner) | `admin-mock-exams-next-model.test.mjs` content-library tokens (`failedKinds`, `cohort_ids: cohortDraft`, `is_public: true`) + `react/mock-content-mutation.test.tsx`; the Next library sets visibility through `/admin/mock-corrections/public-tests/…` and offers no Writing visibility toggle |
| `mock-admin-done-exam-toggle.test.mjs` | all three tests read the legacy live/list scripts | port | same file, now on `admin-mock-live.tsx` and `admin-mock-exams.tsx` (`done && !isOpen` guard, "Kỳ thi đã kết thúc", closing still offered) |
| `mock-window-vietnam-time.test.mjs` | "the compatibility script no longer uses the browser zone" | retire (covered) | same file: the Next dialog test (`vietnamLocalToIso`, `formatVietnamDateTime`) |
| `mock-reassign-warning.test.mjs` | all five tests read `admin-mock-exams.js` | port | same file, now on `retake-assignment-dialog.tsx` (persistent warning, `locked` / `refresh_failed` named from loaded candidates, cleared when empty) |
| `mock-retake-servable-skills.test.mjs` | all seven tests read `admin-mock-exams.js` | port | same file, now on `retakeServableSkills` / `mergeRetestCandidates` (model) and `retake-assignment-dialog.tsx` (disabled and unchecked, servable list shown, target exam, cohort name in the source picker) |
| `mock-pacing-unknown-order.test.mjs` | all six tests read `admin-mock-pacing.js` | port | same file, now on `normalizePacing` (null order stays null) and `admin-mock-pacing.tsx` ("—", Có/Không, cleared marker, tooltip, legend count) |
| `mock-live-console-boot.test.mjs` | all ten tests read `admin-mock-live.js` (boot wiring, pause clock, recollect, Advance gate run in a VM) | port | same file, now on `admin-mock-live.tsx` (bad-link notice + JSX picker, polling effect keyed on the exam and cleared per effect, paused clock, tick stops without time left, `from_section`, `readyToAdvance` / `collecting` gate) |
| `mock-exam-runner-resilience.test.mjs` | "a single mid-exam re-entry is shown" read `admin-mock-live.js` | port | same test, now on `studentIntegrity` in `admin-mock-live.tsx`; the runner assertions are untouched |
| `mock-cockpit-consolidation.test.mjs` | the `admin-mock-tests.js`, `admin-exam-content.js` and `admin-mock-live.js` assertions (tabs, context bar, tablist ARIA, arrow keys, needs-exam source, level tabs, visibility labels, embedded picker and error) | port | same file, now on `admin-mock-tests.tsx`, `lib/admin-mock-tests-model.mjs`, `exam-content-library.tsx` and `admin-mock-live.tsx`; the retired HTML fixture assertions are unchanged |
| `mock-tests-cockpit.test.mjs` | controller pins (frame map, stage, list GET, Supabase init), frame-location helpers, `.hidden` use, theme sync and storage adoption, and the HTML script-tag pin | port | same file, now on `mockTestsFrame` / `mockExamStage` (model) and `admin-mock-tests.tsx` (frame epoch remount, theme mirror, `av-theme` adoption); the Supabase init and the `frameAt` / `loadFrame` helpers have no Next counterpart (the runtime boundary owns auth; the iframe remounts by key) |
| `admin-writing-queue-next-behavior.test.mjs` | `admin-mock-tests.js` mocklane frame URL | port | same assertion on `lib/admin-mock-tests-model.mjs` |
| `admin-mock-report-retest.test.mjs` | `renderRetest` / `reportSkills` run from `admin-mock-report.js` and its no-block pins | port | same file, now on `reportSkills` (model) and `admin-mock-review-report.tsx` (banner only with flags, "vẫn là kết quả chính thức", no retest block); the HTML fixture pin stays |
| `back-nav-origin.test.mjs` | opener pins on `admin-mock-reviews.js`; `wireBack()` run from `admin-mock-report.js` | port | same file, now on the `admin-mock-reviews.tsx` opener (`target="_blank"`, `mock_exam_id`) and the report's `back` link (encoded id on a fixed path, no `history.back`) |
| `mock-review-band-prefill.test.mjs` | all sixteen tests read `admin-mock-reviews.js` (`draftBandOf` run in a VM, the value expression, `wCell`, the caption chain) | port | same file, now on `draftBandOf` / `initialBandDraft` (model, run) and the roster's `writingText` lifted from `admin-mock-reviews.tsx` and run (counts and band independent, `~` for a suggestion, "—" only when both are absent); the captions run `bandCaption()` / `BAND_SOURCE` from the model (provenance for a pre-filled band, none for a confirmed band, the Writing-specific and L/R blankable reasons with "(overall sẽ để trống theo)", "Chưa có band tự tính — cần bạn nhập" otherwise) and pin that the form renders `bandCaption(detail, skill)`. The legacy captions were restored on `staging` by 53bc1ccb, so the gap first recorded here is closed |
| `mock-review-blankable-bands.test.mjs` | `doSave` / `collectBands` run from `admin-mock-reviews.js`, and its caption pins | port | same file, now runs `buildFinalBandsPayload` (blank blankable skill omitted, forgotten Writing and convertible Listening refused by name, full set unchanged) and runs the L/R blankable caption from `bandCaption()`, pinning that the form renders it |
| `mock-review-roster-status.test.mjs` | `claimCell` and label pins on `admin-mock-reviews.js`; the `.mr-pill--done` rule on the retired HTML page | port | same file, now on the roster status cell and `STATUS` labels in `admin-mock-reviews.tsx`, `.mrr-status.is-released` in `admin-mock-reviews-next.css` (theme tokens, no hex). An unknown status is now refused by `normalizeReviewRoster` (counted as malformed) instead of falling back to the claim flag |
| `mock-roster-bulk-claim-bands.test.mjs` | `wireBulkBar` / `bulkClaim` / `bulkSaveBands` / `renderSkips` pins | port | same file, now on `reconcileBulk` and the bulk bar in `admin-mock-reviews.tsx` (queued-only claim, claimed/edited-only bands, `{ sitting_ids: ids }` only, `bulk-final-bands`, no confirm except release, refusals set after the awaited reload, refetch on failure) |
| `mock-roster-retest-picker.test.mjs` | `retestCell` run from `admin-mock-reviews.js`, `setRetestSkills`, `placeRetestMenu`, popover CSS on the retired HTML page, bulk release pins | port, part retire | same file, now on the inline per-skill checkboxes, `setRetestFlags` (`/retest-flags`, full picture, canonical readback via `retestFlagConfirmed`, refetch on failure), the release `Dialog` (count, "thu hồi") and the skip list. The popover (`<details>` menu, flip-up placement, its CSS) has no Next counterpart and is retired. The Next picker also offers Speaking |
| `mock-speaking-live-results.test.mjs` | the four console tests on `admin-mock-reviews.js` (`bandSkills`, live-Speaking trigger, `collectBands`, source label) | port | same file, now runs `reviewBandSkills` / `buildFinalBandsPayload` and pins `const bandSkills = reviewBandSkills(detail)`; the "Bài chấm trực tiếp" label is read from `BAND_SOURCE` and the form must render `bandCaption(detail, skill)`; the TRF tests are untouched |
| `backend/tests/test_exam_content_level_cohort.py` | `test_the_verb_used_by_the_page_is_in_the_cors_allowlist` read `admin-exam-content.js` | port | same test, now reads `exam-content-library.tsx`: every `window.api.<verb>` is in `_CORS_METHODS`, `patch` is used, `put` is not |


## LEGACYJS-0075 W1 — 2026-11-23

Spec `specs/0075-legacy-public-js-retirement` T002 (G10-T07-W1) deletes the 15
`frontend/public/js/admin-listening-*.js` scripts (attempts, audit, audit-detail,
content-detail, content-list, content-meta, dictation-reports, drills-import,
fulltest-import, gist, mcq, segments, tests-detail, tests-list, tf). Every
`/admin/listening/**` URL has been owned by a Next route under
`frontend/app/(authed-admin-listening)/` since the cutover; no Next code, kept
`public/js` file or browser flow loads these scripts. Retired HTML fixtures stay
(ADR-005). One row per test edited or retired in the same PR (FR-002):

| Test file | Assertions removed (only those reading a deleted script) | Disposition | Replacement that holds the invariant now |
|---|---|---|---|
| `admin-listening-attempts.test.mjs` | controller behaviour block + `TYPE_LABEL` source pin | retire (Next owner) | `admin-listening-attempts-next-behavior.test.mjs` + `verify-admin-listening-attempts-flow.mjs` |
| `admin-listening-audit.test.mjs` | 7 controller pins (fetch, filters, actions) | retire (Next owner) | `admin-listening-audit-next-behavior.test.mjs` + `verify-admin-listening-audit-flow.mjs` |
| `admin-listening-audit-paging.test.mjs` | **whole file retired** (read only `admin-listening-audit.js`) | replace | offset paging over 101 rows in `verify-admin-listening-audit-flow.mjs`; `AUDIT_BATCH` batching in `admin-listening-audit-next-behavior.test.mjs` |
| `admin-listening-content-management.test.mjs` | list/detail/meta controller pins (GETs, status re-fetch, meta and editor deep-links) | retire (Next owner) | `admin-listening-content-next-behavior.test.mjs` (editor links `segments/gist/tf/mcq?content_id=`), `admin-listening-content-detail-next-behavior.test.mjs`, `admin-listening-content-editor-next-behavior.test.mjs` |
| `admin-listening-drills-import.test.mjs` | controller pins (dry-run/commit endpoints, `audio_output/<TEST_ID>/full_test.mp3` matching) and the HTML script-tag pin | retire (Next owner) | `admin-listening-drill-import-next-behavior.test.mjs` + `verify-admin-listening-drill-import-flow.mjs` |
| `admin-listening-fulltest-import.test.mjs` | controller pins incl. archive-then-commit restore | retire (Next owner) | `admin-listening-fulltest-import-next-behavior.test.mjs` (asserts the native owner has no `_archiveThenCommit`) + `verify-admin-listening-fulltest-import-flow.mjs` |
| `admin-listening-reporting-wave2.test.mjs` | 6 `dictation-reports.js` pins (learner name/email fallback, `user_query`, detail URL, diff columns) | retire (Next owner) | `admin-listening-dictation-next-behavior.test.mjs` (model `display_name`/email) + `verify-admin-listening-dictation-flow.mjs` (`user_query` on list and aggregate) |
| `admin-listening-segments.test.mjs` | JS controller pins and the dynamic import of the legacy helpers | port | helper cases ported to `admin-listening-segments-next-behavior.test.mjs` ("ported legacy segment helper cases") against `lib/admin-listening-segments-model.mjs` |
| `admin-listening-segments-next-behavior.test.mjs` | none (gains the ported cases) | port target | itself |
| `admin-listening-tests.test.mjs` | tests-list controller pins (GET, status filter, debounce, row fields) | retire (Next owner) | `admin-listening-tests-next-behavior.test.mjs` + `verify-admin-listening-tests-flow.mjs` |
| `admin-listening-tests-next-behavior.test.mjs` | none (gains `Ẩn khỏi web`) | port target | itself (from `mock-cockpit-consolidation`) |
| `admin-listening-tests-detail.test.mjs` | detail controller pins | retire (Next owner) | `admin-listening-test-detail-next-behavior.test.mjs` + `verify-admin-listening-test-detail-flow.mjs` |
| `admin-listening-test-detail-next-behavior.test.mjs` | none (gains danger-zone gate) | port target | itself (from `admin-progressive-loading-toggle`) |
| `admin-listening-true-false-next-behavior.test.mjs` | one rollback pin on `admin-listening-tf.js` (`expected_updated_at`) | retire (covered) | same file: model asserts `expected_updated_at`; gains the Vietnamese T/F/NG label pin |
| `admin-progressive-loading-toggle.test.mjs` | "tests-detail destructive section gated on fetch" | port | `admin-listening-test-detail-next-behavior.test.mjs` (danger zone after loading/failed-read early returns) |
| `admin-student-listening.test.mjs` | dictation-reports `?user=` prefill | retire (Next owner) | `verify-admin-listening-dictation-flow.mjs` (opens `/admin/listening/dictation?user=…`) |
| `admin-toast.test.mjs` | 7 listening files from the showBanner→showToast list, segments `clearToasts` | retire | Next owners use inline banners; the list keeps the 12 surviving scripts |
| `aver-admin-chrome.test.mjs` | content-list editor deep-link loop | retire (covered) | `admin-listening-content-next-behavior.test.mjs` lines pinning the 4 editor links |
| `listening-gist-tf-pages.test.mjs` | admin Gist/TF JS consts; T/F/NG Vietnamese label test | port | `admin-listening-true-false-next-behavior.test.mjs` (`ANSWER_LABEL` Đúng / Sai / Không có thông tin); Gist owner in `admin-listening-gist-next-behavior.test.mjs` |
| `listening-mcq-sessions-pages.test.mjs` | admin MCQ JS pins (1–20 range, POST, draft/publish, A–D) | retire (Next owner) | `admin-listening-mcq-next-behavior.test.mjs` (`MAX_MCQ_QUESTIONS`, versioned POST) + `verify-admin-listening-mcq-flow.mjs` |
| `listening-mini-test.test.mjs` | fulltest-import preview pins (option letter+text, no /4 /40, `mdInline` emphasis, `mini=true`) | retire (Next owner) | `admin-listening-fulltest-import-next-behavior.test.mjs` (letter/text options, `mini` fingerprint and canonical type). The Next owner renders prompts as escaped plain text, so legacy `mdInline` emphasis has no current owner |
| `listening-test-dictation.test.mjs` | dictation-reports list + aggregate endpoint pins | retire (Next owner) | `verify-admin-listening-dictation-flow.mjs` (list and aggregate queries) |
| `mock-cockpit-consolidation.test.mjs` | tests-list `data-is-public` row | port | `admin-listening-tests-next-behavior.test.mjs` (`is_public`, `Ẩn khỏi web`) |
| `sentence-split-no-lookbehind.test.mjs` | `admin-listening-segments.js` splitter case | retire (covered) | `admin-listening-segments-next-behavior.test.mjs` ported split cases; the student `listening-test-player.js` case stays |
| `web-readiness-p1-warnings.test.mjs` | fulltest-import `p.warnings` banner pin | retire (Next owner) | `admin-listening-fulltest-import.tsx` findings block, exercised by `verify-admin-listening-fulltest-import-flow.mjs` (duplicate-ID warning) |

## Historical summary — 2026-07-13

| Metric | Count |
|--------|-------|
| **Total test files** | 225 (214 active + 4 e2e .spec + 7 other) |
| **In CI** | 131 (backend-tests.yml explicit list) |
| **Not in CI** | 94 (legacy, incomplete, or later-added) |
| **Fragility class: source-string-pin** | ~168 (readFileSync + regex match on HTML/JS/CSS) |
| **Fragility class: dom-behavior** | ~18 (DOM shim, JSDOM, minimal mocking) |
| **Fragility class: contract** | ~23 (API shape, payload structure, type hints) |
| **Fragility class: e2e** | 4 (Playwright; static fixture smoke, not full-stack) |
| **Fragility class: unclear** | 0 (all 33 resolved 2026-07-14 — see appendix) |
| **Disposition: port-to-component-test** | ~128 (source-pin → React test harness) |
| **Disposition: replace-by-types** | ~43 (schema/contract → TypeScript + OpenAPI blocking) |
| **Disposition: replace-by-e2e** | ~21 (integration → staging E2E) |
| **Disposition: keep-until-route-retired** | ~24 (legacy guard, retire after final cutover) |
| **Disposition: retire-immediately** | ~9 (obsolete, reason documented below) |
| **Disposition: unclear** | ~0 (all assigned; re-validation in PR) |

---

## By Domain

### Speaking (17 files, 6 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `practice-redesign.test.mjs` | ✓ | `frontend/pages/practice.html`, `frontend/js/practice.js` | State machine: loading → prep → recording → processing → feedback; session_id routing (never ?part=); form submission state on timeout | source-string-pin | port-to-component-test |
| `practice-persist-failure.test.mjs` | ✓ | `frontend/js/practice.js` | Grading failure UI shows error boundary, not silent loss; retry logic preserved | source-string-pin | port-to-component-test |
| `speaking-redesign.test.mjs` | ✓ | `frontend/pages/speaking.html` | Page embeds aver-chrome with speaking nav; audio recording button wired; session routing via POST /sessions | source-string-pin | port-to-component-test |
| `speaking-ia-cleanup.test.mjs` | ✗ | `frontend/pages/speaking.html`, `frontend/js/` | IA cleanup: menu items, nav hierarchy after Sprint 18.3 polish | source-string-pin | keep-until-route-retired |
| `speaking-length-gate.test.mjs` | ✗ | `frontend/js/practice.js` | Recording duration gate 300s (MAX_AUDIO_DURATION_SECONDS); UI shows warning at threshold | source-string-pin | keep-until-route-retired |
| `speaking-results-feedback-tokens.test.mjs` | ✗ | `frontend/pages/result.html`, `frontend/css/` | Feedback token styling (fluency, lexical, grammar bands); light-theme compat | source-string-pin | port-to-component-test |
| `speaking-results-light-theme.test.mjs` | ✗ | `frontend/pages/result.html`, `frontend/css/` | Result page light-theme rendering: contrast, readability, WCAG AA | source-string-pin | replace-by-e2e |
| `speaking-rubric-v2-compat.test.mjs` | ✗ | `frontend/js/practice.js`, `frontend/pages/result.html` | Rubric version compat: v1 has LRS, v2 has semantic tags; UI adaptation | source-string-pin | replace-by-types |
| `speaking-stub-contract.test.mjs` | ✗ | `frontend/js/api.js` | Stub API returns grading shape that matches production (response field names, band ranges) | contract | replace-by-types |
| `part-2-input-ux.test.mjs` | ✗ | `frontend/pages/practice.html`, `frontend/js/practice.js` | Part 2 cue card display, input field focus, warning on short prep time (1 min) | source-string-pin | keep-until-route-retired |
| `sample-answer-status.test.mjs` | ✗ | `frontend/js/practice.js` | Sample answer playback UI: shows audio embed, disables recording during playback | source-string-pin | keep-until-route-retired |
| `pronunciation-contract.test.mjs` | ✗ | `frontend/js/api.js` | Pronunciation band endpoint returns { band_score, ielts_level, phoneme_detail } shape | contract | replace-by-types |
| `result-redesign.test.mjs` | ✓ | `frontend/pages/result.html`, `frontend/js/practice.js` | Result page loads via session_id; band cards, pronunciation, grammar sections render; no "undefined" fallbacks | source-string-pin | port-to-component-test |
| `full-test-result-redesign.test.mjs` | ✓ | `frontend/pages/full-test-result.html`, `frontend/js/` | Full test chains via extra_session_ids; result page aggregates all parts; PDF export present | source-string-pin | port-to-component-test |
| `sprint-15-3-accordion-drilldown.test.mjs` | ✓ | `frontend/pages/result.html`, `frontend/js/` | Result accordion: expand/collapse; grammar deep-link to article; retention UI visible | source-string-pin | port-to-component-test |
| `sprint-15-3-1-result-extractor.test.mjs` | ✓ | `frontend/js/` | Result data extraction: parse band/phoneme/grammar from server shape; no NaN/undefined leaks | dom-behavior | replace-by-types |
| `sprint-16-3-retention-warning.test.mjs` | ✓ | `frontend/pages/result.html` | Retention warning banner: shows when engagement low; dismissable; animation smooth | source-string-pin | port-to-component-test |

### Writing (21 files, 10 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `writing-dashboard-redesign.test.mjs` | ✓ | `frontend/pages/writing-dashboard.html`, `frontend/js/writing-dashboard.js` | Page embedded chrome with writing nav; assignment list loads; cell edits POST /assignments/:id/edit | source-string-pin | port-to-component-test |
| `writing-result-redesign.test.mjs` | ✓ | `frontend/pages/writing-result.html`, `frontend/js/writing-result.js` | Result page shows essay, band, feedback, image snapshot (if Task 1); reload preserves state | source-string-pin | port-to-component-test |
| `writing-analytics-instrument.test.mjs` | ✓ | `frontend/js/writing-dashboard.js` | Telemetry: click = POST /api/telemetry with route, user, action; no token leak | source-string-pin | replace-by-types |
| `writing-tips-redesign.test.mjs` | ✓ | `frontend/pages/writing-tips.html` | Tips page shows examples, band ranges, common errors; text-only, no audio | source-string-pin | port-to-component-test |
| `writing-highlight.test.mjs` | ✓ | `frontend/js/writing-result.js` | Essay highlighting for grammar issues, lexical, spelling; user can toggle by issue type | source-string-pin | port-to-component-test |
| `writing-prompt-bank-ui.test.mjs` | ✓ | `frontend/pages/writing-new/`, `frontend/js/` | Prompt bank shows tasks (1/2), filters, pagination; selection POST /assignments | source-string-pin | port-to-component-test |
| `writing-cohorts-admin.test.mjs` | ✓ | `frontend/pages/admin/writing/`, `frontend/js/admin-writing-cohorts.js` | Admin cohort UI: create, edit, student list, reassign; permissions checked client-side | source-string-pin | port-to-component-test |
| `writing-independent-upload.test.mjs` | ✓ | `frontend/pages/writing-new/`, `frontend/js/` | Student self-service upload: drag-drop or paste, topic optional, POST to /sessions | source-string-pin | port-to-component-test |
| `writing-task1-image.test.mjs` | ✓ | `frontend/pages/writing-result.html`, `frontend/js/writing-result.js` | Task 1 essay image embed via Supabase bucket reference; fallback to placeholder if missing | source-string-pin | keep-until-route-retired |
| `writing-regrade-tips.test.mjs` | ✓ | `frontend/pages/admin/writing/regrade.html`, `frontend/js/` | Regrade UI: select reason, confirm, POST /grading/regrade; success redirects to result | source-string-pin | port-to-component-test |
| `admin-writing-grade-redesign.test.mjs` | ✓ | `frontend/pages/admin/writing/grade.html`, `frontend/js/admin-writing-grade.js` | Grade form: essay render, band selector (4.0–9.0), feedback text, submit guards duplicate | source-string-pin | port-to-component-test |
| `admin-writing-dashboard.test.mjs` | ✓ | `frontend/pages/admin/writing/dashboard.html`, `frontend/js/admin-writing-dashboard.js` | Admin dashboard: queue count, in-progress list, sort/filter, drill-down to grade form | source-string-pin | port-to-component-test |
| `writing-admin-escaper-recursion.test.mjs` | ✗ | `frontend/js/admin-writing-grade.js` | HTML escaper in essay display is idempotent (no double-escape) | dom-behavior | replace-by-types |
| `writing-prompt-answer-key.test.mjs` | ✗ | `frontend/pages/writing-result.html`, `frontend/js/` | Task 1 answer key (fact bank) loaded from prompt; used to grade charts; WRITING_TASK1_FACTS_ENABLED gate | contract | replace-by-types |
| `admin-writing-new-redesign.test.mjs` | ✗ | `frontend/pages/admin/writing/new.html` | New prompt form: topic, level, image upload, save POST /prompts; validation on title/level | source-string-pin | port-to-component-test |
| `admin-writing-assignments-redesign.test.mjs` | ✗ | `frontend/pages/admin/writing/assignments.html` | Assignment form: cohort, prompt, deadline, notification; POST /assignments with cohort_id | source-string-pin | port-to-component-test |
| `admin-writing-prompts-redesign.test.mjs` | ✗ | `frontend/pages/admin/writing/prompts.html` | Prompt list: paginated, filterable by level/topic, bulk actions (publish, archive) | source-string-pin | port-to-component-test |
| `admin-writing-status-redesign.test.mjs` | ✗ | `frontend/pages/admin/writing/status.html` | Status dashboard: grades per student, completion %, feedback rate | source-string-pin | keep-until-route-retired |
| `admin-writing-redesign.test.mjs` | ✗ | `frontend/pages/admin/writing/index.html` | Writing admin hub: navigation to sub-pages (dashboard, queue, prompts, cohorts) | source-string-pin | keep-until-route-retired |
| `pricing-redesign.test.mjs` | ✓ (current glob) | Hash-pinned `frontend/tests/fixtures/gate-f-pricing/` | Historical pre-launch sentinel and dormant pricing/FAQ design | archived characterization | All 119 cases preserved outside public; live guard is native redirect plus permanent HTML URL interception; physical retirement still HOLD |
| `gate-f-pricing-fixtures.test.mjs` (added 2026-09-10) | ✓ (current glob) | Three fixture files, manifest, loader and isolated checkout | Historical controls/link, corruption/path rejection, both dedicated suites independent of public files | integrity + isolated-checkout execution | Does not certify live CTA/UI; native coverage needs declared frontend TypeScript and Next dependencies; remaining consumers in wave 4 mapping |
| `onboarding-redesign.test.mjs` | ✗ | `frontend/pages/onboarding.html` | Onboarding flow: skill selection, cohort join, first session setup | source-string-pin | retire-immediately (deprecated in pivot; legacy flow) |

### Reading (15 files, 8 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `reading-content-rich-layout.test.mjs` | ✓ | `frontend/pages/reading-exam.html`, `frontend/js/reading-exam.js` | Reading content: passage + questions render; layout breaks on mobile handled by flexbox | source-string-pin | port-to-component-test |
| `reading-translation-vi.test.mjs` | ✓ | `frontend/pages/reading-exam.html` | Vietnamese translation toggle shows/hides translation panel; stored in session | source-string-pin | port-to-component-test |
| `admin-reading-l1-l2-actions.test.mjs` | ✓ | `frontend/pages/admin/reading/`, `frontend/js/admin-reading.js` | Reading admin: L1/L2 test management, edit passage/questions, delete guards confirm | source-string-pin | port-to-component-test |
| `reading-admin-preview-fix.test.mjs` | ✓ | `frontend/public/pages/admin/reading/preview.html` | Legacy rollback keeps answer-key QA and diagram image controls | source-string-pin | retained rollback invariant; native coverage below |
| `admin-reading-preview-next-behavior.test.mjs` + `verify-admin-reading-preview-flow.mjs` | ✓ | `/admin/reading/preview` | Admin gate; full canonical answer-key contract; sanitized passage Markdown; diagram block ownership; upload/delete ACK + canonical readback; responsive/dark/reduced-motion UI | model/source + fixture-backed browser | native owner |
| `reading-access-lock.test.mjs` | ✓ | `frontend/pages/reading-exam.html`, `frontend/js/reading-exam.js` | Access lock: code-gated content shows lock icon until code entered; POST /verify-code | source-string-pin | keep-until-route-retired |
| `reading-access-share.test.mjs` | ✓ | `frontend/pages/reading-exam.html` | Share link: students can use direct URL if cohort has permission; no code needed | source-string-pin | keep-until-route-retired |
| `reading-sharelink-url-fix.test.mjs` | ✓ | `frontend/js/` | Share URL pattern uses /reading/l?/share/:code not query param; deep-links preserved | source-string-pin | port-to-component-test |
| `reading-attempts-dashboard.test.mjs` | ✓ | `frontend/pages/reading-attempts.html`, `frontend/js/` | Attempts page: shows all prior attempts, scores, dates; reload via session_id | source-string-pin | port-to-component-test |
| `reading-l1l2-grammar-toggle.test.mjs` | ✓ | `frontend/pages/reading-exam.html` | Grammar toggle shows/hides difficulty metadata; state saved to session storage | source-string-pin | keep-until-route-retired |
| `reading-mini-test.test.mjs` | ✓ | `frontend/pages/reading-mini.html`, `frontend/js/` | Mini reading: 3–5 questions, no timing, instant score; used for diagnostic | source-string-pin | keep-until-route-retired |
| `reading-diagnostic.test.mjs` | ✗ | `frontend/pages/reading-diagnostic.html` | Diagnostic flow: self-assessed level → auto-pick L1/L2 content; initial screen shows disclaimer | source-string-pin | replace-by-e2e |
| `l3-edit-delete-block-images.test.mjs` | ✓ | `frontend/pages/admin/reading/l3-edit.html`, `frontend/js/` | L3 edit: block CRUD (paragraph, image, MCQ, matching), drag-reorder, image upload | source-string-pin | port-to-component-test |
| `l3-action-consistency.test.mjs` | ✓ | `frontend/pages/admin/reading/l3-edit.html` | L3 actions: save validates all blocks, error toast on fail, success redirects to detail | source-string-pin | port-to-component-test |
| `reading-rich-imgprompt.test.mjs` | ✓ | `frontend/pages/reading-exam.html`, `frontend/js/reading-exam.js` | Rich question: image + text prompt; user input collected (essay or gap-fill) | source-string-pin | port-to-component-test |
| `reading-rich-chuabai.test.mjs` | ✓ | `frontend/pages/reading-exam.html` | Chua bai (completion) questions: 4-option MCQ or gap-fill with word bank | source-string-pin | port-to-component-test |

### Listening (legacy registry plus native replacements)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `listening-test-player.test.mjs` | ✓ | `frontend/pages/listening-exam.html`, `frontend/js/listening-exam.js` | Test player: play/pause audio, scrub timeline, answer MCQ/gap-fill, section transitions | source-string-pin | port-to-component-test |
| `listening-mini-test.test.mjs` | ✓ | `frontend/pages/listening-mini.html`, `frontend/js/` | Mini listening: ~10 min, no timer, instant score | source-string-pin | port-to-component-test |
| `listening-review-ui.test.mjs` | ✓ | `frontend/pages/listening-result.html`, `frontend/js/listening-result.js` | Review UI: play audio clip per question, show answer/transcript, band breakdown | source-string-pin | port-to-component-test |
| `admin-listening-fulltest-import.test.mjs` + `admin-listening-fulltest-import-next-behavior.test.mjs` + `verify-admin-listening-fulltest-import-flow.mjs` | ✓ | native `/admin/listening/import-fulltest`; HTML/JS rollback; importer API | Four-file SHA-256 identity; dry-run evidence; duplicate fail-closed handoff; progress-aware Draft commit; durable account receipt; GET-only ambiguity reconciliation; exact status readback | model/source + fixture-browser | native owner; retain legacy rollback sentinels until HTML retirement |
| `listening-dictation.test.mjs` | ✗ | `frontend/pages/listening-dictation.html`, `frontend/js/` | Dictation: repeat-play audio, type response, check spelling; skills-practice mode | source-string-pin | keep-until-route-retired |
| `listening-gist-tf-pages.test.mjs` | ✗ | `frontend/pages/listening-gist.html`, `frontend/pages/listening-tf.html` | Gist & True/False pages: section-specific drill; no timing | source-string-pin | keep-until-route-retired |
| `listening-mcq-sessions-pages.test.mjs` | ✗ | `frontend/pages/listening-mcq-sessions.html` | MCQ sessions page: show all attempts, replay, scores | source-string-pin | port-to-component-test |
| `listening-test-dictation.test.mjs` | ✗ | `frontend/pages/listening-exam.html` | During-test dictation questions use transcript scrub (no per-sentence timing) | source-string-pin | keep-until-route-retired |
| `listening-page-shell.test.mjs` | ✗ | `frontend/pages/listening-*.html` | Listening page structure: chrome embed, audio player, question area; no inline player controls | source-string-pin | keep-until-route-retired |
| `listening-skills.test.mjs` | ✗ | `frontend/pages/listening-skills.html`, `frontend/js/` | Skills practice hub: drill by section type (dictation, gist, MCQ, matching) | source-string-pin | keep-until-route-retired |
| `listening-tests-list.test.mjs` | ✗ | `frontend/pages/listening-tests.html`, `frontend/js/` | Tests list: full tests, minis, level filters, start button → /sessions POST | source-string-pin | keep-until-route-retired |
| `admin-listening-audit.test.mjs` + native dashboard/detail model tests and browser verifiers | ✓ | native `/admin/listening/audit` + `/admin/listening/audit-detail`; HTML/JS rollback; audit API/engine | Complete inventory; live-vs-saved truth; source provenance; repairable malformed rows without implicit empty-array writes; read-only ambiguous q_num cards; explicit window clearing; version-pinned repair, section-tab draft retention and CAS triage with stale locks; absolute/full and verified-offset section audio; exact-request paid-run GET reconciliation plus confirmed discard; truthful status guards | model-contract + backend route + fixture-browser + rollback characterization | native dashboard and repair workspace invariants active; retain legacy tests only for rollback sentinels |
| `admin-listening-content-management.test.mjs` | ✗ | `frontend/pages/admin/listening/`, `frontend/js/` | Content mgmt: CRUD tests, clone test, publish/archive, move between levels | source-string-pin | port-to-component-test |
| `admin-listening-drills-import.test.mjs` | ✓ native replacement: `admin-listening-drill-import-next-behavior.test.mjs` + fixture browser verifier | `frontend/app/(authed-admin-listening)/admin/listening/import-drills/`, `frontend/lib/admin-listening-drill-import-model.mjs` | Drills import: deterministic bundle ownership, metadata-only/audio-ready truth, dry-run duplicate gate, sequential receipt-backed commit and canonical GET reconciliation | model-contract + fixture-browser | retain legacy characterization for rollback; native invariant active |
| `admin-listening-segments.test.mjs` | ✗ | `frontend/pages/admin/listening/`, `frontend/js/` | Segments editor: view audio waveform, mark play regions, set timing; POST to backend | source-string-pin | port-to-component-test |
| `admin-listening-tests-detail.test.mjs` | ✗ | `frontend/pages/admin/listening/detail.html`, `frontend/js/` | Detail page: show sections, questions per section, edit links, delete guards confirm | source-string-pin | port-to-component-test |
| `admin-listening-tests.test.mjs` | ✗ | `frontend/pages/admin/listening/`, `frontend/js/` | Test list: paginated, filterable by level/type, import/create buttons | source-string-pin | port-to-component-test |

### Vocabulary (21 files, 11 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `vocab-landing.test.js` | ✓ | `frontend/vocabulary.html`, `frontend/js/vocabulary-landing.js` | Landing page: topic list, stats, CTA buttons, theme toggle | dom-behavior | port-to-component-test |
| `vocabulary-redesign.test.mjs` | ✓ | `frontend/pages/vocabulary.html`, `frontend/js/vocabulary.js` | Vocab hub: topic card grid, study/quiz CTAs, progress rings per topic | source-string-pin | port-to-component-test |
| `vocab-card-flag.test.mjs` | ✓ | `frontend/js/vocab-card.js` | Vocab card: flag/star for later review, POST /api/vocabulary/flag | source-string-pin | port-to-component-test |
| `vocab-topic-study.test.mjs` | ✓ | `frontend/pages/vocab-study.html`, `frontend/js/vocab-study.js` | Study mode: flashcard flip, audio play, swipe through cards, progress counter | source-string-pin | port-to-component-test |
| `vocab-practice.test.mjs` | ✓ | `frontend/pages/vocab-practice.html`, `frontend/js/vocab-practice.js` | Practice mode: gap-fill MCQ, shuffle, hint system, POST progress | source-string-pin | port-to-component-test |
| `vocab-article-reskin.test.mjs` | ✓ | `frontend/pages/vocab-article.html`, `frontend/js/vocab-article.js` | Article page: word detail, definition, example sentences, related words | source-string-pin | port-to-component-test |
| `vocab-browse-master-detail.test.mjs` | ✓ | `frontend/pages/vocab-browse.html`, `frontend/js/vocab-browse.js` | Browse: topic list (master), click → word detail (detail pane) | source-string-pin | port-to-component-test |
| `vocab-admin-console.test.mjs` | ✓ | `frontend/pages/admin/vocab/`, `frontend/js/admin-vocab.js` | Admin console: topic CRUD, card list, bulk upload, content import | source-string-pin | port-to-component-test |
| `admin-vocab-topics-console.test.mjs` | ✓ | `frontend/pages/admin/vocab/topics.html`, `frontend/js/` | Topics: create, edit, list cards per topic, publish/archive, reorder | source-string-pin | port-to-component-test |
| `admin-vocab-quiz-analytics.test.mjs` | ✓ | `frontend/pages/admin/vocab/analytics.html`, `frontend/js/` | Analytics: quiz performance by question, student mastery, error heatmap | source-string-pin | replace-by-e2e |
| `vocab-css-integrity.test.mjs` | ✓ | `frontend/css/vocab.css`, `frontend/pages/vocab-*.html` | CSS: Tailwind token compliance, no hardcoded colors, dark-mode pair for every style | source-string-pin | replace-by-types |
| `quiz-engine.test.mjs` | ✓ | `frontend/js/quiz-engine.js` | Quiz logic: shuffle, shuffle, MCQ/gap-fill/boolean scoring, retry with penalty | dom-behavior | replace-by-types |
| `quiz-results-ui.test.mjs` | ✓ | `frontend/pages/quiz-result.html`, `frontend/js/` | Result page: score, feedback per question, retry button, time spent | source-string-pin | port-to-component-test |
| `vocab-exam-split.test.mjs` | ✗ | `frontend/js/vocabulary.js` | Exam filter: /api/vocabulary/exam returns curated + imported cards, split by 'lists' field | contract | replace-by-types |
| `vocab-module-loader.test.mjs` | ✗ | `frontend/js/` | Module loader: dynamically fetch vocab content from CDN/backend; no hardcoded URLs | contract | replace-by-types |
| `vocab-source-link.test.mjs` | ✗ | `frontend/pages/vocab-article.html`, `frontend/js/vocab-article.js` | Source link: word origin (AWL/TOEIC/THPT source), POSTed to /api/telemetry | source-string-pin | keep-until-route-retired |
| `pending-vocab.test.mjs` | ✗ | `frontend/js/`, `frontend/pages/` | Pending words: words added to "later" list, sync with backend on session close | source-string-pin | keep-until-route-retired |
| `kp-fe-widgets.test.mjs` | ✗ | `frontend/pages/`, `frontend/js/kp-*.js` | Knowledge Plus widgets: roadmap, progress, unlock badges | source-string-pin | replace-by-e2e |
| `kp-roadmap.test.mjs` | ✗ | `frontend/pages/kp-roadmap.html`, `frontend/js/kp-roadmap.js` | Roadmap visualization: skill tree, prerequisites, next articles; click → article | source-string-pin | replace-by-e2e |
| `admin-vocab-extract.test.mjs` | ✗ | `frontend/js/admin-vocab.js` | Extraction tests: vocabulary bulk operations don't cause silent data loss | dom-behavior | replace-by-e2e |
| `d1-srs-indicator.test.mjs` | ✗ | `frontend/js/`, `frontend/pages/vocab-*.html` | SRS indicator: shows confidence level (new/learning/mature) via badge color | source-string-pin | port-to-component-test |

### Grammar (8 files, 0 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `grammar-recommendation-reliability.test.mjs` | ✗ | `frontend/pages/result.html`, `frontend/js/practice.js`, `frontend/js/grammar.js` | Recommendation links use /grammar/:category/:slug routes, not query params; click telemetry POSTs to /api/grammar/recommendations/:id/clicked | source-string-pin | keep-until-route-retired |
| `grammar-check-ui.test.mjs` | ✗ | `frontend/pages/result.html`, `frontend/js/` | Grammar check UI: expandable issue list, anchor link to article, score breakdown | source-string-pin | keep-until-route-retired |
| `grammar-wiki-redesign.test.mjs` | ✗ | `frontend/pages/grammar-article.html`, `frontend/js/grammar.js` | Article page: category/slug routing, content render, related articles, light-theme compat | source-string-pin | port-to-component-test |
| `grammar-article-light-theme-rendering.test.mjs` | ✗ | `frontend/pages/grammar-article.html`, `frontend/css/` | Light-theme rendering: contrast WCAG AA, readability, code block styling | source-string-pin | replace-by-e2e |
| `grammar-wiki-light-theme-rendering.test.mjs` | ✗ | `frontend/pages/grammar.html`, `frontend/css/` | Grammar hub light-theme: article grid, category nav, search results | source-string-pin | replace-by-e2e |
| `grammar-wiki-comprehensive-theme-rendering.test.mjs` | ✗ | `frontend/pages/grammar-article.html`, `frontend/css/grammar-wiki.css` | Comprehensive rendering: dark + light theme, all article types, code/quote/list blocks | source-string-pin | replace-by-e2e |
| `admin-grammar-extract.test.mjs` | ✗ | `frontend/js/admin-grammar.js`, `frontend/pages/admin/grammar/` | Admin grammar: article CRUD, category tree, metadata edit (related, prereq, pathway) | dom-behavior | replace-by-e2e |
| `sprint-6-12c-audit-closure.test.mjs` | ✗ | `frontend/js/grammar.js`, `frontend/pages/grammar*.html` | Audit closure: grammar roadmap links are canonical (not broken), anchor handling smooth | source-string-pin | keep-until-route-retired |

### Admin (34 files, 19 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `admin-dashboard-redesign.test.mjs` | ✓ | `frontend/pages/admin/index.html`, `frontend/js/admin-dashboard.js` | Admin hub: chrome embed, nav to sub-pages, quick stats (users, sessions, errors) | source-string-pin | port-to-component-test |
| `admin-access-codes.test.mjs` | ✓ | `frontend/pages/admin/access-codes/index.html`, `frontend/js/admin-access-codes.js` | Access codes: list with cohort filter, create modal, edit/delete actions, bulk merge UI | source-string-pin | port-to-component-test |
| `admin-students-redesign.test.mjs` | ✓ | `frontend/pages/admin/students/index.html`, `frontend/js/admin-students.js` | Students: searchable list, drill-down to detail, cohort filter, email log | source-string-pin | port-to-component-test |
| `admin-users-codes-reskin.test.mjs` | ✓ | `frontend/pages/admin/users/index.html`, `frontend/js/admin-users.js` | Users: list, search, role toggle (student/instructor/admin), code assignments | source-string-pin | port-to-component-test |
| `sprint-17-1-admin-codes.test.mjs` | ✓ | `frontend/pages/admin/access-codes/`, `frontend/js/` | Code ownership: canonical via user_code_assignments (active) or access_codes.used_by (legacy fallback); no synthesis error | source-string-pin | keep-until-route-retired |
| `sprint-17-2-usage.test.mjs` | ✓ | legacy `public/pages/admin/usage/index.html` + controller/util | Rollback activity rollup: per-user/per-code session count, last activity and logged AI cost | source-string-pin | native contract now covered by `admin-usage-next-behavior.test.mjs` + browser verifier |
| `sprint-17-3-cohorts.test.mjs` | ✓ | `frontend/pages/admin/cohorts/`, `frontend/js/admin-cohorts.js` | Cohorts: CRUD, member list, access code assignment, seat limits | source-string-pin | port-to-component-test |
| `sprint-17-4-foot-traffic.test.mjs` | ✓ | `frontend/pages/admin/foot-traffic.html`, `frontend/js/` | Foot-traffic heatmap: session attempt timeline, peak hours, device breakdown | source-string-pin | port-to-component-test |
| `sprint-17-5-reassignment.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/js/` | Reassignment flow: move student between cohorts, existing assignments retained | source-string-pin | port-to-component-test |
| `admin-toast.test.mjs` | ✓ | `frontend/js/admin-toast.js` | Toast notification: auto-dismiss, stack multiple, close button, no animation flicker | dom-behavior | replace-by-types |
| `admin-confirm-danger.test.mjs` | ✓ | `frontend/js/admin-confirm-danger.js` | Confirm modal: block action until user types "CONFIRM", no accidental deletes | dom-behavior | replace-by-types |
| `admin-a11y-labels.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/js/` | a11y: all inputs have labels, buttons have aria-label, dialogs trap focus | source-string-pin | replace-by-e2e |
| `admin-polish.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/css/` | Polish: consistent spacing, button sizes, card styling, no visual regression | source-string-pin | replace-by-e2e |
| `admin-progressive-loading-toggle.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/js/` | Progressive loading: expand/collapse sections, lazy-load detailed data, no timeout | source-string-pin | port-to-component-test |
| `admin-overview.test.mjs` | ✗ | `frontend/pages/admin/overview.html`, `frontend/js/admin-overview.js` | Overview: system stats (total users, active sessions, KB, usage %, uptime) | source-string-pin | port-to-component-test |
| `admin-error-logs.test.mjs` | ✗ | `frontend/pages/admin/error-logs.html`, `frontend/js/admin-error-logs.js` | Error logs: table, filters (date, severity, route), export CSV, mark-as-read | source-string-pin | port-to-component-test |
| `admin-error-logs-humanize.test.mjs` | ✗ | `frontend/js/admin-error-logs.js` | Error humanization: convert stack traces to user-friendly messages, no token leak | dom-behavior | replace-by-types |
| `admin-monolith-redesign.test.mjs` | ✗ | `frontend/pages/admin/`, `frontend/js/` | Monolith refactor complete: all routes in new IA (not legacy admin.html) | source-string-pin | retire-immediately (legacy reference) |
| `admin-instructor-queue-redesign.test.mjs` | ✗ | `frontend/pages/admin/instructor-queue.html`, `frontend/js/` | Instructor queue: pending essays, re-grade requests, priority sort | source-string-pin | port-to-component-test |
| `admin-system-extract.test.mjs` | ✗ | `frontend/js/admin-system.js`, `frontend/pages/admin/system.html` | System config: feature flags display, deployment info, database status | dom-behavior | replace-by-e2e |
| `admin-speaking-extract.test.mjs` | ✗ | `frontend/js/admin-speaking.js`, `frontend/pages/admin/speaking.html` | Speaking admin: grading queue, retry, bulk operations | dom-behavior | replace-by-e2e |
| `merge-codes-users-tabs.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/js/` | Tab navigation: codes/users/cohorts stay synced, active tab highlighted | source-string-pin | port-to-component-test |
| `generate-and-assign-code.test.mjs` | ✓ | `frontend/pages/admin/access-codes/`, `frontend/js/` | Flow: generate → assign to cohort/user → confirm POST to backend | source-string-pin | port-to-component-test |
| `site-overview-coverage.test.mjs` | ✓ | `docs/SITE_OVERVIEW.md`, README, native App Router page inventory and legacy redirect identities | Documentation: no dead page references, ≥85% native coverage, six spine routes and README link (not admin metric/UI assertions) | source-string-pin | Nine obligations ported in wave 6; no physical HTML dependency; current route source remains required |
| `site-overview-native-inventory.test.mjs` (added 2026-09-10) | ✓ (current glob) | Overview collector/parser and isolated native/doc checkout | Empty/unsupported inventories fail closed; canonical page citations, coverage dilution, historical identity/owner checks, no-public execution and dead-route negative control | isolated-checkout + source/doc regression | Supports the nine-case sentinel; not a compiled-route, HTTP or rendered-UI certificate |
| `grade-queue.test.mjs` | ✓ | `frontend/pages/admin/grade-queue.html`, `frontend/js/admin-grade-queue.js` | Grade queue: pending essays list, sort by date/student, open form POSTs to grade endpoint | source-string-pin | port-to-component-test |
| `grade-submit-next.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/js/` | Grade workflow: submit → confirm → POST /grading → success toast → next item auto-loads | source-string-pin | port-to-component-test |
| `content-template-download.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/js/` | Download template: CSV/Excel export for import workflows; no silent data loss | source-string-pin | keep-until-route-retired |
| `assignment-analysis-level.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/js/` | Assignment level analysis: filter by cohort/skill, show completion % per level | source-string-pin | port-to-component-test |
| `regrade-level-picker.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/js/` | Regrade picker: select reason (prompt change, remark request), confirm action | source-string-pin | port-to-component-test |
| `hide-subbands-toggle.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/js/` | Toggle: hide/show fine-grained band subscores in result view | source-string-pin | keep-until-route-retired |

### Platform (13 files, 5 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `theme-toggle.test.mjs` | ✓ | `frontend/js/theme-toggle.js`, `frontend/css/tokens.css` | Theme toggle: exports 8 functions (initTheme, setTheme, etc), localStorage persists choice, matchMedia syncs with system | dom-behavior | replace-by-types |
| `theme-toggle-icon-canonical.test.mjs` | ✓ | Current landing, chrome JS and page CSS; hash-pinned Pricing fixture | Icon markup, BEM-drift rejection, shadow visibility CSS and no per-page duplication (not runtime click/ARIA coverage) | source-string-pin | Pricing decoupled in wave 5; other inputs remain current, no deletion approval |
| `b8-frontend-polish.test.mjs` | ✓ (current glob) | Current result HTML/practice JS; hash-pinned Pricing fixture | Non-blocking notices, root-relative retry routing, navigation guard, historical manual-payment copy | source-string-pin | Four cases preserved in wave 5; native Pricing launch gate covered separately |
| `gate-f-pricing-shared-sources.test.mjs` (added 2026-09-10) | ✓ (current glob) | Explicit temporary copies of three shared suites and inputs; no public Pricing | All 209 cases run without public Pricing; broken current Home/landing/result copies fail the corresponding suite | isolated-checkout + negative control | Supplements, does not replace, dedicated no-public Pricing isolation |
| `theme-toggle-layout-context.test.mjs` | ✓ (current glob) | Discovered frontend HTML, including compatibility aliases | Inline theme toggle has a flex-hinted immediate parent and nesting depth ≥2; not React provider/context behavior | source-string-pin | Keep current scanner; Pricing contributes four generated cases through two paths; disposition required before deletion |
| `typography-tier1.test.js` | ✓ | `frontend/css/tailwind.build.css`, `frontend/css/tokens.css` | Tailwind tokens: all semantic sizes (sm, md, lg, xl) present, scale proportional, no gap | source-string-pin | replace-by-types |
| `hex-budget.test.mjs` | ✓ | `frontend/css/`, `tests/fixtures/hex-budget.json` | Per-file raw hex literal cap; default zero; no stale budget headroom or missing-file entries; exact token/generated exemptions | source-string-pin | Keep ratchet; remove a retired CSS file's row only in the same approved deletion diff |
| `design-fix-1-admin-primitives.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/css/` | Admin primitives: button/input/modal/table styles consistent | source-string-pin | port-to-component-test |
| `design-fix-2-admin-buttons-hubs.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/css/` | Button variants: primary/secondary/danger, sizes match tokens | source-string-pin | port-to-component-test |
| `design-fix-3-user-tokens.test.mjs` | ✓ | `frontend/css/tokens.css`, `frontend/pages/` | User-facing tokens: spacing, shadows, border-radius, consistent everywhere | source-string-pin | port-to-component-test |
| `primitive-families.test.mjs` | ✓ | `frontend/css/`, `frontend/pages/` | Primitive families: button + input + card + dialog have cohesive variants | source-string-pin | port-to-component-test |
| `chrome-spacing-canonical.test.mjs` | ✓ | `frontend/js/components/aver-chrome.js`, `frontend/pages/` | Chrome spacing: margin/padding consistent with page grid | source-string-pin | port-to-component-test |
| `chrome-unification-canonical.test.mjs` | ✗ | `frontend/js/components/aver-chrome.js`, `frontend/js/components/aver-admin-chrome.js` | Unification: shared nav logic, no duplicate event handling, icon set consistent | source-string-pin | keep-until-route-retired |
| `subheading-pattern-canonical.test.mjs` | ✗ | `frontend/pages/`, `frontend/css/` | Subheading pattern: typography, spacing, color consistent across pages | source-string-pin | keep-until-route-retired |
| `warning-banner-tokens.test.mjs` | ✗ | `frontend/pages/`, `frontend/css/` | Banner tokens: background, text, icon colors follow token system | source-string-pin | keep-until-route-retired |

### Chrome (5 files, 1 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `aver-admin-chrome.test.mjs` | ✓ | `frontend/js/components/aver-admin-chrome.js`, `frontend/pages/admin/` | Web Component: `<aver-admin-chrome active="...">` renders nav with active tab highlighted; click navigates via window.location | source-string-pin | keep-until-route-retired |
| `audio-player.test.mjs` | ✗ | `frontend/js/components/audio-player.js`, `frontend/pages/listening*.html` | Audio player Web Component: play/pause/scrub, load audio via src attribute, events fire on play/end | dom-behavior | replace-by-types |
| `audio-cutter.test.mjs` | ✗ | `frontend/js/audio-cutter.js`, `frontend/pages/admin/listening/` | Audio cutter: select region via waveform, set start/end time, preview clip, POST to backend | dom-behavior | port-to-component-test |
| `cue-card-detector.test.mjs` | ✗ | `frontend/js/cue-card-detector.js`, `frontend/pages/practice.html` | Cue card detection: extracts text from Part 2 cue card image via OCR; fallback to user input | contract | replace-by-types |
| `cue-card-*` (4 files) | ✗ | `frontend/pages/practice.html`, `frontend/js/cue-card-*.js` | Cue card display, fetch URL, length warning, part router — see sub-entries below | source-string-pin | keep-until-route-retired |
| `cue-card-fetch-url.test.mjs` | ✗ | `frontend/js/cue-card-fetch-url.js` | Fetch: GET /api/cue-cards/:part → return { image_url, prompt, duration } | contract | replace-by-types |
| `cue-card-length-warning.test.mjs` | ✗ | `frontend/js/cue-card-length-warning.js` | Warning: shows if prep time <1 min; dismissable | source-string-pin | keep-until-route-retired |
| `cue-card-part-router.test.mjs` | ✗ | `frontend/js/cue-card-part-router.js` | Router: map session_id + part → cue card; no cross-part leakage | dom-behavior | replace-by-types |
| `cue-card-ui-wiring.test.mjs` | ✗ | `frontend/js/cue-card-ui-wiring.js` | Wiring: cue card loads on practice start, displays in sidebar, updates on part change | source-string-pin | keep-until-route-retired |
| `exam-player.test.mjs` + `exam-player-next-model.test.mjs` | ✓ | `/exam` retired in LEARNERNAV-0062 batch 7a (307 → `/tests`); `frontend/pages/exam.html` archived | Pure player model (`lib/exam-player-model.mjs`) and legacy source strings only; the native page, `exam-player-next-behavior.test.mjs` and `verify-exam-flow.mjs` left with the route | model/source | remove with the model and archive at G07-T24 |
| `mock-exam-next-{model,behavior}.test.mjs` + `verify-mock-exam-flow.mjs` + backend mock workflow/reconciliation tests | ✓ | `/mock-exam`; `frontend/pages/mock-exam.html` retained for parity/rollback | Native runner: exact sitting/owner state, server clock, admin collection pause, retake assignment, same-origin parent/iframe flush, sealed Reading/Listening lost-ACK receipts, local + server Writing autosave and immutable final payload reconciliation | backend + model/source + fixture-backed browser | native route owner; legacy runner remains rollback-only until Gate E/F |

### Miscellaneous (60 files, 25 in CI)

#### API & Contract Tests (12 files, 4 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `api-route.test.mjs` | ✗ | `frontend/js/api.js` | Route construction: session → /sessions/id, response → /sessions/id/responses | contract | replace-by-types |
| `no-raw-fetch-relative-path.test.mjs` | ✗ | `frontend/js/`, `frontend/pages/` | No raw fetch with relative path; use window.api.base + absolute URL | source-string-pin | replace-by-types |
| `css-paths-absolute.test.mjs` | ✓ (current glob) | Discovered frontend HTML carrying inline theme toggle or aver-chrome | Stylesheet link hrefs are nonempty and root-relative/external; roster floor and Grammar import pins remain; not a CSS @import/url or build guarantee | source-string-pin | Keep current scanner; Pricing contributes two generated cases through two paths; disposition required before deletion |
| `cross-page-navigation-canonical.test.mjs` | ✗ | `frontend/pages/`, `frontend/js/` | Navigation: all internal links use canonical routes (no double-redirects) | source-string-pin | keep-until-route-retired |
| `error-reporter.test.mjs` | ✗ | `frontend/js/error-reporter.js` | Reporter: captures console.error, window.onerror, unhandled promise rejection; POSTs to telemetry | dom-behavior | replace-by-types |
| `error-reporter-dispatch.test.mjs` | ✗ | `frontend/js/error-reporter.js` | Dispatch: batches errors, samples to avoid quota, scrubs tokens/URLs | dom-behavior | replace-by-types |
| `safe-error-detail.test.mjs` | ✓ | `frontend/js/`, `frontend/pages/error.html` | Safe error detail: 500 response has user-safe message, no stack/token in UI | source-string-pin | port-to-component-test |
| `perf-resource-hints.test.mjs` | ✓ | `frontend/pages/`, `frontend/html/` | Hints: preconnect, dns-prefetch, preload for critical paths (fonts, API, images) | source-string-pin | port-to-component-test |
| `anti-flash-iife-canonical.test.mjs` | ✓ | Current non-Pricing HTML and design-system doc; hash-pinned Pricing fixture | Theme bootstrap validation/fallback source patterns and documentation (not rendered flicker/lang coverage) | source-string-pin | Pricing decoupled in wave 5; all other page reads and assertions retained |
| `web-readiness-p1-warnings.test.mjs` | ✓ | `frontend/pages/`, `frontend/html/` | Web readiness P1: all meta tags, viewport, charset, no deprecated attributes | source-string-pin | port-to-component-test |
| `brief-contrast-guidance.test.mjs` | ✓ | `frontend/css/`, `frontend/pages/` | Contrast: WCAG AA everywhere, guidance text is readable | source-string-pin | replace-by-e2e |
| `brief-hardcoded-color-lesson.test.mjs` | ✓ | `frontend/pages/`, `frontend/css/` | Hardcoded: no hex/rgb in HTML/inline styles, Tailwind tokens only | source-string-pin | replace-by-types |
| `brief-lock-contract.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | Lock contract: access gates consistent, no plaintext secrets in HTML | source-string-pin | port-to-component-test |
| `bundle-import-ui.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | Bundle import: UI doesn't block on large JS, lazy-load admin/charts | source-string-pin | replace-by-types |

#### Audit & Formalization (7 files, 1 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `sprint-6-7-1-audit-closure.test.mjs` | ✓ | `frontend/js/`, `frontend/pages/` | Sprint 6.7.1 closure: listed checks all pass, no regressions | source-string-pin | retire-immediately (historical audit) |
| `sprint-6-9-1-audit-closure.test.mjs` | ✓ | `frontend/js/`, `frontend/pages/` | Sprint 6.9.1 closure: listed checks all pass | source-string-pin | retire-immediately (historical audit) |
| `sprint-6-12c-audit-closure.test.mjs` | ✗ | `frontend/js/`, `frontend/pages/` | Sprint 6.12c closure: grammar links canonical | source-string-pin | retire-immediately (historical audit) |
| `sprint-6-14c-hotfix-audit-closure.test.mjs` | ✗ | `frontend/js/`, `frontend/pages/` | Sprint 6.14c hotfix: listed checks pass | source-string-pin | retire-immediately (historical audit) |
| `sprint-6-15-2-narrative-correction.test.mjs` | ✗ | `frontend/js/`, `frontend/pages/` | Narrative correction: text changes validated | source-string-pin | retire-immediately (historical audit) |
| `phase-closure-ledger.test.mjs` | ✗ | `frontend/`, `backend/` | Phase closure: all listed invariants pass | source-string-pin | keep-until-route-retired |
| `gate-9-5-9-6-9-7-formalization.test.mjs` | ✗ | `frontend/js/`, `frontend/pages/` | Gate formalization: 9.5/9.6/9.7 checks pass | source-string-pin | keep-until-route-retired |
| `gate-10-formalization.test.mjs` | ✗ | `frontend/js/`, `frontend/pages/` | Gate 10: listed checks pass | source-string-pin | keep-until-route-retired |

#### Rendering & Visual Tests (12 files, 4 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `home-redesign.test.mjs` | ✓ | `frontend/pages/home.html`, `frontend/js/home.js` | Home page: skill cards, stats render, no error boundaries shown | source-string-pin | port-to-component-test |
| `home-stats-loading.test.mjs` | ✓ | `frontend/pages/home.html`, `frontend/js/` | Stats loading: skeletal UI shows while fetching, then replaced with values | source-string-pin | port-to-component-test |
| `index-redesign.test.mjs` | ✗ | `frontend/index.html` | Login page: Supabase auth form, link to dashboard, no hardcoded secrets | source-string-pin | port-to-component-test |
| `profile-redesign.test.mjs` | ✗ | `frontend/pages/profile.html`, `frontend/js/` | Profile page: user info, change password form, language preference | source-string-pin | port-to-component-test |
| `dashboard-tweaks.test.mjs` | ✓ | `frontend/pages/home.html`, `frontend/js/` | Dashboard tweaks: layout polish, consistent spacing, card interactions smooth | source-string-pin | port-to-component-test |
| `viewers-anonymous.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | Anonymous viewers: show CTA to sign up, don't expose internals | source-string-pin | keep-until-route-retired |
| `student-hub-drawer.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | Drawer UI: slide in/out, content lazy-load, no flicker on open | source-string-pin | port-to-component-test |
| `sprint-18-3-1-polish.test.mjs` | ✓ | `frontend/pages/`, `frontend/css/` | Polish: consistent spacing, shadows, border-radius | source-string-pin | retire-immediately (historical audit) |
| `sprint-18-3-1-1-overflow.test.mjs` | ✓ | `frontend/pages/`, `frontend/css/` | Overflow: no horizontal scroll, responsive breakpoints | source-string-pin | retire-immediately (historical audit) |
| `sprint-18-3-1-2-toolbar.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/components/` | Toolbar: sticky on scroll, action buttons responsive, no z-index collision | source-string-pin | retire-immediately (historical audit) |
| `sprint-18-3-1-3-toolbar-split.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | Toolbar split: content/meta sections don't overlap on mobile | source-string-pin | retire-immediately (historical audit) |
| `sprint-18-3-2-students-chrome.test.mjs` | ✓ | `frontend/js/components/aver-chrome.js`, `frontend/pages/` | Chrome on student pages: nav items, active tab, click handling | source-string-pin | keep-until-route-retired |

#### Playwright E2E (4 files, 0 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `accordion_interaction.spec.js` | ✗ | `frontend/pages/result.html`, `frontend/js/` | Accordion expand/collapse works in real browser; state reflected in DOM | e2e | keep-until-route-retired |
| `accordion_renders.spec.js` | ✗ | `frontend/pages/result.html` | Accordion renders (no JS errors, visible structure) | e2e | keep-until-route-retired |
| `result_accordion.spec.js` | ✗ | `frontend/pages/result.html`, `frontend/js/` | Result accordion: grammar section, detail links, printable | e2e | keep-until-route-retired |
| `retention_warning.spec.js` | ✗ | `frontend/pages/result.html` | Retention warning: animates in, dismiss button works, closed state persists | e2e | keep-until-route-retired |

#### Misc Infrastructure & Tokens (7 files, 0 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `undefined-token-sentinel.test.mjs` | ✓ | `frontend/css/`, `frontend/pages/`, `frontend/js/` | Sentinel: no undefined Tailwind token usage (catches typos like av-size-badname) | source-string-pin | replace-by-types |
| `d1-source-label.test.mjs` | ✗ | `frontend/pages/vocab-*.html`, `frontend/js/` | Source label: vocab card shows origin (AWL/TOEIC/common) when available | source-string-pin | keep-until-route-retired |
| `sprint-14-6-5-light-theme-panels.test.mjs` | ✓ | `frontend/css/`, `frontend/pages/` | Light-theme panels: shadow, background, border colors work together | source-string-pin | retire-immediately (historical audit) |
| `sprint-14-5-1-result-completeness.test.mjs` | ✓ | `frontend/pages/result.html`, `frontend/js/` | Result page: all sections present (band, phoneme, grammar, pronunciation) | source-string-pin | retire-immediately (historical audit) |
| `sprint-14-8-1-signal-persistence.test.mjs` | ✓ | `frontend/js/`, `frontend/pages/` | Session signal persists on reload (via URL session_id), no data loss | source-string-pin | retire-immediately (historical audit) |
| `sprint-18-3-components.test.mjs` | ✓ | `frontend/js/components/`, `frontend/pages/` | Components: common patterns (button, input, modal) present and wired | source-string-pin | retire-immediately (historical audit) |
| `sprint-18-2-dashboard.test.mjs` | ✓ | `frontend/pages/home.html`, `frontend/js/` | Dashboard: load stats, render cards, click CTA | source-string-pin | retire-immediately (historical audit) |
| `sprint-18-1-ia.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | IA: all nav links point to correct routes, no 404 | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-2-l1-reading.test.mjs` | ✓ | `frontend/pages/reading-exam.html`, `frontend/js/` | L1 reading: passage + 3 Q formats (MCQ, matching, gist) | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-3-l2-skill-and-admin.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/admin-reading.js` | L2 reading + admin: levels separate, permissions enforced | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-6-l3-exam-ui.test.mjs` | ✓ | `frontend/pages/reading-exam.html`, `frontend/js/` | L3 exam: takes, live timing, result PDF export | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-8-admin-polish-and-cleanup.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/css/` | Admin polish: consistent styling, no visual debt | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-10-prod-hotfix.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | Hotfix: specific bug fixed, no regression | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-11-exam-ux-v2.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | UX v2: reading/listening/speaking consistent interactions | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-13a-standards-fidelity.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | Standards fidelity: IELTS rubric alignment checked | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-13b-standards-a11y.test.mjs` | ✓ | `frontend/pages/`, `frontend/css/` | Standards a11y: WCAG 2.1 AA compliance | source-string-pin | replace-by-e2e |
| `sprint-20-13c-standards-behavior.test.mjs` | ✓ | `frontend/js/`, `frontend/pages/` | Standards behavior: session persistence, logout, role isolation | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-14-display-fidelity.test.mjs` | ✓ | `frontend/pages/`, `frontend/css/` | Display fidelity: typography, spacing, color match design | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-14b-phase-b-types.test.mjs` | ✓ | `frontend/js/`, `frontend/pages/` | Phase B types: API shapes verified | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-14e-summary-instruction.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | Summary instruction: visible, clear, no jargon | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-14f-alpha-diagram-image.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | Diagram images: load, render at correct size, alt-text present | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-15-admin-reading-mgmt.test.mjs` | ✓ | `frontend/pages/admin/reading/`, `frontend/js/` | Admin reading mgmt: CRUD, permissions, audit log | source-string-pin | retire-immediately (historical audit) |
| `f2-compare-mix.test.mjs` | ✓ | `frontend/pages/grammar-compare.html`, `frontend/js/` | Compare page: side-by-side rendering, example mix | source-string-pin | port-to-component-test |

---

## Tests Marked UNCLEAR — RESOLVED 2026-07-14

All formerly-UNCLEAR entries were re-read against their test file + target
source and finalized (durable invariant + ledger disposition). The per-test
result is the **"## UNCLEAR resolution" appendix** at the end of this doc; the
inline disposition column no longer contains any UNCLEAR marker. This queue is
closed — do not treat these as open.

## Historical retirement suggestions — not deletion approval

These July suggestions require current per-invariant revalidation under ADR-005.
The Pricing (item 2) and CSS-link scanner (item 32) deletion suggestions were
withdrawn after source inspection on 2026-09-10; those numbered entries remain
only to preserve the historical record. Other entries are not newly certified
by this checkpoint.

1. `admin-monolith-redesign.test.mjs` — Legacy reference to old admin.html
2. `pricing-redesign.test.mjs` — **Original deletion suggestion withdrawn.** Historical assertions now use hash-pinned fixtures; native coverage is independent of public HTML. Other consumers still block physical retirement (see current checkpoint).
3. `onboarding-redesign.test.mjs` — Deprecated onboarding flow
4. `sprint-6-7-1-audit-closure.test.mjs` — Historical audit
5. `sprint-6-9-1-audit-closure.test.mjs` — Historical audit
6. `sprint-6-12c-audit-closure.test.mjs` — Historical audit
7. `sprint-6-14c-hotfix-audit-closure.test.mjs` — Historical audit
8. `sprint-6-15-2-narrative-correction.test.mjs` — Historical audit
9. `sprint-14-6-5-light-theme-panels.test.mjs` — Historical audit
10. `sprint-14-5-1-result-completeness.test.mjs` — Historical audit
11. `sprint-14-8-1-signal-persistence.test.mjs` — Historical audit
12. `sprint-18-3-components.test.mjs` — Historical audit
13. `sprint-18-2-dashboard.test.mjs` — Historical audit
14. `sprint-18-1-ia.test.mjs` — Historical audit
15. `sprint-18-3-1-polish.test.mjs` — Historical audit
16. `sprint-18-3-1-1-overflow.test.mjs` — Historical audit
17. `sprint-18-3-1-2-toolbar.test.mjs` — Historical audit
18. `sprint-18-3-1-3-toolbar-split.test.mjs` — Historical audit
19. `sprint-20-2-l1-reading.test.mjs` — Historical audit
20. `sprint-20-3-l2-skill-and-admin.test.mjs` — Historical audit
21. `sprint-20-6-l3-exam-ui.test.mjs` — Historical audit
22. `sprint-20-8-admin-polish-and-cleanup.test.mjs` — Historical audit
23. `sprint-20-10-prod-hotfix.test.mjs` — Historical audit
24. `sprint-20-11-exam-ux-v2.test.mjs` — Historical audit
25. `sprint-20-13a-standards-fidelity.test.mjs` — Historical audit
26. `sprint-20-13c-standards-behavior.test.mjs` — Historical audit
27. `sprint-20-14-display-fidelity.test.mjs` — Historical audit
28. `sprint-20-14b-phase-b-types.test.mjs` — Historical audit
29. `sprint-20-14e-summary-instruction.test.mjs` — Historical audit
30. `sprint-20-14f-alpha-diagram-image.test.mjs` — Historical audit
31. `sprint-20-15-admin-reading-mgmt.test.mjs` — Historical audit
32. `css-paths-absolute.test.mjs` — Historical retirement suggestion withdrawn in wave 7: the build does not replace this stylesheet-link invariant; keep pending explicit per-page disposition.

---

## Disposition Summary by Count

| Disposition | Count | Rationale |
|---|---|---|
| **port-to-component-test** | 128 | Source-string-pin tests → characterization/snapshot tests in Next.js component test harness (e.g., Vitest + jsdom) |
| **replace-by-types** | 43 | Contract tests → TypeScript types + OpenAPI schema validation + typed tests (no re-pin HTML/JS strings) |
| **replace-by-e2e** | 21 | Visual/rendering/a11y tests → staging E2E (Playwright, real browser, real backend) |
| **keep-until-route-retired** | 24 | Domain-specific guard that stays on legacy route in fallback after cutover; retire only after canonical route cutover soak window closes |
| **retire-immediately** | 9 | Obsolete or enforced by build (no longer meaningful or no migration target exists) |

---

## Fragility Class Breakdown

| Class | Count | Characteristics | Migration strategy |
|---|---|---|---|
| **source-string-pin** | ~168 | readFileSync + regex match on HTML/JS/CSS source | Port to component test (Vitest snapshot or characterization test); may need source update post-migration |
| **dom-behavior** | ~18 | DOM shim, JSDOM, minimal mocking; tests JS function behavior | Replace with unit/integration test in Next.js harness; may add E2E for complex flows |
| **contract** | ~23 | API shape, payload structure, TypeScript types | Replace with OpenAPI blocking + typed test; no need to re-pin source strings |
| **e2e** | 4 | Playwright, real browser, fixture-based smoke | Keep as-is (migrate fixture source only); upgrade to full staging E2E in Phase 1 |
| **unclear** | 0 | Resolved 2026-07-14 (see appendix) | — |

---

## Next Steps (Before Gate A)

1. ~~Reconcile unclear entries (34 tests)~~ — **DONE 2026-07-14** (finalized in the UNCLEAR resolution appendix).
2. **Retire obsolete tests** (9 files) — remove immediately, no replacement needed.
3. **Validate Route Ledger alignment** — ensure test disposition matches planned route migration order (Phase 2–6).
4. **Create Test Replacement Backlog** — spike effort for porting top-priority tests (speaking, writing, reading, admin).
5. **Lock CI test list in code** — migrate backend-tests.yml to explicit (not glob) reference once cleanup is done; currently 131/225 in CI, gap of 94 files.

---

## References

- **Migration Plan:** `/docs/FE_NEXTJS_MIGRATION_MASTER_PLAN_2026-07-12.md` §7.4, §11.4, §B7
- **Baseline commit:** `9047e09f` (discovery baseline, July 12); validation refresh at `3f031d17` (July 13)
- **CI configuration:** `.github/workflows/backend-tests.yml` lines 124–254 (131 files, node --test)
- **Test method:** node:test (native Node.js; no external framework)


---

## UNCLEAR resolution (2026-07-14)

The 33 rows formerly marked **UNCLEAR** (disposition column) were re-read
(and, after review #758, the endpoint-bearing invariants re-verified against
each test's actual assertions — 6 were corrected)
against their test file + target source and finalized. The disposition column
now carries the ledger-taxonomy value; the **durable invariant** below is the
implementation-agnostic guarantee each test protects (what must stay true
after the page migrates to Next.js), replacing the fragile source-string it
currently matches.

| test | durable invariant (finalized) | disposition |
|---|---|---|
| speaking-rubric-v2-compat | Grading API response keeps legacy field names (band_fc/lr/gra/p, *_feedback, strengths, improvements) so the result renderer stays back-compatible | replace-by-types |
| reading-diagnostic | Result page fetches the diagnostic for the submitted attempt (`/api/reading/diagnostic?attempt_id=`) and links to L2 exercises | replace-by-e2e |
| admin-listening-drills-import | Native four-gate drills import: path-safe inventory → dry-run → sequential receipt-backed POST `/admin/listening/drills/import/commit` → exact canonical GET; HTML remains rollback | replaced-by-model-and-fixture-browser |
| admin-vocab-quiz-analytics | Vocab analytics hits `/admin/quiz/students?skill_area=vocab` (per-student) + `/admin/quiz/banks?skill_area=vocab` (hard-words) | replace-by-e2e |
| kp-fe-widgets | Weak-grammar widget fetches `/api/me/kp-mastery?status=weak&kp_type=grammar`; reading review renders a KP stepper with grammar deep-links | replace-by-e2e |
| kp-roadmap | Roadmap branches on slug: no-slug → `/api/me/roadmap`; has-slug → per-article; articles link `/grammar/{category}/{slug}` | replace-by-e2e |
| exam-player | Native `/exam` GETs list/detail, submits every canonical q_num once, retries only caller-owned review reads, and renders KP review/micro-check without exposing keys pre-submit | replaced-by-model-source-and-fixture-browser |
| d1-srs-indicator | SRS indicator renders on `srs_updated=true`, branches on `srs_rating`, clears prior indicator before appending (response-schema-driven) | port-to-component-test |
| admin-writing-new-redesign | New-essay form POSTs the 8-key payload (student_id, task_type, analysis_level, selected_model, form_of_address, grading_tier, prompt_text, essay_text) to the essays endpoint | port-to-component-test |
| admin-writing-assignments-redesign | Assignment form creates via `/admin/writing/assignments` (cohort_id, prompt_id, deadline, instructions); status taxonomy pending/in_progress/submitted/graded/delivered | port-to-component-test |
| admin-writing-prompts-redesign | Prompt list paginated + filterable by level/topic with bulk publish/archive; create/edit via `POST /admin/writing/prompts` | port-to-component-test |
| listening-mcq-sessions-pages | MCQ user page POSTs `/api/listening/attempts` (mode=mcq); admin editor POSTs `/admin/listening/exercises` (exercise_type=mcq, 1–20 Q); browse filters accent/cefr/section; analytics day-chart | port-to-component-test |
| admin-listening-content-management | Content list GETs `/admin/listening/content` (status filter); detail GETs content/{id} + exercises?content_id= | port-to-component-test |
| `admin-listening-content-next-behavior.test.mjs` + `verify-admin-listening-content-flow.mjs` | ✓ | `/admin/listening` | Admin gate; canonical pagination/filter URL; malformed-row truth; per-row exercise complete/error states; responsive/dark/reduced-motion inventory | model/source + fixture-backed browser | native inventory owner and native detail identity links |
| `admin-listening-content-detail-next-behavior.test.mjs` + `verify-admin-listening-content-detail-flow.mjs` | ✓ | `/admin/listening/content/[contentId]` | Independent content/exercise reads; identity validation; parent-test audio truth; bounded render polling; confirm + status PATCH + canonical GET readback; responsive dialog/detail | model/source + fixture-backed browser | native detail/status owner; Metadata, Dictation, Gist and T/F are native; MCQ remains a rollback workspace |
| `admin-listening-content-editor-next-behavior.test.mjs` + `verify-admin-listening-content-editor-flow.mjs` + `test_admin_listening_content_patch.py` | ✓ | `/admin/listening/content/[contentId]/edit` | Exact identity; nullable classification; delta-only PATCH; explicit nullable license/source clearing; case-insensitive NC and HTTP(S) attribution validation; atomic `expected_updated_at`; account/content pending receipt; ambiguous-write GET-only reconciliation; conflict lock; responsive/focus/unsaved-change boundaries | backend + model/source + fixture-backed browser | native metadata editor owner; direct HTML remains explicit rollback |
| `admin-listening-tests-next-behavior.test.mjs` + `verify-admin-listening-tests-flow.mjs` | ✓ | `/admin/listening/tests` | URL status/type/search/page; malformed/total truth; exam-only boundary; focused confirm; status/exam PATCH + exact detail GET + list readback; stale ACK rejection; responsive inventory | model/source + fixture-backed browser | native tests inventory/status owner; test detail/import remain rollback workspaces |
| `admin-listening-test-detail-next-behavior.test.mjs` + `verify-admin-listening-test-detail-flow.mjs` | ✓ | `/admin/listening/tests/[testId]` | Identity/child-contract validation; independent test/audio/map reads; signed-preview failure truth; busy-guarded mode/audio/assemble/map/status/archive writes + exact GET readback; typed hard-delete + exact cascade ACK; responsive/focus/rollback identity | model/source + fixture-backed browser | native test detail owner; import, metadata and exercise editors remain explicit legacy workspaces |
| `admin-listening-attempts-next-behavior.test.mjs` + `verify-admin-listening-attempts-flow.mjs` | ✓ | `/admin/listening/attempts` | URL filter/detail identity; strict score/accuracy/list/detail envelopes; backend total preservation; explicit user/test association lookup failure; hostile text escaping; per-question trap truth; pagination and responsive containment | backend + model/source + fixture-backed browser | native attempt inventory/detail owner; direct HTML remains explicit rollback |
| `admin-listening-dictation-next-behavior.test.mjs` + `verify-admin-listening-dictation-flow.mjs` | ✓ | `/admin/listening/dictation` | URL filter/session identity; independent stale-guarded list and full-scope aggregate reads; backend total preservation; explicit user lookup failure; strict summary/trend/sentence envelopes; reference-versus-learner evidence; pagination and responsive containment | backend + model/source + fixture-backed browser | native dictation report owner; direct HTML remains explicit rollback |
| `listening-dictation-next-behavior.test.mjs` + `verify-listening-dictation-session-flow.mjs` + `test_listening_test_dictation.py` + migrations 210/220/224 | ✓ | `/listening/dictation/session` | Exact test/section identity; safe audio URL; multi-section picker; timed/free-scrub audio; server-canonical per-sentence grade; hostile text escaping; account/test/section durable receipt; payload fingerprint; commit-with-lost-ACK read-back; exact full-section coverage; canonical summary; per-sentence flags; 24-hour answer/claim/completion guard before the DB finalizer; responsive containment | backend + migration + model/source + fixture-backed browser + real PostgreSQL proof | native stable owner for fresh admission; Legacy remains the affinity rollback target until Gate F retirement |
| `test_migration_224_active_player_resume_ttl.py` + `test_full_test_finalize.py` + `verify_active_player_ttl_224.sql` | ✓ | Core Speaking/Reading/Listening/Writing players | Fixed 24-hour resume/renderer boundary; router deadline checks; DB child/RPC guards; DB parent guards for N−1 finalizers (Writing keys on the learner essay link and preserves admin status override); Full Test persists all three submitted rows before background finalization and maps a deadline race to 410; terminal admin regrade remains legal | backend + migration + read-only verifier + real PostgreSQL proof | required before All-Next deploy and legacy retirement |
| `listening-practice-run-next-model.test.mjs` + `listening-practice-run-next-behavior.test.mjs` + `verify-listening-practice-run-flow.mjs` + Listening attempt/resume/router pytest | ✓ | `/listening/practice-run` | Exact practice identity; recursive grading-leak guard; optional bounded audio windows; resume-before-destructive-start; lost-start ACK GET reconciliation; insert-once first-answer scoring; exact check retry; two-confirmed-miss reveal; lost-submit ACK owner GET reconciliation; hostile-text escaping; responsive containment | backend + model/source + fixture-backed browser | native Luyện nhanh runner owner; direct HTML remains parity/rollback until Gate F |
| `admin-listening-segments-next-behavior.test.mjs` + `verify-admin-listening-segments-flow.mjs` + `test_listening_segments.py` | ✓ | `/admin/listening/segments` | Required content and optional exact exercise identity; multiple ordered Dictation blocks; alignment/proportional timestamp generation; backend-equivalent row validation; exact versioned POST; expected-absent create; durable account/content receipt; ambiguous-write GET-only reconciliation; conflict lock; public audio-time API; responsive/focus/unsaved boundaries | backend + model/source + fixture-backed browser | native Dictation segment editor owner; direct HTML remains explicit rollback |
| `admin-listening-gist-next-behavior.test.mjs` + `verify-admin-listening-gist-flow.mjs` + `test_listening_gist_tf.py` + `test_listening_segments.py` | ✓ | `/admin/listening/gist` | Required content and optional exact exercise identity; multiple ordered Gist blocks with one learner-reachable published block; strict prompt/model/keyword contract; exact versioned POST; expected-absent create; 401-before-ACK truth; durable account/content receipt; ambiguous-write GET-only reconciliation; exact-block conflict reload; scoring truth; responsive/focus/unsaved boundaries | backend + model/source + fixture-backed browser | native Gist rubric editor owner; direct HTML remains explicit rollback |
| `admin-listening-true-false-next-behavior.test.mjs` + `verify-admin-listening-true-false-flow.mjs` + `test_listening_gist_tf.py` + `test_listening_segments.py` + migration 209 | ✓ | `/admin/listening/tf` | Required content and optional exact exercise identity; multiple ordered true_false blocks with one atomically enforced learner-reachable published block; strict 3–12 statement/text/answer contract; repairable oversized legacy text; exact versioned POST; expected-absent create; 401-before-ACK truth; durable account/content receipt; ambiguous-write GET-only reconciliation; exact-block conflict reload; keyboard-focus-stable reorder plus add/remove/minimum interactions; deterministic lowest-order fallback; exact all-correct scoring truth; responsive/focus/unsaved boundaries | backend + migration + model/source + fixture-backed browser | native T/F/NG answer-key editor owner; direct HTML remains explicit rollback |
| `admin-listening-mcq-next-behavior.test.mjs` + `verify-admin-listening-mcq-flow.mjs` + `test_listening_gist_tf.py` + `test_listening_segments.py` + migration 209 | ✓ | `/admin/listening/mcq` | Required content and optional exact exercise identity; multiple ordered MCQ blocks with one atomically enforced learner-reachable published block; strict 1–20 question/four-option/answer-index contract; repairable oversized legacy text; exact versioned POST; expected-absent create; 401-before-ACK truth; durable account/content receipt; ambiguous-write GET-only reconciliation; exact-block conflict reload; keyboard-focus-stable reorder plus add/remove/minimum interactions; deterministic lowest-order fallback; exact all-correct scoring truth; responsive/focus/unsaved boundaries | backend + migration + model/source + fixture-backed browser | native MCQ answer-key editor owner; direct HTML remains explicit rollback |
| admin-listening-tests-detail | Test detail shows sections + questions-per-section with edit/delete-confirm; GETs `/admin/listening/tests/{id}` | port-to-component-test |
| admin-listening-tests | Tests list paginated + filterable by level/type with import/create | port-to-component-test |
| audio-cutter | Region selection + `/detect-silence` (auto-detect) + `/cut-audio` (export) endpoints | port-to-component-test |
| admin-overview | Overview shows 4 stat tiles (students-total, students-active-7d, errors-undismissed, access-codes-active) + skill cards | port-to-component-test |
| admin-error-logs | Error dashboard shows total/undismissed/24h/7d cards + 3-filter bar + dismiss/undismiss/refresh | port-to-component-test |
| admin-instructor-queue-redesign | Instructor review queue: GET `/admin/instructor/queue` + claim/release lifecycle (`/admin/instructor/reviews/{id}/claim` + `/release`) | port-to-component-test |
| assignment-analysis-level | Assignment analysis-LEVEL picker (L1–L5, default L3): assignment payloads carry `analysis_level`; queue/grade show read-only level badges | port-to-component-test |
| regrade-level-picker | Regrade modal (L1–L5): the regrade POST body carries `analysis_level` (not empty `{}`), seeded from the current essay level; cancel is a hard no-op (confirmDanger a11y pattern) | port-to-component-test |
| home-stats-loading | Home stats show a loading placeholder during fetch, real value on success, "—" on error (never literal 0) | port-to-component-test |
| student-hub-drawer | Student drawer shows profile/cohort/target-vs-current/essay-history from `/admin/students/{id}` + writing summary; deep-links to assignment form | port-to-component-test |
| admin-writing-status-redesign | Writing status dashboard: per-student grade counts, completion %, feedback rate | keep-until-route-retired |
| admin-writing-redesign | Writing admin hub navigates to dashboard/queue/prompts/cohorts/assignments | keep-until-route-retired |
| chrome-unification-canonical | `<aver-chrome>` renders unified nav (6 skill links + theme toggle + user pill) and logs out via getSupabase().auth.signOut() | keep-until-route-retired |
| theme-toggle-layout-context | Theme toggle sits inside a flex container (legacy DOM-position guarantee — re-verify in Next layout, not pin legacy HTML) | keep-until-route-retired |
| phase-closure-ledger | Doc-consistency audit (DESIGN_SYSTEM/UNIFIED_DESIGN_BRIEF vs filesystem) — legacy design-system artifact | keep-until-route-retired |
| gate-9-5-9-6-9-7-formalization | DESIGN_SYSTEM § 17.9/17.10/17.11 doc audit (Gate 9.5/9.6/9.7) — legacy design-system artifact | keep-until-route-retired |
| gate-10-formalization | DESIGN_SYSTEM § 17.14 doc audit (Gate 10 topnav-wrap position) — legacy design-system artifact | keep-until-route-retired |

**Mapping note:** agent-level dispositions collapsed to the ledger taxonomy —
API/endpoint-integration → `replace-by-e2e`, pure response-schema →
`replace-by-types`, DOM/page rendering (fragile source-pin) →
`port-to-component-test`, legacy-structure / doc-audit → `keep-until-route-retired`
(retire after the owning route cuts over, not before).

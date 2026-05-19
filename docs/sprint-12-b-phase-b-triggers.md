# DEBT-ADMIN-IA-REFACTOR — Phase B Trigger Criteria

Companion to `sprint-12-8-cluster-closure-retrospective.md`. After
cluster closure (PR #227 merge), 2 sidebar items remain placeholders
and 3 cross-cutting concerns are explicitly deferred. **Do not ship
any of these without a trigger.**

---

## Placeholder sidebar items (PHASE_B_SECTIONS = {cohorts, usage})

### 1. Cohort management UI

**Current state:** placeholder at `/pages/admin/cohorts/index.html`,
backed by Migration 060 (`cohorts` table). Sprint 12.2 shipped the
schema + `POST/GET/PATCH /admin/cohorts` endpoints, but no UI surface.
Andy manages cohorts via SQL.

**Trigger:** Andy reports needing to manage ≥5 active cohorts AND ≥1
of: bulk reassign users across cohorts, freeze a cohort, generate
codes per cohort. Until the manual SQL workflow visibly hurts, the
surface is premature.

**Scope when triggered:** list + filter + add cohort + assign members
+ freeze toggle + per-cohort code prefix mgmt. Backend endpoints
already exist; this is pure frontend + sentinel tests. Estimate: 0.5
session.

### 2. Usage logs

**Current state:** placeholder at `/pages/admin/usage/index.html`. The
sidebar item exists for symmetry with access-codes; no DB-backed
"usage events" feed exists today.

**Trigger:** ≥1 access-code abuse incident per month requires a
queryable usage log. Until incidents surface, build nothing. If a
single incident requires forensics, log spelunking via Railway logs
is enough.

**Alternative resolution:** drop the placeholder entirely if no usage
events get instrumented within 6 months of cluster closure. Don't
keep dead nav.

---

## Cross-cutting Phase B candidates

### 3. Instructor role split (`require_instructor` guard)

**Current state:** Sprint 12.8 added `PATCH /admin/users/{id}/role`
that writes `admin | instructor | student`. No router code currently
distinguishes `instructor` from `admin` — `require_admin()` is still
the only gate.

**Trigger:** first non-Andy instructor onboards AND ≥1 endpoint needs
"instructor can do X but cannot do Y" (canonical example: grade
writing but cannot generate access codes).

**Scope when triggered:** add `require_instructor()` helper, audit the
existing ~60 `/admin/*` endpoints, split the ~15 that should be
admin-only from the rest, ship sentinel tests for each split. Estimate:
1 session.

### 4. Mobile responsive polish (admin surface)

**Current state:** `<aver-admin-chrome>` ships a hamburger menu and a
`<768px` mobile breakpoint, but per-page content (tables, modals,
filter bars) is desktop-first. Tables overflow horizontally on phones;
modals don't constrain to viewport on small screens.

**Trigger:** admin-on-phone usage > 20% of admin sessions in a 30d
window. Track via the `viewport_width` field that error-reporter.js
already captures (Sprint 12.3) — when ≥20% of admin error reports
come from < 768px viewports, the trigger fires.

**Scope when triggered:** card-collapse pattern for tables on mobile,
modal viewport constraint, hamburger interaction polish. Estimate:
0.7 session.

### 5. Admin-side content analytics tuning

**Current state:** Sprint 12.7 ships Grammar analytics (top viewed,
top saved, zero-view list). No equivalent for Speaking topics,
Listening exercises, Vocab D1.

**Trigger:** content library exceeds 50 items in any single category
(currently: Grammar = 132 articles, Speaking topics ≈ 30, Listening
exercises ≈ 20, D1 pool ≈ 100). Speaking topics is closest to the
trigger.

**Scope when triggered:** per-skill analytics dashboard mirroring the
Grammar analytics pattern. Estimate: 0.5 session per skill.

### 6. PDF export for sessions (regression)

**Current state:** `GET /sessions/{id}/export/pdf` exists but
WeasyPrint system deps (cairocffi, pango) aren't installed on Railway.
Endpoint fails in prod. Pre-cluster known issue.

**Trigger:** ≥3 user requests for "save my session as PDF" within 30
days OR Andy decides PDF export is a commercial-launch must.

**Scope when triggered:** either fix the Railway image to ship
WeasyPrint deps OR swap to a pure-Python PDF generator (ReportLab is
~200 KB and dep-free). Estimate: 0.3 session.

---

## Anti-triggers (do NOT ship)

These were considered and explicitly rejected:

- **Audit log for admin actions.** Considered for Sprint 12.8.
  Rejected: every admin endpoint already logs via `logger.info` with
  structured `extra` dicts; Railway logs are sufficient for audit.
  Adding an `audit_log` DB table is premature without a compliance
  requirement.

- **Two-factor auth for admin role.** Considered for Sprint 12.8.
  Rejected: Andy is the only admin until trigger #3 fires.
  Single-account 2FA is friction without security benefit.

- **Admin activity dashboard ("what did admins do today").**
  Considered after Sprint 12.4. Rejected: distinct from Tổng quan
  (cross-module user activity); would only matter when ≥3 admins
  exist.

- **WYSIWYG markdown editor for Grammar.** Considered for Sprint
  12.7. Rejected: Andy's authoring workflow is repo + git + commit;
  switching to an in-browser editor would lose version control and
  PR review. The hybrid file-based pattern is the right answer.

---

## Decision log

When in doubt about whether a trigger fires, fall back to: **does the
current manual workflow visibly hurt?** If yes, the surface is overdue.
If no, the surface is premature.

The 9 PRs in DEBT-ADMIN-IA-REFACTOR each fired because a manual
workflow was hurting. Maintain that bar for Phase B.

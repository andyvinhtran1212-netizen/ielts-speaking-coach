/**
 * frontend/js/components/aver-admin-chrome.js — canonical Aver Learning
 * admin chrome as a Shadow DOM Web Component (Sprint 12.1).
 *
 * Renders the canonical admin nav: top bar (back link + brand + ADMIN
 * badge + theme toggle + user email) + left sidebar with sectioned nav.
 *
 * Pattern reference: <aver-chrome> (Sprint 7.11). Shadow DOM, attribute
 * API, design-token-only styles, single source of truth.
 *
 * Usage:
 *
 *   <aver-admin-chrome active="writing"></aver-admin-chrome>
 *   <aver-admin-chrome active="writing" subsection="grade"></aver-admin-chrome>
 *
 *   <script type="module" src="/js/components/aver-admin-chrome.js"></script>
 *
 * Attributes:
 *   active="overview" | "speaking" | "writing" | "listening" | "vocab"
 *        | "grammar" | "students" | "users" | "cohorts" | "access-codes"
 *        | "usage" | "error-logs" | "system"
 *     Highlights the matching sidebar entry. Reactive via observedAttributes.
 *
 *   subsection="<page-slug>"
 *     Highlights a child entry under the active section (e.g. "grade"
 *     under writing). Optional.
 *
 * Phase B placeholders: 'cohorts', 'usage', 'system' render with a "Sắp
 * ra mắt" badge and the link still works (lands on a placeholder page).
 *
 * Persistence: sidebar collapse state stored under
 * 'av-admin-sidebar-collapsed' in localStorage. Default expanded on
 * desktop; mobile (<768px) overlays the sidebar above content and the
 * hamburger button is the only trigger.
 */

import { bindToggleButton } from '/js/theme-toggle.js';
import { installPerfResourceHints } from '/js/components/perf-hints.js';


// ── Constants ──────────────────────────────────────────────────────


const VALID_ACTIVE = [
  'overview', 'dashboard',
  'speaking', 'writing', 'listening', 'vocab', 'grammar',
  'students', 'users', 'cohorts',
  'access-codes', 'usage', 'foot-traffic',
  'error-logs',
  'system',
];

// Sprint 12.8 graduated `system` (AI Usage + Alerts now LIVE).
// Sprint 17.2 graduated `usage`; Sprint 17.3 graduated `cohorts` (management UI now LIVE).
// No Phase-B placeholders remain.
const PHASE_B_SECTIONS = new Set([]);

const SIDEBAR_LS_KEY = 'av-admin-sidebar-collapsed';

const POLL_INTERVAL_MS = 50;
const POLL_MAX_TRIES = 60;

installPerfResourceHints();


// ── Shadow tree styles ─────────────────────────────────────────────


const STYLE = /* css */ `
:host {
  display: block;
  font-family: var(--av-font-sans);
  --admin-sidebar-w: 240px;
  --admin-sidebar-w-collapsed: 64px;
  --admin-header-h: 56px;
}

/* ── Theme toggle (mirrors aver-chrome) ───────────────────────── */
.av-theme-toggle .icon-sun  { display: none; }
.av-theme-toggle .icon-moon { display: block; }
:host-context([data-theme="dark"]) .av-theme-toggle .icon-sun  { display: block; }
:host-context([data-theme="dark"]) .av-theme-toggle .icon-moon { display: none; }
.av-theme-toggle svg {
  width: 18px;
  height: 18px;
  stroke-width: 2;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.av-theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--av-border-default);
  border-radius: var(--av-radius-pill);
  color: var(--av-text-secondary);
  cursor: pointer;
  font-family: inherit;
}
.av-theme-toggle:hover {
  background: var(--av-surface-sunken);
}

/* ── Header (top bar) ─────────────────────────────────────────── */
.admin-header {
  position: sticky; top: 0; z-index: 30;
  height: var(--admin-header-h);
  display: flex; align-items: center;
  gap: var(--av-space-4);
  padding: 0 var(--av-space-6);
  background: var(--av-surface-card);
  border-bottom: 1px solid var(--av-border-subtle);
}
.hamburger {
  display: none;
  width: 36px; height: 36px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--av-border-default);
  border-radius: var(--av-radius-pill);
  color: var(--av-text-secondary);
  cursor: pointer; font-family: inherit;
  align-items: center; justify-content: center;
}
.hamburger svg {
  width: 18px; height: 18px;
  stroke-width: 2; fill: none; stroke: currentColor;
  stroke-linecap: round; stroke-linejoin: round;
}
.back-link {
  display: inline-flex; align-items: center; gap: var(--av-space-1);
  font-size: var(--av-fs-sm);
  font-weight: var(--av-fw-medium);
  color: var(--av-text-secondary);
  text-decoration: none;
}
.back-link:hover { color: var(--av-text-primary); }
.brand {
  font-family: var(--av-font-sans);
  font-size: var(--av-fs-base);
  font-weight: var(--av-fw-bold);
  letter-spacing: var(--av-tracking-tight);
  color: var(--av-text-primary);
  text-decoration: none;
}
.brand .mark { color: var(--av-primary); }
.admin-badge {
  font-family: var(--av-font-mono);
  font-size: var(--av-fs-xs);
  font-weight: var(--av-fw-bold);
  padding: 2px 8px;
  border-radius: var(--av-radius-sm);
  background: var(--av-brand-teal-50);
  color: var(--av-brand-teal-800);
  border: 1px solid var(--av-brand-teal-200);
  letter-spacing: var(--av-tracking-wide);
}
.brand-divider {
  color: var(--av-border-default);
  font-size: var(--av-fs-base);
}
.header-spacer { flex: 1; }
.header-email {
  font-size: var(--av-fs-xs);
  color: var(--av-text-muted);
  font-family: var(--av-font-mono);
}

/* ── Body grid (sidebar + content) ────────────────────────────── */
.admin-body {
  display: grid;
  grid-template-columns: var(--admin-sidebar-w) 1fr;
  min-height: calc(100vh - var(--admin-header-h));
}
:host([data-collapsed="1"]) .admin-body {
  grid-template-columns: var(--admin-sidebar-w-collapsed) 1fr;
}

/* ── Sidebar ──────────────────────────────────────────────────── */
.sidebar {
  position: sticky;
  top: var(--admin-header-h);
  align-self: flex-start;
  height: calc(100vh - var(--admin-header-h));
  overflow-y: auto;
  padding: var(--av-space-4) var(--av-space-2);
  background: var(--av-surface-sunken);
  border-right: 1px solid var(--av-border-subtle);
  display: flex; flex-direction: column;
  gap: var(--av-space-1);
}
.collapse-btn {
  align-self: flex-end;
  width: 28px; height: 28px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--av-border-default);
  border-radius: var(--av-radius-sm);
  color: var(--av-text-secondary);
  cursor: pointer; font-family: inherit;
  display: inline-flex; align-items: center; justify-content: center;
  margin-bottom: var(--av-space-2);
}
.collapse-btn:hover { background: var(--av-surface-card); }
.collapse-btn svg {
  width: 14px; height: 14px;
  stroke-width: 2; fill: none; stroke: currentColor;
  stroke-linecap: round; stroke-linejoin: round;
}
.nav-group {
  display: flex; flex-direction: column;
  gap: var(--av-space-1);
  margin-bottom: var(--av-space-3);
}
.nav-group-title {
  font-size: var(--av-fs-xs);
  text-transform: uppercase;
  letter-spacing: var(--av-tracking-widest);
  color: var(--av-text-muted);
  padding: var(--av-space-2) var(--av-space-3) var(--av-space-1);
  font-weight: var(--av-fw-semibold);
}
.nav-item {
  display: flex; align-items: center;
  gap: var(--av-space-2);
  padding: var(--av-space-2) var(--av-space-3);
  border-radius: var(--av-radius-md);
  font-size: var(--av-fs-sm);
  font-weight: var(--av-fw-medium);
  color: var(--av-text-secondary);
  text-decoration: none;
  border: 1px solid transparent;
}
.nav-item:hover {
  background: var(--av-surface-card);
  color: var(--av-text-primary);
}
.nav-item.active {
  background: var(--av-brand-teal-50);
  color: var(--av-brand-teal-800);
  border-color: var(--av-brand-teal-200);
  font-weight: var(--av-fw-semibold);
}
.nav-item .nav-icon {
  width: 16px; height: 16px;
  flex-shrink: 0;
  stroke-width: 2; fill: none; stroke: currentColor;
  stroke-linecap: round; stroke-linejoin: round;
}
.nav-item .nav-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nav-item .phase-b-tag {
  margin-left: auto;
  font-family: var(--av-font-mono);
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--av-radius-pill);
  background: var(--av-surface-card);
  color: var(--av-text-muted);
  border: 1px solid var(--av-border-default);
  letter-spacing: var(--av-tracking-wide);
}

:host([data-collapsed="1"]) .nav-group-title,
:host([data-collapsed="1"]) .nav-label,
:host([data-collapsed="1"]) .phase-b-tag { display: none; }
:host([data-collapsed="1"]) .nav-item { justify-content: center; padding: var(--av-space-2); }
:host([data-collapsed="1"]) .nav-subgroup { display: none; }

/* ── Sub-items (Sprint 12.2 F2) ──────────────────────────────── */
.nav-subgroup {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 2px 0 var(--av-space-2) calc(var(--av-space-3) + 16px);
  padding-left: var(--av-space-2);
  border-left: 1px solid var(--av-border-default);
}
.nav-subitem {
  display: block;
  padding: 4px var(--av-space-2);
  border-radius: var(--av-radius-sm);
  font-size: var(--av-fs-xs);
  color: var(--av-text-muted);
  text-decoration: none;
  border: 1px solid transparent;
}
.nav-subitem:hover {
  background: var(--av-surface-card);
  color: var(--av-text-primary);
}
.nav-subitem.active {
  background: var(--av-brand-teal-50);
  color: var(--av-brand-teal-800);
  border-color: var(--av-brand-teal-200);
  font-weight: var(--av-fw-semibold);
}

/* ── Content slot ─────────────────────────────────────────────── */
.content {
  padding: var(--av-space-6);
  background: var(--av-surface-page, var(--av-surface-card));
  min-width: 0;
}

/* ── Backdrop (mobile) ────────────────────────────────────────── */
.backdrop {
  display: none;
  position: fixed;
  top: var(--admin-header-h); left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 20;
}
:host([data-mobile-open="1"]) .backdrop { display: block; }

/* ── Mobile ───────────────────────────────────────────────────── */
@media (max-width: 768px) {
  .hamburger { display: inline-flex; }
  .header-email { display: none; }
  .admin-body { grid-template-columns: 1fr; }
  .sidebar {
    position: fixed;
    top: var(--admin-header-h); left: 0; bottom: 0;
    width: var(--admin-sidebar-w);
    height: auto;
    transform: translateX(-100%);
    transition: transform 0.2s ease;
    z-index: 25;
    background: var(--av-surface-card);
  }
  :host([data-mobile-open="1"]) .sidebar { transform: translateX(0); }
  .collapse-btn { display: none; }
}
`;


// ── Sidebar content ────────────────────────────────────────────────


/**
 * Sidebar nav entries. Each entry: { section, label, href, group?,
 * phaseB?, subsections? }. `subsections` is a flat list under the
 * parent — sub-items render only when the parent is `active` (to keep
 * the sidebar manageable). The route convention matches §5 of
 * docs/sprint-12-0-admin-discovery.md.
 */
const NAV_GROUPS = [
  {
    title: null,  // ungrouped top of sidebar
    items: [
      { section: 'overview',  label: 'Tổng quan', href: '/pages/admin/index.html', icon: 'home' },
      // Sprint 18.2 — new ops Dashboard (6-metric overview); consolidates the
      // Usage / Lưu lượng / Hệ thống surfaces as drill-downs.
      { section: 'dashboard', label: 'Dashboard',  href: '/pages/admin/dashboard/index.html', icon: 'activity',
        subsections: [
          // reading-access-tracking C — reading-attempts drill-down (auth +
          // anonymous share-link takers: time/band/skills).
          { slug: 'reading-attempts', label: 'Reading — Lượt làm bài', href: '/pages/admin/dashboard/reading-attempts.html' },
        ],
      },
    ],
  },
  {
    title: 'Nội dung',
    items: [
      { section: 'speaking',  label: 'Speaking',  href: '/pages/admin/speaking/index.html',  icon: 'mic' },
      { section: 'writing',   label: 'Writing',   href: '/pages/admin/writing/index.html',   icon: 'pen',
        subsections: [
          { slug: 'new',              label: 'Soạn bài viết',     href: '/pages/admin/writing/new.html' },
          { slug: 'grade',            label: 'Chấm bài viết',     href: '/pages/admin/writing/grade.html' },
          { slug: 'status',           label: 'Trạng thái chấm',   href: '/pages/admin/writing/status.html' },
          { slug: 'assignments',      label: 'Gán bài tập',       href: '/pages/admin/writing/assignments.html' },
          { slug: 'prompts',          label: 'Thư viện prompt',   href: '/pages/admin/writing/prompts.html' },
          { slug: 'tips',             label: 'Mẹo viết',          href: '/pages/admin/writing/tips.html' },
          { slug: 'cohorts',          label: 'Lớp học',           href: '/pages/admin/writing/cohorts.html' },
          { slug: 'regrade-requests', label: 'Yêu cầu chấm lại',   href: '/pages/admin/writing/regrade-requests.html' },
          { slug: 'instructor-queue', label: 'Hàng đợi Instructor', href: '/pages/admin/writing/instructor-queue.html' },
        ],
      },
      { section: 'listening', label: 'Listening', href: '/pages/admin/listening/index.html', icon: 'headphones',
        subsections: [
          { slug: 'content',   label: 'Quản lý nội dung', href: '/pages/admin/listening/index.html' },
          { slug: 'create',    label: 'Tạo bài',          href: '/pages/admin/listening/index.html' },
          { slug: 'convert',   label: 'Convert DOCX',     href: '/pages/admin/listening/convert.html' },
          { slug: 'tests',     label: 'Cambridge tests',  href: '/pages/admin/listening/tests.html' },
          { slug: 'segments',  label: 'Chia cắt audio',   href: '/pages/admin/listening/segments.html' },
          { slug: 'gist',      label: 'Bài Gist',         href: '/pages/admin/listening/gist.html' },
          { slug: 'tf',        label: 'Bài True/False',   href: '/pages/admin/listening/tf.html' },
          { slug: 'mcq',       label: 'Bài MCQ',          href: '/pages/admin/listening/mcq.html' },
          { slug: 'mini-test', label: 'Mini Test',        href: '/pages/admin/listening/mini-test.html' },
        ],
      },
      { section: 'reading',   label: 'Reading',   href: '/pages/admin/reading/content.html', icon: 'book-open',
        subsections: [
          { slug: 'content',  label: 'Quản lý nội dung', href: '/pages/admin/reading/content.html' },
        ],
      },
      { section: 'vocab',     label: 'Vocab',     href: '/pages/admin/vocab/index.html',     icon: 'book',
        subsections: [
          { slug: 'stats',         label: 'Stats',           href: '/pages/admin/vocab/stats.html' },
          { slug: 'd1-curation',   label: 'D1 Curation',     href: '/pages/admin/vocab/d1-curation.html' },
          { slug: 'lemmas',        label: 'Lemma Overrides', href: '/pages/admin/vocab/lemmas.html' },
          { slug: 'exercises',     label: 'D1 Exercises',    href: '/pages/admin/vocab/exercises.html' },
        ],
      },
      { section: 'grammar',   label: 'Grammar',   href: '/pages/admin/grammar/index.html',   icon: 'edit',
        subsections: [
          { slug: 'articles',         label: 'Articles',          href: '/pages/admin/grammar/articles.html' },
          { slug: 'analytics',        label: 'Analytics',         href: '/pages/admin/grammar/analytics.html' },
          { slug: 'recommend-test',   label: 'Recommendation tester', href: '/pages/admin/grammar/recommend-test.html' },
        ],
      },
    ],
  },
  {
    title: 'Người dùng',
    items: [
      { section: 'users',    label: 'Tất cả người dùng',  href: '/pages/admin/users/index.html',    icon: 'user-check' },
      // Sprint 18.1 — IA fold: the standalone "Học viên" (students) nav entry
      // is folded into this area. The cohorts + students pages now present as
      // one tabbed area ("Lớp & Học viên" tab bar); 'students' stays in
      // VALID_ACTIVE so the students page still resolves when reached via the tab.
      { section: 'cohorts',  label: 'Lớp & Học viên',     href: '/pages/admin/cohorts/index.html',  icon: 'layers' },
    ],
  },
  {
    title: 'Truy cập',
    items: [
      { section: 'access-codes', label: 'Mã kích hoạt', href: '/pages/admin/access-codes/index.html', icon: 'key' },
      // Sprint 18.2 — "Usage logs" + "Lưu lượng" folded into the Dashboard as
      // drill-downs. Pages remain reachable + in VALID_ACTIVE for deep links.
    ],
  },
  {
    title: null,
    items: [
      { section: 'error-logs', label: 'Báo lỗi',   href: '/pages/admin/error-logs/index.html', icon: 'alert' },
      // Sprint 18.2 — "Hệ thống" folded into the Dashboard (AI Usage is the
      // cost-card drill-down). system / ai-usage / alerts stay in VALID_ACTIVE.
    ],
  },
];


/**
 * Inline SVG icon set. Lucide-style strokes, sized via .nav-icon.
 */
const ICONS = {
  home:        '<polyline points="3 12 12 3 21 12"/><path d="M5 10v10h14V10"/>',
  mic:         '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="22"/>',
  pen:         '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  headphones:  '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-7h3v5z"/><path d="M3 19a2 2 0 0 0 2 2h1v-7H3v5z"/>',
  book:        '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  // Sprint 20.8 A3 — the Reading sidebar entry has referenced 'book-open'
  // since 20.1 but the key was never added to ICONS; the SVG path fell back
  // to '' and the menu rendered iconless. Add the Lucide book-open glyph
  // (open spine, two facing pages) — visually parallel to `book` (Vocab).
  'book-open': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  edit:        '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  users:       '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'user-check':'<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>',
  layers:      '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  key:         '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  activity:    '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  alert:       '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  settings:    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
};


function renderNavItem(item, isActive) {
  const cls = isActive ? 'nav-item active' : 'nav-item';
  const tag = item.phaseB
    ? '<span class="phase-b-tag">Sắp ra mắt</span>'
    : '';
  return `
    <a href="${item.href}" class="${cls}" data-section="${item.section}"
       aria-label="${item.label}${item.phaseB ? ' — Phase B' : ''}">
      <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
        ${ICONS[item.icon] || ''}
      </svg>
      <span class="nav-label">${item.label}</span>
      ${tag}
    </a>
  `;
}


function renderSubItem(parentSection, sub, isActive) {
  const cls = isActive ? 'nav-subitem active' : 'nav-subitem';
  return `
    <a href="${sub.href}" class="${cls}"
       data-section="${parentSection}"
       data-subsection="${sub.slug}"
       aria-label="${sub.label}">
      <span class="nav-sublabel">${sub.label}</span>
    </a>
  `;
}


function renderSidebar(active, subsection) {
  return NAV_GROUPS.map((group) => {
    const items = group.items.map((item) => {
      const isActive = item.section === active;
      const parent = renderNavItem(item, isActive);
      if (!isActive || !item.subsections || !item.subsections.length) {
        return parent;
      }
      const subs = item.subsections.map((sub) =>
        renderSubItem(item.section, sub, sub.slug === subsection)
      ).join('');
      return `${parent}<div class="nav-subgroup">${subs}</div>`;
    }).join('');
    const title = group.title
      ? `<div class="nav-group-title">${group.title}</div>`
      : '';
    return `<div class="nav-group">${title}${items}</div>`;
  }).join('');
}


function buildTemplate(active, subsection) {
  return /* html */ `
<div class="admin-header">
  <button class="hamburger" id="hamburger" type="button" aria-label="Mở/đóng sidebar">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="3" y1="6"  x2="21" y2="6"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  </button>
  <a href="/pages/home.html" class="back-link">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M15 19l-7-7 7-7"/>
    </svg>
    Trang chủ
  </a>
  <span class="brand-divider">|</span>
  <a href="/pages/admin/index.html" class="brand">
    IELTS<span class="mark">Coach</span>
  </a>
  <span class="admin-badge">ADMIN</span>
  <div class="header-spacer"></div>
  <button class="av-theme-toggle" id="theme-toggle" type="button" aria-label="Chuyển giao diện sáng/tối">
    <svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>
    </svg>
    <svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
    </svg>
  </button>
  <span class="header-email" id="header-email"></span>
</div>

<div class="admin-body">
  <aside class="sidebar" id="sidebar" aria-label="Admin navigation">
    <button class="collapse-btn" id="collapse-btn" type="button"
            aria-label="Thu/mở rộng sidebar" title="Thu gọn">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </button>
    ${renderSidebar(active, subsection)}
  </aside>
  <main class="content">
    <slot></slot>
  </main>
</div>

<div class="backdrop" id="backdrop"></div>
`;
}


// ── Custom element ─────────────────────────────────────────────────


export class AverAdminChrome extends HTMLElement {
  static get observedAttributes() { return ['active', 'subsection']; }

  constructor() {
    super();
    this._toggleTeardown = null;
    this._abortController = null;
  }

  connectedCallback() {
    if (this._mounted) return;
    this._mounted = true;

    // Sprint 12.3 — autoload the global error reporter so every page
    // that embeds <aver-admin-chrome> automatically captures uncaught
    // exceptions + Promise rejections. error-reporter.js is idempotent
    // (self-guarded against double-load) so re-injection is safe.
    try {
      if (typeof document !== 'undefined' && !document.querySelector('script[data-aver-error-reporter]')) {
        const s = document.createElement('script');
        s.src = '/js/error-reporter.js';
        s.setAttribute('data-aver-error-reporter', '1');
        s.async = true;
        document.head.appendChild(s);
      }
    } catch { /* swallow — never block chrome render on reporter load */ }

    // Apply persisted collapse state BEFORE first paint so the layout
    // doesn't flash an expanded sidebar then snap collapsed.
    try {
      if (localStorage.getItem(SIDEBAR_LS_KEY) === '1') {
        this.setAttribute('data-collapsed', '1');
      }
    } catch { /* swallow — private-browsing or storage disabled */ }

    const shadow = this.attachShadow({ mode: 'open' });
    const active = this._normalizeActive(this.getAttribute('active'));
    const subsection = this._normalizeSubsection(this.getAttribute('subsection'), active);
    shadow.innerHTML = `<style>${STYLE}</style>${buildTemplate(active, subsection)}`;

    this._bindToggle();
    this._bindCollapse();
    this._bindHamburger();
    this._populateEmail();
  }

  disconnectedCallback() {
    // Always release body scroll on tear-down so a mid-state component
    // detach doesn't leave the page non-scrollable.
    this._setBodyScrollLock(false);
    if (this._toggleTeardown) {
      try { this._toggleTeardown(); } catch { /* swallow */ }
      this._toggleTeardown = null;
    }
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  attributeChangedCallback(name, _prev, next) {
    if (name !== 'active' && name !== 'subsection') return;
    if (!this.shadowRoot) return;
    const active = this._normalizeActive(this.getAttribute('active'));
    const subsection = this._normalizeSubsection(this.getAttribute('subsection'), active);
    const sidebar = this.shadowRoot.getElementById('sidebar');
    if (!sidebar) {
      this._applyActive(active);
      return;
    }
    const collapseBtn = sidebar.querySelector('.collapse-btn');
    sidebar.innerHTML = (collapseBtn ? collapseBtn.outerHTML : '') + renderSidebar(active, subsection);
    this._bindCollapse();
    // Re-bind hamburger nav-item close handlers for the new DOM.
    this._rebindNavItemCloseHandlers();
  }


  // ── Internal ───────────────────────────────────────────────────


  _normalizeActive(value) {
    return VALID_ACTIVE.includes(value) ? value : null;
  }

  _normalizeSubsection(value, active) {
    if (!value || !active) return null;
    const group = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.section === active);
    if (!group || !group.subsections) return null;
    return group.subsections.some((s) => s.slug === value) ? value : null;
  }

  _applyActive(active) {
    const links = this.shadowRoot.querySelectorAll('.nav-item[data-section]');
    links.forEach((a) => {
      if (active && a.dataset.section === active) {
        a.classList.add('active');
      } else {
        a.classList.remove('active');
      }
    });
  }

  _rebindNavItemCloseHandlers() {
    if (!this._abortController) return;
    const sig = this._abortController.signal;
    this.shadowRoot.querySelectorAll('.nav-item, .nav-subitem').forEach((a) => {
      a.addEventListener('click', () => {
        this.removeAttribute('data-mobile-open');
        this._setBodyScrollLock(false);
      }, { signal: sig });
    });
  }

  _setBodyScrollLock(locked) {
    // Sprint 12.2 F3 — lock page scroll while the mobile sidebar
    // overlay is open so background content can't scroll behind it.
    if (typeof document === 'undefined' || !document.body) return;
    if (locked) {
      this._priorBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = this._priorBodyOverflow || '';
      this._priorBodyOverflow = undefined;
    }
  }

  _bindToggle() {
    const btn = this.shadowRoot.getElementById('theme-toggle');
    if (!btn) return;
    this._toggleTeardown = bindToggleButton(btn);
  }

  _bindCollapse() {
    const btn = this.shadowRoot.getElementById('collapse-btn');
    if (!btn) return;
    this._abortController = this._abortController || new AbortController();
    btn.addEventListener('click', () => {
      const collapsed = this.getAttribute('data-collapsed') === '1';
      if (collapsed) {
        this.removeAttribute('data-collapsed');
        try { localStorage.removeItem(SIDEBAR_LS_KEY); } catch { /* swallow */ }
      } else {
        this.setAttribute('data-collapsed', '1');
        try { localStorage.setItem(SIDEBAR_LS_KEY, '1'); } catch { /* swallow */ }
      }
    }, { signal: this._abortController.signal });
  }

  _bindHamburger() {
    const ham = this.shadowRoot.getElementById('hamburger');
    const backdrop = this.shadowRoot.getElementById('backdrop');
    if (!ham || !backdrop) return;
    this._abortController = this._abortController || new AbortController();
    const sig = this._abortController.signal;
    ham.addEventListener('click', () => {
      const open = this.getAttribute('data-mobile-open') === '1';
      if (open) {
        this.removeAttribute('data-mobile-open');
        this._setBodyScrollLock(false);
      } else {
        this.setAttribute('data-mobile-open', '1');
        this._setBodyScrollLock(true);
      }
    }, { signal: sig });
    backdrop.addEventListener('click', () => {
      this.removeAttribute('data-mobile-open');
      this._setBodyScrollLock(false);
    }, { signal: sig });
    // Close mobile sidebar when a nav item is clicked.
    this._rebindNavItemCloseHandlers();
  }

  _populateEmail() {
    const emailEl = this.shadowRoot.getElementById('header-email');
    if (!emailEl) return;
    let tries = 0;
    const tick = async () => {
      if (!this.shadowRoot) return;
      const sb = (typeof window !== 'undefined'
                  && typeof window.getSupabase === 'function')
                 ? window.getSupabase()
                 : null;
      if (!sb) {
        tries += 1;
        if (tries >= POLL_MAX_TRIES) return;
        setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }
      try {
        const { data } = await sb.auth.getSession();
        const session = data && data.session;
        if (session && session.user && session.user.email) {
          emailEl.textContent = session.user.email;
        }
      } catch { /* swallow */ }
    };
    setTimeout(tick, 0);
  }
}


if (typeof customElements !== 'undefined' && !customElements.get('aver-admin-chrome')) {
  customElements.define('aver-admin-chrome', AverAdminChrome);
}

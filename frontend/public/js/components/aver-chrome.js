/**
 * frontend/js/components/aver-chrome.js — canonical Aver Learning chrome
 * as a Shadow DOM Web Component (Sprint 7.11).
 *
 * Renders the canonical top nav (brand + skill tabs + theme toggle +
 * user pill + logout dropdown) into a shadow root. Single source of
 * truth replacing the ~40-line chrome block previously copy-pasted
 * across 18 pages — Sprint 7.12+ migrates pages to use this component.
 *
 * Usage:
 *
 *   <aver-chrome active="speaking"></aver-chrome>
 *
 *   <script type="module" src="/js/components/aver-chrome.js"></script>
 *
 * Page contract:
 *   - <head> must run the anti-flash IIFE (sets [data-theme] on <html>
 *     before any stylesheet loads). The component does not own this —
 *     it must run pre-paint per page.
 *   - <body> must include Supabase init (api.js + initSupabase) BEFORE
 *     or after this component connects. The component polls
 *     window.getSupabase for up to ~3s, then waits for the Next runtime
 *     boundary's `aver:supabase-runtime-ready` event (U-21: the chrome no
 *     longer loads behind that boundary). Until then the pill placeholder
 *     ("…" / "·") remains on auth-gated routes; on public routes the
 *     account menu stays hidden until a session is confirmed (U-06).
 *
 * Attributes:
 *   active="home" | "writing" | "speaking" | "grammar" | "vocabulary"
 *     Highlights the matching skill tab. Unset / unknown = no highlight
 *     (admin / auth surfaces). Reactive via observedAttributes.
 *
 * Methods:
 *   setUser({ name?, initials?, email? })
 *     Overwrites the pill name + avatar with page-authoritative data.
 *     Used by speaking.html renderUser() which fetches /auth/me for
 *     permissions context. Marks the component as page-authoritative
 *     so the auto-fetch path skips (or is overridden if called late).
 *
 * Events:
 *   av-chrome-signing-out (bubbles, composed)
 *     Dispatched when the user clicks Đăng xuất, before the awaited revoke.
 *     The Next AuthProvider holds pages out of their signed-out /login
 *     redirect so the chrome's own '/' redirect stays the destination.
 *   av-chrome-signed-out (bubbles, composed)
 *     Dispatched right before the post-signOut redirect to /index.html.
 *     Pages can listen for cleanup (cancel polls, close dialogs, etc).
 *
 * Phase B locked decisions (PHASE_CLOSURE_LEDGER.md Sprint 7.10):
 *   Q1 Shadow DOM · Q2 `active` attribute · Q3 slots-free
 *   Q4 setUser() method · Q5 polling window.getSupabase
 *   Q6 batched migration · Q7 explicit out-of-scope list
 */

import { bindToggleButton } from '/js/theme-toggle.js';
import { canonicalInitials } from '/js/user-pill.js';
import { installPerfResourceHints } from '/js/components/perf-hints.js';
import { clearPersistedAuthSession, rememberSignedOutSession } from '/js/auth-sign-out-state.js';


// ── Constants ──────────────────────────────────────────────────────


// Sprint 11.1 — 'listening' added as the 5th skill tab between Speaking
// and Grammar (DEBT-LISTENING-MODULE foundation 1/5). Page shell lives
// at /pages/listening.html; user-facing routes (dictation, gist, T/F,
// MCQ, mini test) land in Sprint 11.2-11.4.
const VALID_ACTIVE = ['home', 'writing', 'class', 'speaking', 'listening', 'grammar', 'vocabulary'];

// Supabase polling — ~3s ceiling matches Sprint 7.8-hotfix bootstrap
// pattern. 50ms tick × 60 tries.
const POLL_INTERVAL_MS = 50;
const POLL_MAX_TRIES = 60;

// U-21 — dispatched by components/supabase-runtime-boundary.tsx once api.js
// has adopted the shared client. Logout waits at most this long for it.
const RUNTIME_READY_EVENT = 'aver:supabase-runtime-ready';
const LOGOUT_RUNTIME_WAIT_MS = 5000;

// U-20 — must equal the disclosure @media query in STYLE below.
const MOBILE_NAV_QUERY = '(max-width: 1024.98px)';

function currentSupabase() {
  return (typeof window !== 'undefined' && typeof window.getSupabase === 'function')
    ? window.getSupabase()
    : null;
}

// Resolves with the shared client, or null when the runtime is not ready
// within `timeoutMs`.
function whenSupabase(timeoutMs) {
  const ready = currentSupabase();
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener(RUNTIME_READY_EVENT, done);
      resolve(currentSupabase());
    };
    const timer = setTimeout(done, timeoutMs);
    window.addEventListener(RUNTIME_READY_EVENT, done);
  });
}

// U-21 — the hint origins come from api.js and runtime-config.js. The chrome
// can now load before both, and hinting then would warm the PRODUCTION
// fallback origins from staging, so wait for the runtime.
if (currentSupabase()) installPerfResourceHints();
else window.addEventListener(RUNTIME_READY_EVENT, () => installPerfResourceHints(), { once: true });


// ── Shadow tree template ───────────────────────────────────────────


// Inline stylesheet — verbatim from components.css lines 116-130
// (theme-toggle icon-swap + svg) + lines 741-923 (chrome block).
// `:host-context([data-theme="dark"])` substitutes for the original
// `[data-theme="dark"] .av-theme-toggle ...` descendant selectors so
// the rule still matches against the page-level <html data-theme>.
// Sprint 7.14 deletes the source rules from components.css; until
// then they live in both places (pages still use the source).
const STYLE = /* css */ `
:host {
  display: block;
  font-family: var(--av-font-sans);
}

.skip-link {
  position: fixed; top: var(--av-space-2); left: var(--av-space-2); z-index: var(--av-z-toast);
  min-height: var(--av-control-min-height);
  display: inline-flex; align-items: center;
  padding: 0 var(--av-space-4); border-radius: var(--av-radius-md);
  color: var(--av-text-on-primary); background: var(--av-primary); font-weight: var(--av-fw-bold);
  transform: translateY(-160%); transition: transform var(--av-duration-fast) var(--av-easing-default);
}
.skip-link:focus { transform: translateY(0); }

/* ── Theme toggle ─────────────────────────────────────────────── */

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

/* ── Chrome ───────────────────────────────────────────────────── */

.topnav-wrap {
  max-width: 1180px;
  margin: 0 auto;
  padding: 0 var(--av-space-8);
}

.topnav {
  display: flex;
  align-items: center;
  gap: var(--av-space-6);
  padding: var(--av-space-4) 0;
  border-bottom: 1px solid var(--av-border-subtle);
  margin-bottom: var(--av-space-16);
}

.brand {
  font-family: var(--av-font-sans);
  font-size: var(--av-fs-lg);
  font-weight: var(--av-fw-bold);
  letter-spacing: var(--av-tracking-tight);
  color: var(--av-text-primary);
  margin-right: auto;
  text-decoration: none;
}
.brand .dot { color: var(--av-primary); }

.nav-links {
  display: flex;
  align-items: center;
  gap: var(--av-space-1);
  flex-wrap: wrap;
}
.nav-links a,
.nav-links span {
  display: inline-flex;
  align-items: center;
  gap: var(--av-space-1);
  padding: var(--av-space-2) var(--av-space-3);
  border-radius: var(--av-radius-pill);
  font-size: var(--av-fs-sm);
  font-weight: var(--av-fw-medium);
  color: var(--av-text-muted);
  text-decoration: none;
  transition:
    color var(--av-duration-fast) var(--av-easing-default),
    background var(--av-duration-fast) var(--av-easing-default);
}
.nav-links a:hover {
  color: var(--av-text-primary);
  background: var(--av-surface-sunken);
}
.nav-links a.active {
  color: var(--av-primary);
  background: var(--av-primary-soft);
}
.nav-links .locked {
  color: var(--av-text-faint);
  cursor: not-allowed;
}
.nav-links .locked::after {
  content: "Soon";
  font-family: var(--av-font-sans);
  font-size: var(--av-fs-xs);
  font-weight: var(--av-fw-medium);
  text-transform: uppercase;
  letter-spacing: var(--av-tracking-wide);
  line-height: 1;
  margin-left: var(--av-space-1);
  padding: 2px 6px;
  border-width: 1px;
  border-style: solid;
  border-color: var(--av-border-subtle);
  border-radius: var(--av-radius-sm);
  opacity: 0.7;
  box-sizing: border-box;
}

.topnav-right {
  display: flex;
  align-items: center;
  gap: var(--av-space-3);
}

.av-theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--av-border-default);
  border-radius: var(--av-radius-pill);
  color: var(--av-text-secondary);
  cursor: pointer;
  font-family: inherit;
  transition:
    background var(--av-duration-fast) var(--av-easing-default),
    border-color var(--av-duration-fast) var(--av-easing-default),
    color var(--av-duration-fast) var(--av-easing-default);
}
.av-theme-toggle:hover {
  background: var(--av-primary-soft);
  border-color: var(--av-primary-border);
  color: var(--av-primary);
}
.av-theme-toggle:focus-visible {
  outline: none;
  box-shadow: var(--av-shadow-focus);
}
.av-theme-toggle:active {
  transform: scale(0.96);
}

.user-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--av-space-2);
  padding: var(--av-space-1) var(--av-space-3) var(--av-space-1) var(--av-space-1);
  background: var(--av-surface-card);
  border: 1px solid var(--av-border-default);
  border-radius: var(--av-radius-pill);
  font-size: var(--av-fs-sm);
  font-weight: var(--av-fw-medium);
  color: var(--av-text-primary);
  font-family: inherit;
  cursor: pointer;
  transition:
    border-color var(--av-duration-fast) var(--av-easing-default),
    background var(--av-duration-fast) var(--av-easing-default);
}
.user-pill:hover {
  border-color: var(--av-primary-border);
  background: var(--av-primary-soft);
}
.user-pill .avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--av-primary);
  color: var(--av-text-on-primary);
  display: grid;
  place-items: center;
  font-size: var(--av-fs-sm);
  font-weight: var(--av-fw-bold);
}

.user-menu {
  position: relative;
}
.user-menu-dropdown {
  position: absolute;
  top: calc(100% + var(--av-space-2));
  right: 0;
  min-width: 180px;
  background: var(--av-surface-elevated);
  border: 1px solid var(--av-border-default);
  border-radius: var(--av-radius-md);
  box-shadow: var(--av-shadow-md);
  padding: var(--av-space-1);
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 50;
}
.user-menu-dropdown[hidden] {
  display: none;
}
.user-menu-item {
  display: flex;
  align-items: center;
  gap: var(--av-space-2);
  width: 100%;
  padding: var(--av-space-2) var(--av-space-3);
  border-radius: var(--av-radius-sm);
  font-size: var(--av-fs-sm);
  font-weight: var(--av-fw-medium);
  color: var(--av-text-primary);
  background: transparent;
  border: 0;
  text-align: left;
  text-decoration: none;
  font-family: inherit;
  cursor: pointer;
  transition: background var(--av-duration-fast) var(--av-easing-default);
}
.user-menu-item:hover,
.user-menu-item:focus-visible {
  background: var(--av-surface-sunken);
  outline: none;
}
.user-menu-item--danger {
  color: var(--av-error);
}
.user-menu-item--danger:hover,
.user-menu-item--danger:focus-visible {
  background: var(--av-error-soft);
}
/* U-12: author "display: flex" above beats the UA [hidden] rule, so a
   role-gated item (#instructor-link) needs this at every width — it used to
   live only in the <=1024.98px block, leaking the link to students at 1280px. */
.user-menu-item[hidden] { display: none; }

.mobile-nav-toggle { display: none; }

/* U-20: the full eight-link row needs ~1045px beside the brand and the named
   user pill, so it wrapped to 2-3 rows anywhere from 721px to ~1180px. Below
   1025px the links move behind the disclosure; 1025-1279.98px keeps the row
   but compacts it; >=1280px is the untouched desktop layout. The .98 upper
   bounds keep zoomed fractional widths (e.g. 1024.5px) inside a block. Keep
   the disclosure query in sync with MOBILE_NAV_QUERY. */
@media (max-width: 1024.98px) {
  .topnav { gap: var(--av-space-3); flex-wrap: wrap; }
  .mobile-nav-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    background: var(--av-surface-card);
    border: 1px solid var(--av-border-default);
    border-radius: var(--av-radius-md);
    color: var(--av-text-primary);
    cursor: pointer;
  }
  .mobile-nav-toggle:focus-visible { outline: none; box-shadow: var(--av-shadow-focus); }
  .nav-links {
    display: none;
    width: 100%;
    min-width: 0;
    order: 3;
    align-items: stretch;
    flex-direction: column;
  }
  .nav-links.is-open { display: flex; }
  .nav-links a {
    box-sizing: border-box;
    min-height: 44px;
    border-radius: var(--av-radius-md);
  }
  .nav-links a[aria-current="page"] {
    color: var(--av-primary);
    background: var(--av-primary-soft);
    font-weight: var(--av-fw-bold);
  }
  .nav-links a:focus-visible { outline: none; box-shadow: var(--av-shadow-focus); }
  .topnav-right { margin-left: auto; gap: var(--av-space-2); }
  .user-pill { padding: var(--av-space-1); }
  #user-pill-name { display: none; }
  .user-menu-item { box-sizing: border-box; min-height: 44px; }
}

@media (max-width: 720px) {
  .topnav-wrap { padding: 0 var(--av-space-4); }
  .topnav { margin-bottom: var(--av-space-8); }
}

@media (min-width: 1025px) and (max-width: 1279.98px) {
  .topnav { gap: var(--av-space-4); }
  .nav-links { flex-wrap: nowrap; }
  .nav-links a,
  .nav-links span {
    padding-left: var(--av-space-2);
    padding-right: var(--av-space-2);
    white-space: nowrap;
  }
  .user-pill { padding: var(--av-space-1); }
  #user-pill-name { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .skip-link { transition: none; }
}
`;

const TEMPLATE = /* html */ `
<a class="skip-link" href="#aver-main-content">Bỏ qua điều hướng</a>
<div class="topnav-wrap">
  <nav class="topnav" aria-label="Primary">
    <a href="/home" class="brand">Aver<span class="dot">.</span>Learning</a>

    <div class="nav-links" id="mobile-nav-menu">
      <a href="/home" data-tab="home">Trang chủ</a>
      <a href="/writing/dashboard" data-tab="writing">Writing</a>
      <a href="/my-class" data-tab="class">MY CLASS</a>
      <a href="/speaking" data-tab="speaking">Speaking</a>
      <a href="/listening" data-tab="listening">Listening</a>
      <a href="/grammar" data-tab="grammar">Grammar</a>
      <a href="/vocabulary" data-tab="vocabulary">Vocabulary</a>
      <a href="/reading/vocab" data-tab="reading">Reading</a>
    </div>

    <div class="topnav-right">
      <button class="mobile-nav-toggle" id="mobile-nav-toggle" type="button"
              aria-label="Mở menu" aria-expanded="false" aria-controls="mobile-nav-menu">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16"></path>
        </svg>
      </button>
      <button class="av-theme-toggle" id="theme-toggle" type="button" aria-label="Chuyển giao diện sáng/tối">
        <svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>
        </svg>
        <svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      </button>

      <div class="user-menu">
        <button class="user-pill" id="user-pill" type="button"
                aria-haspopup="true" aria-expanded="false" aria-label="Menu hồ sơ">
          <span class="avatar" id="user-avatar">·</span>
          <span id="user-pill-name">…</span>
        </button>
        <div class="user-menu-dropdown" role="menu" hidden>
          <a href="/profile" class="user-menu-item" role="menuitem">Hồ sơ</a>
          <!-- W-6b / Q-40: the role-gated "Trang giảng viên" link (#instructor-link)
               is NOT in this template — _applyRole() inserts it here, before
               logout, ONLY for instructor/admin, so a learner's DOM never
               carries <a href="/instructor"> (mirrors require_instructor). -->
          <button type="button" class="user-menu-item user-menu-item--danger"
                  id="user-menu-logout" role="menuitem">Đăng xuất</button>
        </div>
      </div>
    </div>
  </nav>
</div>
`;


// ── Custom element ─────────────────────────────────────────────────


export class AverChrome extends HTMLElement {
  static get observedAttributes() { return ['active']; }

  constructor() {
    super();
    this._userOverride = false;
    this._pollTimer = null;
    this._pollTries = 0;
    this._toggleTeardown = null;
    this._abortController = null;
    this._docClickHandler = null;
    this._docKeydownHandler = null;
    this._runtimeReadyHandler = null;
    this._role = null;
  }

  connectedCallback() {
    if (this._mounted) return;
    this._mounted = true;

    // Sprint 12.3 — autoload the global error reporter so every page
    // that embeds <aver-chrome> automatically captures uncaught
    // exceptions + Promise rejections. error-reporter.js is idempotent
    // (self-guarded against double-load) so re-injection is safe.
    // PC-J06 — the chrome can now connect before runtime-config.js, and a
    // reporter loaded then posts to the PRODUCTION API fallback. Next routes
    // get the reporter from SupabaseRuntimeBoundary right after the config,
    // so self-inject only once the config is known.
    try {
      if (typeof document !== 'undefined'
          && window.__AVER_RUNTIME_CONFIG__
          && !document.querySelector('script[data-aver-error-reporter]')) {
        const s = document.createElement('script');
        s.src = '/js/error-reporter.js';
        s.setAttribute('data-aver-error-reporter', '1');
        s.async = true;
        document.head.appendChild(s);
      }
    } catch { /* swallow — never block chrome render on reporter load */ }

    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${STYLE}</style>${TEMPLATE}`;

    this._applyActive(this.getAttribute('active'));
    // Native auth-gated route groups declare this route-scoped marker from
    // AuthedShell. Apply the signed-in target synchronously instead of racing
    // the independent Supabase poll against navigation or parity capture.
    // Public layouts omit it and retain the public /vocabulary default.
    if (document.querySelector('meta[name="aver-auth-gated"][content="1"]')) {
      this._applyVocabNav(true);
    } else {
      // U-06 — a guest on a public route (Grammar Wiki) must not see the
      // "·" / "…" account placeholder; it appears once a session is found.
      this._setAccountVisible(false);
    }
    this._applyRole();   // re-apply any role set before the element upgraded
    this._bindToggle();
    this._bindSkipLink();
    this._bindDropdown();
    this._bindLogout();
    this._schedulePopulate();
    this._injectSpeculationRules();
  }

  _bindSkipLink() {
    const link = this.shadowRoot && this.shadowRoot.querySelector('.skip-link');
    if (!link) return;
    link.addEventListener('click', (event) => {
      const main = document.querySelector('main');
      if (!main) return;
      event.preventDefault();
      if (!main.id) main.id = 'aver-main-content';
      if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
      main.focus({ preventScroll: true });
      main.scrollIntoView({ block: 'start' });
    });
  }

  /**
   * Perf P2.3 — Speculation Rules PREFETCH for the main skill dashboards.
   * On a supporting browser, hovering a nav link to one of these dashboards
   * fetches its HTML ahead of the click so navigation starts warm.
   *
   * PREFETCH, not prerender (Codex review on #653): prerender executes the
   * target page's scripts before the user navigates, so a hover / abandoned
   * intent would fire real page-load side effects — the analytics `page_view`
   * beacon (js/analytics-beacon.js POSTs /api/analytics/events), the /auth/me
   * last_seen_at bump, dashboard queries — polluting analytics and doing writes
   * on speculation. Prefetch is a NON-EXECUTING hint: it only warms the HTML
   * document, no scripts run, no side effects. (Smaller win than prerender, but
   * correct; the shadow-DOM caveat below already made the prerender win
   * uncertain, so the trade-off is favourable.)
   *
   * Scoped deliberately:
   *   • allowlist of the 7 top-level dashboards ONLY — never stateful pages
   *     (practice/result need a session_id) or admin/instructor areas;
   *   • eagerness "moderate" → prefetch on hover/pointerdown INTENT, not on load;
   *   • feature-detected + fully try/caught → fails safe (does nothing) on
   *     browsers without speculation rules or if the nav lives out of reach.
   *
   * Verify in Chrome DevTools → Application → Speculative loads. NOTE: the nav
   * links render in this component's shadow root; document-rule matching of
   * shadow-DOM links varies by Chrome version — if a build doesn't match,
   * this simply no-ops (no correctness or cost impact).
   */
  _injectSpeculationRules() {
    try {
      if (typeof document === 'undefined') return;
      if (typeof HTMLScriptElement === 'undefined'
          || typeof HTMLScriptElement.supports !== 'function'
          || !HTMLScriptElement.supports('speculationrules')) return;
      if (document.querySelector('script[type="speculationrules"][data-aver-speculation]')) return;

      const rules = {
        prefetch: [{
          source: 'document',
          where: {
            or: [
              { href_matches: '/home' },
              { href_matches: '/my-class' },
              { href_matches: '/speaking' },
              { href_matches: '/writing/dashboard' },
              { href_matches: '/listening' },
              { href_matches: '/reading/vocab' },
              { href_matches: '/grammar' },
              { href_matches: '/vocabulary' },
            ],
          },
          eagerness: 'moderate',
        }],
      };

      const s = document.createElement('script');
      s.type = 'speculationrules';
      s.setAttribute('data-aver-speculation', '1');
      s.textContent = JSON.stringify(rules);
      document.head.appendChild(s);
    } catch { /* never break chrome on speculation-rules injection */ }
  }

  disconnectedCallback() {
    if (this._toggleTeardown) {
      try { this._toggleTeardown(); } catch { /* swallow */ }
      this._toggleTeardown = null;
    }
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    if (this._docClickHandler) {
      document.removeEventListener('click', this._docClickHandler);
      this._docClickHandler = null;
    }
    if (this._docKeydownHandler) {
      document.removeEventListener('keydown', this._docKeydownHandler);
      this._docKeydownHandler = null;
    }
    if (this._pollTimer !== null) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._runtimeReadyHandler) {
      window.removeEventListener(RUNTIME_READY_EVENT, this._runtimeReadyHandler);
      this._runtimeReadyHandler = null;
    }
  }

  attributeChangedCallback(name, prev, next) {
    if (name !== 'active') return;
    if (!this.shadowRoot) return; // pre-connect mutation; connectedCallback will apply
    this._applyActive(next);
  }

  /**
   * Page-authoritative pill population. Use from page bootstrap that
   * carries context the component itself can't fetch (e.g.,
   * speaking.html /auth/me with permissions). Marks the pill as
   * page-authoritative so the auto-fetch never overwrites it; the auto
   * /auth/me role lookup still runs unless `role` is passed here.
   */
  setUser({ name, initials, email, role } = {}) {
    this._userOverride = true;
    if (role !== undefined) this.setRole(role);   // page-authoritative role gate
    if (!this.shadowRoot) return; // mark only; render on connect

    this._applyVocabNav(true);   // B3 — page passed a user → logged in → nav → hub
    this._setAccountVisible(true);

    const resolvedName = name || (email && email.split('@')[0]) || 'bạn';
    const resolvedInitials = initials || canonicalInitials(resolvedName);

    const pillEl = this.shadowRoot.getElementById('user-pill-name');
    const avatarEl = this.shadowRoot.getElementById('user-avatar');
    if (pillEl) pillEl.textContent = resolvedName.length > 14
      ? resolvedName.slice(0, 13) + '…' : resolvedName;
    if (avatarEl) avatarEl.textContent = resolvedInitials;
  }

  /**
   * W-2 — role-gate the "Trang giảng viên" menu item. Rendered ONLY for
   * role 'instructor' or 'admin' (admin ⊃ instructor); for any other role it
   * is removed from the shadow DOM, not merely hidden (Q-40). Stores the role
   * so a pre-connect call (page bootstrap before the element upgrades)
   * applies on connect.
   */
  setRole(role) {
    this._role = role || null;
    this._applyRole();
  }

  _applyRole() {
    const root = this.shadowRoot;
    if (!root) return; // pre-connect; connectedCallback re-applies
    const existing = root.getElementById('instructor-link');
    const show = this._role === 'instructor' || this._role === 'admin';
    if (!show) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const logout = root.getElementById('user-menu-logout');
    if (!logout) return;
    const link = document.createElement('a');
    link.href = '/instructor';
    link.className = 'user-menu-item';
    link.id = 'instructor-link';
    link.setAttribute('role', 'menuitem');
    link.textContent = 'Trang giảng viên';
    logout.before(link);
  }

  /**
   * Fix-2 (D-B) — resolve the AUTHORITATIVE role from /auth/me so the
   * instructor-area link surfaces on EVERY chrome page, not only the ones that
   * call setUser({role}). user_metadata does NOT reliably carry role, so the
   * Supabase session alone can't gate the link — we ask the backend.
   *
   * Called from the auto-populate path, which already runs only when:
   *   • a real Supabase session exists (logged-out → never reaches here →
   *     link is never rendered, mirroring the backend require_instructor guard), and
   *   • the page hasn't taken over the pill (setUser → _userOverride short-
   *     circuits the whole auto path) — so speaking.html, which passes its own
   *     /auth/me role into setUser, does NOT trigger a second fetch here.
   *
   * Fail-closed: any non-OK response or network/parse error leaves the link
   * unrendered and never breaks the chrome. Uses a raw fetch (NOT window.api.get,
   * which redirects to /login on 401) so a stale token can't bounce the page.
   */
  async _resolveRole(token) {
    if (this._role !== null) return; // a page already set the role → no double-fetch
    // Perf P1.1 — a page marked `role-source="page"` fetches /auth/me itself and
    // feeds the role via setUser({role}). Its /auth/me is slow (cross-region), so
    // the _userOverride short-circuit above lands AFTER this tick would fire —
    // meaning without this declarative opt-out the component races ahead and pays
    // for a SECOND /auth/me (the most expensive call on the page). The attribute
    // is synchronous at parse time, so it wins the race the _role guard cannot.
    if (this.getAttribute('role-source') === 'page') return;
    if (!token) return;              // unauthenticated → link never rendered
    const base = (typeof window !== 'undefined' && window.api && window.api.base) || '';
    if (!base) return;
    let role = null;
    try {
      const resp = await fetch(base + '/auth/me', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (resp && resp.ok) {
        const me = await resp.json();
        role = (me && me.role) || null;
      }
    } catch {
      return; // network/parse error — fail closed, never break chrome
    }
    if (this._role !== null) return; // raced with a page setRole() during the await
    this.setRole(role);              // non-instructor / null → link never rendered
  }


  // ── Internal ───────────────────────────────────────────────────


  // B3 — session-adaptive Vocabulary target. Default (template) is the PUBLIC
  // wiki /vocabulary so a logged-out user browses without a login wall;
  // once a session is confirmed we point it at the login-gated hub ("của bạn").
  _applyVocabNav(loggedIn) {
    const root = this.shadowRoot;
    if (!root) return;
    const link = root.querySelector('.nav-links a[data-tab="vocabulary"]');
    if (link) link.setAttribute('href', loggedIn ? '/vocabulary/hub' : '/vocabulary');
  }

  _setAccountVisible(visible) {
    const menu = this.shadowRoot && this.shadowRoot.querySelector('.user-menu');
    if (menu) menu.hidden = !visible;
  }

  _applyActive(value) {
    const root = this.shadowRoot;
    if (!root) return;
    const links = root.querySelectorAll('.nav-links a[data-tab]');
    const target = VALID_ACTIVE.includes(value) ? value : null;
    links.forEach((a) => {
      const isActive = target && a.dataset.tab === target;
      // Preserve the desktop highlight roster; mark all eight current
      // destinations semantically and visually in the mobile panel.
      a.classList.toggle('active', Boolean(isActive));
      if (a.dataset.tab === value) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  _bindToggle() {
    const btn = this.shadowRoot.getElementById('theme-toggle');
    if (!btn) return;
    this._toggleTeardown = bindToggleButton(btn);
  }

  _bindDropdown() {
    const root = this.shadowRoot;
    const toggle = root.getElementById('user-pill');
    const menu = root.querySelector('.user-menu-dropdown');
    if (!toggle || !menu) return;

    this._abortController = new AbortController();
    const { signal } = this._abortController;

    const mobileToggle = root.getElementById('mobile-nav-toggle');
    const mobileMenu = root.getElementById('mobile-nav-menu');
    const disclosures = [
      { button: toggle, panel: menu, mobile: false },
      { button: mobileToggle, panel: mobileMenu, mobile: true },
    ];
    const isOpen = ({ button }) => button.getAttribute('aria-expanded') === 'true';
    const close = (item, restoreFocus = false) => {
      if (!isOpen(item)) return;
      item.button.setAttribute('aria-expanded', 'false');
      if (item.mobile) item.panel.classList.remove('is-open');
      else item.panel.hidden = true;
      if (restoreFocus) item.button.focus();
    };
    disclosures.forEach((item) => {
      item.button.addEventListener('click', () => {
        if (isOpen(item)) close(item, true);
        else {
          disclosures.forEach((other) => close(other));
          item.button.setAttribute('aria-expanded', 'true');
          if (item.mobile) {
            item.panel.classList.add('is-open');
            item.panel.querySelector('a')?.focus();
          }
          else item.panel.hidden = false;
        }
      }, { signal });
      item.panel.addEventListener('click', (event) => {
        if (event.target.closest('a')) close(item, true);
      }, { signal });
    });

    // composedPath includes shadow targets, unlike the retargeted document event.
    this._docClickHandler = (event) => {
      const path = event.composedPath();
      disclosures.forEach((item) => {
        if (!path.includes(item.button) && !path.includes(item.panel)) close(item, true);
      });
    };
    document.addEventListener('click', this._docClickHandler);
    this._docKeydownHandler = (event) => {
      if (event.key === 'Escape') disclosures.forEach((item) => close(item, true));
    };
    document.addEventListener('keydown', this._docKeydownHandler);
    window.matchMedia(MOBILE_NAV_QUERY).addEventListener('change', () => {
      close(disclosures[1]);
    }, { signal });
  }

  _bindLogout() {
    const root = this.shadowRoot;
    const logout = root.getElementById('user-menu-logout');
    if (!logout) return;
    const signal = this._abortController && this._abortController.signal;
    logout.addEventListener('click', async () => {
      // ORDERING IS LOAD-BEARING (review #762): the event/redirect stay
      // AFTER the awaited revoke. supabase-js v2 signOut() calls the
      // network revoke BEFORE clearing the localStorage session — if we
      // dispatched av-chrome-signed-out first, the Next AuthProvider's
      // fail-closed redirect (profile → /login) would navigate away
      // mid-revoke, cancelling BOTH the revoke and the storage cleanup:
      // the next page load would restore the session and the logout would
      // silently undo itself.
      //
      // av-chrome-signing-out is NOT a sign-out announcement: it only tells
      // the AuthProvider that this user-initiated logout owns the final
      // navigation ('/'). Without it, SIGNED_OUT (fired inside signOut()) and
      // av-chrome-signed-out flip Next pages to signed-out, and their
      // fail-closed `location.replace('/login')` effect runs after — and
      // overrides — the `location.href = '/'` below.
      this.dispatchEvent(new CustomEvent('av-chrome-signing-out', {
        bubbles: true,
        composed: true,
      }));
      try {
        // U-21 — the menu is usable before the runtime adopts the client;
        // wait for it so an early click still revokes the session.
        const sb = await whenSupabase(LOGOUT_RUNTIME_WAIT_MS);
        if (sb && sb.auth && typeof sb.auth.signOut === 'function') {
          // U-07: record the session being ended BEFORE the revoke, so /login
          // does not boot it if this page dies mid-revoke.
          await rememberSignedOutSession(sb);
          // AUDIT F6 / review #762: v2 signOut() does NOT throw on a failed
          // revoke — it RESOLVES with { error }. Discarding it made a
          // still-valid refresh token look identical to a real sign-out.
          // The flow continues either way (fail-closed locally), but the
          // failure must reach the error dashboard.
          const result = await sb.auth.signOut();
          if (result && result.error) {
            console.error('Sign-out revoke failed:', result.error);
            try {
              window.aver && window.aver.reportError && window.aver.reportError(
                'signOut revoke failed: '
                  + (result.error.message || String(result.error)),
                { type: 'auth_signout_revoke_failed' },
              );
            } catch (e) { /* reporting must never block logout */ }
          }
        }
      } catch (err) {
        console.error('Sign-out failed:', err);
        try {
          window.aver && window.aver.reportError && window.aver.reportError(
            'signOut threw: ' + ((err && err.message) || String(err)),
            { type: 'auth_signout_revoke_failed' },
          );
        } catch (e) { /* reporting must never block logout */ }
      }
      // U-07: a failed revoke (signOut resolves { error }) leaves the session
      // persisted — possibly already revoked server-side. Fail closed locally
      // before announcing, so no page can boot it and send it to /auth/me.
      clearPersistedAuthSession();
      try { window.api && window.api.clearAuthCache && window.api.clearAuthCache(); } catch (e) { /* page is leaving */ }
      this.dispatchEvent(new CustomEvent('av-chrome-signed-out', {
        bubbles: true,
        composed: true,
      }));
      window.location.href = '/';
    }, signal ? { signal } : undefined);
  }

  // PC-J06 — setUser() owns the pill but not the role: since the chrome now
  // connects before the runtime, a page's setUser({name}) (e.g. /home) can
  // land before this path runs, and it must still resolve the /auth/me role
  // unless the page already supplied one.
  _pageOwnsUser() {
    return this._userOverride && this._role !== null;
  }

  _schedulePopulate() {
    if (this._pageOwnsUser()) return;
    this._pollTries = 0;
    const tick = async () => {
      this._pollTimer = null;
      if (this._pageOwnsUser()) return; // raced with setUser({role})
      if (!this.shadowRoot) return; // disconnected

      const sb = currentSupabase();

      if (!sb) {
        this._pollTries += 1;
        if (this._pollTries >= POLL_MAX_TRIES) {
          // U-21 — the runtime can take longer than the poll on slow mobile
          // now that the chrome does not wait for it; resume on its signal.
          if (!this._runtimeReadyHandler) {
            this._runtimeReadyHandler = () => {
              window.removeEventListener(RUNTIME_READY_EVENT, this._runtimeReadyHandler);
              this._runtimeReadyHandler = null;
              this._schedulePopulate();
            };
            window.addEventListener(RUNTIME_READY_EVENT, this._runtimeReadyHandler);
          }
          return;
        }
        this._pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }

      if (!sb.auth || typeof sb.auth.getSession !== 'function') return;

      let session = null;
      try {
        const result = await sb.auth.getSession();
        session = result && result.data && result.data.session;
      } catch (err) {
        console.warn('[aver-chrome] getSession failed:', err);
        return;
      }
      if (this._pageOwnsUser()) return; // raced
      if (!session || !session.user) return;

      this._applyVocabNav(true);   // B3 — logged in → Vocabulary nav → hub
      this._setAccountVisible(true);

      const meta = session.user.user_metadata || {};
      const email = session.user.email || '';
      const name = meta.display_name || meta.full_name || meta.name
        || (email.split('@')[0] || 'bạn');

      const pillEl = this.shadowRoot.getElementById('user-pill-name');
      const avatarEl = this.shadowRoot.getElementById('user-avatar');
      if (!this._userOverride && pillEl && pillEl.textContent === '…') {
        pillEl.textContent = name.length > 14 ? name.slice(0, 13) + '…' : name;
      }
      if (!this._userOverride && avatarEl && avatarEl.textContent === '·') {
        avatarEl.textContent = canonicalInitials(name);
      }

      // Fix-2 (D-B) — surface the instructor-area link via the authoritative
      // backend role. Logged-in only (we have a session here); fail-closed.
      await this._resolveRole(session.access_token);
    };
    // Start immediately — if getSupabase is already there we resolve
    // in the same tick. Otherwise the recursive tick polls.
    this._pollTimer = setTimeout(tick, 0);
  }
}


if (typeof customElements !== 'undefined' && !customElements.get('aver-chrome')) {
  customElements.define('aver-chrome', AverChrome);
}

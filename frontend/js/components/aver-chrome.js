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
 *     or shortly after this component connects. The component polls
 *     window.getSupabase for up to ~3s; if unavailable, the pill
 *     placeholder ("…" / "·") remains.
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


// ── Constants ──────────────────────────────────────────────────────


const VALID_ACTIVE = ['home', 'writing', 'speaking', 'grammar', 'vocabulary'];

// Supabase polling — ~3s ceiling matches Sprint 7.8-hotfix bootstrap
// pattern. 50ms tick × 60 tries.
const POLL_INTERVAL_MS = 50;
const POLL_MAX_TRIES = 60;


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

@media (max-width: 720px) {
  .topnav-wrap { padding: 0 var(--av-space-4); }
  .topnav { gap: var(--av-space-3); flex-wrap: wrap; margin-bottom: var(--av-space-8); }
  .nav-links { width: 100%; order: 3; overflow-x: auto; flex-wrap: nowrap; }
  .topnav-right { margin-left: auto; }
}
`;

const TEMPLATE = /* html */ `
<div class="topnav-wrap">
  <nav class="topnav" aria-label="Primary">
    <a href="/pages/home.html" class="brand">Aver<span class="dot">.</span>Learning</a>

    <div class="nav-links">
      <a href="/pages/home.html" data-tab="home">Trang chủ</a>
      <a href="/pages/writing-dashboard.html" data-tab="writing">Writing</a>
      <a href="/pages/speaking.html" data-tab="speaking">Speaking</a>
      <a href="/grammar.html" data-tab="grammar">Grammar</a>
      <a href="/pages/vocabulary.html" data-tab="vocabulary">Vocabulary</a>
      <span class="locked" aria-disabled="true">Reading</span>
      <span class="locked" aria-disabled="true">Listening</span>
    </div>

    <div class="topnav-right">
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
          <a href="/pages/profile.html" class="user-menu-item" role="menuitem">Hồ sơ</a>
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
  }

  connectedCallback() {
    if (this._mounted) return;
    this._mounted = true;

    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${STYLE}</style>${TEMPLATE}`;

    this._applyActive(this.getAttribute('active'));
    this._bindToggle();
    this._bindDropdown();
    this._bindLogout();
    this._schedulePopulate();
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
   * page-authoritative so the auto-fetch skips.
   */
  setUser({ name, initials, email } = {}) {
    this._userOverride = true;
    if (!this.shadowRoot) return; // mark only; render on connect

    const resolvedName = name || (email && email.split('@')[0]) || 'bạn';
    const resolvedInitials = initials || canonicalInitials(resolvedName);

    const pillEl = this.shadowRoot.getElementById('user-pill-name');
    const avatarEl = this.shadowRoot.getElementById('user-avatar');
    if (pillEl) pillEl.textContent = resolvedName.length > 14
      ? resolvedName.slice(0, 13) + '…' : resolvedName;
    if (avatarEl) avatarEl.textContent = resolvedInitials;
  }


  // ── Internal ───────────────────────────────────────────────────


  _applyActive(value) {
    const root = this.shadowRoot;
    if (!root) return;
    const links = root.querySelectorAll('.nav-links a[data-tab]');
    const target = VALID_ACTIVE.includes(value) ? value : null;
    links.forEach((a) => {
      if (target && a.dataset.tab === target) {
        a.classList.add('active');
      } else {
        a.classList.remove('active');
      }
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

    const close = () => {
      menu.setAttribute('hidden', '');
      toggle.setAttribute('aria-expanded', 'false');
    };
    const open = () => {
      menu.removeAttribute('hidden');
      toggle.setAttribute('aria-expanded', 'true');
    };
    const isOpen = () => !menu.hasAttribute('hidden');

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isOpen()) close(); else open();
    }, { signal });

    // Outside-click close. Composed events from inside the shadow root
    // surface on document with composedPath()[0] === shadow target;
    // we close when the click does NOT pass through this host element.
    this._docClickHandler = (e) => {
      if (!isOpen()) return;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (path.includes(this)) return;
      close();
    };
    document.addEventListener('click', this._docClickHandler);

    this._docKeydownHandler = (e) => {
      if (e.key === 'Escape' && isOpen()) {
        close();
        toggle.focus();
      }
    };
    document.addEventListener('keydown', this._docKeydownHandler);
  }

  _bindLogout() {
    const root = this.shadowRoot;
    const logout = root.getElementById('user-menu-logout');
    if (!logout) return;
    const signal = this._abortController && this._abortController.signal;
    logout.addEventListener('click', async () => {
      try {
        const sb = (typeof window !== 'undefined'
                    && typeof window.getSupabase === 'function')
                   ? window.getSupabase()
                   : null;
        if (sb && sb.auth && typeof sb.auth.signOut === 'function') {
          await sb.auth.signOut();
        }
      } catch (err) {
        console.error('Sign-out failed:', err);
      }
      this.dispatchEvent(new CustomEvent('av-chrome-signed-out', {
        bubbles: true,
        composed: true,
      }));
      window.location.href = '/index.html';
    }, signal ? { signal } : undefined);
  }

  _schedulePopulate() {
    if (this._userOverride) return;
    this._pollTries = 0;
    const tick = async () => {
      this._pollTimer = null;
      if (this._userOverride) return; // raced with setUser()
      if (!this.shadowRoot) return; // disconnected

      const sb = (typeof window !== 'undefined'
                  && typeof window.getSupabase === 'function')
                 ? window.getSupabase()
                 : null;

      if (!sb) {
        this._pollTries += 1;
        if (this._pollTries >= POLL_MAX_TRIES) {
          console.warn('[aver-chrome] window.getSupabase unavailable after polling; pill placeholder retained.');
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
      if (this._userOverride) return; // raced
      if (!session || !session.user) return;

      const meta = session.user.user_metadata || {};
      const email = session.user.email || '';
      const name = meta.display_name || meta.full_name || meta.name
        || (email.split('@')[0] || 'bạn');

      const pillEl = this.shadowRoot.getElementById('user-pill-name');
      const avatarEl = this.shadowRoot.getElementById('user-avatar');
      if (pillEl && pillEl.textContent === '…') {
        pillEl.textContent = name.length > 14 ? name.slice(0, 13) + '…' : name;
      }
      if (avatarEl && avatarEl.textContent === '·') {
        avatarEl.textContent = canonicalInitials(name);
      }
    };
    // Start immediately — if getSupabase is already there we resolve
    // in the same tick. Otherwise the recursive tick polls.
    this._pollTimer = setTimeout(tick, 0);
  }
}


if (typeof customElements !== 'undefined' && !customElements.get('aver-chrome')) {
  customElements.define('aver-chrome', AverChrome);
}

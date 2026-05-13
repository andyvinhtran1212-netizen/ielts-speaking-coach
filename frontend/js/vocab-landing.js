// js/vocab-landing.js — Sprint 6.0 unified vocabulary landing.
//
// Tab-switching + lazy iframe loading + URL-hash deep-linking for
// /pages/vocabulary.html. Distinct from /js/vocabulary.js (which
// powers the Vocabulary Wiki at /vocabulary.html and predates this
// sprint by a wide margin).
//
// Approach: each tab panel contains an <iframe> pointing at the
// existing standalone page (my-vocabulary.html, flashcards.html,
// exercises.html). The iframe `src` stays empty until the tab is
// first activated, at which point we set it. Subsequent visits to
// the same tab reuse the already-loaded iframe so its state — modal
// open, scroll position, in-flight fetches — survives tab switches.
//
// Why iframe instead of module extraction:
//   The existing pages are full self-contained surfaces (each owns
//   its auth bootstrap, Supabase init, Tailwind import, modal
//   lifecycle). Extracting them into reusable modules would touch
//   ~600 LOC and risk breaking production-stable pages for an
//   architectural win that doesn't unlock new product capability in
//   this sprint. Documented as a Sprint 6.0 deviation; revisited in
//   6.1+ when click-to-add introduces cross-tab state worth the
//   refactor.

(function () {
  'use strict';

  // Iframe path (Sprint 6.0 legacy) — preserved for tabs not yet
  // migrated to ES-module mount under DEBT-2026-05-09-B.
  const TAB_SOURCES = {
    'flashcards': '/pages/flashcards.html?embedded=1',
    'exercises':  '/pages/exercises.html?embedded=1',
    // 'topic-bank' has no src — it's a static placeholder panel.
  };

  // Sprint 7.3 — module path. Tabs in this map dynamic-import their
  // module and mount into `[data-panel="<tab>"] .tab-mount`, bypassing
  // the iframe path entirely. Phase-2..4 sprints (7.4 / 7.5) extend
  // this map as flashcards + exercises migrate.
  const TAB_LOADERS = {
    'my-vocab': () => import('/js/vocab-modules/my-vocab.js'),
  };

  const DEFAULT_TAB = 'my-vocab';
  const VALID_TABS = new Set([
    'my-vocab', 'flashcards', 'exercises', 'topic-bank',
  ]);

  // Track which tab panels have had their iframe `src` set so we don't
  // re-fetch on every tab click. (Module path tracks via container's
  // `data-mounted` attribute — see guardMount() in _loader.js.)
  const _loaded = new Set();

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

  function activateTab(tabName, { updateHash = true } = {}) {
    if (!VALID_TABS.has(tabName)) tabName = DEFAULT_TAB;

    $$('.vocab-tabs .tab').forEach(t => {
      const isActive = t.dataset.tab === tabName;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
      t.tabIndex = isActive ? 0 : -1;
    });
    $$('.tab-panel').forEach(panel => {
      const isTarget = panel.dataset.panel === tabName;
      panel.hidden = !isTarget;
    });

    // Sprint 7.3 — module path takes priority. If the tab has a
    // TAB_LOADERS entry, dynamic-import the module and mount it; iframe
    // path is bypassed for this tab. `data-mounted` on the container
    // is the idempotency guard (see vocab-modules/_loader.js).
    const loader = TAB_LOADERS[tabName];
    if (loader) {
      const container = document.querySelector(
        `[data-panel="${tabName}"] .tab-mount`,
      );
      if (container && container.dataset.mounted !== 'true') {
        // Render skeleton synchronously while import resolves.
        import('/js/vocab-modules/_loader.js').then(({ renderSkeleton, renderError }) => {
          renderSkeleton(container);
          loader().then((mod) => mod.mount(container, { embedded: true })).catch((err) => {
            console.error('[vocab-landing] module mount failed:', err);
            renderError(container, err, {
              onRetry: () => { container.innerHTML = ''; activateTab(tabName, { updateHash: false }); },
            });
          });
        }).catch((err) => {
          // _loader import itself failed — fall back to raw error text.
          console.error('[vocab-landing] loader helper import failed:', err);
          container.innerHTML = '<p style="text-align:center;padding:3rem;">Không tải được module. Vui lòng tải lại trang.</p>';
        });
      }
    } else {
      // Iframe path (Sprint 6.0 legacy) — preserved for unmigrated tabs.
      const src = TAB_SOURCES[tabName];
      if (src && !_loaded.has(tabName)) {
        const frame = document.querySelector(
          `[data-panel="${tabName}"] .tab-frame`,
        );
        if (frame) {
          frame.src = src;
          _loaded.add(tabName);
        }
      }
    }

    if (updateHash) {
      // history.replaceState avoids piling up nav history on every click.
      try {
        history.replaceState(null, '', '#' + tabName);
      } catch (e) {
        // `replaceState` can throw in sandboxed iframes — best-effort.
      }
    }
  }

  function setupTabs() {
    $$('.vocab-tabs .tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        if (tab.disabled) return;
        e.preventDefault();
        activateTab(tab.dataset.tab);
      });
      tab.addEventListener('keydown', (e) => {
        if (tab.disabled) return;
        // Left/Right arrow keys cycle through enabled tabs (a11y).
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const enabled = $$('.vocab-tabs .tab').filter(t => !t.disabled);
        const idx = enabled.indexOf(tab);
        if (idx < 0) return;
        const next = e.key === 'ArrowRight'
          ? enabled[(idx + 1) % enabled.length]
          : enabled[(idx - 1 + enabled.length) % enabled.length];
        next.focus();
        activateTab(next.dataset.tab);
      });
    });

    // hashchange wins if the user uses browser back/forward.
    window.addEventListener('hashchange', () => {
      const fromHash = (window.location.hash || '').slice(1);
      if (VALID_TABS.has(fromHash)) {
        activateTab(fromHash, { updateHash: false });
      }
    });
  }

  // ── Stats fetch ─────────────────────────────────────────────────
  async function loadStats() {
    if (!window.api) return;
    let data;
    try {
      data = await window.api.get('/api/student/home-summary');
    } catch (err) {
      console.warn('[vocab-landing] stats fetch failed:', err);
      return;
    }
    if (!data || !data.skills || !data.skills.vocabulary) return;
    const v = data.skills.vocabulary;

    const wordsEl = document.getElementById('stat-words-count');
    const dueEl   = document.getElementById('stat-flashcards-due');
    const stacksEl = document.getElementById('stat-stacks-count');

    if (wordsEl) wordsEl.textContent = String(v.words_learned || 0);
    if (dueEl)   dueEl.textContent   = String(v.flashcards_due || 0);
    // The stacks count isn't part of home-summary today; show "—" until
    // an aggregator endpoint exposes it. Anti-pattern #23 — don't add
    // a new endpoint just to fill one cosmetic stat.
    if (stacksEl) stacksEl.textContent = '—';
  }

  function bootstrap() {
    if (typeof window.api === 'undefined') {
      return setTimeout(bootstrap, 30);
    }
    setupTabs();
    const fromHash = (window.location.hash || '').slice(1);
    activateTab(VALID_TABS.has(fromHash) ? fromHash : DEFAULT_TAB,
      { updateHash: false });
    loadStats();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  // Test seam.
  window.__vocabLanding = {
    activateTab,
    DEFAULT_TAB,
    VALID_TABS: Array.from(VALID_TABS),
    TAB_LOADERS: Object.keys(TAB_LOADERS),
    TAB_SOURCES: Object.keys(TAB_SOURCES),
  };
})();

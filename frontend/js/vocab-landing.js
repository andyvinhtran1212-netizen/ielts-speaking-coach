// js/vocab-landing.js — vocabulary landing tab switcher.
//
// Tab-switching + URL-hash deep-linking for /pages/vocabulary.html.
// Distinct from /js/vocabulary.js (which powers the Vocabulary Wiki at
// /vocabulary.html and predates this sprint by a wide margin).
//
// Architecture (post DEBT-2026-05-09-B closure, Sprint 7.6):
//   Each vocab tab dynamic-imports its module from /js/vocab-modules/*
//   and mounts it into `[data-panel="<tab>"] .tab-mount`. The legacy
//   Sprint 6.0 iframe pattern was retired across Sprint 7.3 → 7.6;
//   embedded-mode.css and the per-page IIFE are gone.
//
// Sprint history (for context only — see PHASE_CLOSURE_LEDGER.md):
//   - Sprint 6.0  shipped iframe-mounted vocab tabs (deferred refactor)
//   - Sprint 7.3 / 7.4 / 7.5 migrated each child to an ES module
//   - Sprint 7.6 retired the iframe code path here + embedded-mode.css

(function () {
  'use strict';

  // Module-mount registry. Each entry dynamic-imports the named module
  // and the parent activateTab() calls mod.mount(container, { embedded: true }).
  // The container's `data-mounted` attribute is the idempotency guard
  // (see vocab-modules/_loader.js guardMount()).
  const TAB_LOADERS = {
    'my-vocab':   () => import('/js/vocab-modules/my-vocab.js'),
    'flashcards': () => import('/js/vocab-modules/flashcards.js'),
    'exercises':  () => import('/js/vocab-modules/exercises.js'),
  };

  const DEFAULT_TAB = 'my-vocab';
  const VALID_TABS = new Set([
    'my-vocab', 'flashcards', 'exercises', 'topic-bank',
  ]);

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

    // Dynamic-import the module for this tab and mount it. Tabs not in
    // TAB_LOADERS (currently only `topic-bank`, a static placeholder)
    // are pure CSS reveals — no module load needed.
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
  };
})();

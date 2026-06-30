// js/vocab-landing.js — vocabulary landing mode-card switcher.
//
// Mode-card click delegation + URL-hash deep-linking for
// /pages/vocabulary.html. Distinct from /js/vocabulary.js (which
// powers the Vocabulary Wiki at /vocabulary.html and predates this
// sprint by a wide margin).
//
// Architecture (post Sprint 8.2 IA refactor):
//   The ARIA tablist row was retired; the dashboard view (`.vocab-modes`
//   + 4 `.mode-card` anchors) is the page's default landing state.
//   Clicking a mode-card or visiting `#flashcards` (etc.) hides the
//   dashboard and activates the target `.tab-panel`. Each panel
//   dynamic-imports its module from /js/vocab-modules/* and mounts it
//   into `[data-panel="<mode>"] .tab-mount`. The legacy Sprint 6.0
//   iframe pattern was retired across Sprint 7.3 → 7.6.
//
// Sprint history (for context only — see PHASE_CLOSURE_LEDGER.md):
//   - Sprint 6.0  shipped iframe-mounted vocab tabs (deferred refactor)
//   - Sprint 7.3 / 7.4 / 7.5 migrated each child to an ES module
//   - Sprint 7.6 retired the iframe code path here + embedded-mode.css
//   - Sprint 8.2 retired the ARIA tablist row → mode-card grid;
//                bootstrap now defaults to the dashboard view (no hash)

(function () {
  'use strict';

  // Module-mount registry. Each entry dynamic-imports the named module
  // and the parent activateTab() calls mod.mount(container, { embedded: true }).
  // The container's `data-mounted` attribute is the idempotency guard
  // (see vocab-modules/_loader.js guardMount()).
  const TAB_LOADERS = {
    // Inline module — fetches /api/vocabulary/categories and renders a
    // topic-card grid. Each card links to /vocabulary.html?cat=<slug>
    // (the public wiki filtered to that topic). No separate file needed.
    'vocab-topics': () => Promise.resolve({
      mount(container) {
        if (container.dataset.mounted === 'true') return;
        if (container.dataset.loading === 'true') return;
        container.dataset.loading = 'true';
        window.api.get('/api/vocabulary/categories').then(function (cats) {
          cats = cats || [];
          if (!cats.length) {
            container.innerHTML = '<p style="text-align:center;padding:3rem;color:var(--av-text-faint)">Chưa có chủ đề nào.</p>';
            container.dataset.mounted = 'true';
            delete container.dataset.loading;
            return;
          }
          function esc(s) {
            return String(s == null ? '' : s)
              .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          }
          var cards = cats.map(function (c) {
            var n = c.article_count != null ? c.article_count : (c.articles || []).length;
            var slug = encodeURIComponent(c.slug);
            // Card carries explicit actions: "Khám phá" (browse the wiki),
            // "🃏 Flashcards" (study the stack), and "✍️ Luyện tập" (exercises —
            // shown only when the topic has enough words for a real MCQ).
            return '<div class="vocab-topic-card">'
              + '<div class="vtc-body">'
              + '<h3 class="vtc-title">' + esc(c.title || c.slug) + '</h3>'
              + '</div>'
              + '<div class="vtc-foot">'
              + '<span class="vtc-count">'
              + '<span class="vtc-num">' + n + '</span>'
              + '<span class="vtc-unit">từ vựng</span>'
              + '</span>'
              + '</div>'
              + '<div class="vtc-actions">'
              + '<a class="vtc-act vtc-act--browse" href="/vocabulary.html?cat=' + slug + '">Khám phá</a>'
              + '<a class="vtc-act vtc-act--study" href="/pages/flashcard-study.html?stack=wiki:' + slug + '">🃏 Flashcards</a>'
              // "✍️ Luyện tập" → straight into the adaptive Quick-Check player.
              // quiz.html?skill_area=vocab resolves the bank itself: one published
              // bank → starts immediately (no intermediate picker); 2+ → shows the
              // lesson picker so the student chooses. Lessons are their own taxonomy
              // (not the wiki categories), so the link is global — always shown.
              + '<a class="vtc-act vtc-act--ex" href="/pages/quiz.html?skill_area=vocab">✍️ Luyện tập</a>'
              + '</div>'
              + '</div>';
          }).join('');
          var header = '<div class="vtc-panel-head">'
            + '<h2 class="vtc-panel-title">Chủ đề từ vựng</h2>'
            + '<p class="vtc-panel-sub">Chọn chủ đề để khám phá từ vựng theo ngữ cảnh IELTS.</p>'
            // Progress lives here (entry on the Vocabulary page) rather than behind
            // the practice flow.
            + '<a class="vtc-progress-link" href="/pages/quiz-progress.html"'
            + ' style="display:inline-block;margin-top:var(--av-space-2);font-size:var(--av-fs-sm);'
            + 'font-weight:var(--av-fw-semibold);color:var(--av-primary);text-decoration:none;">'
            + '📊 Tiến độ luyện tập →</a>'
            + '</div>';
          container.innerHTML = header + '<div class="vocab-topics-grid">' + cards + '</div>';
          container.dataset.mounted = 'true';
          delete container.dataset.loading;
        }).catch(function () {
          container.innerHTML = '<p style="text-align:center;padding:3rem;color:var(--av-error,#c00)">Không tải được danh sách chủ đề.</p>';
          delete container.dataset.loading;
        });
      },
    }),
    'my-vocab':     () => import('/js/vocab-modules/my-vocab.js'),
    'flashcards':   () => import('/js/vocab-modules/flashcards.js'),
    'exercises':    () => import('/js/vocab-modules/exercises.js'),
    'needs-review': () => import('/js/vocab-modules/needs-review.js'),
  };

  // DEFAULT_TAB is the fall-back when activateTab() receives an unknown
  // mode name (e.g., a malformed deep-link hash). Sprint 8.2 — the
  // page-load default is the dashboard view itself, not any individual
  // panel; bootstrap() no longer auto-activates DEFAULT_TAB on cold
  // load. DEFAULT_TAB is kept solely for the unknown-mode fallback path.
  //
  // Sprint 10.1.5 — `needs-review` added (5th mode card). Surfaces
  // source_type='needs_review' items on a dedicated tab so they don't
  // pollute the main vocab bank (Sprint 6.0 archival reversed).
  const DEFAULT_TAB = 'my-vocab';
  const VALID_TABS = new Set([
    'vocab-topics', 'my-vocab', 'flashcards', 'exercises', 'needs-review',
  ]);

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

  function activateTab(tabName, { updateHash = true } = {}) {
    if (!VALID_TABS.has(tabName)) tabName = DEFAULT_TAB;

    // Hide the dashboard view + reveal the target panel.
    const dashboard = $('.vocab-modes');
    if (dashboard) dashboard.hidden = true;
    $$('.tab-panel').forEach(panel => {
      const isTarget = panel.dataset.panel === tabName;
      panel.hidden = !isTarget;
    });

    // Dynamic-import the module for this tab and mount it. All tabs in
    // VALID_TABS have a TAB_LOADERS entry; a tab without one would be a
    // pure CSS reveal (no such tab currently exists).
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
      // Sprint 9.2 — promote replaceState → pushState so each mode-card
      // click becomes a history entry. Browser back/forward then cycles
      // through visited modes (and back to the dashboard view when the
      // hash is empty — see showDashboard + hashchange below).
      try {
        history.pushState(null, '', '#' + tabName);
      } catch (e) {
        // pushState can throw in sandboxed iframes — best-effort.
      }
    }
  }

  // Sprint 9.2 — back-link target. Reverses activateTab(): re-reveal
  // the .vocab-modes dashboard + hide every panel. Called from the
  // hashchange listener when the URL has no recognised mode hash and
  // from each module's [data-action="back-to-dashboard"] click via
  // its programmatic history.pushState + hashchange dispatch.
  function showDashboard() {
    const dashboard = $('.vocab-modes');
    if (dashboard) dashboard.hidden = false;
    $$('.tab-panel').forEach(panel => { panel.hidden = true; });
  }

  function setupModeCards() {
    // Sprint 8.2 — click-delegation on .mode-card[data-mode] replaces
    // the tab-button click + ArrowLeft/ArrowRight cycle handler. The
    // mode-cards are <a href="#"> anchors; preventDefault keeps the
    // bare-fragment href from advancing the URL hash to "#" before
    // activateTab() writes the canonical hash via pushState.
    $$('.mode-card[data-mode]').forEach(card => {
      card.addEventListener('click', (e) => {
        e.preventDefault();
        activateTab(card.dataset.mode);
      });
    });

    // Sprint 9.2 — hashchange handles both directions:
    //   - hash matches a VALID_TAB → activate that panel
    //   - hash is empty / unknown → show the dashboard (the back-link
    //     and the browser Back button both land here once the user has
    //     navigated past a mode panel)
    window.addEventListener('hashchange', () => {
      const fromHash = (window.location.hash || '').slice(1);
      if (VALID_TABS.has(fromHash)) {
        activateTab(fromHash, { updateHash: false });
      } else {
        showDashboard();
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
    setupModeCards();
    // Sprint 8.2 — default landing state is the dashboard view (the
    // .vocab-modes section). Only activate a panel when the URL hash
    // explicitly requests one (e.g., vocabulary.html#flashcards from a
    // deep link or browser back/forward). Phase B Q5 — hash routing
    // preserved.
    const fromHash = (window.location.hash || '').slice(1);
    if (VALID_TABS.has(fromHash)) {
      activateTab(fromHash, { updateHash: false });
    }
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
    showDashboard,
    DEFAULT_TAB,
    VALID_TABS: Array.from(VALID_TABS),
    TAB_LOADERS: Object.keys(TAB_LOADERS),
  };
})();

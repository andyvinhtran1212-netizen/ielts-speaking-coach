/**
 * frontend/js/vocab-modules/exercises.js
 *
 * Sprint 7.5 — exercises drill-hub as a vocab-module. DEBT-2026-05-09-B
 * Phase 3/4 (final migration; Sprint 7.6 retires the iframe path + CSS).
 *
 *   mount(container, opts) → Promise<{ unmount }>
 *
 * Smallest of the three vocab modules. The exercises page is a drill-list
 * hub — 3 cards (D1 fill-blank, Flashcards, D3 speak-with-target) gated by
 * per-user feature flags from /auth/me. No interactive handlers, no
 * timers, no audio; cards are plain `<a href>` links to the actual drill
 * surfaces (which live on separate pages and are out of scope here).
 *
 * Card hrefs are absolute (`/pages/...`) per Sprint 6.15.8-hotfix lesson:
 * Vercel rewrites can resolve relative paths against the served URL
 * rather than the rewritten target, so absolute paths are resilient.
 *
 * Phase B contract (carried from Sprint 7.2):
 *   - Q1 event delegation — N/A here (no interactive handlers).
 *   - Q2 embedded → window.top.location.href for auth redirect.
 *   - Q3 idempotent mount via guardMount (data-mounted attribute).
 *
 * Cleanup: only the container + guard need clearing — no timers, no
 * listeners, no audio subscriptions to release.
 */

import { guardMount, redirectToLogin } from './_loader.js';


const HTML = /* html */ `
  <main class="max-w-3xl mx-auto px-4 pt-4 pb-8">

    <!-- Sprint 9.1 — .subpage-header primitive (components.css). The
         pre-9.1 .ex-header "context bar" was retired alongside the
         3x duplicated {prefix}-header rule sets. -->
    <header class="subpage-header mb-6">
      <div class="subpage-header__lhs">
        <p class="eyebrow" style="margin:0;">Vocabulary</p>
        <span class="subpage-header__sep">|</span>
        <h1 class="subpage-header__title">Exercises</h1>
      </div>
    </header>

    <div data-state="loading" class="text-center py-16 empty-state">
      <p class="text-sm">Loading…</p>
    </div>

    <div data-state="disabled" class="hidden text-center py-16 empty-state">
      <p class="text-lg font-medium mb-2">Exercises are not enabled</p>
      <p class="text-sm">This feature is rolling out. Check back soon.</p>
    </div>

    <div data-state="error" class="hidden text-center py-16 empty-state">
      <p class="text-sm">Could not load exercise hub. Please refresh.</p>
    </div>

    <div data-state="hub" class="hidden">
      <h2 class="ex-hub-title text-lg font-semibold mb-1">Pick a drill</h2>
      <p class="ex-hub-sub text-sm mb-6">Short, targeted vocab practice tied to your bank.</p>

      <!-- Sprint 9.1 — drill cards adopted .mode-card shared primitive
           (components.css). Inner-class skeleton matches Sprint 8.1 +
           8.2 pattern: .head > .icon + pill, h3, .lede. D3 "Speak with
           target" card retired per Phase D Q8 — it was a Coming-soon
           placeholder deferred to Phase E with no concrete ship plan. -->
      <div class="modes-grid">

        <!-- D1: Fill blank -->
        <a data-card="d1" href="/pages/d1-exercise.html" class="mode-card">
          <div class="head">
            <div class="icon"><i data-lucide="pencil"></i></div>
            <span class="ex-pill pill-live">Live</span>
          </div>
          <h3>Fill the blank</h3>
          <p class="lede">
            A short sentence with one word missing. Pick the word that fits.
          </p>
        </a>

        <!-- Flashcards (Phase D Wave 2) — gated on flashcard_enabled. -->
        <a data-card="flashcards" href="/pages/flashcards.html" class="mode-card hidden">
          <div class="head">
            <div class="icon"><i data-lucide="layers"></i></div>
            <span class="ex-pill pill-live">Live</span>
          </div>
          <h3>Flashcards</h3>
          <p class="lede">
            Ôn từ vựng cá nhân theo lịch tự động — thẻ nào sắp quên sẽ tự nổi lên trước.
          </p>
        </a>

      </div>
    </div>

  </main>
`;


export async function mount(container, opts = {}) {
  const { embedded = false } = opts;

  const guard = guardMount(container);
  if (guard.alreadyMounted) return guard.getHandle();

  const BASE = window.api && window.api.base;
  if (!BASE) {
    container.innerHTML =
      '<p style="text-align:center;padding:3rem;color:var(--av-text-muted);">' +
      'window.api not initialized — module cannot bootstrap.</p>';
    return { unmount: () => {} };
  }

  container.innerHTML = HTML;

  const $ = (sel) => container.querySelector(sel);

  function showState(name) {
    ['loading', 'disabled', 'error', 'hub'].forEach((s) => {
      const el = $(`[data-state="${s}"]`);
      if (el) el.classList.toggle('hidden', s !== name);
    });
  }

  async function init() {
    try {
      const sb = window.getSupabase ? window.getSupabase() : null;
      const { data } = sb ? await sb.auth.getSession() : { data: {} };
      const token = data?.session?.access_token;
      if (!token) { redirectToLogin({ embedded }); return; }

      const res = await fetch(`${BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { showState('disabled'); return; }
      const me = await res.json();

      // Sprint 9.1 — D3 "Speak with target" card retired; the `d3`
      // flag read + the disabled-branch `!d3` clause were dropped
      // alongside the markup. The drill hub now ships only D1 + the
      // gated Flashcards card.
      const d1 = me.d1_enabled === true;
      const flashcards = me.flashcard_enabled === true;

      if (!d1 && !flashcards) { showState('disabled'); return; }

      // Default-deny: REMOVE the D1 card from the DOM when its flag is off
      // (mirror anti-pattern alert from PHASE_D_V3_PLAN — feature flag must
      // remove DOM, not display:none).
      if (!d1) {
        const card = $('[data-card="d1"]');
        if (card && card.parentNode) card.parentNode.removeChild(card);
      }

      // Flashcards (Phase D Wave 2): unhide the card when the user's flag
      // is on; remove from DOM otherwise. Same default-deny pattern.
      const flashcardsCard = $('[data-card="flashcards"]');
      if (flashcards) {
        if (flashcardsCard) flashcardsCard.classList.remove('hidden');
      } else if (flashcardsCard && flashcardsCard.parentNode) {
        flashcardsCard.parentNode.removeChild(flashcardsCard);
      }

      showState('hub');
    } catch (err) {
      console.error('[exercises]', err);
      showState('error');
    }
  }

  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }

  init();

  function unmount() {
    container.innerHTML = '';
    guard.clearHandle();
  }

  const handle = { unmount };
  guard.setHandle(handle);
  return handle;
}

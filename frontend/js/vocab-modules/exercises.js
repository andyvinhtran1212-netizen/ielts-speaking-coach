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
  <!-- Page context bar (preserves page title). -->
  <header class="ex-header ex-context-bar px-6 py-4">
    <div class="max-w-3xl mx-auto flex items-center gap-4">
      <p class="eyebrow" style="margin:0;">Vocabulary</p>
      <span class="ex-header__sep">|</span>
      <h1 class="ex-header__title text-base font-semibold">Exercises</h1>
    </div>
  </header>

  <main class="max-w-3xl mx-auto px-4 pt-20 pb-8">

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

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">

        <!-- D1: Fill blank -->
        <a data-card="d1" href="/pages/d1-exercise.html" class="ex-card">
          <div class="flex items-start justify-between mb-3">
            <span class="text-2xl">📝</span>
            <span class="ex-pill pill-live">Live</span>
          </div>
          <h3 class="ex-card__title text-base font-semibold mb-1">Fill the blank</h3>
          <p class="ex-card__body text-sm">
            A short sentence with one word missing. Pick the word that fits.
          </p>
          <p class="ex-card__cta text-xs mt-3">Start →</p>
        </a>

        <!-- Flashcards (Phase D Wave 2) — gated on flashcard_enabled. -->
        <a data-card="flashcards" href="/pages/flashcards.html" class="ex-card hidden">
          <div class="flex items-start justify-between mb-3">
            <span class="text-2xl">📚</span>
            <span class="ex-pill pill-live">Live</span>
          </div>
          <h3 class="ex-card__title text-base font-semibold mb-1">Flashcards</h3>
          <p class="ex-card__body text-sm">
            Ôn từ vựng cá nhân theo lịch tự động — thẻ nào sắp quên sẽ tự nổi lên trước.
          </p>
          <p class="ex-card__cta text-xs mt-3">Start →</p>
        </a>

        <!-- D3: Speak with target — deferred to Phase E (was Wave 2 before pivot). -->
        <div data-card="d3" class="ex-card disabled" aria-disabled="true">
          <div class="flex items-start justify-between mb-3">
            <span class="text-2xl">🎙️</span>
            <span class="ex-pill pill-soon">Coming soon</span>
          </div>
          <h3 class="ex-card__title text-base font-semibold mb-1">Speak with target</h3>
          <p class="ex-card__body text-sm">
            Record a short answer that uses a target word from your bank.
          </p>
          <p class="ex-card__cta ex-card__cta--soon text-xs mt-3">Available in a future update</p>
        </div>

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

      const d1 = me.d1_enabled === true;
      const d3 = me.d3_enabled === true;
      const flashcards = me.flashcard_enabled === true;

      if (!d1 && !d3 && !flashcards) { showState('disabled'); return; }

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

      // D3 stays "Coming soon" — deferred to Phase E.

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

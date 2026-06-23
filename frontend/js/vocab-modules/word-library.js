/**
 * vocab-modules/word-library.js — VE4 "Từ vựng" tab (Probe-A).
 *
 * Re-surfaces the dormant content_vocab library (20 words / 6 categories) as a
 * word-card grid inside the vocabulary landing. One call to
 * GET /api/vocabulary/categories (embeds per-word summaries incl. VE1 gloss_vi)
 * → render category sections of mini-cards. Each card: headword + POS, IPA,
 * VN gloss, level, ▶ (speechSynthesis en-GB) and links to the existing
 * vocab-article.html?cat=&slug= detail page (NOT redesigned this slice).
 *
 * All API access via window.api (no raw fetch — base + the project convention).
 * No backend, no bucket, no migration. Styles are `.vc-*`-scoped + page-scoped
 * Google fonts (added in vocabulary.html) so nothing here restyles the
 * existing vocab landing.
 */

import { guardMount } from './_loader.js';

const CAT_ICON = {
  environment: '🌿', technology: '💡', education: '📖',
  'work-career': '💼', health: '🏃', 'people-society': '🌐',
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Pure: build a mini-card's HTML from a word summary. Exported for unit test.
export function renderCard(w) {
  const pos = w.part_of_speech ? `<span class="vc-pos">${esc(w.part_of_speech)}</span>` : '';
  const ipa = w.pronunciation ? `<div class="vc-ipa">${esc(w.pronunciation)}</div>` : '';
  const gloss = w.gloss_vi ? `<div class="vc-gloss">${esc(w.gloss_vi)}</div>` : '';
  const level = w.level ? `<span class="vc-level">${esc(w.level)}</span>` : '';
  const href = `/pages/vocab-article.html?cat=${encodeURIComponent(w.category)}&slug=${encodeURIComponent(w.slug)}`;
  return `<a class="vc-card" href="${href}">
    <div class="vc-card-head">
      <span class="vc-headword">${esc(w.headword)}</span>${pos}
    </div>
    ${ipa}${gloss}
    <div class="vc-card-foot">
      ${level}
      <button type="button" class="vc-play" data-hw="${esc(w.headword)}" aria-label="Phát âm ${esc(w.headword)}">▶</button>
    </div>
  </a>`;
}

// Pure: build the full grid (all category sections) from the categories feed.
export function renderGrid(categories) {
  const cats = (categories || []).filter((c) => (c.articles || []).length);
  if (!cats.length) {
    return '<p class="vc-empty">Chưa có từ vựng.</p>';
  }
  return cats.map((c) => {
    const icon = CAT_ICON[c.slug] || '📚';
    const cards = (c.articles || []).map(renderCard).join('');
    return `<section class="vc-cat">
      <h2 class="vc-cat-title">${icon} ${esc(c.title || c.slug)}</h2>
      <div class="vc-grid">${cards}</div>
    </section>`;
  }).join('');
}

function speak(headword) {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(headword);
    u.lang = 'en-GB';
    u.rate = 0.92;   // mirrors vocabulary.js pronunciation pacing
    window.speechSynthesis.speak(u);
  } catch (_) { /* audio is best-effort */ }
}

export async function mount(container, opts = {}) {
  const guard = guardMount(container);
  if (guard.alreadyMounted) return guard.getHandle();

  if (!(window.api && window.api.base)) {
    container.innerHTML = '<p class="vc-empty">window.api chưa sẵn sàng.</p>';
    return { unmount: () => {} };
  }

  container.innerHTML = '<p class="vc-empty">Đang tải từ vựng…</p>';
  let categories;
  try {
    categories = await window.api.get('/api/vocabulary/categories');
  } catch (err) {
    container.innerHTML = `<p class="vc-empty">Không tải được từ vựng: ${esc(err && err.message)}</p>`;
    return { unmount: () => {} };
  }

  container.innerHTML = `<div class="vc-root">${renderGrid(categories)}</div>`;

  // ▶ pronunciation — delegated; preventDefault so it doesn't follow the card link.
  const onClick = (e) => {
    const btn = e.target.closest('.vc-play');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    speak(btn.dataset.hw || '');
  };
  container.addEventListener('click', onClick);

  const handle = {
    unmount: () => {
      container.removeEventListener('click', onClick);
      try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) {}
      container.innerHTML = '';
      guard.clearHandle();
    },
  };
  guard.setHandle(handle);
  return handle;
}

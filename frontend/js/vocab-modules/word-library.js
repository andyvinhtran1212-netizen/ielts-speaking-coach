/**
 * vocab-modules/word-library.js — "Từ vựng" word-card grid.
 *
 * One call to GET /api/vocabulary/categories (embeds per-word summaries incl.
 * gloss_vi) → render category sections of mini-cards. Each card: headword + POS,
 * IPA, VN gloss, level, ▶ (speechSynthesis en-GB) and links to the existing
 * vocab-article.html?cat=&slug= detail page.
 *
 * Slice-B — with the category-runtime (>30 topics), the plain vertical scroll of
 * every section got too long, so this adds a CLIENT-SIDE toolbar:
 *   • a search box (debounced) matching headword + VN gloss within the current
 *     scope → a flat result grid with a count;
 *   • a horizontal-scrolling chip row to filter the grid to one category.
 * All data is already loaded by the single /categories call, so search + filter
 * are 0 extra API calls (no /search round-trip).
 *
 * All API access via window.api (no raw fetch). Styles are `.vc-*`-scoped.
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

// Pure: flatten the categories feed into one word list (each summary already
// carries its category slug). Exported for unit test.
export function flattenWords(categories) {
  return (categories || []).flatMap((c) => c.articles || []);
}

// Pure: filter a flat word list by category (slug; '' = all) + query (matches
// headword OR VN gloss, case-insensitive). Exported for unit test.
export function filterWords(words, query, category) {
  const q = String(query || '').trim().toLowerCase();
  let out = words || [];
  if (category) out = out.filter((w) => w.category === category);
  if (q) {
    out = out.filter((w) =>
      String(w.headword || '').toLowerCase().includes(q) ||
      String(w.gloss_vi || '').toLowerCase().includes(q));
  }
  return out;
}

// Pure: the chip row (horizontal scroll). First chip = "Tất cả"; one per
// category with a count. `active` is the selected slug ('' = all).
export function renderChips(categories, active) {
  const total = (categories || []).reduce(
    (n, c) => n + (c.article_count != null ? c.article_count : (c.articles || []).length), 0);
  const chip = (slug, label, count, isActive) =>
    `<button type="button" role="tab" aria-selected="${isActive}"
       class="vc-chip${isActive ? ' is-active' : ''}" data-cat="${esc(slug)}">${esc(label)}
       <span class="vc-chip-n">${count}</span></button>`;
  const all = chip('', 'Tất cả', total, !active);
  const rest = (categories || [])
    .filter((c) => (c.article_count != null ? c.article_count : (c.articles || []).length))
    .map((c) => {
      const count = c.article_count != null ? c.article_count : (c.articles || []).length;
      return chip(c.slug, c.title || c.slug, count, active === c.slug);
    }).join('');
  return `<div class="vc-chips" role="tablist" aria-label="Lọc theo chủ đề">${all}${rest}</div>`;
}

// Pure: the empty state when a search matches nothing — an invitation, not a void.
export function renderEmpty(query) {
  return `<div class="vc-empty">
    <p class="vc-empty-title">Không tìm thấy từ nào cho “${esc(query)}”.</p>
    <p class="vc-empty-hint">Thử từ khóa khác, hoặc bỏ lọc chủ đề để tìm trong tất cả.</p>
  </div>`;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
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

function cancelSpeech() {
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) {}
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

  const state = {
    categories: categories || [],
    words: flattenWords(categories),
    cat: '',       // '' = Tất cả
    query: '',
  };

  container.innerHTML = `<div class="vc-root">
    <div class="vc-toolbar">
      <div class="vc-search-wrap">
        <input type="search" class="vc-search" placeholder="Tìm từ vựng…"
               aria-label="Tìm từ vựng theo từ hoặc nghĩa" autocomplete="off" />
        <button type="button" class="vc-search-clear" aria-label="Xóa tìm kiếm" hidden>×</button>
      </div>
      ${renderChips(state.categories, state.cat)}
    </div>
    <div class="vc-results" aria-live="polite"></div>
  </div>`;

  const resultsEl = container.querySelector('.vc-results');
  const searchEl = container.querySelector('.vc-search');
  const clearEl = container.querySelector('.vc-search-clear');

  // Render the results region for the current (query, scope). A non-empty query
  // → flat result grid + count (or empty state); empty query → section view,
  // scoped to the selected chip.
  function renderResults() {
    cancelSpeech();   // a scope/search change cancels any in-flight pronunciation
    const q = state.query.trim();
    if (q) {
      const hits = filterWords(state.words, q, state.cat);
      resultsEl.innerHTML = hits.length
        ? `<p class="vc-count">${hits.length} kết quả</p>
           <div class="vc-grid">${hits.map(renderCard).join('')}</div>`
        : renderEmpty(q);
      return;
    }
    const cats = state.cat
      ? state.categories.filter((c) => c.slug === state.cat)
      : state.categories;
    resultsEl.innerHTML = renderGrid(cats);
  }
  renderResults();

  const onSearch = debounce(() => {
    state.query = searchEl.value || '';
    clearEl.hidden = !state.query;
    renderResults();
  }, 200);
  searchEl.addEventListener('input', onSearch);

  // Delegated clicks: ▶ pronunciation, chip filter, and clear button.
  const onClick = (e) => {
    const play = e.target.closest('.vc-play');
    if (play) { e.preventDefault(); e.stopPropagation(); speak(play.dataset.hw || ''); return; }

    const chip = e.target.closest('.vc-chip');
    if (chip) {
      state.cat = chip.dataset.cat || '';
      container.querySelectorAll('.vc-chip').forEach((c) => {
        const on = (c.dataset.cat || '') === state.cat;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-selected', String(on));
      });
      chip.scrollIntoView({ block: 'nearest', inline: 'center' });
      renderResults();
      return;
    }

    if (e.target.closest('.vc-search-clear')) {
      searchEl.value = '';
      state.query = '';
      clearEl.hidden = true;
      renderResults();
      searchEl.focus();
    }
  };
  container.addEventListener('click', onClick);

  const handle = {
    unmount: () => {
      container.removeEventListener('click', onClick);
      searchEl.removeEventListener('input', onSearch);
      cancelSpeech();
      container.innerHTML = '';
      guard.clearHandle();
    },
  };
  guard.setHandle(handle);
  return handle;
}

/**
 * vocabulary.js — Vocabulary Wiki logic
 *
 * Handles both vocabulary.html (landing + search) and
 * pages/vocab-article.html (article detail + TTS + analytics).
 */

(function () {
  // ── Resolve API base (reuses api.js pattern) ─────────────────────────────
  const BASE = window.api ? window.api.base : (() => {
    const h = location.hostname;
    return (h === 'localhost' || h === '127.0.0.1')
      ? 'http://localhost:8000'
      : 'https://ielts-speaking-coach-production.up.railway.app';
  })();

  // ── Category icon map ────────────────────────────────────────────────────
  const CAT_ICONS = {
    'environment':   '🌿',
    'technology':    '💡',
    'education':     '📖',
    'work-career':   '💼',
    'health':        '🏃',
    'people-society':'🌐',
  };

  // ── Detect which page we're on ───────────────────────────────────────────
  const isArticlePage = document.getElementById('article-content') !== null;

  if (isArticlePage) {
    initArticlePage();
  } else {
    initLandingPage();
  }

  // ════════════════════════════════════════════════════════════════════════
  // LANDING PAGE
  // ════════════════════════════════════════════════════════════════════════

  function initLandingPage() {
    loadCategories();

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      let debounceTimer;
      searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => handleSearch(searchInput.value.trim()), 200);
      });
    }
  }

  async function loadCategories() {
    const grid = document.getElementById('category-grid');
    const errorEl = document.getElementById('error-state');
    if (!grid) return;

    try {
      const res = await fetch(`${BASE}/api/vocabulary/categories`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const categories = await res.json();
      renderCategories(categories);
    } catch (err) {
      console.error('[vocab] loadCategories failed:', err);
      grid.innerHTML = '';
      if (errorEl) errorEl.classList.remove('hidden');
    }
  }

  function renderCategories(categories) {
    const grid = document.getElementById('category-grid');
    if (!grid) return;

    if (!categories.length) {
      grid.innerHTML = '<p class="text-white/40 text-sm col-span-3 py-8 text-center">Chưa có chủ đề nào.</p>';
      return;
    }

    grid.innerHTML = categories.map(cat => {
      const icon = CAT_ICONS[cat.slug] || '📚';
      const words = (cat.articles || []).slice(0, 4).map(a => a.headword).join(', ');
      return `
        <div class="cat-card bg-white/[0.03] border border-white/[0.07] rounded-xl p-5"
             onclick="window.location.href='vocabulary.html?cat=${cat.slug}'"
             role="button" tabindex="0"
             onkeydown="if(event.key==='Enter')window.location.href='vocabulary.html?cat=${cat.slug}'">
          <div class="flex items-start justify-between mb-3">
            <span class="text-2xl">${icon}</span>
            <span class="text-xs font-semibold text-teal-light/70 bg-teal/10 border border-teal/20 rounded-full px-2 py-0.5">
              ${cat.article_count} từ
            </span>
          </div>
          <h3 class="text-white font-semibold text-base mb-1">${escHtml(cat.title)}</h3>
          <p class="text-white/40 text-xs mb-3 leading-relaxed">${escHtml(cat.description || '')}</p>
          <p class="text-white/30 text-xs truncate">${escHtml(words)}</p>
        </div>`;
    }).join('');

    // If a ?cat= param is present, show that category's articles
    const params = new URLSearchParams(location.search);
    const catParam = params.get('cat');
    if (catParam) {
      const catData = categories.find(c => c.slug === catParam);
      if (catData) showCategoryArticles(catData);
    }
  }

  function showCategoryArticles(cat) {
    const section = document.getElementById('search-section');
    const resultsEl = document.getElementById('search-results');
    const emptyEl = document.getElementById('search-empty');
    const head = document.getElementById('cat-section-head');
    if (!section || !resultsEl) return;

    section.classList.remove('hidden');
    section.querySelector('.section-head').textContent = cat.title;

    if (head) head.textContent = 'Tất cả chủ đề';

    const arts = cat.articles || [];
    if (!arts.length) {
      emptyEl && emptyEl.classList.remove('hidden');
      resultsEl.innerHTML = '';
      return;
    }

    emptyEl && emptyEl.classList.add('hidden');
    resultsEl.innerHTML = arts.map(a => wordCard(a)).join('');
  }

  // Search ─────────────────────────────────────────────────────────────────

  async function handleSearch(q) {
    const section = document.getElementById('search-section');
    const resultsEl = document.getElementById('search-results');
    const emptyEl = document.getElementById('search-empty');
    if (!section || !resultsEl) return;

    if (!q) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    section.querySelector('.section-head').textContent = 'Kết quả tìm kiếm';

    try {
      const res = await fetch(`${BASE}/api/vocabulary/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const results = await res.json();

      if (!results.length) {
        resultsEl.innerHTML = '';
        emptyEl && emptyEl.classList.remove('hidden');
      } else {
        emptyEl && emptyEl.classList.add('hidden');
        resultsEl.innerHTML = results.map(r => wordCard(r)).join('');
      }
    } catch (err) {
      console.error('[vocab] search failed:', err);
    }
  }

  function wordCard(a) {
    return `
      <a href="pages/vocab-article.html?cat=${encodeURIComponent(a.category)}&slug=${encodeURIComponent(a.slug)}"
         class="word-card block bg-white/[0.03] border border-white/[0.07] rounded-xl p-4 no-underline hover:no-underline">
        <div class="flex items-center justify-between mb-1">
          <span class="text-white font-semibold text-base">${escHtml(a.headword)}</span>
          ${a.level ? `<span class="text-xs text-amber-300/60 bg-amber-300/10 border border-amber-300/15 rounded-full px-2 py-0.5">${escHtml(a.level)}</span>` : ''}
        </div>
        <div class="flex items-center gap-2">
          <span class="text-white/35 text-xs">${escHtml(a.part_of_speech || '')}</span>
          ${a.pronunciation ? `<span class="text-teal-light/60 text-xs font-mono">${escHtml(a.pronunciation)}</span>` : ''}
        </div>
      </a>`;
  }

  // ════════════════════════════════════════════════════════════════════════
  // ARTICLE PAGE
  // ════════════════════════════════════════════════════════════════════════

  let _currentHeadword = '';

  async function initArticlePage() {
    const params = new URLSearchParams(location.search);
    const cat  = params.get('cat');
    const slug = params.get('slug');

    if (!cat || !slug) {
      showError();
      return;
    }

    try {
      const res = await fetch(`${BASE}/api/vocabulary/articles/${encodeURIComponent(cat)}/${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const article = await res.json();
      renderArticle(article);
      fireAnalytics(slug, cat);
    } catch (err) {
      console.error('[vocab] load article failed:', err);
      showError();
    }
  }

  function renderArticle(a) {
    document.title = `${a.headword} — Vocabulary Wiki`;

    const breadcrumb = document.getElementById('nav-breadcrumb');
    if (breadcrumb) breadcrumb.textContent = a.headword;

    _currentHeadword = a.headword;

    setEl('headword', a.headword);
    setEl('pronunciation', a.pronunciation || '');
    setEl('meta-level', a.level || '');
    setEl('meta-pos', a.part_of_speech || '');

    const catEl = document.getElementById('meta-category');
    if (catEl) {
      catEl.textContent = a.category.replace('-', ' & ').replace(/\b\w/g, c => c.toUpperCase());
    }

    const bodyEl = document.getElementById('article-body');
    if (bodyEl) bodyEl.innerHTML = a.html || '';

    // Synonyms
    renderChips('synonyms-box', 'synonyms-list', a.synonyms || []);
    // Antonyms
    renderChips('antonyms-box', 'antonyms-list', a.antonyms || [], 'border-red-400/20 text-red-400/70 bg-red-400/5');
    // Collocations
    renderCollocations('collocations-box', 'collocations-list', a.collocations || []);
    // Related words
    renderRelated('related-box', 'related-list', a.related_words || [], a.category);

    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('article-content').classList.remove('hidden');
  }

  function renderChips(boxId, listId, items, chipClass = '') {
    const box = document.getElementById(boxId);
    const list = document.getElementById(listId);
    if (!box || !list || !items.length) return;
    box.classList.remove('hidden');
    list.innerHTML = items.map(t =>
      `<span class="tag-chip ${chipClass}">${escHtml(t)}</span>`
    ).join('');
  }

  function renderCollocations(boxId, listId, items) {
    const box = document.getElementById(boxId);
    const list = document.getElementById(listId);
    if (!box || !list || !items.length) return;
    box.classList.remove('hidden');
    list.innerHTML = items.map(c =>
      `<div class="text-white/50 text-xs py-1 border-b border-white/5">${escHtml(c)}</div>`
    ).join('');
  }

  function renderRelated(boxId, listId, items, currentCat) {
    const box = document.getElementById(boxId);
    const list = document.getElementById(listId);
    if (!box || !list) return;

    // items may be resolved objects {slug, headword, category} or raw strings
    const resolved = items.filter(i => typeof i === 'object' && i.slug && i.headword);
    if (!resolved.length) return;

    box.classList.remove('hidden');
    list.innerHTML = resolved.map(r =>
      `<a href="vocab-article.html?cat=${encodeURIComponent(r.category)}&slug=${encodeURIComponent(r.slug)}"
          class="related-card">
        <span class="text-white/80 text-sm font-medium">${escHtml(r.headword)}</span>
      </a>`
    ).join('');
  }

  function showError() {
    const loading = document.getElementById('loading-state');
    const error   = document.getElementById('error-state');
    if (loading) loading.style.display = 'none';
    if (error) error.classList.remove('hidden');
  }

  function setEl(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // Expose retry handler for inline onclick in vocabulary.html
  window.loadCategories = loadCategories;

  // ── TTS ──────────────────────────────────────────────────────────────────
  window.speakHeadword = function () {
    if (!_currentHeadword || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(_currentHeadword);
    utt.lang = 'en-US';
    utt.rate = 0.9;

    const btn = document.getElementById('tts-btn');
    if (btn) btn.classList.add('speaking');
    utt.onend = () => btn && btn.classList.remove('speaking');
    utt.onerror = () => btn && btn.classList.remove('speaking');

    window.speechSynthesis.speak(utt);
  };

  // ── Analytics ────────────────────────────────────────────────────────────
  async function fireAnalytics(slug, category) {
    try {
      let sessionId = sessionStorage.getItem('vocab_session_id');
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        sessionStorage.setItem('vocab_session_id', sessionId);
      }

      await fetch(`${BASE}/api/analytics/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_name: 'vocab_wiki_viewed',
          event_data: { slug, category },
          session_id: sessionId,
        }),
      });
    } catch (_) {
      // Analytics failures must never block content rendering
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();

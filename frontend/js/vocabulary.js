/**
 * vocabulary.js — Vocabulary Wiki logic (word-card design v2).
 *
 * Drives both the wiki landing (root vocabulary.html — categories + search) and
 * the per-word article (pages/vocab-article.html — the v2 detail card). Both now
 * sit under <aver-chrome> and render with `.va-*` markup styled by
 * css/vocab-wiki.css (theme-aware --av-* tokens). All data via window.api.base.
 *
 * Audio: ▶ buttons carry data-audio (pregenerated mp3 from Slice-2) + data-say
 * (fallback text). A single delegated handler prefers the mp3, else speechSynthesis.
 */

(function () {
  const BASE = window.api.base;

  const CAT_ICONS = {
    'environment': '🌿', 'technology': '💡', 'education': '📖',
    'work-career': '💼', 'health': '🏃', 'people-society': '🌐',
  };

  const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function prettyCat(slug) {
    return String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  // ▶ button: prefers pregenerated audio (data-audio), falls back to data-say.
  function playBtn(audioUrl, say, extraCls) {
    return `<button type="button" class="va-play ${extraCls || ''}"
      data-audio="${esc(audioUrl || '')}" data-say="${esc(say || '')}"
      aria-label="Nghe ${esc(say || '')}">${PLAY_SVG}</button>`;
  }

  const isArticlePage = document.getElementById('article-content') !== null;
  if (isArticlePage) initArticlePage(); else initLandingPage();

  // ════════════════════════════ LANDING ════════════════════════════

  function initLandingPage() {
    loadCategories();
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      let t;
      searchInput.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => handleSearch(searchInput.value.trim()), 200);
      });
    }
  }

  window.loadCategories = async function loadCategories() {
    const grid = document.getElementById('category-grid');
    const errorEl = document.getElementById('error-state');
    if (!grid) return;
    if (errorEl) errorEl.classList.add('hidden');
    try {
      const res = await fetch(`${BASE}/api/vocabulary/categories`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      renderCategories(await res.json());
    } catch (err) {
      console.error('[vocab] loadCategories failed:', err);
      grid.innerHTML = '';
      if (errorEl) errorEl.classList.remove('hidden');
    }
  };

  function renderCategories(categories) {
    const grid = document.getElementById('category-grid');
    if (!grid) return;
    const cats = (categories || []).filter(c => (c.article_count || (c.articles || []).length));
    if (!cats.length) {
      grid.innerHTML = '<p class="va-empty">Chưa có chủ đề nào.</p>';
      return;
    }
    grid.innerHTML = cats.map(cat => {
      const icon = CAT_ICONS[cat.slug] || '📚';
      const words = (cat.articles || []).slice(0, 4).map(a => a.headword).join(' · ');
      const count = cat.article_count != null ? cat.article_count : (cat.articles || []).length;
      return `<a class="va-cat-card" href="/vocabulary.html?cat=${encodeURIComponent(cat.slug)}">
        <div class="va-cat-top">
          <span class="va-cat-icon">${icon}</span>
          <span class="va-cat-count">${count} từ</span>
        </div>
        <h3 class="va-cat-title">${esc(cat.title || cat.slug)}</h3>
        ${cat.description ? `<p class="va-cat-desc">${esc(cat.description)}</p>` : ''}
        ${words ? `<p class="va-cat-words">${esc(words)}</p>` : ''}
      </a>`;
    }).join('');

    const catParam = new URLSearchParams(location.search).get('cat');
    if (catParam) {
      const catData = cats.find(c => c.slug === catParam);
      if (catData) showCategoryArticles(catData);
    }
  }

  function showCategoryArticles(cat) {
    const section = document.getElementById('search-section');
    const resultsEl = document.getElementById('search-results');
    const emptyEl = document.getElementById('search-empty');
    const label = document.getElementById('results-label');
    if (!section || !resultsEl) return;
    section.classList.remove('hidden');
    if (label) label.textContent = cat.title || cat.slug;
    const arts = cat.articles || [];
    if (!arts.length) { emptyEl && emptyEl.classList.remove('hidden'); resultsEl.innerHTML = ''; return; }
    emptyEl && emptyEl.classList.add('hidden');
    resultsEl.innerHTML = arts.map(miniCard).join('');
  }

  async function handleSearch(q) {
    const section = document.getElementById('search-section');
    const resultsEl = document.getElementById('search-results');
    const emptyEl = document.getElementById('search-empty');
    const label = document.getElementById('results-label');
    if (!section || !resultsEl) return;
    if (!q) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    if (label) label.textContent = 'Kết quả tìm kiếm';
    try {
      const res = await fetch(`${BASE}/api/vocabulary/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const results = await res.json();
      if (!results.length) {
        resultsEl.innerHTML = '';
        emptyEl && emptyEl.classList.remove('hidden');
      } else {
        emptyEl && emptyEl.classList.add('hidden');
        resultsEl.innerHTML = results.map(miniCard).join('');
      }
    } catch (err) { console.error('[vocab] search failed:', err); }
  }

  // v2 mini-card. Rich in category view (full summary); sparse for /search
  // (headword/slug/category only) — optional fields just don't render.
  function miniCard(a) {
    const href = `/pages/vocab-article.html?cat=${encodeURIComponent(a.category)}&slug=${encodeURIComponent(a.slug)}`;
    const nColl = a.n_collocations || 0;
    return `<a class="va-mini" href="${href}">
      <div class="va-mini-top">
        <div>
          <h3 class="va-mini-word">${esc(a.headword)}</h3>
          ${a.part_of_speech ? `<div class="va-mini-pos">${esc(a.part_of_speech)}</div>` : ''}
        </div>
        ${playBtn(a.audio_headword, a.headword, 'va-small')}
      </div>
      ${a.pronunciation ? `<div class="va-mini-ipa">${esc(a.pronunciation)}</div>` : ''}
      ${a.gloss_vi ? `<p class="va-mini-vi">${esc(a.gloss_vi)}</p>` : ''}
      <div class="va-mini-foot">
        <span class="va-mini-lvl">${esc(a.level || '')}</span>
        ${nColl ? `<span class="va-mini-lvl j">${nColl} collocations</span>` : ''}
      </div>
    </a>`;
  }

  // ════════════════════════════ ARTICLE ════════════════════════════

  function initArticlePage() {
    const params = new URLSearchParams(location.search);
    const cat = params.get('cat'), slug = params.get('slug');
    if (!cat || !slug) { showArticleError(); return; }
    loadArticle(cat, slug);
  }

  async function loadArticle(cat, slug) {
    try {
      const res = await fetch(`${BASE}/api/vocabulary/articles/${encodeURIComponent(cat)}/${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      renderArticle(await res.json());
      fireAnalytics(slug, cat);
    } catch (err) {
      console.error('[vocab] load article failed:', err);
      showArticleError();
    }
  }

  function showArticleError() {
    const loading = document.getElementById('loading-state');
    const error = document.getElementById('error-state');
    if (loading) loading.style.display = 'none';
    if (error) error.classList.remove('hidden');
  }

  // IPA → stress specimen: split on '.' syllable separators; the chunk carrying
  // the primary-stress mark (ˈ) is enlarged + teal. Degrades to nothing when the
  // IPA has no stress mark (renders plain IPA only).
  function stressSpecimen(ipa) {
    const raw = String(ipa || '').replace(/^\/|\/$/g, '').trim();
    if (!raw || raw.indexOf('ˈ') === -1) return '';
    const sylls = raw.split('.').filter(Boolean);
    if (sylls.length < 2) return '';
    let onIdx = -1;
    const cells = sylls.map((s, i) => {
      const on = s.indexOf('ˈ') !== -1;
      if (on) onIdx = i;
      return { text: s.replace(/ˈ|ˌ/g, ''), on };
    });
    const html = cells.map(c => `<span class="va-syl${c.on ? ' on' : ''}">${esc(c.text)}</span>`).join('');
    const tag = onIdx >= 0 ? `<span class="va-stress-tag">trọng âm ${onIdx + 1}</span>` : '';
    return `<div class="va-stress" aria-hidden="true">${html}${tag}</div>`;
  }

  function chips(items) {
    return (items || []).map(c => `<span class="va-chip">${esc(c)}</span>`).join('');
  }
  function netRow(label, items) {
    const vals = (items || []).map(x => (x && typeof x === 'object') ? x.headword : x).filter(Boolean);
    if (!vals.length) return '';
    const dd = vals.map(v => `<b>${esc(v)}</b>`).join('<span class="va-sep">·</span>');
    return `<dt>${esc(label)}</dt><dd>${dd}</dd>`;
  }
  // highlight the headword inside the example sentence
  function highlightExample(example, headword) {
    const safe = esc(example);
    if (!headword) return safe;
    const re = new RegExp('(' + headword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    return safe.replace(re, '<span class="va-w">$1</span>');
  }

  function renderArticle(a) {
    document.title = `${a.headword} — Vocabulary Wiki`;
    const crumb = document.getElementById('nav-breadcrumb');
    if (crumb) crumb.textContent = a.headword;

    const pad = [];
    // 1) head
    pad.push(`<div class="va-pad">
      <div class="va-eyebrow-row">
        <span class="va-eyebrow">${esc(prettyCat(a.category))}</span>
        ${a.level ? `<span class="va-pill">${esc(a.level)}</span>` : ''}
      </div>
      <div class="va-head">
        <h2 class="va-headword">${esc(a.headword)}</h2>
        ${playBtn(a.audio_headword, a.headword, '')}
      </div>
      ${a.pronunciation ? `<p class="va-ipa">${esc(a.pronunciation)}${a.part_of_speech ? ` <span class="va-pos">· ${esc(a.part_of_speech)}</span>` : ''}</p>` : ''}
      ${stressSpecimen(a.pronunciation)}
    </div>`);

    // 2) definitions
    if (a.definition_en || a.gloss_vi) {
      pad.push('<div class="va-rule"></div><div class="va-pad">'
        + (a.definition_en ? `<p class="va-def-en">${esc(a.definition_en)}</p>` : '')
        + (a.gloss_vi ? `<p class="va-def-vi">${esc(a.gloss_vi)}</p>` : '')
        + '</div>');
    }

    // 3) usage — example + collocations
    if (a.example || (a.collocations && a.collocations.length)) {
      pad.push('<div class="va-rule"></div><div class="va-pad">'
        + (a.example
            ? `<div class="va-use-head"><span class="va-eyebrow">Dùng khi nói</span>${playBtn(a.audio_example, a.example, 'va-small va-ghost')}</div>
               <p class="va-example">“${highlightExample(a.example, a.headword)}”</p>`
            : '')
        + (a.collocations && a.collocations.length ? `<div class="va-colloc">${chips(a.collocations)}</div>` : '')
        + '</div>');
    }

    // 4) word network
    const net = netRow('Đồng nghĩa', a.synonyms) + netRow('Trái nghĩa', a.antonyms) + netRow('Họ từ', a.related_words);
    if (net) pad.push(`<div class="va-rule"></div><div class="va-pad"><dl class="va-net">${net}</dl></div>`);

    // 5) callouts
    if (a.common_error || a.memory_hook) {
      let c = '<div class="va-rule"></div><div class="va-pad">';
      if (a.common_error) {
        c += `<div class="va-callout va-warn"><svg class="va-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg><div><span class="va-t">Hay nhầm</span>${esc(a.common_error)}</div></div>`;
      }
      if (a.memory_hook) {
        c += `<div class="va-callout va-hook"><svg class="va-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.5.4.8 1 .9 1.6l.1.7h6l.1-.7c.1-.6.4-1.2.9-1.6A7 7 0 0 0 12 2z"/></svg><div><span class="va-t">Mẹo nhớ</span>${esc(a.memory_hook)}</div></div>`;
      }
      c += '</div>';
      pad.push(c);
    }

    // 6) foot — register / source
    if (a.register || a.source) {
      const bits = [];
      if (a.register) bits.push(`register <b>${esc(a.register)}</b>`);
      if (a.source) bits.push(`nguồn <b>${esc(a.source)}</b>`);
      pad.push(`<div class="va-rule"></div><div class="va-pad va-foot"><span class="va-trace">${bits.join(' · ')}</span></div>`);
    }

    const card = `<div class="va-card va-detail va-reveal">${pad.join('')}</div>`;
    // Keep the markdown body (the 20 seed words carry definitions/examples there).
    const body = a.html ? `<div id="article-body" class="md-body">${a.html}</div>` : '';

    const host = document.getElementById('article-content');
    host.innerHTML = card + body;
    const loading = document.getElementById('loading-state');
    if (loading) loading.style.display = 'none';
    host.classList.remove('hidden');
  }

  // ════════════════════════════ AUDIO (delegated) ════════════════════════════

  let _audioEl = null;
  function stopAudio() { if (_audioEl) { try { _audioEl.pause(); } catch (_) {} _audioEl = null; } }
  function fallbackSpeak(text, btn) {
    if (!text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB'; u.rate = 0.92;
    if (btn) { btn.classList.add('is-playing'); u.onend = u.onerror = () => btn.classList.remove('is-playing'); }
    window.speechSynthesis.speak(u);
  }
  function playFrom(btn) {
    const url = btn.getAttribute('data-audio') || '';
    const say = btn.getAttribute('data-say') || '';
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) {}
    stopAudio();
    if (url) {
      try {
        _audioEl = new Audio(url);
        btn.classList.add('is-playing');
        _audioEl.onended = () => btn.classList.remove('is-playing');
        _audioEl.play().catch(() => { btn.classList.remove('is-playing'); fallbackSpeak(say, btn); });
        return;
      } catch (_) { /* fall through */ }
    }
    fallbackSpeak(say, btn);
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.va-play');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    playFrom(btn);
  });

  // ════════════════════════════ Analytics ════════════════════════════

  async function fireAnalytics(slug, category) {
    try {
      let sessionId = sessionStorage.getItem('vocab_session_id');
      if (!sessionId) { sessionId = crypto.randomUUID(); sessionStorage.setItem('vocab_session_id', sessionId); }
      fetch(`${BASE}/api/analytics/events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_name: 'vocab_wiki_viewed',
          event_data: { slug, category },
          session_id: sessionId,
        }),
      }).catch(() => {});
    } catch (_) { /* analytics best-effort */ }
  }
})();

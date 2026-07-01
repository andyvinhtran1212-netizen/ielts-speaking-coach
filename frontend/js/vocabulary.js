/**
 * vocabulary.js — Vocabulary Wiki (master-detail browse + per-word card).
 *
 * Drives two surfaces:
 *  • /vocabulary.html — master-detail browse: a left list (from /categories) +
 *    a right detail pane that fetches /articles/{cat}/{slug} per selection and
 *    renders the v2 card (the feed lacks the card fields — Discovery U2). On
 *    <860px the list collapses and the detail slides up as a sheet.
 *  • pages/vocab-article.html — the standalone per-word page (deep-link / SEO /
 *    share), reusing the SAME cardHTML builder.
 *
 * All data via window.api (no raw fetch). Audio ▶ prefers the pregenerated mp3
 * (data-audio, Slice-2) and falls back to speechSynthesis (data-say).
 */

(function () {
  const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function prettyCat(slug) {
    return String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  function playBtn(audioUrl, say, extraCls) {
    return `<button type="button" class="va-play ${extraCls || ''}"
      data-audio="${esc(audioUrl || '')}" data-say="${esc(say || '')}"
      aria-label="Nghe ${esc(say || '')}">${PLAY_SVG}</button>`;
  }

  // Per-card "report an error" control. Quick: tap ⚑ → tap a reason → fire-and-
  // forget a `vocab_card_flagged` analytics event (reuses /api/analytics/events,
  // so no new table — admin queries analytics_events, same as vocab_fp_reported).
  function flagControl(a) {
    return `<span class="va-flag-wrap" data-slug="${esc(a.slug || '')}"
        data-headword="${esc(a.headword || '')}" data-category="${esc(a.category || '')}">
      <button type="button" class="va-flag" aria-haspopup="true" aria-expanded="false"
        aria-label="Báo lỗi thẻ từ này"><span aria-hidden="true">⚑</span> Báo lỗi</button>
      <span class="va-flag-menu" role="menu" hidden>
        <span class="va-flag-q">Báo lỗi về:</span>
        <button type="button" class="va-flag-opt" data-reason="content" role="menuitem">Nội dung</button>
        <button type="button" class="va-flag-opt" data-reason="audio" role="menuitem">Âm thanh</button>
      </span>
    </span>`;
  }

  // ── Stress specimen (R1/R2 fix) ───────────────────────────────────────────
  // Split on syllable dots AND the stress marks ˈ/ˌ; the PRIMARY-stressed
  // syllable is the chunk that begins with ˈ. A single-syllable word with no
  // mark is itself the stress. Multi-word/idiom IPA (has a space) gets NO
  // specimen — we emphasise the post-ˈ syllable inside the IPA line instead.
  function stressParts(ipa) {
    let s = String(ipa || '').replace(/\//g, '').trim();
    if (!s || /\s/.test(s)) return null;
    s = s.replace(/([ˈˌ])/g, '|$1').replace(/\./g, '|');
    const parts = s.split('|').filter(Boolean);
    let pi = parts.findIndex(p => p.indexOf('ˈ') === 0);
    if (pi < 0 && parts.length === 1) pi = 0;        // lone syllable, no mark → it's the stress
    if (pi < 0) return null;                          // multi-syllable, no primary mark → can't place
    return { parts: parts.map(p => p.replace(/[ˈˌ]/g, '')), primary: pi };
  }
  function ipaEmphasis(ipa) {        // idiom path: bold the syllable after the primary ˈ
    return esc(ipa).replace(/ˈ([^ˈˌ.\/\s]+)/, 'ˈ<span class="va-st">$1</span>');
  }
  // Slice-2 — orthographic syllabification "me-TROP-o-lis": split on '-', the
  // token with an UPPERCASE letter is the primary stress (first such, if 2). A
  // lone token with no uppercase is itself the stress; a multi-token string with
  // no uppercase → null (can't place → caller falls back to IPA).
  function orthographicParts(syllables) {
    const s = String(syllables || '').trim();
    if (!s) return null;
    const parts = s.split('-').map(x => x.trim()).filter(Boolean);
    if (!parts.length) return null;
    let pi = parts.findIndex(p => /[A-Z]/.test(p));
    if (pi < 0 && parts.length === 1) pi = 0;
    if (pi < 0) return null;
    return { parts, primary: pi };
  }
  function renderSpecimen(sp) {
    const cells = sp.parts.map((p, i) =>
      `<span class="va-syl${i === sp.primary ? ' on' : ''}">${esc(p)}</span>`).join('');
    return `<div class="va-stress" aria-hidden="true">${cells}<span class="va-stress-tag">trọng âm ${sp.primary + 1}</span></div>`;
  }
  function specimenHTML(ipa) {        // (b) IPA-derived specimen (single words)
    const sp = stressParts(ipa);
    return sp ? renderSpecimen(sp) : '';
  }
  // Priority: (a) orthographic syllables → (b) IPA parser → (c) none (idiom).
  function specimenParts(a) {
    return orthographicParts(a.syllables) || stressParts(a.pronunciation);
  }

  function chips(items) { return (items || []).map(c => `<span class="va-chip">${esc(c)}</span>`).join(''); }
  function netRow(label, items) {
    const vals = (items || []).map(x => (x && typeof x === 'object') ? x.headword : x).filter(Boolean);
    if (!vals.length) return '';
    const dd = vals.map(v => `<b>${esc(v)}</b>`).join('<span class="va-sep">·</span>');
    return `<dt>${esc(label)}</dt><dd>${dd}</dd>`;
  }
  function highlightExample(example, headword) {
    const safe = esc(example);
    if (!headword) return safe;
    const re = new RegExp('(' + headword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    return safe.replace(re, '<span class="va-w">$1</span>');
  }

  // ── Shared card builder (article page + master-detail right pane) ──────────
  function cardHTML(a) {
    const sp = specimenParts(a);     // (a) orthographic else (b) IPA; null = idiom
    // Idiom (no specimen) → emphasise the post-ˈ syllable in the IPA line; else plain IPA.
    const ipaLine = a.pronunciation
      ? (sp ? esc(a.pronunciation) : ipaEmphasis(a.pronunciation))
      : '';
    const pad = [];
    pad.push(`<div class="va-pad">
      <div class="va-eyebrow-row">
        <span class="va-eyebrow">${esc(prettyCat(a.category))}</span>
        <span class="va-eyebrow-actions">
          ${a.level ? `<span class="va-pill">${esc(a.level)}</span>` : ''}
          ${flagControl(a)}
        </span>
      </div>
      <div class="va-head">
        <h2 class="va-headword">${esc(a.headword)}</h2>
        ${playBtn(a.audio_headword, a.headword, '')}
      </div>
      ${ipaLine ? `<p class="va-ipa">${ipaLine}${a.part_of_speech ? ` <span class="va-pos">· ${esc(a.part_of_speech)}</span>` : ''}</p>` : ''}
      ${sp ? renderSpecimen(sp) : ''}
    </div>`);

    // VN line: prefer the CURATED definition_vi (mig112); fall back to gloss_vi
    // (the body's first paragraph) for words without a curated VN yet.
    const defVi = (a.definition_vi && a.definition_vi.trim()) ? a.definition_vi : a.gloss_vi;
    if (a.definition_en || defVi) {
      pad.push('<div class="va-rule"></div><div class="va-pad">'
        + (a.definition_en ? `<p class="va-def-en">${esc(a.definition_en)}</p>` : '')
        + (defVi ? `<p class="va-def-vi">${esc(defVi)}</p>` : '')
        + '</div>');
    }

    if (a.example || (a.collocations && a.collocations.length)) {
      pad.push('<div class="va-rule"></div><div class="va-pad">'
        + (a.example
            ? `<div class="va-use-head"><span class="va-eyebrow">Dùng khi nói</span>${playBtn(a.audio_example, a.example, 'va-small va-ghost')}</div>
               <p class="va-example">“${highlightExample(a.example, a.headword)}”</p>`
            : '')
        + (a.collocations && a.collocations.length ? `<div class="va-colloc">${chips(a.collocations)}</div>` : '')
        + '</div>');
    }

    // Word network — each row hidden when empty (netRow → ''). related_words is
    // now "Từ liên quan" (was mislabelled "Họ từ"); word_family (mig112) is "Họ từ".
    const net = netRow('Đồng nghĩa', a.synonyms) + netRow('Trái nghĩa', a.antonyms)
              + netRow('Từ liên quan', a.related_words) + netRow('Họ từ', a.word_family);
    if (net) pad.push(`<div class="va-rule"></div><div class="va-pad"><dl class="va-net">${net}</dl></div>`);

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

    if (a.register || a.source) {
      const bits = [];
      if (a.register) bits.push(`register <b>${esc(a.register)}</b>`);
      if (a.source) bits.push(`nguồn <b>${esc(a.source)}</b>`);
      pad.push(`<div class="va-rule"></div><div class="va-pad va-foot"><span class="va-trace">${bits.join(' · ')}</span></div>`);
    }
    return `<div class="va-card va-detail va-reveal">${pad.join('')}</div>`;
  }

  // Body de-dup. A word with STRUCTURED example/memory renders those in the card,
  // so its markdown body (## Ví dụ / ## Ghi nhớ) is a duplicate → skip it entirely.
  // Seed words (no structured example/memory yet) still get the body as a fallback,
  // de-duped by stripping the leading <p> (that paragraph is the gloss already
  // shown as def-vi — gloss_vi is extracted from it).
  function articleBodyHTML(a) {
    if (!a.html) return '';
    const hasStructured = !!(String(a.example || '').trim() || String(a.memory_hook || '').trim());
    if (hasStructured) return '';
    const stripped = a.html.replace(/^\s*<p>[\s\S]*?<\/p>\s*/, '');
    return stripped.trim() ? `<div id="article-body" class="md-body">${stripped}</div>` : '';
  }

  // ── Page dispatch ─────────────────────────────────────────────────────────
  const shell = document.getElementById('vmd-shell');
  if (shell) initBrowse(shell);
  else if (document.getElementById('article-content')) initArticlePage();

  // ════════════════════════════ MASTER-DETAIL ════════════════════════════

  function initBrowse(shell) {
    const rowsEl = document.getElementById('vmd-rows');
    const cardEl = document.getElementById('vmd-card');
    const chipsEl = document.getElementById('vmd-chips');
    const countEl = document.getElementById('vmd-count');
    const qEl = document.getElementById('vmd-q');
    const state = { words: [], cats: [], cat: '', q: '', selected: null, seq: 0 };
    // Card identity is (category, slug) — the same slug can now live in several
    // categories (mig 122), so selection/deeplink key on the pair, not slug alone,
    // else duplicate-slug rows highlight together and the wrong card opens.
    const selKey = (c, s) => (c || '') + ' ' + (s || '');

    function visible() {
      const q = state.q.trim().toLowerCase();
      return state.words.filter(w =>
        (!state.cat || w.category === state.cat) &&
        (!q || String(w.headword || '').toLowerCase().includes(q) ||
               String(w.gloss_vi || '').toLowerCase().includes(q)));
    }
    function rowHTML(w) {
      return `<div class="vmd-row${state.selected === selKey(w.category, w.slug) ? ' active' : ''}" role="button" tabindex="0"
        data-slug="${esc(w.slug)}" data-cat="${esc(w.category)}">
        ${playBtn(w.audio_headword, w.headword, 'va-small va-ghost')}
        <div class="vmd-row-main">
          <div class="vmd-rw">${esc(w.headword)}</div>
          <div class="vmd-rmeta">${esc(w.pronunciation || '')}${w.part_of_speech ? ' · ' + esc(w.part_of_speech) : ''}</div>
        </div>
        ${w.level ? `<span class="vmd-rlvl">${esc(w.level)}</span>` : ''}
      </div>`;
    }
    function renderRows() {
      const v = visible();
      countEl.textContent = v.length + ' từ' + ((state.q || state.cat) ? ' (lọc)' : '');
      rowsEl.innerHTML = v.length ? v.map(rowHTML).join('') : '<p class="va-empty">Không tìm thấy từ nào.</p>';
    }
    function renderChips() {
      const total = state.words.length;
      const chip = (slug, label, n, on) =>
        `<button type="button" class="vmd-chip${on ? ' is-active' : ''}" data-cat="${esc(slug)}">${esc(label)} <span class="va-mono">${n}</span></button>`;
      const rest = state.cats
        .filter(c => (c.article_count || (c.articles || []).length))
        .map(c => chip(c.slug, c.title || c.slug,
          c.article_count != null ? c.article_count : (c.articles || []).length, state.cat === c.slug)).join('');
      chipsEl.innerHTML = chip('', 'Tất cả', total, !state.cat) + rest;
    }
    function markActive() {
      rowsEl.querySelectorAll('.vmd-row').forEach(r =>
        r.classList.toggle('active',
          selKey(r.getAttribute('data-cat'), r.getAttribute('data-slug')) === state.selected));
    }

    async function selectWord(cat, slug) {
      state.selected = selKey(cat, slug);
      markActive();
      shell.classList.add('show-detail');
      cardEl.innerHTML = '<p class="va-empty">Đang tải…</p>';
      const my = ++state.seq;
      try {
        const a = await window.api.get(`/api/vocabulary/articles/${encodeURIComponent(cat)}/${encodeURIComponent(slug)}`);
        if (my !== state.seq) return;                 // a newer selection won — drop stale render
        cardEl.innerHTML = cardHTML(a) + articleBodyHTML(a);
        try { history.replaceState(null, '', `/vocabulary.html?cat=${encodeURIComponent(cat)}&slug=${encodeURIComponent(slug)}`); } catch (_) {}
        fireAnalytics(slug, cat);
      } catch (err) {
        if (my !== state.seq) return;
        cardEl.innerHTML = '<p class="va-empty">Không tải được từ này.</p>';
      }
    }

    rowsEl.addEventListener('click', (e) => {
      if (e.target.closest('.va-play')) return;       // ▶ handled by the global audio handler
      const row = e.target.closest('.vmd-row');
      if (row) selectWord(row.getAttribute('data-cat'), row.getAttribute('data-slug'));
    });
    rowsEl.addEventListener('keydown', (e) => {
      const row = e.target.closest('.vmd-row');
      if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectWord(row.getAttribute('data-cat'), row.getAttribute('data-slug')); }
    });
    chipsEl.addEventListener('click', (e) => {
      const c = e.target.closest('.vmd-chip'); if (!c) return;
      state.cat = c.getAttribute('data-cat') || '';
      renderChips(); renderRows();
    });
    let dt; qEl.addEventListener('input', () => { clearTimeout(dt); dt = setTimeout(() => { state.q = qEl.value; renderRows(); }, 200); });
    const back = document.getElementById('vmd-back');
    if (back) back.addEventListener('click', () => shell.classList.remove('show-detail'));

    (async function load() {
      try {
        state.cats = await window.api.get('/api/vocabulary/categories') || [];
      } catch (err) {
        cardEl.innerHTML = '<p class="va-empty">Không tải được từ vựng.</p>'; return;
      }
      state.words = state.cats.flatMap(c => c.articles || []);
      // Deep-link or desktop default → open a word in the right pane.
      const params = new URLSearchParams(location.search);
      // ?cat=<slug> from the vocab-topics topic-picker pre-filters the list.
      const wantCat = params.get('cat');
      if (wantCat && state.cats.some(c => c.slug === wantCat)) state.cat = wantCat;
      renderChips(); renderRows();
      // Arrived from the hub word-library tab → reveal the "← Từ vựng" back link
      // (points at /pages/vocabulary.html#word-library; browser-back also returns
      // there since the hub wrote that hash via pushState).
      if (params.get('from') === 'word-library') {
        const back = document.getElementById('vmd-hub-back');
        if (back) back.hidden = false;
      }
      const wantSlug = params.get('slug');
      // Resolve the deeplink by (cat, slug) first — a slug-only match could open
      // the wrong category's card now that a slug may exist in several topics.
      const want = wantSlug && (
        state.words.find(w => w.slug === wantSlug && (!wantCat || w.category === wantCat))
        || state.words.find(w => w.slug === wantSlug));
      if (want) selectWord(want.category, want.slug);
      else if (state.words.length && window.matchMedia('(min-width: 861px)').matches) {
        const firstWord = state.cat
          ? state.words.find(w => w.category === state.cat)
          : state.words[0];
        if (firstWord) selectWord(firstWord.category, firstWord.slug);
      }
    })();
  }

  // ════════════════════════════ ARTICLE PAGE ════════════════════════════

  function initArticlePage() {
    const params = new URLSearchParams(location.search);
    const cat = params.get('cat'), slug = params.get('slug');
    if (!cat || !slug) { showArticleError(); return; }
    loadArticle(cat, slug);
  }
  async function loadArticle(cat, slug) {
    try {
      const a = await window.api.get(`/api/vocabulary/articles/${encodeURIComponent(cat)}/${encodeURIComponent(slug)}`);
      renderArticle(a);
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
  function renderArticle(a) {
    document.title = `${a.headword} — Vocabulary Wiki`;
    const crumb = document.getElementById('nav-breadcrumb');
    if (crumb) crumb.textContent = a.headword;
    const host = document.getElementById('article-content');
    host.innerHTML = cardHTML(a) + articleBodyHTML(a);
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

  // ── Flag / report an error (delegated) ──────────────────────────────────────
  function closeFlagMenus(except) {
    document.querySelectorAll('.va-flag-wrap').forEach((w) => {
      if (w === except) return;
      const m = w.querySelector('.va-flag-menu');
      const b = w.querySelector('.va-flag');
      if (m) m.hidden = true;
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  }
  function sendFlag(wrap, reason) {
    if (!wrap) return;
    const menu = wrap.querySelector('.va-flag-menu');
    try {
      let sessionId = sessionStorage.getItem('vocab_session_id');
      if (!sessionId) { sessionId = crypto.randomUUID(); sessionStorage.setItem('vocab_session_id', sessionId); }
      window.api.post('/api/analytics/events', {
        event_name: 'vocab_card_flagged',
        event_data: {
          slug:     wrap.getAttribute('data-slug') || '',
          headword: wrap.getAttribute('data-headword') || '',
          category: wrap.getAttribute('data-category') || '',
          reason:   reason || 'unspecified',
        },
        session_id: sessionId,
      }).catch(() => {});
    } catch (_) { /* report best-effort — never block the UI */ }
    if (menu) menu.innerHTML = '<span class="va-flag-done">✓ Đã gửi, cảm ơn!</span>';
  }
  document.addEventListener('click', (e) => {
    const opt = e.target.closest('.va-flag-opt');
    if (opt) {
      e.preventDefault(); e.stopPropagation();
      sendFlag(opt.closest('.va-flag-wrap'), opt.getAttribute('data-reason'));
      return;
    }
    const fb = e.target.closest('.va-flag');
    if (fb) {
      e.preventDefault(); e.stopPropagation();
      const wrap = fb.closest('.va-flag-wrap');
      const menu = wrap && wrap.querySelector('.va-flag-menu');
      const willOpen = menu && menu.hidden;     // currently hidden → this click opens it
      closeFlagMenus(wrap);
      if (menu) menu.hidden = !willOpen;
      fb.setAttribute('aria-expanded', String(!!willOpen));
      return;
    }
    closeFlagMenus(null);                        // click elsewhere closes open menus
  });

  // ════════════════════════════ Analytics ════════════════════════════

  function fireAnalytics(slug, category) {
    try {
      let sessionId = sessionStorage.getItem('vocab_session_id');
      if (!sessionId) { sessionId = crypto.randomUUID(); sessionStorage.setItem('vocab_session_id', sessionId); }
      window.api.post('/api/analytics/events', {
        event_name: 'vocab_wiki_viewed',
        event_data: { slug, category },
        session_id: sessionId,
      }).catch(() => {});
    } catch (_) { /* analytics best-effort */ }
  }
})();

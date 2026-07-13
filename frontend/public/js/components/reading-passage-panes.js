/* frontend/js/components/reading-passage-panes.js — reading-l1l2-grammar-toggle.
 *
 * Shared 3-toggle reading-pane swapper for the L1 vocab passage + L2 skill
 * exercise (both load this; one change covers both — they previously each had
 * a duplicated translation panel). A prominent, responsive toggle bar sits
 * ABOVE the passage body and swaps the passage pane between:
 *   • "Văn bản gốc"        — the English original (the already-rendered #rv-body)
 *   • "Bài dịch"           — the Vietnamese translation (translation_vi, #372)
 *   • "Phân tích grammar"  — the grammar analysis (grammar_focus, NEW)
 *
 * Graceful: a button is rendered ONLY when its data exists (no translation →
 * no "Bài dịch"; no grammar → no "Phân tích grammar"); if neither extra exists
 * the bar is not mounted at all (the plain passage stays as-is). XSS-safe: VI
 * prose + grammar fields go through textContent; the grammar `example`'s
 * `**bold**` is escaped THEN turned into <strong> (the #381 escape-first
 * pattern) — never raw innerHTML of untrusted text.
 *
 * `mount(opts)` returns a controller { showPane, panes, buttons, active } so a
 * test can drive the switch directly (Lesson 20 — assert the active pane
 * changes, not just that buttons exist).
 */
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]);
    });
  }
  // **bold** → <strong> on an ESCAPED string (so the input is inert HTML first).
  function formatBold(s) {
    return escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  function _btn(label, name) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'rv-panes__btn';
    b.setAttribute('data-pane', name);
    b.setAttribute('role', 'tab');
    b.textContent = label;
    return b;
  }

  function _viPane(translationVi) {
    var pane = document.createElement('div');
    pane.className = 'rv-pane rv-pane--vi md-body';
    pane.setAttribute('data-pane', 'translation');
    translationVi.split(/\n\s*\n/).forEach(function (para) {
      var t = para.trim();
      if (!t) return;
      var p = document.createElement('p');
      p.textContent = t;            // XSS-safe — plain prose, never innerHTML
      pane.appendChild(p);
    });
    return pane;
  }

  function _grammarPane(grammarFocus) {
    var pane = document.createElement('div');
    pane.className = 'rv-pane rv-pane--grammar';
    pane.setAttribute('data-pane', 'grammar');
    grammarFocus.forEach(function (g) {
      var card = document.createElement('div');
      card.className = 'rv-gpoint';

      var h = document.createElement('h3');
      h.className = 'rv-gpoint__title';
      h.textContent = g.point || '';          // XSS-safe
      card.appendChild(h);

      if (g.example) {
        var ex = document.createElement('p');
        ex.className = 'rv-gpoint__example';
        ex.innerHTML = formatBold(g.example);  // escaped THEN **→<strong> (safe)
        card.appendChild(ex);
      }
      // analysis / review / tip — labelled rows, plain-text values (XSS-safe).
      [['analysis', 'Phân tích'], ['review', 'Cấu trúc'], ['tip', 'Mẹo đọc']].forEach(function (pair) {
        var val = g[pair[0]];
        if (!val) return;
        var row = document.createElement('p');
        row.className = 'rv-gpoint__row rv-gpoint__' + pair[0];
        var lbl = document.createElement('strong');
        lbl.className = 'rv-gpoint__lbl';
        lbl.textContent = pair[1] + ': ';
        var span = document.createElement('span');
        span.textContent = val;               // XSS-safe
        row.appendChild(lbl);
        row.appendChild(span);
        card.appendChild(row);
      });
      pane.appendChild(card);
    });
    return pane;
  }

  // opts: { body (the #rv-body element), translationVi (string), grammarFocus (array) }
  function mount(opts) {
    opts = opts || {};
    var body = opts.body;
    if (!body || !body.parentNode) return null;

    var translationVi = (opts.translationVi || '').trim();
    var grammarFocus = Array.isArray(opts.grammarFocus)
      ? opts.grammarFocus.filter(function (g) { return g && g.point; }) : [];
    var hasVi = !!translationVi;
    var hasGrammar = grammarFocus.length > 0;
    // Nothing extra to toggle → leave the passage exactly as it was.
    if (!hasVi && !hasGrammar) return null;

    var article = body.parentNode;
    var panes = { original: body };
    var buttons = {};

    var bar = document.createElement('div');
    bar.className = 'rv-panes';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'Chế độ xem bài đọc');

    var order = [['original', 'Văn bản gốc']];
    if (hasVi) order.push(['translation', 'Bài dịch']);
    if (hasGrammar) order.push(['grammar', 'Phân tích grammar']);
    order.forEach(function (pair) {
      var b = _btn(pair[1], pair[0]);
      buttons[pair[0]] = b;
      bar.appendChild(b);
    });
    article.insertBefore(bar, body);

    // VI + grammar panes are siblings of the original body; only one is shown.
    if (hasVi) { panes.translation = _viPane(translationVi); article.insertBefore(panes.translation, body.nextSibling); }
    if (hasGrammar) { panes.grammar = _grammarPane(grammarFocus); article.insertBefore(panes.grammar, body.nextSibling); }

    var controller = { showPane: showPane, panes: panes, buttons: buttons, active: 'original' };

    function showPane(name) {
      if (!panes[name]) name = 'original';
      Object.keys(panes).forEach(function (k) {
        if (panes[k]) panes[k].hidden = (k !== name);
      });
      Object.keys(buttons).forEach(function (k) {
        var on = (k === name);
        buttons[k].classList.toggle('is-active', on);
        buttons[k].setAttribute('aria-selected', on ? 'true' : 'false');
      });
      controller.active = name;
    }

    Object.keys(buttons).forEach(function (k) {
      buttons[k].addEventListener('click', function () { showPane(k); });
    });
    showPane('original');   // default to the English original

    return controller;
  }

  window.ReadingPanes = { mount: mount, _formatBold: formatBold };
})();

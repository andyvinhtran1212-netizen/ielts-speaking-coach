/**
 * writing-highlight.js — T4·1 inline error highlight (STUDENT view only).
 *
 * Highlights each mistakeAnalysis.original span directly inside the student's
 * essay text (<pre id="essay-text">), with a popover showing the suggestion +
 * explanation on hover, click, and keyboard focus.
 *
 * HARD GATES (this is the easiest thread to get wrong):
 *   1. NEVER highlight the wrong span. Uncertain / not-found / overlapping →
 *      no highlight; the mistake card (rendered elsewhere) stays as fallback.
 *      Better to miss than to mark the wrong characters.
 *   2. XSS-safe. The essay is user content; every non-highlight segment, every
 *      highlighted fragment, and all popover text (original/suggestion/
 *      explanation) is escaped. Nothing is injected.
 *   3. Never mutate the source text. The displayed essay is byte-identical to
 *      essay_text — we only wrap <span>s (HTML-escaped, no chars added/removed).
 *   4. The JS normaliser matches the Python _norm (mistake_authenticity.py)
 *      exactly, so matching is consistent with the P-2a authenticity filter.
 *
 * On ANY error the whole thing degrades to plain textContent (gate #1).
 */
(function (global) {
  'use strict';
  if (global.WritingHighlight) return;

  // ── _norm parity with backend mistake_authenticity.py:_norm ──────────
  // Unicode VARIANTS of the same punctuation → one canonical form. EXACTLY
  // the backend _PUNCT_VARIANTS map (apostrophes, double quotes, guillemets,
  // dashes). Folding variants is safe; it never equates two different marks.
  var PUNCT = {
    '’': "'", '‘': "'", 'ʼ': "'", '′': "'",   // apostrophes
    '“': '"', '”': '"', '„': '"',                   // double quotes
    '«': '"', '»': '"',                                   // guillemets
    '–': '-', '—': '-', '―': '-', '−': '-'     // en/em/horiz/minus dashes
  };

  function foldPunct(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      out += (PUNCT[c] || c);
    }
    return out;
  }

  // NFC → fold punctuation variants → collapse whitespace runs → trim.
  // Case-sensitive; no real punctuation removed. Mirrors the Python rule.
  function _norm(s) {
    s = (s == null ? '' : String(s)).normalize('NFC');
    s = foldPunct(s);
    return s.replace(/\s+/g, ' ').trim();
  }

  // ── HTML escaping (XSS gate) ─────────────────────────────────────────
  function escapeHtml(s) {
    if (global.WC && typeof global.WC.escapeHtml === 'function') {
      return global.WC.escapeHtml(s);
    }
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Build normalised essay + offset map back to RAW characters ───────
  // Returns { norm, starts[], ends[] } where normalised char i was produced
  // by raw[starts[i] .. ends[i]). Built char-by-char so every offset maps to
  // the exact raw characters — any substring match in `norm` therefore maps
  // back to the correct raw span by construction (gate #1 + #3).
  function buildNormMap(raw) {
    var out = '';
    var starts = [];
    var ends = [];
    var rawIdx = 0;
    var inWS = false;
    var wsStart = -1;

    // Iterate by code point; track the UTF-16 offset (rawIdx) for slicing.
    var iter = typeof raw[Symbol.iterator] === 'function' ? raw : String(raw);
    for (var ch of iter) {
      var w = ch.length; // UTF-16 units consumed by this code point
      if (/\s/.test(ch)) {
        if (!inWS) { inWS = true; wsStart = rawIdx; }
      } else {
        if (inWS) {
          // Collapse the whitespace run to one space — but suppress a LEADING
          // run (nothing emitted yet) to match Python's trim().
          if (out.length > 0) {
            out += ' ';
            starts.push(wsStart);
            ends.push(rawIdx);
          }
          inWS = false;
        }
        var nfc = ch.normalize('NFC');
        for (var nc0 of nfc) {
          var nc = PUNCT[nc0] || nc0;
          out += nc;
          starts.push(rawIdx);
          ends.push(rawIdx + w);
        }
      }
      rawIdx += w;
    }
    // A trailing whitespace run is never emitted → matches Python's trim().
    return { norm: out, starts: starts, ends: ends };
  }

  function _typeOf(m) {
    return (m && (m.type || m.mistakeType)) || 'Other';
  }

  // Bucket a free-text mistake type into a small set for colour coding.
  function _typeClass(type) {
    var t = String(type || '').toLowerCase();
    if (/spell/.test(t)) return 'spelling';
    if (/punct/.test(t)) return 'punctuation';
    if (/gramm|tense|agreement|article|preposition|\bgra\b/.test(t)) return 'grammar';
    if (/lex|vocab|word|collocation|\blr\b/.test(t)) return 'lexical';
    if (/cohes|coher|link|cohesion|\bcc\b/.test(t)) return 'coherence';
    return 'other';
  }

  // ── Compute the spans to highlight (RAW offsets) ─────────────────────
  // Sequential-consume per identical `original` (the Nth flag of "the" grabs
  // the Nth occurrence). Overlap → earlier array index wins (HTML can't nest).
  // Not found / fully overlapping → skipped (card stays).
  function computeSpans(raw, mistakes) {
    var mapped = buildNormMap(raw);
    var norm = mapped.norm;
    var claimed = new Array(norm.length); // normalised chars already taken
    var cursor = {};                       // normOrig → next search start
    var spans = [];

    (mistakes || []).forEach(function (m, mi) {
      var normOrig = _norm(m && m.original);
      if (!normOrig) return; // empty original → no highlight
      var from = cursor[normOrig] || 0;
      var pos = -1;
      while (true) {
        var idx = norm.indexOf(normOrig, from);
        if (idx === -1) break;
        var clash = false;
        for (var k = idx; k < idx + normOrig.length; k++) {
          if (claimed[k]) { clash = true; break; }
        }
        if (!clash) { pos = idx; break; }
        from = idx + 1; // this occurrence overlaps a claimed span — try next
      }
      if (pos === -1) return; // not found / all occurrences overlap → skip
      for (var k2 = pos; k2 < pos + normOrig.length; k2++) claimed[k2] = true;
      cursor[normOrig] = pos + normOrig.length;
      var rawStart = mapped.starts[pos];
      var rawEnd = mapped.ends[pos + normOrig.length - 1];
      if (rawStart == null || rawEnd == null || rawEnd <= rawStart) return;
      spans.push({ rawStart: rawStart, rawEnd: rawEnd, mi: mi, m: m });
    });

    // Defensive: enforce non-overlapping RAW ranges, earlier-index wins.
    spans.sort(function (a, b) {
      return a.rawStart - b.rawStart || a.mi - b.mi;
    });
    var safe = [];
    var lastEnd = 0;
    spans.forEach(function (s) {
      if (s.rawStart >= lastEnd) { safe.push(s); lastEnd = s.rawEnd; }
    });
    return { spans: safe };
  }

  // ── Build the highlighted HTML (escaped) ─────────────────────────────
  function buildHtml(raw, spans) {
    var html = '';
    var pos = 0;
    spans.forEach(function (s) {
      html += escapeHtml(raw.slice(pos, s.rawStart));
      var frag = raw.slice(s.rawStart, s.rawEnd); // exact raw chars (gate #3)
      var type = _typeOf(s.m);
      var sugg = (s.m && s.m.suggestion) || '';
      var expl = (s.m && s.m.explanation) || '';
      html +=
        '<mark class="wh-mark wh-type-' + _typeClass(type) + '" ' +
        'tabindex="0" role="button" ' +
        'aria-label="' + escapeHtml('Lỗi: ' + type + '. Nhấn để xem gợi ý sửa.') + '" ' +
        'data-wh-type="' + escapeHtml(type) + '" ' +
        'data-wh-suggestion="' + escapeHtml(sugg) + '" ' +
        'data-wh-explanation="' + escapeHtml(expl) + '">' +
        escapeHtml(frag) +
        '</mark>';
      pos = s.rawEnd;
    });
    html += escapeHtml(raw.slice(pos));
    return html;
  }

  // ── Popover (one shared element; hover + click + keyboard) ────────────
  var _pop = null;
  var _active = null;   // currently-shown mark
  var _pinned = false;  // click/Enter keeps it open until Esc / outside click

  function _ensurePopover() {
    if (_pop) return _pop;
    _pop = document.createElement('div');
    _pop.className = 'wh-popover';
    _pop.id = 'wh-popover';
    _pop.setAttribute('role', 'tooltip');
    _pop.hidden = true;
    _pop.innerHTML =
      '<div class="wh-popover__type"></div>' +
      '<div class="wh-popover__diff">' +
        '<span class="wh-popover__from"></span>' +
        '<span class="wh-popover__arrow" aria-hidden="true">→</span>' +
        '<span class="wh-popover__to"></span>' +
      '</div>' +
      '<p class="wh-popover__explain"></p>';
    document.body.appendChild(_pop);
    return _pop;
  }

  function _showFor(mark) {
    var pop = _ensurePopover();
    // Populate via textContent — XSS-safe round trip (getAttribute decodes,
    // textContent re-escapes). The "from" side is the mark's own raw text.
    pop.querySelector('.wh-popover__type').textContent = mark.getAttribute('data-wh-type') || '';
    pop.querySelector('.wh-popover__from').textContent = mark.textContent || '';
    var sugg = mark.getAttribute('data-wh-suggestion') || '';
    var toEl = pop.querySelector('.wh-popover__to');
    var arrowEl = pop.querySelector('.wh-popover__arrow');
    toEl.textContent = sugg;
    toEl.style.display = sugg ? '' : 'none';
    arrowEl.style.display = sugg ? '' : 'none';
    var expl = mark.getAttribute('data-wh-explanation') || '';
    var explEl = pop.querySelector('.wh-popover__explain');
    explEl.textContent = expl;
    explEl.style.display = expl ? '' : 'none';
    pop.setAttribute('data-wh-type', mark.getAttribute('data-wh-type') || 'other');
    pop.className = 'wh-popover wh-type-' + (mark.className.match(/wh-type-(\S+)/) || [, 'other'])[1];

    pop.hidden = false;
    mark.setAttribute('aria-describedby', 'wh-popover');
    _active = mark;
    _position(mark, pop);
  }

  function _position(mark, pop) {
    var r = mark.getBoundingClientRect();
    // Measure popover after it's visible.
    var pw = pop.offsetWidth;
    var ph = pop.offsetHeight;
    var margin = 8;
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;
    // Default below; flip above if not enough room.
    var top = r.bottom + margin;
    if (top + ph > vh && r.top - margin - ph > 0) {
      top = r.top - margin - ph;
    }
    var left = r.left + (r.width / 2) - (pw / 2);
    if (left < margin) left = margin;
    if (left + pw > vw - margin) left = vw - margin - pw;
    pop.style.top = Math.max(margin, top) + 'px';
    pop.style.left = left + 'px';
  }

  function _hide() {
    if (!_pop) return;
    _pop.hidden = true;
    if (_active) _active.removeAttribute('aria-describedby');
    _active = null;
    _pinned = false;
  }

  function _attachPopover(container) {
    var marks = container.querySelectorAll('.wh-mark');
    if (!marks.length) return;

    marks.forEach(function (mark) {
      mark.addEventListener('mouseenter', function () {
        if (!_pinned) _showFor(mark);
      });
      mark.addEventListener('mouseleave', function () {
        if (!_pinned && _active === mark) _hide();
      });
      mark.addEventListener('focus', function () {
        if (!_pinned) _showFor(mark);
      });
      mark.addEventListener('blur', function () {
        if (!_pinned && _active === mark) _hide();
      });
      mark.addEventListener('click', function () {
        if (_pinned && _active === mark) { _hide(); }
        else { _pinned = false; _showFor(mark); _pinned = true; }
      });
      mark.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (_pinned && _active === mark) { _hide(); }
          else { _pinned = false; _showFor(mark); _pinned = true; }
        } else if (e.key === 'Escape') {
          if (_active === mark) { _hide(); mark.focus(); }
        }
      });
    });

    // Global dismissers (attached once).
    if (!_attachPopover._global) {
      _attachPopover._global = true;
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && _active) {
          var m = _active; _hide();
          if (m && typeof m.focus === 'function') m.focus();
        }
      });
      document.addEventListener('click', function (e) {
        if (_pinned && _active && !_active.contains(e.target) &&
            (!_pop || !_pop.contains(e.target))) {
          _hide();
        }
      }, true);
      window.addEventListener('resize', function () { if (_active) _hide(); });
      window.addEventListener('scroll', function () { if (_active && !_pinned) _hide(); }, true);
    }
  }

  // ── Public entry ─────────────────────────────────────────────────────
  // render(el, rawEssay, mistakes) → wraps matched originals into el as
  // escaped HTML and wires the popover. On ANY failure → el.textContent =
  // rawEssay (gate #1: never break the page, keep cards as fallback).
  // Returns { matchedCount, total }.
  function render(el, rawEssay, mistakes) {
    if (!el) return { matchedCount: 0, total: 0 };
    var raw = rawEssay == null ? '' : String(rawEssay);
    try {
      var list = Array.isArray(mistakes) ? mistakes : [];
      var result = computeSpans(raw, list);
      el.innerHTML = buildHtml(raw, result.spans);
      _attachPopover(el);
      return { matchedCount: result.spans.length, total: list.length };
    } catch (err) {
      if (global.console) global.console.error('[writing-highlight] failed, plain-text fallback', err);
      el.textContent = raw; // gate #1 — never break, never mis-highlight
      return { matchedCount: 0, total: (mistakes || []).length, error: true };
    }
  }

  global.WritingHighlight = {
    _norm: _norm,
    foldPunct: foldPunct,
    buildNormMap: buildNormMap,
    computeSpans: computeSpans,
    buildHtml: buildHtml,
    render: render
  };
})(typeof window !== 'undefined' ? window : this);

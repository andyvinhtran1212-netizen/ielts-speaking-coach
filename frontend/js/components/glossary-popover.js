/* frontend/js/components/glossary-popover.js — Sprint 20.2.
 *
 * window.GlossaryPopover.attach(rootEl, glossary) — highlights glossary terms
 * inside an already-rendered + sanitized passage, and shows a definition
 * popover on click.
 *
 * Design (Code-authoritative, Discovery blind-spot #4): terms are auto-wrapped
 * by walking TEXT NODES of the sanitized HTML and inserting <button> elements
 * via the DOM API (NOT markdown `[term](glossary:slug)` — DOMPurify strips the
 * custom scheme, and auto-wrap means zero authoring burden). XSS-safe: term
 * labels + definitions are set with textContent, never innerHTML.
 *
 * glossary item shape: { term, definition, example?, audio_url? }.
 * Only the FIRST occurrence of each term is wrapped. Dismiss: click-outside /
 * Esc / ✕ (reuses the image-lightbox dismissal idiom). Mobile (<600px) renders
 * a bottom modal instead of an anchored popover.
 */
(function () {
  'use strict';

  var SKIP_TAGS = { A: 1, CODE: 1, PRE: 1, BUTTON: 1, SCRIPT: 1, STYLE: 1 };
  var popover = null;

  function isLetterOrDigit(ch) { return !!ch && /[\p{L}\p{N}]/u.test(ch); }

  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Wrap the earliest matching remaining-term occurrence in one text node.
  // Returns the trailing text node to continue scanning, or null when no match.
  function wrapFirstMatch(textNode, remaining) {
    var text = textNode.nodeValue;
    var lower = text.toLowerCase();
    var best = null; // {idx, len, entry}
    remaining.forEach(function (entry, key) {
      var re = new RegExp(escapeRegExp(key), 'g');
      var m;
      while ((m = re.exec(lower)) !== null) {
        var before = lower[m.index - 1];
        var after = lower[m.index + key.length];
        if (!isLetterOrDigit(before) && !isLetterOrDigit(after)) {
          if (!best || m.index < best.idx) best = { idx: m.index, len: key.length, entry: entry, key: key };
          break; // earliest occurrence of THIS term is enough
        }
      }
    });
    if (!best) return null;

    var parent = textNode.parentNode;
    var matchedText = text.substr(best.idx, best.len);
    var afterText = text.substr(best.idx + best.len);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'glossary-term';
    btn.textContent = matchedText;            // preserves the original casing
    btn._glossEntry = best.entry;
    btn.setAttribute('aria-label', 'Định nghĩa: ' + best.entry.term);

    var afterNode = document.createTextNode(afterText);
    textNode.nodeValue = text.substr(0, best.idx);
    parent.insertBefore(btn, textNode.nextSibling);
    parent.insertBefore(afterNode, btn.nextSibling);

    remaining.delete(best.key);
    return afterNode;
  }

  function highlightTerms(rootEl, glossary) {
    var remaining = new Map();
    (glossary || []).forEach(function (g) {
      if (g && g.term) remaining.set(String(g.term).toLowerCase(), g);
    });
    if (!remaining.size) return;

    var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        while (p && p !== rootEl) {
          if (SKIP_TAGS[p.nodeName]) return NodeFilter.FILTER_REJECT;
          p = p.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var nodes = [];
    var cur;
    while ((cur = walker.nextNode())) nodes.push(cur);

    nodes.forEach(function (node) {
      var n = node;
      while (n && remaining.size) {
        n = wrapFirstMatch(n, remaining);
      }
    });
  }

  function close() { if (popover) { popover.remove(); popover = null; } }

  function openFor(btn) {
    close();
    var entry = btn._glossEntry || {};
    popover = document.createElement('div');
    popover.className = 'glossary-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-modal', 'false');

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'glossary-popover__close';
    closeBtn.setAttribute('aria-label', 'Đóng');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', close);

    var termEl = document.createElement('div');
    termEl.className = 'glossary-popover__term';
    termEl.textContent = entry.term || '';

    var defEl = document.createElement('div');
    defEl.className = 'glossary-popover__def';
    defEl.textContent = entry.definition || '';

    popover.appendChild(closeBtn);
    popover.appendChild(termEl);
    popover.appendChild(defEl);
    if (entry.example) {
      var exEl = document.createElement('div');
      exEl.className = 'glossary-popover__ex';
      exEl.textContent = '“' + entry.example + '”';
      popover.appendChild(exEl);
    }

    document.body.appendChild(popover);

    if (window.innerWidth < 600) {
      popover.classList.add('is-modal');
    } else {
      var r = btn.getBoundingClientRect();
      var top = r.bottom + window.scrollY + 6;
      var maxLeft = window.innerWidth - popover.offsetWidth - 8;
      var left = Math.min(Math.max(r.left + window.scrollX, 8), Math.max(8, maxLeft));
      popover.style.top = top + 'px';
      popover.style.left = left + 'px';
    }
    closeBtn.focus();
  }

  function attach(rootEl, glossary) {
    if (!rootEl) return;
    highlightTerms(rootEl, glossary);
    rootEl.addEventListener('click', function (ev) {
      var btn = ev.target.closest && ev.target.closest('.glossary-term');
      if (btn) { ev.preventDefault(); openFor(btn); }
    });
    // Dismiss on outside click / Esc (lightbox idiom).
    document.addEventListener('click', function (ev) {
      if (popover && !popover.contains(ev.target) && !(ev.target.closest && ev.target.closest('.glossary-term'))) {
        close();
      }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') close();
    });
  }

  window.GlossaryPopover = { attach: attach, _highlightTerms: highlightTerms };
})();

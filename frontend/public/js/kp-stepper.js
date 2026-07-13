/* kp-stepper.js — shared renderer for the KP-aware solution stepper.
 *
 * Renders a backend `stepper` view-model ({steps:[{action,instruction_vi,kp_refs,
 * microcheck}], distractors, kp_tags}) into token-styled HTML, and wires
 * interactive micro-checks to POST evidence to /api/kp/microcheck-answers.
 * Used by the exam review (and mirrors the reading-review inline stepper).
 * window.KPStepper = { renderHtml, wire }.
 */
(function () {
  'use strict';

  function esc(s) {
    if (window.WC && typeof window.WC.escapeHtml === 'function') return window.WC.escapeHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function prettySlug(s) {
    return String(s || '').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  var STEP_ACTION = {
    locate: 'Định vị thông tin', decode_vocab: 'Giải mã từ vựng',
    parse_syntax: 'Phân tích cấu trúc câu', eliminate: 'Loại đáp án nhiễu',
    infer: 'Suy luận', confirm: 'Chốt đáp án',
  };
  var KP_ICON = { grammar: '📘', vocab: '📗', skill: '🎯' };

  function kpChip(ref) {
    if (!ref || !ref.slug) return '';
    var chip = '<span style="display:inline-flex;align-items:center;gap:4px;font-size:var(--av-fs-xs);' +
      'padding:2px 8px;border-radius:999px;background:var(--av-primary-soft);' +
      'color:var(--av-primary);margin:2px 4px 0 0;">' +
      (KP_ICON[ref.type] || '•') + ' ' + esc(ref.title || prettySlug(ref.slug)) + '</span>';
    if (ref.type === 'grammar' && ref.category) {
      var href = '/grammar/' + encodeURIComponent(ref.category) + '/' + encodeURIComponent(ref.slug) +
        (ref.anchor ? ('#' + encodeURIComponent(ref.anchor)) : '');
      return '<a href="' + esc(href) + '" style="text-decoration:none;">' + chip + '</a>';
    }
    return chip;
  }
  function kpChips(refs) {
    refs = refs || [];
    return refs.length ? '<div style="margin-top:6px;">' + refs.map(kpChip).join('') + '</div>' : '';
  }
  function microcheckHtml(mc, kpRefs) {
    var opts = (mc.options || []).map(function (o, i) {
      var letter = String.fromCharCode(65 + i);
      return '<button type="button" data-letter="' + letter + '" ' +
        'style="display:block;width:100%;text-align:left;margin-top:6px;padding:8px 12px;' +
        'border:1px solid var(--av-border-default);border-radius:var(--av-radius-md);' +
        'background:var(--av-surface-card);color:var(--av-text-primary);cursor:pointer;">' +
        '<b>' + letter + '.</b> ' + esc(typeof o === 'string' ? o : (o.text || '')) + '</button>';
    }).join('');
    return '<div data-mc data-answer="' + esc(String(mc.answer || '')) + '" ' +
      'data-kprefs="' + esc(JSON.stringify(kpRefs || [])) + '" ' +
      'style="margin-top:10px;padding:12px;border:1px dashed var(--av-primary-border);' +
      'border-radius:var(--av-radius-md);background:var(--av-primary-soft);">' +
      '<div style="font-weight:600;color:var(--av-text-primary);font-size:var(--av-fs-sm);">🧩 ' +
        esc(mc.prompt || '') + '</div>' + opts +
      '<div data-mc-fb hidden style="margin-top:8px;font-size:var(--av-fs-sm);font-weight:600;"></div></div>';
  }

  function renderHtml(stepper) {
    if (!stepper || !Array.isArray(stepper.steps) || !stepper.steps.length) return '';
    var steps = '<ol style="list-style:none;margin:0;padding:0;">' + stepper.steps.map(function (s, i) {
      var mc = (s.microcheck && s.microcheck.prompt && Array.isArray(s.microcheck.options))
        ? microcheckHtml(s.microcheck, s.kp_refs) : '';
      return '<li style="display:flex;gap:12px;padding:8px 0;' +
        (i ? 'border-top:1px solid var(--av-border-subtle);' : '') + '">' +
        '<span style="flex:none;width:24px;height:24px;border-radius:999px;background:var(--av-primary-soft);' +
          'color:var(--av-primary);font-weight:700;font-size:var(--av-fs-xs);' +
          'display:flex;align-items:center;justify-content:center;">' + (i + 1) + '</span>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:var(--av-fs-xs);font-weight:700;color:var(--av-primary);' +
            'text-transform:uppercase;letter-spacing:.03em;">' + esc(STEP_ACTION[s.action] || 'Bước') + '</div>' +
          '<div style="color:var(--av-text-primary);margin-top:2px;">' + esc(s.instruction_vi || '') + '</div>' +
          kpChips(s.kp_refs) + mc +
        '</div></li>';
    }).join('') + '</ol>';

    var distractors = (stepper.distractors || []).filter(function (d) { return d.option && d.why_wrong_vi; });
    var dHtml = distractors.length
      ? '<div style="margin-top:12px;"><div style="font-size:var(--av-fs-xs);font-weight:700;' +
          'text-transform:uppercase;color:var(--av-text-muted);margin-bottom:4px;">Phân tích đáp án nhiễu</div>' +
          '<ul style="list-style:none;margin:0;padding:0;">' + distractors.map(function (d) {
            return '<li style="padding:6px 0;"><b style="color:var(--av-error);">' + esc(d.option) + '.</b> ' +
              esc(d.why_wrong_vi) + kpChips(d.kp_refs) + '</li>';
          }).join('') + '</ul></div>'
      : '';
    return steps + dHtml;
  }

  function wire(root) {
    if (!root) return;
    root.querySelectorAll('[data-mc]').forEach(function (mc) {
      var answer = mc.getAttribute('data-answer');
      var refs = [];
      try { refs = JSON.parse(mc.getAttribute('data-kprefs') || '[]'); } catch (_) { refs = []; }
      var fb = mc.querySelector('[data-mc-fb]');
      mc.querySelectorAll('[data-letter]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (mc.dataset.done) return;
          mc.dataset.done = '1';
          var correct = btn.getAttribute('data-letter') === answer;
          btn.style.borderColor = correct ? 'var(--av-success)' : 'var(--av-error)';
          btn.style.background = correct ? 'var(--av-success-soft)' : 'var(--av-error-soft)';
          if (fb) {
            fb.hidden = false;
            fb.style.color = correct ? 'var(--av-success)' : 'var(--av-error)';
            fb.textContent = correct ? '✓ Chính xác' : ('✗ Chưa đúng — đáp án: ' + answer);
          }
          if (refs.length && window.api && window.api.post) {
            window.api.post('/api/kp/microcheck-answers', {
              answers: refs.map(function (r) { return { kp: r, correct: correct }; }),
            }).catch(function () {});
          }
        });
      });
    });
  }

  window.KPStepper = { renderHtml: renderHtml, wire: wire };
})();

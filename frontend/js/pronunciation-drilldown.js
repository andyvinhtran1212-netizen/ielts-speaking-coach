/**
 * frontend/js/pronunciation-drilldown.js — Sprint 15.1
 *
 * Per-phoneme drill-down for weak words in the pronunciation feedback panel.
 * A weak-word badge (rendered by practice.js _renderPronBlock) opens a modal
 * listing that word's phonemes, score bars, and — for SAPI symbols present in
 * PHONEME_REF — example words + a Vietnamese-learner tip.
 *
 * Empirical basis (Sprint 15.0/15.1 PF-1): Azure Granularity=Phoneme returns
 * SAPI phones (e.g. "ih", "ay"), HundredMark 0–100. PHONEME_REF is therefore
 * keyed on SAPI symbols, with IPA as a display field.
 *
 * Pattern #26: all colour comes from .ds-* classes (ds.css) — this file bakes
 * NO inline color/background styles. Pattern #29: phonemes missing from the
 * lookup degrade gracefully (symbol + score only).
 */
(function () {
  'use strict';

  // SAPI (en-US) → display IPA + example words + learner tips. Covers the
  // standard en-US phone set; symbols outside it degrade gracefully.
  var PHONEME_REF = {
    // ── Vowels ──
    aa: { ipa: 'ɑ',  examples: ['father', 'hot', 'car'],     tip_vn: 'Mở miệng rộng, âm "a" dài và sâu trong cổ họng.', tip_en: 'Open mouth wide, deep open "ah".' },
    ae: { ipa: 'æ',  examples: ['cat', 'bad', 'apple'],      tip_vn: 'Miệng mở rộng theo chiều ngang, giữa "a" và "e".', tip_en: 'Mouth wide, between "a" and "e".' },
    ah: { ipa: 'ʌ',  examples: ['cup', 'luck', 'but'],       tip_vn: 'Âm "ơ" ngắn, miệng thả lỏng tự nhiên.', tip_en: 'Short relaxed "uh".' },
    ao: { ipa: 'ɔ',  examples: ['dog', 'law', 'caught'],     tip_vn: 'Tròn môi, âm "o" mở.', tip_en: 'Rounded open "aw".' },
    aw: { ipa: 'aʊ', examples: ['now', 'house', 'out'],      tip_vn: 'Trượt từ "a" sang "u", môi tròn dần.', tip_en: 'Glide "a" → "oo", round the lips.' },
    ax: { ipa: 'ə',  examples: ['about', 'sofa', 'taken'],   tip_vn: 'Âm "ơ" rất nhẹ, không nhấn (schwa).', tip_en: 'Very light unstressed schwa.' },
    ay: { ipa: 'aɪ', examples: ['my', 'time', 'like'],       tip_vn: 'Trượt từ "a" sang "i", rõ cả hai phần.', tip_en: 'Glide "a" → "ee".' },
    eh: { ipa: 'ɛ',  examples: ['bed', 'head', 'said'],      tip_vn: 'Âm "e" ngắn, miệng mở vừa.', tip_en: 'Short "e" as in "bed".' },
    er: { ipa: 'ɝ',  examples: ['bird', 'her', 'work'],      tip_vn: 'Cong lưỡi lên, giữ âm "ơ-r" — đừng bỏ /r/.', tip_en: 'Curl tongue, hold the r-colour.' },
    ey: { ipa: 'eɪ', examples: ['day', 'name', 'say'],       tip_vn: 'Trượt từ "ê" sang "i".', tip_en: 'Glide "ay" → "ee".' },
    ih: { ipa: 'ɪ',  examples: ['sit', 'bit', 'ship'],       tip_vn: 'Âm "i" ngắn, lưỡi thấp hơn /iy/ — khác "ee".', tip_en: 'Short lax "i", lower than /iy/.' },
    iy: { ipa: 'iː', examples: ['see', 'eat', 'machine'],    tip_vn: 'Âm "i" dài, căng, kéo môi sang ngang.', tip_en: 'Long tense "ee", spread the lips.' },
    ow: { ipa: 'oʊ', examples: ['go', 'boat', 'know'],       tip_vn: 'Trượt từ "ô" sang "u", tròn môi dần.', tip_en: 'Glide "oh" → "oo".' },
    oy: { ipa: 'ɔɪ', examples: ['boy', 'coin', 'enjoy'],     tip_vn: 'Trượt từ "o" sang "i".', tip_en: 'Glide "oy".' },
    uh: { ipa: 'ʊ',  examples: ['book', 'put', 'good'],      tip_vn: 'Âm "u" ngắn, môi tròn nhẹ.', tip_en: 'Short lax "oo".' },
    uw: { ipa: 'uː', examples: ['food', 'blue', 'soon'],     tip_vn: 'Âm "u" dài, tròn môi mạnh.', tip_en: 'Long tense "oo", round firmly.' },
    // ── Consonants ──
    b:  { ipa: 'b',  examples: ['big', 'job', 'rubber'],     tip_vn: 'Bật hai môi, có rung thanh.', tip_en: 'Voiced lip stop.' },
    ch: { ipa: 'tʃ', examples: ['chair', 'watch', 'cheese'], tip_vn: 'Âm "ch" bật mạnh, không thành "sh".', tip_en: 'Sharp "ch", not "sh".' },
    d:  { ipa: 'd',  examples: ['dog', 'red', 'ladder'],     tip_vn: 'Đầu lưỡi chạm lợi, có rung.', tip_en: 'Voiced tongue-ridge stop.' },
    dh: { ipa: 'ð',  examples: ['this', 'mother', 'the'],    tip_vn: 'Lưỡi chạm răng trên, có rung — không thành "d"/"z".', tip_en: 'Voiced "th", tongue on teeth — not "d"/"z".' },
    f:  { ipa: 'f',  examples: ['fish', 'phone', 'laugh'],   tip_vn: 'Răng trên chạm môi dưới, thổi hơi.', tip_en: 'Top teeth on lower lip.' },
    g:  { ipa: 'g',  examples: ['go', 'bag', 'bigger'],      tip_vn: 'Cuống lưỡi chạm vòm mềm, có rung.', tip_en: 'Voiced back stop.' },
    hh: { ipa: 'h',  examples: ['hat', 'who', 'behind'],     tip_vn: 'Thở nhẹ ra, không nghẹn cổ.', tip_en: 'Light breath, no throat catch.' },
    jh: { ipa: 'dʒ', examples: ['job', 'page', 'bridge'],    tip_vn: 'Âm "j" có rung, mạnh hơn "ch".', tip_en: 'Voiced "j".' },
    k:  { ipa: 'k',  examples: ['cat', 'book', 'school'],    tip_vn: 'Cuống lưỡi bật, có hơi.', tip_en: 'Aspirated back stop.' },
    l:  { ipa: 'l',  examples: ['light', 'feel', 'yellow'],  tip_vn: 'Đầu lưỡi chạm lợi; cuối từ giữ rõ /l/.', tip_en: 'Tongue tip to ridge; keep final /l/.' },
    m:  { ipa: 'm',  examples: ['man', 'time', 'summer'],    tip_vn: 'Ngậm môi, âm mũi.', tip_en: 'Lips closed, nasal.' },
    n:  { ipa: 'n',  examples: ['no', 'sun', 'dinner'],      tip_vn: 'Đầu lưỡi chạm lợi, âm mũi.', tip_en: 'Tongue tip to ridge, nasal.' },
    ng: { ipa: 'ŋ',  examples: ['sing', 'long', 'thinking'], tip_vn: 'Âm mũi cuối, cuống lưỡi nâng — không thêm "g".', tip_en: 'Back nasal; don\'t add a hard "g".' },
    p:  { ipa: 'p',  examples: ['pen', 'stop', 'happy'],     tip_vn: 'Bật hai môi, có hơi, không rung.', tip_en: 'Aspirated lip stop.' },
    r:  { ipa: 'ɹ',  examples: ['red', 'very', 'around'],    tip_vn: 'Cong/lùi lưỡi, không chạm — khác "l".', tip_en: 'Curl tongue back, no contact — not "l".' },
    s:  { ipa: 's',  examples: ['see', 'bus', 'lesson'],     tip_vn: 'Hơi xì rõ, không rung.', tip_en: 'Clear hiss, unvoiced.' },
    sh: { ipa: 'ʃ',  examples: ['she', 'wish', 'nation'],    tip_vn: 'Âm "s" tròn môi hơn, "sh".', tip_en: 'Round-lipped "sh".' },
    t:  { ipa: 't',  examples: ['top', 'cat', 'better'],     tip_vn: 'Đầu lưỡi bật ở lợi, có hơi; giữ /t/ cuối từ.', tip_en: 'Aspirated tip stop; keep final /t/.' },
    th: { ipa: 'θ',  examples: ['think', 'bath', 'three'],   tip_vn: 'Lưỡi chạm răng trên, thổi hơi — không thành "t"/"s".', tip_en: 'Unvoiced "th", tongue on teeth.' },
    v:  { ipa: 'v',  examples: ['very', 'love', 'seven'],    tip_vn: 'Răng trên chạm môi dưới, có rung — khác "w"/"b".', tip_en: 'Voiced "v" — not "w"/"b".' },
    w:  { ipa: 'w',  examples: ['we', 'away', 'quick'],      tip_vn: 'Tròn môi mạnh, trượt nhanh.', tip_en: 'Round lips, quick glide.' },
    y:  { ipa: 'j',  examples: ['yes', 'you', 'beyond'],     tip_vn: 'Lưỡi nâng cao, trượt từ "i".', tip_en: 'Glide from "ee".' },
    z:  { ipa: 'z',  examples: ['zoo', 'is', 'busy'],        tip_vn: 'Như "s" nhưng có rung.', tip_en: 'Voiced "s".' },
    zh: { ipa: 'ʒ',  examples: ['measure', 'vision', 'beige'], tip_vn: 'Như "sh" nhưng có rung.', tip_en: 'Voiced "sh".' },
  };

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _tier(score) {
    if (score == null) return 'mid';
    if (score < 60) return 'low';
    if (score < 80) return 'mid';
    return 'high';
  }

  // Pure: word + its phonemes → modal inner HTML. Exposed for sentinels.
  function renderPhonemeDrilldown(word, phonemes) {
    var list = (phonemes || []).slice().sort(function (a, b) {
      return (a.score == null ? 999 : a.score) - (b.score == null ? 999 : b.score);
    });
    var rows = list.map(function (p) {
      var ref   = PHONEME_REF[p.symbol] || null;
      var tier  = _tier(p.score);
      var pct   = Math.max(0, Math.min(100, p.score == null ? 0 : p.score));
      var ipa   = ref ? ' <span class="ds-phoneme__ipa">/' + _esc(ref.ipa) + '/</span>' : '';
      var bar   = '<div class="ds-phoneme__bar"><div class="ds-phoneme__bar-fill ds-phoneme__bar-fill--' + tier + '" style="width:' + pct + '%"></div></div>';
      var ex    = ref
        ? '<p class="ds-phoneme__examples">Ví dụ: <b>' + ref.examples.map(_esc).join('</b>, <b>') + '</b></p>'
        : '';
      var tip   = ref
        ? '<p class="ds-phoneme__tip">' + _esc(ref.tip_vn) + '</p>'
        : '<p class="ds-phoneme__tip">Chưa có gợi ý chi tiết cho âm này.</p>';
      var score = (p.score == null ? '—' : Math.round(p.score));
      return '<div class="ds-phoneme">'
        + '<div class="ds-phoneme__row">'
        +   '<span class="ds-phoneme__sym">' + _esc(p.symbol) + ipa + '</span>'
        +   '<span class="ds-phoneme__score ds-phoneme__score--' + tier + '">' + score + '/100</span>'
        + '</div>' + bar + ex + tip
        + '</div>';
    }).join('');
    if (!rows) rows = '<p class="ds-phoneme__tip">Không có dữ liệu âm vị cho từ này.</p>';
    return '<div class="ds-modal__head">'
      + '<div><h3 class="ds-modal__title">Âm cần luyện — "' + _esc(word) + '"</h3>'
      +   '<p class="ds-modal__sub">Điểm theo từng âm vị (Azure, thang 0–100)</p></div>'
      + '<button type="button" class="ds-modal__close" aria-label="Đóng" data-pron-close>×</button>'
      + '</div>' + rows;
  }

  function _emitTelemetry(word, phonemes) {
    try {
      if (!(window.api && typeof window.api.post === 'function')) return;
      window.api.post('/api/analytics/events', {
        event_name: 'pronunciation_drilldown_view',
        event_data: { word: word, phonemes: (phonemes || []).map(function (p) { return p.symbol; }) },
        session_id: window.__pronSessionId || null,
      }).catch(function () { /* telemetry is best-effort */ });
    } catch (e) { /* never block the UI on telemetry */ }
  }

  var _lastTrigger = null;

  function _close(backdrop) {
    if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    document.removeEventListener('keydown', _onKeydown, true);
    if (_lastTrigger && typeof _lastTrigger.focus === 'function') _lastTrigger.focus();
  }

  function _onKeydown(e) {
    var backdrop = document.querySelector('.ds-modal-backdrop');
    if (!backdrop) return;
    if (e.key === 'Escape') { e.preventDefault(); _close(backdrop); return; }
    if (e.key === 'Tab') {
      // Lightweight focus trap within the modal.
      var f = backdrop.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function openPhonemeDrilldown(word, phonemes) {
    _lastTrigger = document.activeElement;
    var backdrop = document.createElement('div');
    backdrop.className = 'ds-modal-backdrop';
    var modal = document.createElement('div');
    modal.className = 'ds-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Phân tích âm vị cho từ ' + word);
    modal.innerHTML = renderPhonemeDrilldown(word, phonemes);
    backdrop.appendChild(modal);

    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) _close(backdrop); });
    modal.addEventListener('click', function (e) {
      if (e.target.closest('[data-pron-close]')) _close(backdrop);
    });
    document.addEventListener('keydown', _onKeydown, true);
    document.body.appendChild(backdrop);

    var closeBtn = modal.querySelector('[data-pron-close]');
    if (closeBtn) closeBtn.focus();
    _emitTelemetry(word, phonemes);
  }

  // Delegated trigger: weak-word badges (practice.js) carry .ds-pron-weak-word
  // + data-pron-idx into the per-render registry window.__pronWeakWords.
  function _handleTrigger(el) {
    var idx = parseInt(el.getAttribute('data-pron-idx'), 10);
    var reg = window.__pronWeakWords || [];
    var entry = reg[idx];
    if (entry) openPhonemeDrilldown(entry.word, entry.phonemes);
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('.ds-pron-weak-word');
    if (el) _handleTrigger(el);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target.closest && e.target.closest('.ds-pron-weak-word');
    if (el) { e.preventDefault(); _handleTrigger(el); }
  });

  // Expose for sentinels + practice.js.
  window.PronunciationDrilldown = {
    PHONEME_REF: PHONEME_REF,
    renderPhonemeDrilldown: renderPhonemeDrilldown,
    openPhonemeDrilldown: openPhonemeDrilldown,
  };
})();

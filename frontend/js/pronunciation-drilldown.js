/**
 * frontend/js/pronunciation-drilldown.js — Sprint 15.1 / 15.3
 *
 * Per-phoneme drill-down for weak words in the pronunciation feedback panel.
 * Sprint 15.3 PIVOT: was a native <dialog> modal (15.1.2); now an inline
 * accordion (native <details>/<summary>) rendered within the pronunciation
 * section so the surrounding context (scores, corrections, sample answer) stays
 * visible. A weak-word badge scrolls to + expands + highlights its sub-section.
 *
 * Empirical basis (Sprint 15.0/15.1 PF-1): Azure Granularity=Phoneme returns
 * SAPI phones (e.g. "ih", "ay"), HundredMark 0–100. PHONEME_REF is keyed on
 * SAPI symbols, with IPA as a display field.
 *
 * Pattern #26: colour comes from .ds-* classes (ds.css) — no inline color/bg.
 * Pattern #29: phonemes missing from the lookup degrade gracefully.
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

  // Smart default (PF-4): expand when there's a single weak word, collapse when
  // there are several (avoid a wall of phonemes). Pure — exposed for sentinels.
  function smartDefaultOpen(count) { return count <= 1; }

  // Pure: a word's phonemes → score-bar rows (sorted weakest-first). Pattern #29
  // fallback for symbols missing from PHONEME_REF.
  function _phonemeRows(phonemes) {
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
        : '<p class="ds-phoneme__tip">Hướng dẫn cho âm này đang được cập nhật.</p>';
      var score = (p.score == null ? '—' : Math.round(p.score));
      return '<div class="ds-phoneme">'
        + '<div class="ds-phoneme__row">'
        +   '<span class="ds-phoneme__sym">' + _esc(p.symbol) + ipa + '</span>'
        +   '<span class="ds-phoneme__score ds-phoneme__score--' + tier + '">' + score + '/100</span>'
        + '</div>' + bar + ex + tip
        + '</div>';
    }).join('');
    return rows || '<p class="ds-phoneme__tip">Không có dữ liệu âm vị cho từ này.</p>';
  }

  // Pure: weak words [{word, phonemes}] → accordion HTML (native <details>).
  // Exposed for practice.js (+ Sprint 15.3.1 result.html) and sentinels.
  function renderPronunciationAccordion(weakWords) {
    var items = weakWords || [];
    if (!items.length) return '';
    var openByDefault = smartDefaultOpen(items.length);
    var body = items.map(function (w) {
      var phs = w.phonemes || [];
      var weak = phs.filter(function (p) { return p.score != null && p.score < 70; }).length;
      var count = weak > 0 ? (weak + ' âm cần luyện') : (phs.length + ' âm');
      return '<details class="ds-accordion__item" data-drilldown-word="' + _esc(w.word) + '"' + (openByDefault ? ' open' : '') + '>'
        + '<summary class="ds-accordion__head">'
        +   '<span class="ds-accordion__word">' + _esc(w.word) + '</span>'
        +   '<span class="ds-accordion__count">' + _esc(count) + '</span>'
        + '</summary>'
        + '<div class="ds-accordion__body">' + _phonemeRows(phs) + '</div>'
        + '</details>';
    }).join('');
    return '<div class="ds-accordion" data-drilldown-content>'
      + '<p class="ds-accordion__hint">Bấm vào mỗi từ để xem chi tiết âm cần luyện.</p>'
      + body + '</div>';
  }

  // Sprint 15.3.1 — parse a persisted raw Azure pronunciation_payload (the shape
  // _persist_pronunciation stores: {...NBest...}) into the per-word `weakWords`
  // shape renderPronunciationAccordion consumes — the SAME shape practice.js
  // feeds it. Used by result.html (its on-demand pronunciation call was removed
  // pre-launch, so phonemes live only in this raw payload). Pure — no DOM.
  //   - legacy:true  → words present but no Phonemes arrays (pre-15.1, Word
  //                    granularity) → caller shows the placeholder.
  //   - {weakWords:[], legacy:false} → null/empty payload or no recognition.
  function extractWeakWordsFromPayload(payload, opts) {
    opts = opts || {};
    var threshold = (opts.threshold == null) ? 70.0 : opts.threshold;
    var raw = payload;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = null; } }
    var nbest = (raw && raw.NBest) || [];
    if (!nbest.length) return { weakWords: [], legacy: false };
    var words = nbest[0].Words || [];
    if (!words.length) return { weakWords: [], legacy: false };
    var anyPhonemes = words.some(function (w) { return Array.isArray(w.Phonemes) && w.Phonemes.length; });
    if (!anyPhonemes) return { weakWords: [], legacy: true };   // pre-15.1 Word-granularity
    var weakWords = [];
    words.forEach(function (w, idx) {
      var phs = (w.Phonemes || [])
        .map(function (p) { return { symbol: p.Phoneme, score: p.AccuracyScore }; })
        .filter(function (p) { return p.symbol != null && p.score != null; });
      if (!phs.length) return;
      var hasWeak = phs.some(function (p) { return p.score < threshold; });
      var errored = w.ErrorType && w.ErrorType !== 'None';
      if (hasWeak || errored) {
        weakWords.push({ word: w.Word || '', phonemes: phs, word_index: idx });
      }
    });
    return { weakWords: weakWords, legacy: false };
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

  // Expand + scroll to + briefly highlight a word's accordion sub-section.
  function _expandWord(word) {
    var sel = (window.CSS && CSS.escape) ? CSS.escape(word) : word;
    var details = document.querySelector('details.ds-accordion__item[data-drilldown-word="' + sel + '"]');
    if (!details) return false;
    details.open = true;
    if (typeof details.scrollIntoView === 'function') {
      details.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    details.classList.add('ds-accordion__item--highlight');
    setTimeout(function () { details.classList.remove('ds-accordion__item--highlight'); }, 1000);
    return true;
  }

  // Delegated: weak-word badge (practice.js, .ds-pron-weak-word + data-pron-idx
  // into window.__pronWeakWords) → expand its accordion sub-section.
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('.ds-pron-weak-word');
    if (!el) return;
    var idx = parseInt(el.getAttribute('data-pron-idx'), 10);
    var entry = (window.__pronWeakWords || [])[idx];
    if (!entry) return;
    if (_expandWord(entry.word)) _emitTelemetry(entry.word, entry.phonemes);
  });

  // Expose for practice.js + sentinels (+ Sprint 15.3.1 result.html reuse).
  window.PronunciationDrilldown = {
    PHONEME_REF: PHONEME_REF,
    renderPronunciationAccordion: renderPronunciationAccordion,
    extractWeakWordsFromPayload: extractWeakWordsFromPayload,
    smartDefaultOpen: smartDefaultOpen,
  };
})();

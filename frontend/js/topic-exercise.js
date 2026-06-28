/**
 * topic-exercise.js — practise a vocab TOPIC's stack with auto-generated drills.
 *
 * URL: topic-exercise.html?cat=<category>
 *
 * Loads the topic's full vocab_cards (GET /api/vocabulary/categories/{cat}/cards,
 * public — PR1) and BUILDS the questions client-side from the rich fields, so
 * every drill reuses data the card already has (no AI, no round-trip):
 *
 *   def_to_word    — definition → pick the word
 *   word_to_def    — word → pick the definition
 *   example_cloze  — fill the headword into its example sentence
 *   colloc_cloze   — fill the headword into a common collocation
 *   synonym        — pick a synonym of the word
 *   antonym        — pick an antonym of the word
 *   listen         — hear the word (pregenerated audio) → pick it
 *
 * MCQ, graded client-side; the feedback reveals the card's meaning + memory hook
 * so a miss still teaches. Distractors are other headwords / definitions from the
 * same topic, so wrong answers stay plausibly in-domain.
 */

(function () {
  const MAX_Q = 12;
  const _state = { cat: '', catTitle: '', cards: [], questions: [], index: 0, answered: false, score: 0 };
  let _audioEl = null;

  // ── tiny helpers ───────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function setHtml(html) { $('ex-container').innerHTML = html; }
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function showState(msg, isError) {
    setHtml(`<div class="state-msg${isError ? ' error' : ''}">${esc(msg)}</div>`);
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function sample(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function pickWords(correct, pool, n) {
    const seen = new Set([String(correct).toLowerCase()]);
    const out = [];
    for (const x of shuffle(pool.slice())) {
      const k = String(x).toLowerCase();
      if (!x || seen.has(k)) continue;
      seen.add(k); out.push(x);
      if (out.length >= n) break;
    }
    return out;
  }
  function pickDefs(correctDef, cards, exceptSlug, n) {
    const seen = new Set([String(correctDef)]);
    const out = [];
    for (const c of shuffle(cards.slice())) {
      if (c.slug === exceptSlug) continue;
      const d = c.definition_vi || c.definition_en;
      if (!d || seen.has(d)) continue;
      seen.add(d); out.push(d);
      if (out.length >= n) break;
    }
    return out;
  }
  function clozeable(text, hw) { return !!text && !!hw && text.toLowerCase().includes(hw.toLowerCase()); }
  function cloze(text, hw) {
    const i = text.toLowerCase().indexOf(hw.toLowerCase());
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<span class="blank-token">_____</span>' + esc(text.slice(i + hw.length));
  }

  function _speak(text) {
    if (!text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'en-GB'; u.rate = 0.92;
    window.speechSynthesis.speak(u);
  }
  function playAudio(url, fallback) {
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) {}
    if (_audioEl) { try { _audioEl.pause(); } catch (_) {} _audioEl = null; }
    if (url) { try { _audioEl = new Audio(url); _audioEl.play().catch(() => _speak(fallback)); return; } catch (_) {} }
    _speak(fallback);
  }

  // ── Question generation (client-side, from the card's own fields) ────────────
  function makeQuestion(card, headwords, allCards) {
    const hw = card.headword || '';
    if (!hw) return null;
    const eligible = [];
    if (card.definition_vi || card.definition_en) { eligible.push('def_to_word', 'word_to_def'); }
    if (clozeable(card.example, hw)) eligible.push('example_cloze');
    const colloc = (card.collocations || []).find(c => clozeable(c, hw));
    if (colloc) eligible.push('colloc_cloze');
    if ((card.synonyms || []).length) eligible.push('synonym');
    if ((card.antonyms || []).length) eligible.push('antonym');
    if (card.audio_headword) eligible.push('listen');
    if (!eligible.length) return null;

    const type = sample(eligible);
    const wordOptions = () => {
      const opts = shuffle([hw, ...pickWords(hw, headwords, 3)]);
      return { options: opts, answer: opts.indexOf(hw) };
    };

    if (type === 'def_to_word') {
      const { options, answer } = wordOptions();
      const en = (card.definition_vi && card.definition_en)
        ? `<span class="q-def-en">${esc(card.definition_en)}</span>` : '';
      return { type, label: 'Định nghĩa → Từ', card, options, answer,
        promptHtml: `<p class="q-lead">Từ nào khớp định nghĩa sau?</p>
          <div class="q-def">${esc(card.definition_vi || card.definition_en)}${en}</div>` };
    }
    if (type === 'word_to_def') {
      const def = card.definition_vi || card.definition_en;
      const opts = shuffle([def, ...pickDefs(def, allCards, card.slug, 3)]);
      if (opts.length < 2) return wordFallback();   // not enough distinct defs → fall back to def→word
      return { type, label: 'Từ → Định nghĩa', card, options: opts, answer: opts.indexOf(def),
        promptHtml: `<p class="q-lead">Định nghĩa nào đúng cho từ này?</p>
          <div class="q-prompt"><span class="feedback-word">${esc(hw)}</span></div>` };
    }
    if (type === 'example_cloze') {
      const { options, answer } = wordOptions();
      return { type, label: 'Điền vào câu', card, options, answer,
        promptHtml: `<p class="q-lead">Điền từ còn thiếu vào câu:</p>
          <div class="q-prompt">${cloze(card.example, hw)}</div>` };
    }
    if (type === 'colloc_cloze') {
      const { options, answer } = wordOptions();
      return { type, label: 'Cụm từ', card, options, answer,
        promptHtml: `<p class="q-lead">Điền từ vào cụm thường gặp:</p>
          <div class="q-prompt">${cloze(colloc, hw)}</div>` };
    }
    if (type === 'synonym' || type === 'antonym') {
      const list = type === 'synonym' ? card.synonyms : card.antonyms;
      const ans = sample(list);
      const exclude = new Set([hw.toLowerCase(), ...list.map(s => String(s).toLowerCase())]);
      const pool = headwords.filter(h => !exclude.has(h.toLowerCase()));
      const opts = shuffle([ans, ...pickWords(ans, pool, 3)]);
      const word = type === 'synonym' ? 'ĐỒNG NGHĨA' : 'TRÁI NGHĨA';
      return { type, label: type === 'synonym' ? 'Đồng nghĩa' : 'Trái nghĩa', card, options: opts, answer: opts.indexOf(ans),
        promptHtml: `<p class="q-lead">Từ nào <strong>${word}</strong> với từ này?</p>
          <div class="q-prompt"><span class="feedback-word">${esc(hw)}</span></div>` };
    }
    if (type === 'listen') {
      const { options, answer } = wordOptions();
      return { type, label: 'Nghe', card, options, answer, audioUrl: card.audio_headword,
        promptHtml: `<p class="q-lead">Nghe và chọn từ đúng:</p>
          <div class="q-audio-wrap"><button type="button" class="q-audio-btn" id="q-audio">🔊 Nghe lại</button></div>` };
    }
    function wordFallback() {
      const { options, answer } = wordOptions();
      return { type: 'def_to_word', label: 'Định nghĩa → Từ', card, options, answer,
        promptHtml: `<p class="q-lead">Từ nào khớp định nghĩa sau?</p>
          <div class="q-def">${esc(card.definition_vi || card.definition_en || hw)}</div>` };
    }
    return null;
  }

  function buildQuestions() {
    const headwords = _state.cards.map(c => c.headword).filter(Boolean);
    const qs = [];
    for (const card of shuffle(_state.cards.slice())) {
      const q = makeQuestion(card, headwords, _state.cards);
      if (q && q.options.length >= 2) qs.push(q);
      if (qs.length >= MAX_Q) break;
    }
    _state.questions = qs;
  }

  // ── Screens ──────────────────────────────────────────────────────────────
  function renderStart() {
    setHtml(`
      <div class="start-screen">
        <h2>Luyện tập: ${esc(_state.catTitle)}</h2>
        <p>${_state.cards.length} từ trong chủ đề này. Mỗi phiên tối đa ${MAX_Q} câu, đủ dạng:
           định nghĩa, điền câu, đồng/trái nghĩa, và nghe.</p>
        <button type="button" id="ex-start" class="btn-primary btn-large">Bắt đầu</button>
      </div>`);
    $('ex-start').addEventListener('click', () => {
      buildQuestions();
      if (!_state.questions.length) { showState('Chưa tạo được câu hỏi cho chủ đề này.'); return; }
      _state.index = 0; _state.score = 0;
      document.addEventListener('keydown', onKey);
      renderQuestion();
    });
  }

  function renderQuestion() {
    const q = _state.questions[_state.index];
    if (!q) { renderSummary(); return; }
    _state.answered = false;

    const total = _state.questions.length;
    const pct = Math.round((_state.index / total) * 100);
    const optsHtml = q.options.map((opt, i) =>
      `<button type="button" class="option-btn" data-i="${i}">
         <span class="opt-key">${i + 1}.</span> ${esc(opt)}</button>`).join('');

    setHtml(`
      <div class="exercise-active">
        <div class="progress-header">
          <span class="progress-text">${_state.index + 1} / ${total}</span>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          <span class="qtype-tag">${esc(q.label)}</span>
        </div>
        ${q.promptHtml}
        <div class="options" id="ex-options">${optsHtml}</div>
        <div id="ex-feedback"></div>
      </div>`);

    document.querySelectorAll('.option-btn').forEach(b =>
      b.addEventListener('click', () => onAnswer(parseInt(b.getAttribute('data-i'), 10))));
    const ab = $('q-audio');
    if (ab) ab.addEventListener('click', () => playAudio(q.audioUrl, q.card.headword));
    if (q.type === 'listen') playAudio(q.audioUrl, q.card.headword);  // auto-play once
  }

  function onAnswer(idx) {
    if (_state.answered) return;
    _state.answered = true;
    const q = _state.questions[_state.index];
    const correct = idx === q.answer;
    if (correct) _state.score++;

    document.querySelectorAll('.option-btn').forEach((b, i) => {
      b.disabled = true;
      if (i === q.answer) b.classList.add('correct');
      else if (i === idx) b.classList.add('wrong');
      else b.classList.add('dimmed');
    });

    const c = q.card;
    const last = _state.index >= _state.questions.length - 1;
    $('ex-feedback').innerHTML = `
      <div class="feedback ${correct ? 'correct' : 'wrong'}">
        <div class="feedback-head">${correct ? '✓ Chính xác!' : '✗ Chưa đúng'}</div>
        <div><span class="feedback-word">${esc(c.headword)}</span>${c.pronunciation ? `<span class="feedback-ipa">${esc(c.pronunciation)}</span>` : ''}</div>
        ${(c.definition_vi || c.definition_en) ? `<p class="feedback-def">${esc(c.definition_vi || c.definition_en)}</p>` : ''}
        ${c.example ? `<p class="feedback-def" style="font-style:italic;opacity:0.85">“${esc(c.example)}”</p>` : ''}
        ${c.memory_hook ? `<p class="feedback-hook">💡 ${esc(c.memory_hook)}</p>` : ''}
        <div class="feedback-actions">
          <button type="button" id="ex-next" class="btn-primary">${last ? 'Xem kết quả' : 'Tiếp theo →'}</button>
        </div>
      </div>`;
    $('ex-next').addEventListener('click', next);
  }

  function next() {
    _state.index++;
    if (_state.index >= _state.questions.length) renderSummary();
    else renderQuestion();
  }

  function renderSummary() {
    document.removeEventListener('keydown', onKey);
    const total = _state.questions.length;
    const pct = total ? Math.round((_state.score / total) * 100) : 0;
    const backHref = 'vocabulary.html#vocab-topics';
    setHtml(`
      <div class="summary">
        <h2>Hoàn thành: ${esc(_state.catTitle)}</h2>
        <p>Bạn trả lời đúng ${_state.score}/${total} câu.</p>
        <div class="score-number">${_state.score}/${total}</div>
        <div class="score-percent">${pct}% chính xác</div>
        <div class="summary-actions">
          <button type="button" id="ex-restart" class="btn-primary">Làm lại</button>
          <a href="${backHref}" class="btn-secondary">Chọn chủ đề khác</a>
        </div>
      </div>`);
    $('ex-restart').addEventListener('click', () => {
      buildQuestions();
      _state.index = 0; _state.score = 0;
      document.addEventListener('keydown', onKey);
      renderQuestion();
    });
  }

  function onKey(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (!_state.answered && /^[1-9]$/.test(e.key)) {
      const i = parseInt(e.key, 10) - 1;
      const btns = document.querySelectorAll('.option-btn');
      if (i < btns.length) { e.preventDefault(); onAnswer(i); }
    } else if (_state.answered && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); next();
    }
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  async function init() {
    const params = new URLSearchParams(window.location.search);
    _state.cat = (params.get('cat') || '').trim();
    if (!_state.cat) { showState('Thiếu chủ đề — quay lại danh sách chủ đề.', true); return; }

    showState('', false);
    setHtml('<div class="state-msg"><div class="spinner"></div></div>');
    try {
      const body = await window.api.get('/api/vocabulary/categories/' + encodeURIComponent(_state.cat) + '/cards');
      _state.cards = (body && Array.isArray(body.cards)) ? body.cards : [];
      _state.catTitle = (body && body.category) || _state.cat;
    } catch (err) {
      showState('Không tải được từ vựng. Thử lại sau.', true);
      return;
    }
    if (_state.cards.length < 4) {
      showState('Chủ đề này chưa đủ từ để luyện tập (cần ít nhất 4 từ).');
      return;
    }
    const titleEl = $('ex-title');
    if (titleEl) titleEl.textContent = 'Luyện tập · ' + _state.catTitle;
    renderStart();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

import { createActiveTimer } from './course-active-timer.js';

/**
 * Bài đọc ngắn đi kèm bài tập theo buổi.
 *
 * Module giữ draft nhẹ ở máy; chỉ khi đủ câu mới nộp để server chấm và đưa vào
 * điểm tổng hợp. Bản dịch/đáp án không có trong bank payload trước lúc nộp.
 */

const esc = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function inlineMd(value) {
  return esc(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

export const readingDraftKey = (bankId, userId) =>
  `cr:${userId || 'anon'}:${bankId}`;

export function createReading({ api, storage, userId, assignmentItemId = null,
  now = () => Date.now() }) {
  let bankId = null;
  let data = null;
  let draft = {};
  let solution = null;
  const activeTimer = createActiveTimer(now);

  function questions() {
    return (data && data.question_groups || []).flatMap((group) => group.questions || []);
  }

  function save() {
    if (!storage || !bankId) return;
    try { storage.setItem(readingDraftKey(bankId, userId), JSON.stringify(draft)); }
    catch (e) { /* lưu cục bộ hỏng không được chặn làm bài */ }
  }

  function loadDraft() {
    if (!storage || !bankId) return {};
    try { return JSON.parse(storage.getItem(readingDraftKey(bankId, userId)) || '{}') || {}; }
    catch (e) { return {}; }
  }

  const missing = () => questions()
    .filter((q) => !String(draft[q.id] || '').trim())
    .map((q) => q.id);

  function answerFor(qid) {
    if (!solution || !Array.isArray(solution.answers)) return null;
    return solution.answers.find((row) => row.id === qid) || null;
  }

  function renderQuestion(group, q) {
    const chosen = String(draft[q.id] || '');
    const key = answerFor(q.id);
    const result = key ? `<div class="cr-answer">
      <span class="cr-answer__key">Đáp án · ${inlineMd(key.answer)}</span>
      <p>${inlineMd(key.explanation)}</p>
    </div>` : '';
    if (group.input_type === 'tfng') {
      return `<li class="cr-question" id="cr-${esc(q.id)}">
        <p><span class="cr-question__no">${q.number}</span><span class="cr-question__prompt">${inlineMd(q.prompt)}</span></p>
        <div class="cr-choices" role="radiogroup" aria-label="Câu ${q.number}">
          ${['T', 'F', 'NG'].map((choice) => `<label>
            <input class="cr-input" type="radio" name="cr-${esc(q.id)}"
              data-qid="${esc(q.id)}" value="${choice}"${chosen === choice ? ' checked' : ''}>
            <span>${choice}</span>
          </label>`).join('')}
        </div>${result}
      </li>`;
    }
    return `<li class="cr-question" id="cr-${esc(q.id)}">
      <label for="cr-input-${esc(q.id)}"><span class="cr-question__no">${q.number}</span><span class="cr-question__prompt">${inlineMd(q.prompt)}</span></label>
      <input class="cr-input cr-text" id="cr-input-${esc(q.id)}" data-qid="${esc(q.id)}"
        type="text" value="${esc(chosen)}" autocomplete="off"
        placeholder="Viết câu trả lời ngắn…">${result}
    </li>`;
  }

  function render() {
    if (!data) return '';
    const role = String(data.role || 'bài về nhà')
      .replace(/^bài luyện đọc\s*[—-]\s*/i, '');
    const miss = missing();
    const questionCount = questions().length;
    const groups = (data.question_groups || []).map((group) => `
      <section class="cr-question-group" aria-labelledby="cr-group-${esc(group.id)}">
        <header><span>Phần ${group.id === 'content' ? '1' : '2'}</span>
          <h3 id="cr-group-${esc(group.id)}">${esc(group.title)}</h3></header>
        <ol>${(group.questions || []).map((q) => renderQuestion(group, q)).join('')}</ol>
      </section>`).join('');
    const translation = solution ? `<section class="cr-translation">
      <p class="cr-kicker">Bản dịch tham khảo</p>
      <h2>${esc(data.title)}</h2>
      <p>${inlineMd(solution.translation)}</p>
    </section>` : '';

    const result = solution?.result;
    return `<article class="cr-shell">
      <button class="cr-back" id="cr-back" type="button">← Quay lại tổng kết</button>
      <header class="cr-hero">
        <div><p class="cr-kicker">Bài luyện đọc · ${esc(role)}</p>
          <h2>${esc(data.title)}</h2>
          <p>Trọng tâm: ${esc(data.focus)}</p></div>
        <span class="cr-word-count">${Number(data.word_count) || 0}<small>từ</small></span>
      </header>
      <div class="cr-guide" role="note"><strong>Cách làm</strong>
        <span>Đọc lượt đầu không tra từ. Lượt hai dùng bảng từ vựng, rồi hoàn thành đủ ${questionCount} câu trước khi đối chiếu.</span>
      </div>
      <div class="cr-reading-grid">
        <section class="cr-passage" aria-labelledby="cr-passage-title">
          <p class="cr-kicker">Bài đọc</p><h3 id="cr-passage-title">${esc(data.title)}</h3>
          <p lang="en">${esc(data.passage)}</p>
        </section>
        <aside class="cr-vocab" aria-labelledby="cr-vocab-title">
          <p class="cr-kicker">Từ vựng hỗ trợ</p><h3 id="cr-vocab-title">Tra nhanh khi đọc lượt hai</h3>
          <dl>${(data.vocabulary || []).map((row) => `<div>
            <dt>${esc(row.term)} <small>${esc(row.part_of_speech)}</small></dt>
            <dd>${esc(row.meaning)}</dd></div>`).join('')}</dl>
        </aside>
      </div>
      <div class="cr-groups">${groups}</div>
      ${translation}
      <footer class="cr-bar" id="cr-bar">
        <p>${solution
          ? `<strong>Đã nộp phần đọc.</strong> ${result ? `${result.correct}/${result.total} câu đúng · ${Math.round(result.pct)}%.` : 'Kết quả đã được lưu.'}`
          : miss.length
            ? `Còn <strong>${miss.length}</strong> câu chưa trả lời. Điền đủ để mở bản dịch và lời giải.`
            : `Đã trả lời đủ ${questionCount} câu. Bạn có thể mở bản dịch và lời giải.`}</p>
        ${solution ? '' : `<button class="av-button av-button-primary" id="cr-check" type="button"${
          miss.length ? ' disabled' : ''}>Nộp phần đọc</button>`}
      </footer>
    </article>`;
  }

  return {
    get exists() { return !!data; },
    get count() { return questions().length; },
    get missing() { return missing(); },
    get revealed() { return !!solution; },
    get result() { return solution?.result || null; },
    get course() { return solution?.result?.course || null; },
    load(bank) {
      bankId = bank && bank.id;
      data = bank && bank.meta && bank.meta.short_reading || null;
      draft = data ? loadDraft() : {};
      solution = null;
      activeTimer.reset();
      return !!data;
    },
    setActive(active) { activeTimer.setActive(active); },
    write(qid, value) {
      if (!data || !questions().some((q) => q.id === qid)) return;
      draft[qid] = String(value || '');
      save();
    },
    async reveal() {
      if (!data || missing().length) return false;
      solution = await api.post('/api/quiz/course/reading-solution', {
        bank_id: bankId, answers: { ...draft },
        duration_sec: activeTimer.seconds(),
        ...(assignmentItemId ? { class_item: assignmentItemId } : {}),
      });
      draft = { ...(solution?.result?.submitted_answers || draft) };
      save();
      activeTimer.setActive(false);
      return true;
    },
    async review() {
      if (!data) return false;
      solution = await api.post('/api/quiz/course/reading-solution', {
        bank_id: bankId, answers: {}, duration_sec: 0,
        ...(assignmentItemId ? { class_item: assignmentItemId } : {}),
      });
      draft = { ...(solution?.result?.submitted_answers || {}) };
      save();
      activeTimer.setActive(false);
      return true;
    },
    render,
  };
}

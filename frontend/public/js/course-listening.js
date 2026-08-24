import { createActiveTimer } from './course-active-timer.js';

/** Bài nghe ngắn: draft nhẹ ở máy, nộp đủ một lần và tính vào điểm tổng hợp. */

const esc = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const listeningDraftKey = (bankId, userId, assignmentItemId = null) =>
  `cl:${userId || 'anon'}:${bankId}:${assignmentItemId || 'unscoped'}`;

export function createListening({ api, storage, userId, assignmentItemId = null,
  now = () => Date.now() }) {
  let bankId = null;
  let data = null;
  let draft = {};
  let solution = null;
  const activeTimer = createActiveTimer(now);

  const questions = () => (data?.sections || [])
    .flatMap((section) => section.questions || []);
  const missing = () => questions().filter((q) => !draft[q.id]).map((q) => q.id);

  function loadDraft() {
    if (!storage || !bankId) return {};
    try { return JSON.parse(storage.getItem(
      listeningDraftKey(bankId, userId, assignmentItemId)) || '{}') || {}; }
    catch (_error) { return {}; }
  }

  function save() {
    if (!storage || !bankId) return;
    try { storage.setItem(
      listeningDraftKey(bankId, userId, assignmentItemId), JSON.stringify(draft)); }
    catch (_error) { /* localStorage hỏng không chặn làm bài */ }
  }

  function answerFor(qid) {
    return (solution?.answers || []).find((row) => row.id === qid) || null;
  }

  function renderQuestion(section, question) {
    const chosen = String(draft[question.id] || '');
    const answer = answerFor(question.id);
    const options = question.options || [];
    const audio = question.audio_url
      ? `<audio class="cl-audio" controls preload="none" src="${esc(question.audio_url)}">
          Trình duyệt không phát được audio.</audio>` : '';
    const prompt = question.prompt
      ? `<p class="cl-prompt">${esc(question.prompt)}</p>` : '';
    const feedback = answer ? `<div class="cl-feedback" data-correct="${chosen === answer.answer}">
      <strong>Đáp án ${esc(answer.answer)}</strong>${answer.transcript
        ? `<span>Nghe được: “${esc(answer.transcript)}”</span>` : ''}
    </div>` : '';
    return `<li class="cl-question">
      <div class="cl-question__head"><span>Câu ${question.number}</span>${audio}</div>
      ${prompt}
      <div class="cl-options" role="radiogroup" aria-label="Phần ${esc(section.label)}, câu ${question.number}">
        ${options.map((option, index) => {
          const key = String.fromCharCode(65 + index);
          const value = section.mode === 'section_audio' ? option : key;
          return `<label><input class="cl-input" type="radio" name="cl-${esc(question.id)}"
            data-qid="${esc(question.id)}" value="${esc(value)}"${chosen === value ? ' checked' : ''}>
            <span><b>${key}</b>${esc(option)}</span></label>`;
        }).join('')}
      </div>${feedback}
    </li>`;
  }

  function render() {
    if (!data) return '';
    const miss = missing();
    const sections = (data.sections || []).map((section) => `
      <section class="cl-section" aria-labelledby="cl-${esc(section.id)}">
        <header><span class="cl-section__label">Phần ${esc(section.label)}</span>
          <div><h3 id="cl-${esc(section.id)}">${esc(section.title)}</h3>
          <p>${section.mode === 'section_audio'
            ? 'Nghe toàn bài, sau đó chọn Đúng, Sai hoặc Không có thông tin.'
            : 'Bấm nghe từng đoạn, rồi chọn phương án bạn nghe được.'}</p></div></header>
        ${section.audio_url ? `<audio class="cl-audio cl-audio--wide" controls preload="none"
          src="${esc(section.audio_url)}">Trình duyệt không phát được audio.</audio>` : ''}
        <ol>${(section.questions || []).map((q) => renderQuestion(section, q)).join('')}</ol>
      </section>`).join('');
    const transcript = solution ? `<section class="cl-transcript">
      <p class="cl-kicker">Transcript và bản dịch</p>
      <h3>Bài nghe phần D</h3><p lang="en">${esc(solution.talk_transcript)}</p>
      <details><summary>Xem bản dịch tham khảo</summary><p>${esc(solution.talk_translation)}</p></details>
    </section>` : '';

    const result = solution?.result;
    return `<article class="cl-shell">
      <button class="cl-back" id="cl-back" type="button">← Quay lại tổng kết</button>
      <header class="cl-hero"><div><p class="cl-kicker">Bài luyện nghe · 4 phần</p>
        <h2>${esc(data.title)}</h2><p>Trọng tâm: ${esc(data.focus)}</p></div>
        <strong>${questions().length}<small>câu nghe</small></strong></header>
      <div class="cl-guide" role="note"><strong>Cách làm</strong><span>Nghe trước khi nhìn lại lựa chọn. Bạn có thể phát lại audio; transcript và đáp án chỉ mở sau khi hoàn thành đủ bài.</span></div>
      <div class="cl-sections">${sections}</div>${transcript}
      <footer class="cl-bar" id="cl-bar"><p>${solution
        ? `<strong>Đã nộp phần nghe.</strong> ${result ? `${result.correct}/${result.total} câu đúng · ${Math.round(result.pct)}%.` : 'Kết quả đã được lưu.'}`
        : miss.length ? `Còn <strong>${miss.length}</strong> câu chưa trả lời.`
          : `Đã trả lời đủ ${questions().length} câu. Bạn có thể mở đáp án và transcript.`}</p>
        ${solution ? '' : `<button class="av-button av-button-primary" id="cl-check" type="button"${
          miss.length ? ' disabled' : ''}>Nộp phần nghe</button>`}</footer>
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
      bankId = bank?.id;
      data = bank?.meta?.short_listening || null;
      draft = data ? loadDraft() : {};
      solution = null;
      activeTimer.reset();
      return !!data;
    },
    setActive(active) { activeTimer.setActive(active); },
    write(qid, value) {
      if (!questions().some((q) => q.id === qid)) return;
      draft[qid] = String(value || '');
      save();
    },
    async reveal() {
      if (!data || missing().length) return false;
      solution = await api.post('/api/quiz/course/listening-solution', {
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
      if (!bankId) return false;
      solution = await api.post('/api/quiz/course/listening-solution', {
        bank_id: bankId, answers: {}, duration_sec: 0,
        ...(assignmentItemId ? { class_item: assignmentItemId } : {}),
      });
      draft = { ...(solution?.result?.submitted_answers || {}) };
      activeTimer.setActive(false);
      return true;
    },
    async refreshAudio() {
      if (!bankId) return false;
      data = await api.post('/api/quiz/course/listening-audio', {
        bank_id: bankId,
        ...(assignmentItemId ? { class_item: assignmentItemId } : {}),
      });
      return true;
    },
    render,
  };
}

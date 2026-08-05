/**
 * course-writing.js — phần TỰ LUẬN của bài tập theo buổi.
 *
 * KHÔNG chạm DOM để quyết định gì; trang gọi vào đây, module trả HTML và giữ
 * bản nháp. Tách khỏi `course-runner.js` vì nhịp khác hẳn: ở kia là
 * hỏi–đáp–giải thích từng câu, ở đây là ngồi viết cả cụm rồi nộp MỘT lần.
 *
 * Ba luật của phần này, và cả ba đều dễ hỏng nếu để trong trang:
 *   · nộp MỘT lần cho mỗi học viên mỗi bank (server giữ, không phải localStorage);
 *   · ĐỦ CÂU MỚI NHẬN — thiếu một câu thì giữ nháp và chờ;
 *   · chưa chấm được KHÁC HẲN câu-của-em-đúng.
 */

const esc = (s) => (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
  ? window.WC.escapeHtml(s)
  : String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** `**đậm**` → <mark>. Thoát HTML TRƯỚC rồi mới dựng thẻ. */
export function md(s) {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, '<mark>$1</mark>');
}

/**
 * Cặp câu (gốc, đã sửa) → một dòng có gạch bỏ chỗ sai và chỗ đúng liền sau.
 *
 * So theo TỪ, không theo ký tự: một dấu nháy đổi chỗ không được biến cả câu
 * thành đỏ, và học viên đọc theo từ chứ không theo ký tự. Thuật toán là tiền tố
 * chung + hậu tố chung — đủ cho việc sửa lỗi ngữ pháp (thường là một hai chỗ),
 * và không bao giờ dựng ra một bản diff sai lệch như các phép so xấp xỉ.
 */
export function inlineDiff(before, after) {
  const A = String(before || '').split(/(\s+)/);
  const B = String(after || '').split(/(\s+)/);
  let head = 0;
  while (head < A.length && head < B.length && A[head] === B[head]) head += 1;
  let tail = 0;
  while (tail < A.length - head && tail < B.length - head
         && A[A.length - 1 - tail] === B[B.length - 1 - tail]) tail += 1;

  const same1 = A.slice(0, head).join('');
  const del   = A.slice(head, A.length - tail).join('');
  const ins   = B.slice(head, B.length - tail).join('');
  const same2 = A.slice(A.length - tail).join('');

  return esc(same1)
    + (del ? `<del>${esc(del)}</del>` : '')
    + (ins ? `<ins>${esc(ins)}</ins>` : '')
    + esc(same2);
}

const KIND = { grammar: 'ngữ pháp', spelling: 'chính tả' };

/** Khoá bản nháp — theo BANK, để hai bài khác nhau không đè nhau. */
/**
 * Khoá bản nháp — theo BANK **và** NGƯỜI DÙNG.
 *
 * Chỉ theo bank thì hai học viên dùng chung một máy (phòng máy, máy nhà) sẽ mở
 * ra bài viết dở của nhau, và tệ hơn — nộp nhầm dưới tài khoản mình. Ở đây
 * localStorage là bộ nhớ CHUNG của trình duyệt, không phải của tài khoản
 * (codex #935).
 */
export const draftKey = (bankId, userId, itemId) =>
  'cw:' + (userId || 'anon') + ':' + bankId + (itemId ? ':' + itemId : '');

export function createWriting({ api, storage, userId }) {
  let bankId = null;
  let questions = [];
  let submitted = false;
  let submission = null;
  let draft = {};
  let itemId = null;

  function loadDraft() {
    if (!storage) return {};
    try { return JSON.parse(storage.getItem(draftKey(bankId, userId, itemId)) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function saveDraft() {
    if (!storage || submitted) return;   // đã nộp thì nháp không còn nghĩa
    try { storage.setItem(draftKey(bankId, userId, itemId), JSON.stringify(draft)); }
    catch (e) { /* trình duyệt chặn lưu — vẫn viết và nộp được */ }
  }

  const missing = () => questions
    .filter((q) => !String(draft[q.qid] || '').trim())
    .map((q) => q.qid);

  return {
    get submitted() { return submitted; },
    get questions() { return questions.slice(); },
    get missing() { return missing(); },
    get draft() { return { ...draft }; },

    async load(id) {
      bankId = id;
      const r = await api.get('/api/quiz/course/writing?bank_id=' + encodeURIComponent(id));
      itemId = (r && r.item_id) || null;
      questions = (r && r.questions) || [];
      submitted = !!(r && r.submitted);
      submission = (r && r.submission) || null;
      // Nộp rồi thì bản nháp là rác — và giữ nó lại chỉ để một ngày nào đó
      // hiện lên đè lên bài đã chấm.
      draft = submitted ? {} : loadDraft();
      if (submitted && storage) {
        try { storage.removeItem(draftKey(bankId, userId, itemId)); } catch (e) { /* kệ */ }
      }
      return { submitted, count: questions.length };
    },

    /** Ghi một câu vào nháp. Trả về số câu còn thiếu. */
    write(qid, text) {
      if (submitted) return missing().length;
      draft[qid] = text;
      saveDraft();
      return missing().length;
    },

    /**
     * Nộp CẢ CỤM. Thiếu câu thì KHÔNG gọi mạng — lượt chấm chỉ có một, và tiêu
     * nó cho một bài dở dang là không lấy lại được.
     */
    async submit() {
      if (submitted) return { already: true };
      const miss = missing();
      if (miss.length) return { missing: miss };
      const answers = {};
      questions.forEach((q) => { answers[q.qid] = String(draft[q.qid] || '').trim(); });
      const r = await api.post('/api/quiz/course/writing', { bank_id: bankId, answers });
      submitted = true;
      submission = r;
      if (storage) {
        try { storage.removeItem(draftKey(bankId, userId, itemId)); } catch (e) { /* kệ */ }
      }
      return { graded: r };
    },

    /** Màn VIẾT. */
    renderForm() {
      const items = questions.map((q, i) => {
        const val = draft[q.qid] || '';
        const gap = !String(val).trim();
        return `<article class="cw-item" id="cw-${esc(q.qid)}"${gap ? ' data-missing="false"' : ''}>
          <span class="cw-item__no">Câu ${i + 1} · ${esc(q.subtype || '')}</span>
          <p class="cw-item__ask">${md(q.prompt)}</p>
          <textarea class="cw-write" data-qid="${esc(q.qid)}" rows="2"
            aria-label="Câu trả lời cho câu ${i + 1}"
            placeholder="Viết câu của bạn…">${esc(val)}</textarea>
        </article>`;
      }).join('');
      return `<div class="cw-intro">
          <h2>Phần tự luận — ${questions.length} câu</h2>
          <p>Viết hết các câu rồi bấm nộp. Máy soát <strong>ngữ pháp và chính tả</strong>
             rồi trả lại câu đã sửa — không đổi cách viết của bạn.
             <strong>Chỉ nộp được một lần</strong>, nên viết xong hãy đọc lại.</p>
        </div>
        <div class="cw-list">${items}</div>
        <div class="cw-bar">
          <span class="cw-bar__note" id="cw-note"></span>
          <button class="av-button av-button-primary" id="cw-submit" type="button">Nộp phần tự luận</button>
        </div>`;
    },

    /** Dòng trạng thái ở thanh nộp — kèm đường nhảy tới câu còn thiếu. */
    renderNote() {
      const miss = missing();
      if (!miss.length) {
        return `Đã viết đủ ${questions.length}/${questions.length} câu. Đọc lại rồi nộp.`;
      }
      const idx = {};
      questions.forEach((q, i) => { idx[q.qid] = i + 1; });
      const jump = miss.slice(0, 10)
        .map((qid) => `<a href="#cw-${esc(qid)}">${idx[qid]}</a>`).join('');
      return `Còn <strong>${miss.length}</strong> câu chưa viết`
        + `<span class="cw-jump">${jump}</span>`;
    },

    /** Màn ĐÃ CHẤM. */
    renderResult() {
      // DỰNG TỪ BẢN CHỤP, không từ đề hiện hành. `submission.items` giữ nguyên
      // văn đề + bài viết + bản chấm tại thời điểm nộp, đúng vì bộ đề CÓ THỂ
      // được soạn lại (Buổi 1 vừa đổi 31/100 câu). Lấy đề hiện hành làm gốc thì
      // câu bị xoá/đổi mã sẽ làm bản chấm biến mất, còn câu giữ mã mà đổi đề sẽ
      // hiện bài cũ dưới một đề mới (codex #935).
      const items0 = (submission && submission.items) || [];
      const byQid = {};
      questions.forEach((q) => { byQid[q.qid] = q; });
      const clean = (submission && submission.clean) || 0;
      const total = (submission && submission.total) || items0.length;

      const items = items0.map((g, i) => {
        const q = byQid[g.qid] || {};
        const ok = g.ok;
        const body = ok === null
          ? `<p class="cw-diff">${esc(g.answer)}</p>`
            + `<p class="cw-unknown">${esc(g.error || 'Chưa chấm được câu này.')}</p>`
          : ok
              ? `<p class="cw-diff">${esc(g.answer)}</p>`
                + '<p class="cw-unknown">Không có lỗi ngữ pháp hay chính tả.</p>'
              : `<p class="cw-diff">${inlineDiff(g.answer, g.corrected)}</p>`
                + `<ul class="cw-issues">${(g.issues || []).map((x) => `
                    <li class="cw-issue">
                      <span class="cw-issue__kind">${esc(KIND[x.type] || x.type || 'lỗi')}</span>
                      <span><del>${esc(x.before || '')}</del> → <b>${esc(x.after || '')}</b></span>
                      ${x.note ? `<span class="cw-issue__note">${esc(x.note)}</span>` : ''}
                    </li>`).join('')}</ul>`;
        // Đáp án mẫu cũng từ BẢN CHỤP: đề soạn lại mà lấy `q.explain` thì bài
        // cũ đứng cạnh đáp án mẫu của một đề khác (codex #935).
        const modelText = g.explain || q.explain || '';
        const model = modelText ? `<div class="cw-model">${md(modelText)}</div>` : '';
        // Đề lấy từ BẢN CHỤP trước, đề hiện hành chỉ là phương án dự phòng.
        const ask = g.prompt || q.prompt || '';
        return `<article class="cw-item" data-ok="${String(ok)}">
          <span class="cw-item__no">Câu ${i + 1}${q.subtype ? ' · ' + esc(q.subtype) : ''}</span>
          <p class="cw-item__ask">${md(ask)}</p>
          ${body}
          ${model}
        </article>`;
      }).join('');

      return `<div class="cw-done">${clean}<small>/ ${total} câu không lỗi</small></div>
        <div class="cw-list">${items}</div>`;
    },
  };
}

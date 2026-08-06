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

/**
 * Chờ bao lâu sau phím cuối mới đẩy nháp lên máy chủ.
 *
 * Đủ dài để một câu 600 ký tự không thành 600 request, đủ ngắn để đóng tab
 * ngay sau khi gõ vẫn kịp — và `flushDraft()` bắt nốt phần còn lại.
 */
export const PUSH_DELAY_MS = 1500;

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

export function createWriting({ api, storage, userId, now = () => Date.now() }) {
  let bankId = null;
  let questions = [];
  let submitted = false;
  let submission = null;
  let draft = {};
  let itemId = null;
  // Đẩy nháp lên máy chủ SAU khi ngừng gõ, không phải mỗi phím: một câu 600 ký
  // tự là 600 request.
  let pushTimer = null;
  let lastPushed = '';
  // Các lượt lưu tự động NỐI ĐUÔI nhau. Bắn song song thì hai request có thể
  // tới máy chủ ngược thứ tự, và bản `upsert` đến sau kéo bản dự phòng LÙI về
  // nội dung cũ — `lastPushed` khi ấy vẫn là bản mới nên không có lần gửi lại,
  // và một máy khác sẽ khôi phục đúng bản cũ ấy (codex cục bộ 05/08).
  let pending = Promise.resolve();
  // CHƯA nạp xong thì chưa biết bài này có nháp cũ không. Đẩy lúc ấy là gửi
  // `{}` lên đè bản dự phòng đang có — chỉ cần mở trang trên mạng chậm rồi
  // chuyển app.
  let ready = false;

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

  /**
   * Đẩy nháp lên máy chủ — MỘT BẢN DỰ PHÒNG, không phải nguồn thật.
   *
   * ── Vì sao đảo lại so với bản đầu ──────────────────────────────────────
   * Bản đầu cho máy chủ làm nguồn thật. Từ đó phải sinh ra số thứ tự, phép ghi
   * nguyên tử, cờ "không đọc được"… và mỗi mảnh lại hở một đường mất bài: tải
   * lại trang đè mất bản chưa gửi được, lượt ghi không-biết-thứ-tự đè lên bản
   * thật, và nếu lượt gửi cuối không kịp tạo thì bản duy nhất cũng mất.
   *
   * Nhưng đây là tài liệu MỖI LÚC CHỈ MỘT MÁY ĐANG GÕ. Nguồn thật đúng ra phải
   * là máy đang gõ, còn máy chủ chỉ giữ một bản để cứu ca "máy mới / vừa xoá bộ
   * nhớ trình duyệt" — chính là ca mà tính năng sinh ra để phục vụ.
   *
   * Đổi lại: đồng bộ giữa hai máy là "cố gắng hết sức". Gõ ở máy A rồi sang máy
   * B ngay khi A chưa kịp gửi thì B thấy bản cũ hơn. Chấp nhận được, và giải
   * thích được — khác hẳn việc MẤT bài.
   *
   * Nuốt lỗi là ĐÚNG ở đây: học viên đang gõ, không có gì để nói với em ấy, và
   * bản trong máy vẫn còn nguyên.
   */
  function pushDraft({ keepalive = false } = {}) {
    if (submitted || !bankId || !ready) return Promise.resolve();
    const send = () => {
      // Chụp nội dung Ở THỜI ĐIỂM GỬI: gõ thêm trong lúc xếp hàng thì lượt này
      // phải mang bản mới nhất, không phải bản lúc nó được xếp vào hàng.
      const body = JSON.stringify(draft);
      if (body === lastPushed) return null;             // không có gì mới
      lastPushed = body;
      const path = '/api/quiz/course/writing/draft';
      const payload = { bank_id: bankId, answers: { ...draft } };
      // `keepalive` THẬT của fetch: rời trang thì request thường bị huỷ giữa
      // chừng. Không cứu được thì cũng chỉ mất BẢN DỰ PHÒNG — bài vẫn nằm trong
      // máy này.
      const sent = (keepalive && api.postWith)
        ? api.postWith(path, payload, null, { keepalive: true })
        : api.post(path, payload);
      return sent.catch(() => { lastPushed = ''; });    // hỏng thì lần sau gửi lại
    };
    if (keepalive) {
      // Rời trang thì BẮN NGAY. Xếp sau một lượt còn đang bay thì trang có thể
      // đóng trước khi request kịp được tạo ra — và `keepalive` không cứu được
      // một request chưa tồn tại.
      //
      // RANH GIỚI ĐÃ BIẾT: nếu đúng lúc ấy có một lượt lưu tự động còn đang bay
      // và nó tới máy chủ SAU, bản dự phòng lùi lại một nhịp. Không mất bài —
      // bản đầy đủ vẫn nằm trong máy này, và lần mở sau sẽ đẩy lại.
      const p = Promise.resolve(send());
      pending = pending.then(() => p, () => p);
      return p;
    }
    pending = pending.then(send, send);
    return pending;
  }

  function schedulePush() {
    if (submitted) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushTimer = null; pushDraft(); }, PUSH_DELAY_MS);
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
      // MÁY NÀY THẮNG khi nó có nội dung.
      //
      // Bản trên máy chủ chỉ là DỰ PHÒNG, và chỉ được đọc ra khi máy này trống
      // — đúng ca tính năng sinh ra để phục vụ (máy mới, vừa xoá bộ nhớ trình
      // duyệt). Ưu tiên máy chủ thì một bản gõ dở chưa kịp gửi sẽ bị xoá ngay
      // lần tải lại trang kế tiếp, và đó là mất bài thật.
      //
      // Đọc hỏng cũng rơi vào cùng nhánh này: không có bản dự phòng để lấy thì
      // dùng bản trong máy. Không cần một cờ riêng cho ca ấy nữa.
      const local = submitted ? {} : loadDraft();
      const remote = (!submitted && r && r.draft && r.draft.answers) || null;
      draft = Object.keys(local).length ? local : { ...(remote || {}) };
      ready = true;
      if (!submitted) {
        saveDraft();
        // Máy này có bài mà bản dự phòng khác đi (hoặc chưa có) thì gửi lên
        // ngay: chờ tới lần gõ kế tiếp là để trống một khoảng không ai đỡ.
        lastPushed = JSON.stringify(remote || {});
        if (Object.keys(local).length) pushDraft();
      }
      if (submitted && storage) {
        try { storage.removeItem(draftKey(bankId, userId, itemId)); } catch (e) { /* kệ */ }
      }
      return { submitted, count: questions.length };
    },

    /**
     * Đẩy nốt nháp NGAY. Gọi khi rời trang.
     *
     * Không chờ hết `PUSH_DELAY_MS`: đóng tab đúng lúc đang đếm ngược là mất
     * đoạn vừa gõ — mà đoạn vừa gõ mới là đoạn em ấy nhớ nhất.
     */
    flushDraft() {
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
      return pushDraft({ keepalive: true })
        .catch(() => { /* hết cách — bản trong máy vẫn còn */ });
    },

    /** Ghi một câu vào nháp. Trả về số câu còn thiếu. */
    write(qid, text) {
      if (submitted) return missing().length;
      draft[qid] = text;
      saveDraft();
      schedulePush();
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

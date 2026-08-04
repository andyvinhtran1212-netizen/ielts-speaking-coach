/**
 * course-runner.js — lớp logic của bài tập ngữ pháp theo buổi.
 *
 * KHÔNG chạm DOM. Trang (Next client component) vẽ, module này quyết. Tách ra vì
 * toàn bộ phần dễ sai của tính năng nằm ở đây — vòng đời phiên làm bài — và một
 * bộ test khớp chuỗi trong tệp nguồn không chứng minh được gì về nó.
 *
 * ── VÌ SAO VIẾT LẠI ─────────────────────────────────────────────────────────
 * Vòng review đầu bắt SÁU lỗi, và năm cái quy về CÙNG MỘT chỗ: phiên làm bài.
 * Bản trước gọi `PATCH /sessions/{id}` ở cuối chặng nhưng dùng lại một phiên cho
 * mọi chặng, không truyền được lỗi gửi ra ngoài, và nhớ chỗ đang làm thiếu.
 * Vá lẻ từng cái là chữa triệu chứng — nên vòng đời được viết lại một lần:
 *
 *   MỘT PHIÊN = MỘT CHẶNG. Phiên mở khi vào chặng, chốt khi hết chặng, và chặng
 *   sau mở phiên MỚI. Trước đó chặng 2 trở đi ghi đè lên một phiên đã chốt bằng
 *   con số của riêng nó, nên giáo viên chỉ thấy chặng cuối cùng.
 *
 *   KHÔNG CHỐT KHI CHƯA ĐẨY ĐƯỢC BÀI. `flush()` nay ném lỗi ra ngoài; chốt phiên
 *   trong lúc lượt làm còn kẹt sẽ ghi một điểm số "đã xong" cho những câu chưa
 *   hề tới máy chủ.
 */

// Mười câu một chặng. 100 câu liền một mạch quá dài cho một buổi tối, và một
// lượt bỏ dở thì không có chỗ nào để nói "em đã làm tới đâu".
export const STAGE = 10;

// Đẩy lượt làm theo mẻ. Nhỏ hơn thì tốn request; lớn hơn thì mất nhiều khi rớt.
const BATCH = 5;

export const KEYS = ['A', 'B', 'C', 'D'];

export const DANG = {
  A1: 'GÁN NHÃN Ô', A2: 'GỌI TÊN', A3: 'TÌM HẠT NHÂN',
  B1: 'CHỌN DẠNG ĐÚNG', B2: 'CHỌN CẢ CỤM', B3: 'CẶP TỐI THIỂU',
  C1: 'TÌM LỖI', C2: 'VÌ SAO SAI', C3: 'CÂU NÀO ĐÚNG', C4: 'BẢN SỬA ĐÃ ỔN CHƯA',
  D1: 'GIỮ NGUYÊN NGHĨA', D2: 'ĐỔI CHỮ ĐỔI NGHĨA', D3: 'VI PHẠM RÀNG BUỘC NÀO',
  D4: 'NGỮ CẢNH', E1: 'VIẾT LẠI', E2: 'GỘP CÂU', E3: 'SỬA + GHI LÝ DO',
};

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * `**in đậm**` → <mark>. Thoát HTML TRƯỚC rồi mới dựng thẻ: nội dung đi từ cơ sở
 * dữ liệu ra màn hình, và một dấu `<` trong câu tiếng Anh không được thành thẻ.
 */
export function md(s) {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, '<mark>$1</mark>');
}

/**
 * Đề tách hai phần: DÒNG ĐẦU là câu hỏi, phần còn lại là MẪU VẬT — câu tiếng Anh
 * đang bị mổ. Nguồn viết đúng như vậy (71/100 câu có một dòng xuống, 25 câu có
 * hai), và tách ra khiến câu hỏi đọc như câu hỏi.
 */
export function splitStem(de) {
  const i = String(de || '').indexOf('\n');
  if (i === -1) return { ask: de || '', spec: '' };
  return { ask: de.slice(0, i), spec: de.slice(i + 1).trim() };
}

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/**
 * Bộ điều khiển một lượt làm bài.
 *
 * `deps` cho phép test bơm api/bộ nhớ/đồng hồ giả — không cần trình duyệt và
 * không cần mạng.
 */
export function createRunner({ api, storage, now = () => Date.now() }) {
  let bank = null;
  let qs = [];
  let stage = 0;
  let at = 0;
  let marks = [];          // 'right' | 'wrong' | 'self'
  let sessionId = null;
  let pending = [];
  let shownAt = 0;
  let stageStartedAt = 0;
  let answered = false;
  let sessionFailed = false;
  // Lượt đẩy giữa chặng chạy nền. Phải GIỮ lời hứa của nó: chốt chặng trong lúc
  // nó còn bay nghĩa là hàng đợi đang rỗng TẠM THỜI, `flush()` thấy không có gì
  // để gửi nên không ném, và phiên được chốt như thể mọi thứ đã tới máy chủ.
  // (Chính bộ test của module này bắt được — bắn-rồi-quên là một lời hứa bị bỏ.)
  let inflight = Promise.resolve();

  const key = () => 'cx:' + (bank && bank.id);

  function save(done) {
    if (!storage) return;
    try {
      storage.setItem(key(), JSON.stringify({ stage, at, marks, done: !!done }));
    } catch (e) { /* trình duyệt chặn lưu — làm bài vẫn chạy */ }
  }

  /**
   * Khôi phục chỗ đang làm.
   *
   * `done` là cờ RIÊNG cho "chặng này đã xong". Bản trước suy nó từ `at >= STAGE`
   * rồi coi trạng thái ấy là hỏng và đặt lại về đầu chặng — nên tải lại trang ở
   * màn kết quả là phải làm lại cả mười câu.
   */
  function restore() {
    if (!storage) return;
    let v = {};
    try { v = JSON.parse(storage.getItem(key()) || '{}'); } catch (e) { return; }
    if (typeof v.stage !== 'number') return;
    stage = v.stage;
    if (v.done) {
      // Chặng đã xong: sang chặng sau nếu còn, không thì đứng ở màn kết quả.
      if ((stage + 1) * STAGE < qs.length) { stage += 1; at = 0; marks = []; }
      else { at = STAGE; marks = Array.isArray(v.marks) ? v.marks : []; }
    } else {
      at = typeof v.at === 'number' ? v.at : 0;
      marks = Array.isArray(v.marks) ? v.marks : [];
    }
    if (stage * STAGE >= qs.length) { stage = 0; at = 0; marks = []; }
    if (at > STAGE) { at = 0; marks = []; }
  }

  function stageQuestions() {
    return qs.slice(stage * STAGE, stage * STAGE + STAGE);
  }

  async function openSession() {
    sessionId = null;
    sessionFailed = false;
    try {
      const s = await api.post('/api/quiz/sessions', { bank_id: bank.id });
      sessionId = (s && (s.id || s.session_id)) || null;
    } catch (e) { sessionId = null; }
    if (!sessionId) sessionFailed = true;
    stageStartedAt = now();
    return !sessionFailed;
  }

  /**
   * Đẩy lượt làm. NÉM ra ngoài khi hỏng.
   *
   * Bản trước nuốt lỗi rồi resolve bình thường, nên `finishStage` chốt phiên
   * ngay sau đó và ghi một điểm số "đã xong" cho những câu chưa hề tới máy chủ.
   */
  async function flush({ keepalive = false } = {}) {
    if (!sessionId || !pending.length) return;
    const batch = pending.splice(0, pending.length);
    const path = '/api/quiz/sessions/' + sessionId + '/progress';
    const body = { attempts: batch, word_stats: [] };
    try {
      // `keepalive` thật của fetch, không phải một cờ tự đặt: đóng tab giữa
      // chừng thì request thường bị huỷ, và mất lượt làm nghĩa là giáo viên đọc
      // một con số thấp hơn thực tế rồi tưởng em ấy bỏ bài.
      if (keepalive && api.postWith) await api.postWith(path, body, null, { keepalive: true });
      else await api.post(path, body);
    } catch (err) {
      pending = batch.concat(pending);   // trả lại hàng đợi
      throw err;
    }
  }

  function queue(q, ok, given) {
    // Câu tự luận KHÔNG gửi: backend bỏ qua mọi lượt thiếu `is_correct`, nên gửi
    // đi là gửi vào hư không; ghi một giá trị đúng/sai bịa ra thì làm sai chính
    // con số giáo viên đọc.
    if (ok === null) return;
    pending.push({
      client_id: uuid(),
      item_key: q.item_key || q.qid,
      qid: q.qid, skill: q.skill, type: q.type, subtype: q.subtype,
      is_correct: ok, answer_given: given,
      response_time_ms: Math.max(0, now() - shownAt),
      attempt_no: 1,
    });
  }

  return {
    get bank() { return bank; },
    get stage() { return stage; },
    get at() { return at; },
    get marks() { return marks.slice(); },
    get sessionFailed() { return sessionFailed; },
    get pendingCount() { return pending.length; },
    get stageCount() { return Math.ceil(qs.length / STAGE); },
    get total() { return qs.length; },
    stageQuestions,

    current() {
      const list = stageQuestions();
      return at < list.length ? list[at] : null;
    },

    isStageDone() { return at >= stageQuestions().length; },

    async load(bankId) {
      const r = await api.get('/api/quiz/banks/' + encodeURIComponent(bankId));
      bank = r.bank;
      qs = r.questions || [];
      if (!qs.length) throw new Error('Bài tập này chưa có câu hỏi nào.');
      restore();
      await openSession();
      shownAt = now();
      return bank;
    },

    show() { answered = false; shownAt = now(); },

    /** Trả lời một câu trắc nghiệm. */
    answer(picked) {
      if (answered) return null;
      answered = true;
      const q = this.current();
      const ok = picked === q.answer;
      marks[at] = ok ? 'right' : 'wrong';
      queue(q, ok, String(picked));
      if (pending.length >= BATCH) {
        // Nuốt lỗi Ở ĐÂY là đúng (đang giữa chặng, không có gì để nói với học
        // viên), nhưng phải NHỚ lời hứa để `finishStage` chờ được.
        inflight = flush().catch(() => { /* lượt làm đã quay lại hàng đợi */ });
      }
      return {
        correct: ok,
        trap: ok ? null : ((q.why_wrong || {})[String(picked)] || null),
        explain: q.explain || '',
      };
    },

    /** Câu tự luận: không chấm, chỉ mở đáp án mẫu để tự đối chiếu. */
    selfCheck() {
      if (answered) return null;
      answered = true;
      marks[at] = 'self';
      return { explain: this.current().explain || '' };
    },

    next() { at += 1; save(false); },

    /**
     * Hết chặng: đẩy nốt rồi mới chốt.
     *
     * Trả `{persisted}` để trang nói đúng sự thật — chốt phiên khi lượt làm còn
     * kẹt sẽ báo với giáo viên rằng chặng đã xong trong khi chi tiết thì thiếu.
     */
    async finishStage() {
      const list = stageQuestions();
      const graded = list.filter((q) => q.type !== 'writing').length;
      const right = marks.filter((m) => m === 'right').length;

      const axes = {};
      list.forEach((q, i) => {
        if (marks[i] !== 'wrong' || !q.item_key) return;
        axes[q.item_key] = (axes[q.item_key] || 0) + 1;
      });

      let persisted = !sessionFailed;
      if (sessionId) {
        try {
          await inflight;        // chờ lượt đẩy nền xong rồi mới xét hàng đợi
          await flush();
          await api.patch('/api/quiz/sessions/' + sessionId, {
            duration_sec: Math.round((now() - stageStartedAt) / 1000),
            total_questions: graded,
            total_correct: right,
            total_wrong: Math.max(0, graded - right),
            ended_by: 'completed',
          });
        } catch (err) { persisted = false; }
      }
      save(true);
      return {
        right, graded, persisted,
        axes: Object.keys(axes).sort((a, b) => axes[b] - axes[a]).map((a) => ({ axis: a, n: axes[a] })),
        hasMore: stage + 1 < this.stageCount,
      };
    },

    /** Chặng sau mở PHIÊN MỚI — xem ghi chú đầu tệp. */
    async nextStage() {
      stage += 1; at = 0; marks = [];
      save(false);
      await openSession();
      shownAt = now();
    },

    /** Đóng tab giữa chừng: đẩy nốt bằng fetch keepalive. */
    leave() { return flush({ keepalive: true }).catch(() => { /* hết cách */ }); },
  };
}

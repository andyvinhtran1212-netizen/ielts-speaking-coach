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
/**
 * Fisher–Yates trên bản sao. `rng` bơm được để test tái lập.
 */
export function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Bản sao một câu trắc nghiệm với ĐÁP ÁN ĐÃ TRỘN — để bài kiểm tra lại hỏi lại
 * sự hiểu, không hỏi lại trí nhớ vị trí ("câu này đáp án C").
 *
 * `_perm[vị-trí-hiển-thị] = vị-trí-gốc`: mọi thứ đọc theo vị trí (answer,
 * why_wrong) đều phải remap, và lượt làm gửi về server phải mang vị trí GỐC —
 * không thì màn xem lại lỗi sai của học viên chỉ ra nhầm phương án.
 */
export function retakeClone(q, rng) {
  if (!Array.isArray(q.options) || q.options.length < 2) return { ...q };
  const perm = shuffled(q.options.map((_, i) => i), rng);
  const why = {};
  perm.forEach((orig, disp) => {
    const w = (q.why_wrong || {})[String(orig)];
    if (w) why[String(disp)] = w;
  });
  return {
    ...q,
    options: perm.map((i) => q.options[i]),
    answer: perm.indexOf(q.answer),
    why_wrong: why,
    _perm: perm,
  };
}

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
  // Cổng thuộc-bài: 'run' là lượt chính 10 chặng; 'retake' là bài kiểm tra lại
  // (mẫu nhỏ, trộn câu + đáp án) khi lượt chính dưới ngưỡng.
  let mode = 'run';
  let retakeQs = [];
  let retakeNo = 0;
  // Phiên của các chặng ĐÃ CHỐT THÀNH CÔNG — chính là danh sách gửi đi xét đạt.
  // Chặng không chốt được (mạng đứt) không có tên: server sẽ từ chối phiên chưa
  // hoàn thành, và thà thiếu một chặng còn hơn cả lượt bị bác.
  let runSessions = [];
  // Khôi phục ĐÚNG VÀO màn kết quả cuối: không được mở phiên mới. Bản trước mở
  // rồi trang gọi finishStage lần nữa → mỗi lần F5 đẻ thêm một phiên "chặng
  // cuối" rỗng nhưng mang tổng số sao chép, chen vào lượt xét đạt.
  let resumedFinal = false;
  // Lượt đẩy giữa chặng chạy nền. Phải GIỮ lời hứa của nó: chốt chặng trong lúc
  // nó còn bay nghĩa là hàng đợi đang rỗng TẠM THỜI, `flush()` thấy không có gì
  // để gửi nên không ném, và phiên được chốt như thể mọi thứ đã tới máy chủ.
  // (Chính bộ test của module này bắt được — bắn-rồi-quên là một lời hứa bị bỏ.)
  let inflight = Promise.resolve();

  const key = () => 'cx:' + (bank && bank.id);
  // Vân tay bộ đề: đổi câu HOẶC đổi đáp án (re-import) đều đổi vân tay. Trạng
  // thái lưu của bản đề cũ mà đem dùng tiếp thì phiên cũ lẫn vào lượt xét
  // (verdict bác mãi) hoặc lượt làm cũ bị chấm bằng thước mới (codex #928 R4).
  let rev = '';
  // Mục bài giao đang gắn với lượt này. Em chuyển lớp rồi được giao lại CÙNG
  // bank ở lớp mới là một MỤC KHÁC — phiên cũ thuộc mục cũ, verdict bác chúng,
  // và màn kết quả khôi phục sẽ kẹt không mở nổi phiên mới (codex #928 R5).
  let itemId = null;

  function fingerprint(list) {
    const s = list.map((q) => q.qid + ':' + q.answer).join('|');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return String(h);
  }

  function save(done) {
    if (!storage) return;
    // Kiểm tra lại là lượt PHÙ DU: mẫu bốc ngẫu nhiên không tái lập được sau
    // reload, nên không lưu — tải lại trang thì quay về màn kết quả lượt chính
    // và bốc mẫu mới. Lưu nó đè lên trạng thái lượt chính mới là mất dữ liệu.
    if (mode === 'retake') return;
    try {
      storage.setItem(key(), JSON.stringify({
        stage, at, marks, done: !!done, runSessions, rev, item: itemId,
      }));
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
    // Bộ đề đã đổi (re-import: câu khác hay đáp án khác) → trạng thái lưu là
    // của một bài KHÁC. Làm lại từ đầu sạch sẽ; giữ lại là phiên cũ lẫn vào
    // lượt xét hoặc bài cũ bị chấm bằng thước mới.
    if (v.rev !== rev) return;
    // Khác mục bài giao (chuyển lớp, giao lại) = lượt của một BÀI GIAO khác.
    if ((v.item || null) !== itemId) return;
    stage = v.stage;
    runSessions = Array.isArray(v.runSessions)
      ? v.runSessions.filter((s) => typeof s === 'string')
      : [];
    if (v.done) {
      // Chặng đã xong: sang chặng sau nếu còn, không thì đứng ở màn kết quả.
      if ((stage + 1) * STAGE < qs.length) { stage += 1; at = 0; marks = []; }
      else { at = STAGE; marks = Array.isArray(v.marks) ? v.marks : []; resumedFinal = true; }
    } else {
      // Chặng DANG DỞ không sống qua reload — làm lại chặng từ câu đầu.
      //
      // Vì phiên và hàng đợi lượt làm chỉ sống trong bộ nhớ tab: các câu đã
      // trả lời trước khi đóng tab nằm trong một phiên MỒ CÔI (không bao giờ
      // completed, không có tên trong lượt xét). Khôi phục `at` giữa chừng là
      // để học viên đi tiếp với những câu đã rơi vào hư không — verdict
      // phủ-đủ-đề sẽ bác cả lượt ở phút chót và không có đường sửa nào ngoài
      // xoá localStorage (codex #928 R3+R7). Mười câu là giá của một lần đóng
      // tab giữa chặng; một lượt 100 câu bị kẹt vĩnh viễn mới là đắt.
      at = 0; marks = [];
    }
    // Trạng thái lưu không còn khớp bộ đề (bank bị thay/ngắn lại): làm lại từ
    // đầu là một LƯỢT MỚI TRỌN VẸN — phải xoá cả dấu done-cuối lẫn danh sách
    // phiên cũ, không thì load() bỏ mở phiên và mọi lượt làm rơi vào hư không
    // trong khi finishStage vẫn báo "đã lưu" (codex #928 vòng 2).
    if (stage * STAGE >= qs.length) {
      stage = 0; at = 0; marks = []; resumedFinal = false; runSessions = [];
    }
    if (at > STAGE) { at = 0; marks = []; resumedFinal = false; }
  }

  function stageQuestions() {
    if (mode === 'retake') return retakeQs;
    return qs.slice(stage * STAGE, stage * STAGE + STAGE);
  }

  async function openSession() {
    sessionId = null;
    sessionFailed = false;
    try {
      const body = { bank_id: bank.id };
      // Chỉ khai khi khác mặc định — phiên 'run' giữ nguyên hợp đồng cũ.
      if (mode === 'retake') body.kind = 'retake';
      const s = await api.post('/api/quiz/sessions', body);
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
    get mode() { return mode; },
    get retakeNo() { return retakeNo; },
    get runSessionCount() { return runSessions.length; },
    stageQuestions,

    current() {
      const list = stageQuestions();
      return at < list.length ? list[at] : null;
    },

    isStageDone() { return at >= stageQuestions().length; },

    async load(bankId) {
      const r = await api.get('/api/quiz/banks/' + encodeURIComponent(bankId));
      bank = r.bank;
      this.mastery = r.mastery || null;   // {item_id, passed_at, threshold, retake_size, retakes}
      itemId = (r.mastery && r.mastery.item_id) || null;
      qs = r.questions || [];
      if (!qs.length) throw new Error('Bài tập này chưa có câu hỏi nào.');
      rev = fingerprint(qs);
      restore();
      // Đứng ở màn kết quả cuối thì KHÔNG có gì để ghi — mở phiên ở đây là đẻ
      // ra một phiên "chặng cuối" rỗng, và finishStage của lần vẽ lại sẽ chốt
      // nó với tổng số sao chép rồi chen nó vào lượt xét đạt (codex #928).
      if (!resumedFinal) await openSession();
      else { sessionId = null; sessionFailed = false; stageStartedAt = now(); }
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
      // Gửi vị trí GỐC của phương án, không phải vị trí hiển thị: ở bài kiểm
      // tra lại đáp án đã trộn, và màn xem lại lỗi sai đọc theo bộ đề gốc.
      queue(q, ok, String(q._perm ? q._perm[picked] : picked));
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
          // Chỉ phiên ĐÃ CHỐT mới có tên trong lượt xét đạt — server từ chối
          // phiên dang dở, và một phiên hỏng không được kéo cả lượt xuống.
          if (mode === 'run' && runSessions.indexOf(sessionId) === -1) {
            runSessions.push(sessionId);
          }
        } catch (err) { persisted = false; }
      }
      // Chặng chốt hỏng thì KHÔNG đóng dấu done: sessionId + hàng đợi còn
      // nguyên trong bộ nhớ, nên gọi lại finishStage là một lần GỬI LẠI thật
      // sự. Đóng dấu rồi mới hỏng là học viên đi tiếp với một lỗ không vá
      // được, và verdict phủ-đủ-đề sẽ bác cả lượt ở phút chót (codex R3).
      save(persisted);
      return {
        right, graded, persisted,
        retryable: !persisted && !!sessionId,
        axes: Object.keys(axes).sort((a, b) => axes[b] - axes[a]).map((a) => ({ axis: a, n: axes[a] })),
        hasMore: mode === 'run' && stage + 1 < this.stageCount,
      };
    },

    /** Chặng sau mở PHIÊN MỚI — xem ghi chú đầu tệp. */
    async nextStage() {
      stage += 1; at = 0; marks = [];
      save(false);
      await openSession();
      shownAt = now();
    },

    /**
     * Xét đạt lượt vừa xong. Lượt chính = các phiên chặng đã chốt; kiểm tra
     * lại = đúng một phiên của nó. Server tự cộng điểm từ dòng nó giữ.
     */
    verdict() {
      const ids = mode === 'retake' ? [sessionId].filter(Boolean) : runSessions.slice();
      return api.post('/api/quiz/course/verdict', {
        bank_id: bank.id, session_ids: ids,
      });
    },

    /**
     * Bài KIỂM TRA LẠI: bốc `size` câu trắc nghiệm ngẫu nhiên, trộn thứ tự câu
     * VÀ trộn thứ tự đáp án trong từng câu — hỏi lại sự hiểu, không hỏi lại trí
     * nhớ vị trí. Câu tự luận không vào mẫu: nó không chấm máy nên không nói
     * được gì về ngưỡng.
     */
    async startRetake(size, rng = Math.random) {
      const pool = qs.filter((q) => q.type !== 'writing');
      const n = Math.max(1, Math.min(Number(size) || 20, pool.length));
      mode = 'retake';
      retakeNo += 1;
      retakeQs = shuffled(pool, rng).slice(0, n).map((q) => retakeClone(q, rng));
      at = 0; marks = []; answered = false;
      await openSession();
      shownAt = now();
      return retakeQs.length;
    },

    /** Đóng tab giữa chừng: đẩy nốt bằng fetch keepalive. */
    leave() { return flush({ keepalive: true }).catch(() => { /* hết cách */ }); },
  };
}

/**
 * course-writing.js — phần TỰ LUẬN của bài tập theo buổi.
 *
 * KHÔNG chạm DOM để quyết định gì; trang gọi vào đây, module trả HTML và giữ
 * bản nháp. Tách khỏi `course-runner.js` vì nhịp khác hẳn: ở kia là
 * hỏi–đáp–giải thích từng câu, ở đây là ngồi viết cả cụm rồi nộp MỘT lần.
 *
 * Ba luật của phần này, và cả ba đều dễ hỏng nếu để trong trang:
 *   · nộp MỘT lần trong mỗi lượt làm toàn bài (server giữ, không phải localStorage);
 *   · ĐỦ CÂU MỚI NHẬN — thiếu một câu thì giữ nháp và chờ;
 *   · chưa chấm được KHÁC HẲN câu-của-em-đúng.
 */

import { createActiveTimer } from './course-active-timer.js';
import { formatCourseExplanation } from './course-explanation-format.js';

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

const KIND = { grammar: 'ngữ pháp', spelling: 'chính tả', mechanics: 'hình thức' };

/** Mã lỗi của kho viết câu Course 5 (public/error_codes.json của gói). */
export const ERROR_LABELS = {
  SENT: 'Câu thiếu thành phần', SVA: 'Hòa hợp chủ–vị', COUNT: 'Danh từ & lượng từ',
  ART: 'Mạo từ', TENSE: 'Thì & mốc thời gian', CLAUSE: 'Mệnh đề',
  REL: 'Mệnh đề quan hệ', VERBFORM: 'Dạng động từ', PASSIVE: 'Bị động',
  REF: 'Tham chiếu', PARALLEL: 'Song song', LINK: 'Liên từ & quan hệ ý',
  COND: 'Điều kiện', MODAL: 'Tình thái', COMP: 'So sánh', DATA: 'Dữ liệu & đơn vị',
  SCOPE: 'Phạm vi & độ chắc chắn', LEX: 'Từ & cụm từ', PREP: 'Giới từ',
  WORDORDER: 'Trật tự từ', PUNC: 'Dấu câu & chính tả', TASK: 'Yêu cầu của bài',
};

/**
 * Lỗi HÌNH THỨC (viết hoa đầu câu, dấu chấm cuối, khoảng trắng) vẫn hiện đủ,
 * nhưng KHÔNG làm câu bị tính là sai — nhãn ấy do máy chủ đặt bằng phép so
 * (`_classify`), không do model tự khai.
 *
 * Ở đây chỉ là mặt vẽ: bản chấm CŨ (trước 07/08) gắn nhãn `grammar` cho những
 * lỗi ấy và vẫn hiện y như trước — không có bản chuyển đổi nào chạy sau lưng.
 */
export const isFormOnly = (g) => g && g.ok === true
  && Array.isArray(g.issues) && g.issues.length > 0;

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
export const draftKey = (bankId, userId, itemId, attemptNo = 1) =>
  'cw:' + (userId || 'anon') + ':' + bankId + (itemId ? ':' + itemId : '')
    + (Number(attemptNo) > 1 ? ':a' + Number(attemptNo) : '');

export function createWriting({ api, storage, userId, now = () => Date.now() }) {
  let bankId = null;
  let questions = [];
  let submitted = false;
  let submission = null;
  let draft = {};
  // Đã bấm Nộp một lần và đang chờ xác nhận. KHÔNG lưu xuống đâu cả: tải lại
  // trang phải quay về bước một, vì "đã đọc lại rồi" là chuyện của lượt ngồi
  // trước màn hình chứ không phải một trạng thái đáng nhớ.
  let armed = false;
  let itemId = null;
  let attemptNo = 1;
  // Kho viết câu Course 5 (`sentence_lab`): null với bài tự luận Course 1.
  let lab = null;
  // Lượt TỰ VIẾT LẠI sau khi chấm — chỉ sống trong trang; gửi một lần.
  let revision = {};
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
  // Lượt của trang đã bị huỷ (đổi tài khoản / rời trang). Một lượt nạp trả về
  // muộn hay một nhịp lưu tự động còn đếm KHÔNG được gửi nháp nữa: request mới
  // lấy token của người đang đăng nhập LÚC ẤY, không phải của người đã gõ
  // (PC-J352).
  let disposed = false;
  const activeTimer = createActiveTimer(now);

  function loadDraft() {
    if (!storage) return {};
    try { return JSON.parse(storage.getItem(
      draftKey(bankId, userId, itemId, attemptNo)) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function saveDraft() {
    if (!storage || submitted) return;   // đã nộp thì nháp không còn nghĩa
    try { storage.setItem(draftKey(bankId, userId, itemId, attemptNo), JSON.stringify(draft)); }
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
    if (disposed || submitted || !bankId || !ready) return Promise.resolve();
    const send = () => {
      // Một lượt đã xếp hàng có thể chỉ chạy sau khi đổi tài khoản. Keepalive
      // lúc rời trang vẫn bắn ngay, trước dispose, để giữ đoạn vừa gõ.
      if (disposed && !keepalive) return null;
      // Chụp nội dung Ở THỜI ĐIỂM GỬI: gõ thêm trong lúc xếp hàng thì lượt này
      // phải mang bản mới nhất, không phải bản lúc nó được xếp vào hàng.
      const body = JSON.stringify(draft);
      if (body === lastPushed) return null;             // không có gì mới
      lastPushed = body;
      const path = '/api/quiz/course/writing/draft';
      const payload = { bank_id: bankId, class_item: itemId, answers: { ...draft } };
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
    if (submitted || disposed) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushTimer = null; pushDraft(); }, PUSH_DELAY_MS);
  }

  const missing = () => questions
    .filter((q) => !String(draft[q.qid] || '').trim())
    .map((q) => q.qid);

  /**
   * Thanh nộp: HAI BƯỚC.
   *
   * Em Lê Ngọc Hà Linh lưu nháp lúc 08:22:02 và nộp lúc 08:22:06 — bốn giây, tức
   * là một cú bấm chứ không phải một quyết định. Lượt nộp chỉ có MỘT và không có
   * đường lùi trong sản phẩm, nên một cú bấm nhầm là hết bài; mở lại phải chạy
   * SQL tay.
   *
   * Bước hai KHÔNG phải hộp thoại của trình duyệt: hộp ấy chặn cả trang, trên
   * điện thoại thì hiện như thông báo hệ thống và người ta bấm "OK" theo phản
   * xạ — đúng cái phản xạ đang cần chặn. Đây là một thanh ngay dưới bài viết,
   * nói rõ hậu quả, và nút an toàn ("đọc lại") đứng TRƯỚC.
   */
  const bar = () => {
    const miss = missing();
    if (!armed) {
      return `<span class="cw-bar__note" id="cw-note">${noteHtml()}</span>
        <button class="av-button av-button-primary" id="cw-submit" type="button"${
          miss.length ? ' disabled' : ''}>Nộp phần tự luận</button>`;
    }
    return `<span class="cw-bar__note cw-bar__warn" id="cw-note">
        Nộp rồi là <strong>không sửa được nữa</strong>, và chỉ nộp được một lần.
        Đọc lại ${questions.length} câu một lượt trước khi chốt nhé.</span>
      <button class="av-button" id="cw-cancel" type="button">Để tôi đọc lại</button>
      <button class="av-button av-button-primary" id="cw-confirm" type="button">Nộp luôn</button>`;
  };

  async function refreshState() {
    const r = await api.get('/api/quiz/course/writing?bank_id=' + encodeURIComponent(bankId)
      + (itemId ? '&class_item=' + encodeURIComponent(itemId) : ''));
    if (!r || !r.submitted) return;
    questions = r.questions || questions;
    lab = r.sentence_lab || lab;
    submission = { ...(submission || {}), ...(r.submission || {}) };
  }

  const revisionCount = () => Object.values(revision)
    .filter((v) => String(v || '').trim()).length;
  const maxRevision = () => Number(lab && lab.max_revision_items) || 6;

  const reviseBar = () => {
    const n = revisionCount();
    const max = maxRevision();
    const over = n > max;
    const note = over
      ? `Bạn đang viết lại <strong>${n}</strong> câu — chỉ gửi được tối đa ${max} câu.`
      : n
        ? `Đã viết lại ${n}/${max} câu. Gửi một lần để AI đánh giá lại và đưa bản sửa tối thiểu.`
        : `Chọn tối đa ${max} câu để tự viết lại (ưu tiên câu chưa đạt). Không viết câu nào cũng được — bấm chốt để xem đáp án tham khảo.`;
    return `<span class="cw-bar__note" id="cw-revise-note">${note}</span>
      <button class="av-button av-button-primary" id="cw-revise-submit" type="button"${
        over ? ' disabled' : ''}>${n ? 'Gửi bài viết lại' : 'Chốt và xem đáp án'}</button>`;
  };

  const noteHtml = () => {
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
  };

  // ── Kho viết câu Course 5 ────────────────────────────────────────────────
  const labGuide = () => {
    const g = lab && lab.guide;
    if (!g) {
      return lab && lab.guide_locked
        ? '<p class="cw-unknown">Buổi chẩn đoán: ghi nhớ và ví dụ làm mẫu mở sau khi bạn nộp lượt đầu.</p>'
        : '';
    }
    const li = (xs) => (xs || []).map((x) => `<li>${md(x)}</li>`).join('');
    const w = g.worked || {};
    return `<details class="sl-guide"${submitted ? '' : ' open'}>
        <summary>Mục tiêu, ghi nhớ và ví dụ làm mẫu</summary>
        ${g.objective ? `<p><strong>Mục tiêu:</strong> ${md(g.objective)}</p>` : ''}
        ${g.ielts_use ? `<p><strong>Dùng trong IELTS:</strong> ${md(g.ielts_use)}</p>` : ''}
        ${(g.mini_rules || []).length ? `<ul>${li(g.mini_rules)}</ul>` : ''}
        ${w.source ? `<div class="sl-worked"><p><strong>Ví dụ:</strong> ${md(w.instruction || '')}</p>
          <p class="cw-diff">${esc(w.source)}</p>
          <p class="cw-diff">${esc(w.answer || '')}</p>
          ${w.explanation ? `<p>${md(w.explanation)}</p>` : ''}</div>` : ''}
        ${submitted && (g.exit_check || []).length
          ? `<p><strong>Tự kiểm tra cuối buổi:</strong></p><ul>${li(g.exit_check)}</ul>` : ''}
      </details>`;
  };

  const labAsk = (q, fallback) => {
    const it = q && q.sentence_lab_item;
    if (!it) return `<p class="cw-item__ask">${md(fallback || '')}</p>`;
    return `<div class="sl-ask">
        <p class="cw-item__ask"><strong>${esc(it.instruction || '')}</strong></p>
        <p class="sl-source">${esc(it.source || '')}</p>
        <ul class="sl-required">${(it.required || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      </div>`;
  };

  function renderLabForm() {
    const items = questions.map((q, i) => {
      const val = draft[q.qid] || '';
      return `<article class="cw-item" id="cw-${esc(q.qid)}">
          <span class="cw-item__no">Câu ${i + 1} · ${esc(q.subtype || '')}</span>
          ${labAsk(q, q.prompt)}
          <textarea class="cw-write" data-qid="${esc(q.qid)}" rows="2"
            aria-label="Câu trả lời cho câu ${i + 1}"
            placeholder="Viết MỘT câu tiếng Anh hoàn chỉnh…">${esc(val)}</textarea>
        </article>`;
    }).join('');
    return `<div class="cw-intro">
        <h2>${esc(lab.session_id || '')} · ${esc(lab.title || 'Luyện viết câu')} — ${questions.length} câu</h2>
        <p>Mỗi bài viết <strong>một câu tiếng Anh hoàn chỉnh</strong>, giữ đúng dữ kiện và yêu cầu
           in đậm. AI chấm theo thang luyện câu 0–10 (không phải band IELTS) và chỉ ra tối đa
           hai lỗi ưu tiên kèm gợi ý để bạn tự sửa. Sau đó bạn được <strong>tự viết lại tối đa
           ${maxRevision()} câu</strong> để nhận bản sửa tối thiểu. <strong>Lượt nộp đầu chỉ có một</strong>.</p>
      </div>
      ${labGuide()}
      <div class="cw-list">${items}</div>
      <div class="cw-bar" id="cw-bar">${bar()}</div>`;
  }

  const STATUS = {
    accepted: 'Đạt',
    revise: 'Cần sửa',
    needs_review: 'Cần giáo viên xem',
    no_attempt: 'Chưa làm',
  };

  const labFeedback = (fb, text) => {
    if (!fb) return '<p class="cw-unknown">Chưa chấm được câu này.</p>';
    const score = fb.total == null ? '' : `<span class="sl-score">${esc(fb.total)}/10</span>`;
    const errs = (fb.errors || []).map((e) => `
        <li class="cw-issue">
          <span class="cw-issue__kind">${esc(ERROR_LABELS[e.code] || e.code)}</span>
          <span>${e.offending_text ? `<del>${esc(e.offending_text)}</del> — ` : ''}${esc(e.reason_vi || '')}</span>
          ${e.hint_vi ? `<span class="cw-issue__note">Gợi ý: ${esc(e.hint_vi)}</span>` : ''}
        </li>`).join('');
    const fix = fb.minimal_correction
      ? `<p class="sl-label">Bản sửa tối thiểu</p><p class="cw-diff">${inlineDiff(text, fb.minimal_correction)}</p>`
      : '';
    const alt = fb.optional_alternative
      ? `<p class="sl-label">Một cách viết khác (không phải sửa lỗi)</p><p class="cw-diff">${esc(fb.optional_alternative)}</p>`
      : '';
    return `<div class="sl-fb" data-status="${esc(fb.status)}">
        <p class="sl-head"><span class="sl-badge">${esc(STATUS[fb.status] || fb.status)}</span>${score}</p>
        ${fb.strength_vi ? `<p>${esc(fb.strength_vi)}</p>` : ''}
        ${errs ? `<ul class="cw-issues">${errs}</ul>` : ''}
        ${fb.has_more_issues ? '<p class="cw-unknown">Còn lỗi khác — sửa hai lỗi ưu tiên trước.</p>' : ''}
        ${fb.needs_review_reason_vi ? `<p class="cw-unknown">${esc(fb.needs_review_reason_vi)}</p>` : ''}
        ${fix}${alt}
        ${fb.next_action_vi ? `<p class="sl-next">${esc(fb.next_action_vi)}</p>` : ''}
      </div>`;
  };

  function renderLabResult() {
    const items0 = (submission && submission.items) || [];
    const byQid = {};
    questions.forEach((q) => { byQid[q.qid] = q; });
    const done = !!lab.revision_done;
    const clean = (submission && submission.clean) || 0;
    const total = (submission && submission.total) || items0.length;
    const points = items0.reduce((a, g) => a + (Number(g.score) || 0), 0);
    const items = items0.map((g, i) => {
      const q = byQid[g.qid] || {};
      const rev = g.revision;
      const revBlock = rev
        ? `<div class="sl-rev"><p class="sl-label">Bài viết lại</p>
            <p class="cw-diff">${inlineDiff(g.answer, rev.answer)}</p>
            ${labFeedback(rev.feedback, rev.answer)}</div>`
        : (!done
          ? `<label class="sl-label" for="cw-rev-${esc(g.qid)}">Tự viết lại câu này (tuỳ chọn)</label>
             <textarea class="cw-write cw-revise" id="cw-rev-${esc(g.qid)}" data-qid="${esc(g.qid)}" rows="2"
               placeholder="Viết lại theo gợi ý…">${esc(revision[g.qid] || '')}</textarea>`
          : '');
      const modelText = done ? (g.explain || q.explain || '') : '';
      return `<article class="cw-item" data-ok="${String(g.ok)}">
          <span class="cw-item__no">Câu ${i + 1}${q.subtype ? ' · ' + esc(q.subtype) : ''}</span>
          ${labAsk(q, g.prompt)}
          <p class="sl-label">Câu bạn nộp</p>
          <p class="cw-diff">${esc(g.answer)}</p>
          ${labFeedback(g.feedback, g.answer)}
          ${revBlock}
          ${modelText ? `<div class="cw-model course-explain">${formatCourseExplanation(modelText)}</div>` : ''}
        </article>`;
    }).join('');
    return `<div class="cw-done">${clean}<small>/ ${total} câu đạt · ${points}/${total * 10} điểm luyện câu</small></div>
      <p class="cw-unknown">Thang 0–10 là điểm luyện câu, không quy đổi sang band IELTS.</p>
      ${labGuide()}
      <div class="cw-list">${items}</div>
      ${done ? '' : `<div class="cw-bar" id="cw-revise-bar">${reviseBar()}</div>`}`;
  }

  return {
    get submitted() { return submitted; },
    get questions() { return questions.slice(); },
    get missing() { return missing(); },
    get draft() { return { ...draft }; },
    get course() { return submission?.course || null; },
    /** Kho viết câu Course 5 — null với bài tự luận thường. */
    get lab() { return lab; },
    get revisionCount() { return revisionCount(); },
    /** Đang ở bước XÁC NHẬN (đã bấm Nộp một lần). */
    get armed() { return armed; },

    /**
     * Bấm Nộp lần đầu → sang bước xác nhận. Trả `false` khi chưa đủ câu: thiếu
     * bài thì chưa có gì để xác nhận, và trang phải chỉ chỗ còn trống trước.
     */
    arm() {
      if (submitted || missing().length) return false;
      armed = true;
      return true;
    },

    /** Về bước một. Gọi khi bấm "đọc lại", và khi em ấy gõ thêm. */
    disarm() { armed = false; },

    async load(id, assignmentItemId = null) {
      bankId = id;
      const r = await api.get('/api/quiz/course/writing?bank_id=' + encodeURIComponent(id)
        + (assignmentItemId ? '&class_item=' + encodeURIComponent(assignmentItemId) : ''));
      itemId = (r && r.item_id) || null;
      attemptNo = Number(r && r.attempt_no) || 1;
      questions = (r && r.questions) || [];
      lab = (r && r.sentence_lab) || null;
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
      activeTimer.reset();
      if (!submitted) {
        saveDraft();
        // Máy này có bài mà bản dự phòng khác đi (hoặc chưa có) thì gửi lên
        // ngay: chờ tới lần gõ kế tiếp là để trống một khoảng không ai đỡ.
        lastPushed = JSON.stringify(remote || {});
        if (Object.keys(local).length) pushDraft();
      }
      if (submitted && storage) {
        try { storage.removeItem(draftKey(bankId, userId, itemId, attemptNo)); } catch (e) { /* kệ */ }
      }
      return { submitted, count: questions.length };
    },

    setActive(active) { activeTimer.setActive(active); },

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

    /**
     * Thôi gửi nháp cho lượt này. Rời trang: gọi SAU `flushDraft()` để giữ
     * đoạn vừa gõ. Đổi tài khoản: gọi TRƯỚC flush để không dùng token mới.
     */
    dispose() {
      disposed = true;
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    },

    /** Ghi một câu vào nháp. Trả về số câu còn thiếu. */
    write(qid, text) {
      if (submitted) return missing().length;
      draft[qid] = text;
      // Sửa bài thì lời xác nhận vừa rồi nói về một bài KHÁC. Về bước một.
      armed = false;
      saveDraft();
      schedulePush();
      return missing().length;
    },

    /**
     * Nộp CẢ CỤM. Thiếu câu thì KHÔNG gọi mạng — lượt chấm chỉ có một, và tiêu
     * nó cho một bài dở dang là không lấy lại được.
     *
     * CHƯA XÁC NHẬN thì không nộp. Chốt nằm ở đây, không chỉ ở trang: nút và
     * lời cảnh báo là chuyện của mặt vẽ, còn "một cú bấm không nộp được bài" là
     * một luật — và một luật để ngoài trang thì lần dựng lại giao diện sau sẽ
     * đánh rơi nó mà không ai thấy.
     */
    async submit() {
      if (submitted) return { already: true };
      const miss = missing();
      if (miss.length) return { missing: miss };
      if (!armed) return { needsConfirm: true };
      const answers = {};
      questions.forEach((q) => { answers[q.qid] = String(draft[q.qid] || '').trim(); });
      const r = await api.post('/api/quiz/course/writing', {
        bank_id: bankId,
        class_item: itemId,
        answers,
        duration_sec: activeTimer.seconds(),
      });
      submitted = true;
      submission = r;
      activeTimer.setActive(false);
      if (lab) {
        // Kho viết câu: hướng dẫn buổi chẩn đoán (S01/S45) chỉ mở SAU lượt nộp
        // đầu — đọc lại trạng thái để màn kết quả có ngay. Đọc hỏng thì giữ
        // bản chấm vừa nhận; lượt nộp đã chốt rồi.
        try { await refreshState(); } catch (e) { /* giữ kết quả POST */ }
      }
      if (storage) {
        try { storage.removeItem(draftKey(bankId, userId, itemId, attemptNo)); } catch (e) { /* kệ */ }
      }
      return { graded: r };
    },

    /** Ghi một câu viết lại (sau khi chấm). Trả số câu đang viết lại. */
    writeRevision(qid, text) {
      if (!lab || !submitted || lab.revision_done) return revisionCount();
      revision[qid] = text;
      return revisionCount();
    },

    renderReviseBar() { return reviseBar(); },

    /**
     * Gửi lượt viết lại — MỘT lần. Đọc lại trạng thái từ máy chủ sau khi gửi:
     * đáp án tham khảo chỉ máy chủ mới quyết định được lúc nào hiện.
     */
    async submitRevision() {
      if (!lab || !submitted || lab.revision_done) return { already: true };
      if (revisionCount() > maxRevision()) return { tooMany: true };
      const answers = {};
      Object.entries(revision).forEach(([qid, v]) => {
        if (String(v || '').trim()) answers[qid] = String(v).trim();
      });
      const r = await api.post('/api/quiz/course/writing/revise', {
        bank_id: bankId, class_item: itemId, answers,
      });
      // POST thành công = lượt viết lại ĐÃ CHỐT ở máy chủ. Dựng trạng thái từ
      // chính phản hồi ấy trước; lượt đọc lại sau chỉ để lấy đáp án tham khảo
      // theo đề. Đọc hỏng không được biến một lượt đã chốt thành "chưa gửi".
      revision = {};
      lab = { ...lab, revision_done: true };
      if (r && Array.isArray(r.items)) {
        submission = { ...(submission || {}), items: r.items,
          total: r.total ?? submission?.total, clean: r.clean ?? submission?.clean };
      }
      try { await refreshState(); } catch (e) { /* đã có bản chấm từ POST */ }
      return { revised: true };
    },

    /** Màn VIẾT. */
    renderForm() {
      if (lab) return renderLabForm();
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
             rồi trả lại câu đã sửa — không đổi cách viết của bạn. Lỗi trình bày
             (viết hoa đầu câu, dấu chấm cuối câu) vẫn được nhắc nhưng
             <strong>không làm câu bị tính là sai</strong>.
             <strong>Chỉ nộp được một lần</strong>, nên viết xong hãy đọc lại.</p>
        </div>
        <div class="cw-list">${items}</div>
        <div class="cw-bar" id="cw-bar">${bar()}</div>`;
    },

    /** Cả thanh nộp — bước một hoặc bước xác nhận. Trang vẽ lại nó sau mỗi phím. */
    renderBar() { return bar(); },

    /** Dòng trạng thái ở thanh nộp — kèm đường nhảy tới câu còn thiếu. */
    renderNote() { return noteHtml(); },

    /** Màn ĐÃ CHẤM. */
    renderResult() {
      if (lab) return renderLabResult();
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

      const list = (g) => `<ul class="cw-issues">${(g.issues || []).map((x) => `
          <li class="cw-issue">
            <span class="cw-issue__kind">${esc(KIND[x.type] || x.type || 'lỗi')}</span>
            <span><del>${esc(x.before || '')}</del> → <b>${esc(x.after || '')}</b></span>
            ${x.note ? `<span class="cw-issue__note">${esc(x.note)}</span>` : ''}
          </li>`).join('')}</ul>`;

      const items = items0.map((g, i) => {
        const q = byQid[g.qid] || {};
        const ok = g.ok;
        const formOnly = isFormOnly(g);
        // Câu ĐÚNG ngữ pháp mà còn lỗi hình thức vẫn phải thấy chỗ sửa: giấu đi
        // là dạy em ấy rằng viết thường đầu câu cũng được. Nói rõ nó không làm
        // câu bị tính sai, rồi hiện đúng chỗ cần sửa.
        const body = ok === null
          ? `<p class="cw-diff">${esc(g.answer)}</p>`
            + `<p class="cw-unknown">${esc(g.error || 'Chưa chấm được câu này.')}</p>`
          : formOnly
            ? `<p class="cw-diff">${inlineDiff(g.answer, g.corrected)}</p>`
              + '<p class="cw-unknown">Câu đúng ngữ pháp. Còn lỗi trình bày — '
              + 'sửa cho quen tay, câu này vẫn tính là đúng.</p>'
              + list(g)
            : ok
              ? `<p class="cw-diff">${esc(g.answer)}</p>`
                + '<p class="cw-unknown">Không có lỗi ngữ pháp hay chính tả.</p>'
              : `<p class="cw-diff">${inlineDiff(g.answer, g.corrected)}</p>` + list(g);
        // Đáp án mẫu cũng từ BẢN CHỤP: đề soạn lại mà lấy `q.explain` thì bài
        // cũ đứng cạnh đáp án mẫu của một đề khác (codex #935).
        const modelText = g.explain || q.explain || '';
        const model = modelText
          ? `<div class="cw-model course-explain">${formatCourseExplanation(modelText)}</div>`
          : '';
        // Đề lấy từ BẢN CHỤP trước, đề hiện hành chỉ là phương án dự phòng.
        const ask = g.prompt || q.prompt || '';
        return `<article class="cw-item" data-ok="${String(ok)}"${formOnly ? ' data-form="true"' : ''}>
          <span class="cw-item__no">Câu ${i + 1}${q.subtype ? ' · ' + esc(q.subtype) : ''}</span>
          <p class="cw-item__ask">${md(ask)}</p>
          ${body}
          ${model}
        </article>`;
      }).join('');

      // Con số nói về NGỮ PHÁP — đúng thứ bài tập này dạy. Lỗi hình thức đếm
      // riêng ở dòng dưới, để em ấy vẫn biết mình cần sửa gì mà không đọc thành
      // "bài mình sai".
      const forms = items0.filter(isFormOnly).length;
      const hint = forms
        ? `<p class="cw-unknown">${forms} câu đúng ngữ pháp nhưng còn lỗi trình bày `
          + '(viết hoa đầu câu, dấu chấm cuối câu).</p>'
        : '';
      return `<div class="cw-done">${clean}<small>/ ${total} câu đúng ngữ pháp</small></div>
        ${hint}
        <div class="cw-list">${items}</div>`;
    },
  };
}

/**
 * Báo cáo bài làm bài tập theo buổi — MỘT bộ vẽ cho HAI người đọc.
 *
 * Học viên xem lại bài mình, và giáo viên xem bài một em: cùng một nội dung,
 * nên cùng một bộ vẽ. Hai bộ vẽ cho cùng một thứ là hai chỗ để trôi khỏi nhau.
 *
 * ── Việc chính của màn này ──────────────────────────────────────────────────
 * KHÔNG phải đếm điểm. Một em sai 47/90 câu thì "47" không nói được gì để làm
 * tiếp; điều cần biết là YẾU TRỤC NÀO. Gom theo `item_key` thì 47 câu thành
 * khoảng 8 dòng, và đọc được trong ba giây.
 *
 * ── Ngôn ngữ hình ảnh ───────────────────────────────────────────────────────
 * Dùng lại đúng quy ước của bảng Speaking hằng ngày: MỰC = CHỖ CẦN CHÚ Ý. Mỗi
 * trục là một dải ô, ô SAI tô kín, ô đúng chỉ một nét mảnh — trục yếu hiện ra
 * thành một vệt đậm mà không cần đọc chữ nào. Một quy ước cho cả sản phẩm nghĩa
 * là học viên chỉ phải học nó một lần.
 */

import { formatCourseExplanation } from './course-explanation-format.js';

const esc = (s) => (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml
  ? window.WC.escapeHtml(s)
  : String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;'));

/** A, B, C… cho phương án. Học viên nói "câu B", không nói "câu chỉ số 1". */
export const optLabel = (i) => (typeof i === 'number' && i >= 0
  ? String.fromCharCode(65 + i) : '—');

/**
 * Gom câu theo TRỤC, xếp trục sai-nhiều lên trước.
 *
 * Trục vững vẫn giữ lại (không vứt): học viên cần thấy mình được gì, và giáo
 * viên cần biết trục nào KHÔNG phải lo. Chỉ là chúng nằm dưới.
 */
export function groupByAxis(questions) {
  const by = new Map();
  (questions || []).forEach((q) => {
    const k = q.item_key || q.subtype || 'Khác';
    if (!by.has(k)) by.set(k, { axis: k, items: [], wrong: 0 });
    const g = by.get(k);
    g.items.push(q);
    if (!q.is_correct) g.wrong += 1;
  });
  return [...by.values()]
    .map((g) => ({ ...g, total: g.items.length,
                   rate: g.items.length ? g.wrong / g.items.length : 0 }))
    // Sai nhiều nhất lên đầu; hoà thì trục dài hơn trước (nhiều câu = nhiều
    // bằng chứng hơn, đáng tin hơn một trục 1 câu sai 1).
    .sort((a, b) => (b.wrong - a.wrong) || (b.total - a.total));
}

/** Trục CẦN ÔN: sai từ một nửa trở lên, và có ít nhất 2 câu làm bằng chứng. */
export const needsWork = (g) => g.total >= 2 && g.rate >= 0.5;

function cellStrip(items) {
  return '<span class="cr-strip" aria-hidden="true">'
    + items.map((q) => `<i data-ok="${q.is_correct ? '1' : '0'}"></i>`).join('')
    + '</span>';
}

function questionCard(q) {
  const picked = optLabel(q.picked);
  const answer = optLabel(q.answer);
  return `<li class="cr-q" data-ok="${q.is_correct ? '1' : '0'}">
    <p class="cr-q__prompt">${mdBold(q.prompt || '')}</p>
    <dl class="cr-q__pick">
      <dt>Em chọn</dt>
      <dd><b>${esc(picked)}</b> ${esc(q.picked_text || 'không trả lời')}</dd>
      ${q.is_correct ? '' : `<dt>Đáp án</dt>
      <dd><b>${esc(answer)}</b> ${esc(q.answer_text || '')}</dd>`}
    </dl>
    ${q.why_wrong ? `<p class="cr-q__why">${esc(q.why_wrong)}</p>` : ''}
    ${q.explain ? `<div class="cr-q__explain course-explain">${formatCourseExplanation(q.explain)}</div>` : ''}
    ${q.seconds != null ? `<p class="cr-q__time">${esc(q.seconds)} giây</p>` : ''}
  </li>`;
}

/**
 * `**đậm**` → `<strong>`. Đề bài dùng in đậm để chỉ ĐÚNG cụm đang hỏi, nên bỏ
 * nó đi là bỏ mất câu hỏi. Chỉ nhận đúng một dạng — không nạp cả bộ markdown
 * cho một dấu sao.
 */
function mdBold(text) {
  return esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

const NEXT_LABEL = {
  passed: 'Đã đạt',
  retake: 'Revision ngắn',
  retry_full: 'Làm lại toàn bộ',
};

function historyDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Bảng lịch sử lấy từ mastery ledger canonical, không suy từ session rời.
 * Một full run có nhiều session (mỗi chặng một session); revision chỉ có một.
 */
export function renderAttemptHistory(history) {
  const rows = Array.isArray(history) ? history : [];
  if (!rows.length) return '';
  return `<section class="cr-history" aria-labelledby="cr-history-title">
    <header class="cr-history__head">
      <div>
        <p class="cr-history__eyebrow">Learning trail</p>
        <h2 id="cr-history-title">Session &amp; revision</h2>
      </div>
      <p>Chỉ gồm các lượt đã được hệ thống chấm và ghi vào tiến độ.</p>
    </header>
    <div class="cr-history__table-wrap">
      <table class="cr-history__table">
        <thead><tr>
          <th scope="col">Lượt</th><th scope="col">Hình thức</th>
          <th scope="col">Session</th><th scope="col">Kết quả</th>
          <th scope="col">Bước tiếp</th><th scope="col">Thời gian</th>
        </tr></thead>
        <tbody>${rows.map((row, i) => {
          const phase = row.phase === 'retake' ? 'Revision' : 'Full session';
          const completed = row.completed !== false;
          const next = completed ? (NEXT_LABEL[row.next_action] || 'Đã ghi nhận') : 'Làm nốt các phần';
          const state = !completed ? 'progress' : row.next_action === 'passed' ? 'pass'
            : row.next_action === 'retry_full' ? 'retry' : 'revise';
          return `<tr${i === rows.length - 1 ? ' data-current="true"' : ''}>
            <td data-label="Lượt"><b>#${esc(row.number || i + 1)}</b></td>
            <td data-label="Hình thức">${esc(phase)}</td>
            <td data-label="Session">${esc(row.session_count || 0)}</td>
            <td data-label="Kết quả"><strong>${completed
              ? (row.pct == null ? '—' : esc(row.pct) + '%')
              : 'Đang hoàn thành'}</strong></td>
            <td data-label="Bước tiếp"><span class="cr-history__state" data-state="${state}">${esc(next)}</span></td>
            <td data-label="Thời gian">${esc(historyDate(row.at))}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  </section>`;
}

/**
 * Vẽ trọn báo cáo.
 *
 * `opts.title` — dòng tên ở đầu (giáo viên xem bài một em thì là tên em ấy).
 * Trả về chuỗi HTML; nơi gọi tự gắn vào đâu tuỳ nó.
 */
export function renderReport(data, opts = {}) {
  const qs = (data && data.questions) || [];
  const history = renderAttemptHistory(data && data.history);
  // HAI MỨC. Chưa đạt thì máy chủ đã cắt hết phần lộ đáp án và chỉ để lại trục
  // — nên ở đây chỉ cần đừng vẽ thẻ câu rỗng, và nói ra điều kiện mở mức hai.
  const locked = !!(data && data.locked);
  const t = (data && data.totals) || {};
  const summary = (data && data.summary) || {};
  // Máy chủ nói nó ĐỌC THIẾU. Vẽ như thường là đưa ra một bản tổng kết trông
  // đầy đủ mà sai — và khi thiếu SẠCH thì "chưa có câu nào được chấm" là một
  // khẳng định lượt đọc hỏng không chứng minh được (codex cục bộ 06/08).
  const warn = (data && data.stale)
    ? '<p class="cr-stale">Chưa đọc được đầy đủ bài làm — vài câu có thể thiếu. '
      + 'Mở lại để thử lại.</p>'
    : '';
  if (!qs.length) {
    return warn + history + (warn || history ? '' : '<p class="cr-empty">Chưa có câu nào được chấm. Làm xong một '
      + 'chặng là báo cáo hiện ra ở đây.</p>');
  }
  const groups = groupByAxis(qs);
  const weak = groups.filter(needsWork);
  const worst = weak[0] || null;

  // HERO là TRỤC YẾU NHẤT, không phải điểm số. Điểm số nói em ấy đứng đâu; trục
  // yếu nói em ấy phải làm gì tiếp.
  const hero = worst
    ? `<p class="cr-hero__label">Yếu nhất</p>
       <p class="cr-hero__axis">${esc(worst.axis)}</p>
       <p class="cr-hero__sub">sai <b>${worst.wrong}</b>/${worst.total} câu</p>`
    : `<p class="cr-hero__label">Không có trục nào cần ôn</p>
       <p class="cr-hero__axis">Cả bài đều vững</p>`;

  const stats = [
    ['trắc nghiệm lượt đầu', summary.baseline_quiz_pct == null ? '—' : `${summary.baseline_quiz_pct}%`],
    ['đúng lượt đầu', `${t.correct || 0}/${t.answered || 0}`],
    ['trung vị mỗi câu', t.median_sec == null ? '—' : `${t.median_sec} giây`],
    ['thời gian trả lời', t.active_sec ? Math.round(t.active_sec / 60) + ' phút' : '—'],
    // Chỉ hiện khi CÓ — một dòng "rời máy 0 giây" là nhiễu.
    ...(t.idle_sec ? [['rời máy', Math.round(t.idle_sec / 60) + ' phút']] : []),
  ];

  return `<div class="cr">
    ${warn}
    <section class="cr-decision">
      <div><p>Kết luận gần nhất</p><strong>${esc(NEXT_LABEL[summary.latest_action] || 'Chưa có kết luận')}</strong>
      <span>${summary.latest_pct == null ? 'Chưa có lượt hoàn thành đủ phần.'
        : `${esc(summary.latest_pct)}% · ngưỡng đạt ${esc(summary.pass_pct)}%`}</span></div>
      <b>${summary.latest_pct == null ? '—' : `${esc(Math.round(summary.latest_pct))}%`}</b>
    </section>
    <section class="cr-hero">
      <div class="cr-hero__main">${hero}</div>
      <p class="cr-hero__count">
        <b>${weak.length}</b><span>trục cần ôn</span>
      </p>
    </section>

    <ul class="cr-stats">
      ${stats.map(([k, v]) => `<li><span>${esc(k)}</span><b>${esc(v)}</b></li>`).join('')}
    </ul>

    ${history}

    ${locked ? `<p class="cr-locked">Xem chi tiết từng câu kèm lời giải sẽ mở khi
      em đạt ${esc(data.threshold != null ? data.threshold + '%' : 'ngưỡng của lớp')}.
      Giờ hãy dùng bảng dưới để biết ôn trục nào trước.</p>` : ''}
    <ol class="cr-axes">
      ${groups.map((g, i) => `<li class="cr-axis" data-weak="${needsWork(g) ? '1' : '0'}">
        <button class="cr-axis__head" type="button" data-axis="${i}"
                aria-expanded="false"${locked ? ' disabled' : ''}>
          <span class="cr-axis__name">${esc(g.axis)}</span>
          <span class="cr-axis__n">${g.wrong}/${g.total}</span>
          ${cellStrip(g.items)}
        </button>
        ${locked ? '' : `<ul class="cr-qs" hidden>${g.items.map(questionCard).join('')}</ul>`}
      </li>`).join('')}
    </ol>
  </div>`;
}

/**
 * Gắn hành vi mở/đóng trục. Uỷ quyền trên một gốc, vì nội dung được vẽ lại.
 *
 * Tách khỏi `renderReport` để nơi gọi vẽ bao nhiêu lần cũng chỉ gắn một lần —
 * gắn lại sau mỗi lần vẽ là cách chắc chắn để có hai bộ nghe cùng một cú bấm.
 */
export function bindReport(root) {
  if (!root || root.dataset.crBound === '1') return;
  root.dataset.crBound = '1';
  root.addEventListener('click', (e) => {
    const head = e.target.closest('.cr-axis__head');
    if (!head || !root.contains(head)) return;
    const list = head.parentElement.querySelector('.cr-qs');
    if (!list) return;
    const open = !list.hidden;
    list.hidden = open;
    head.setAttribute('aria-expanded', open ? 'false' : 'true');
  });
}

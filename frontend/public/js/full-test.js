/**
 * Trang "Thi thử Full Test 4 kỹ năng" — danh sách kỳ thi đang mở.
 *
 * TÁCH RA TỪ MÃ INLINE của `pages/full-test.html` khi port sang Next (không đổi
 * một dòng logic nào). Lý do tách: bản Next phải chạy CHÍNH mã này, không chép
 * lại — chép là hai bản trôi khỏi nhau và cổng parity chỉ so được vỏ.
 *
 * KHÔNG tự gọi `initSupabase` như bản inline cũ: bản legacy gọi nó ngay trước
 * khi gọi `mount()`, còn bản Next để `AuthedShell` lo. Module chỉ nhận trạng
 * thái đã sẵn sàng — cùng khuôn với `vocab-modules/exercises.js`.
 */
export async function mount() {
  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return (window.WC && window.WC.escapeHtml)
      ? window.WC.escapeHtml(s) : String(s == null ? '' : s);
  }
  function show(id) {
    ['loading', 'empty', 'error'].forEach(function (s) {
      el('state-' + s).classList.add('hidden');
    });
    el('exam-list').classList.add('hidden');
    if (id) el(id).classList.remove('hidden');
  }

  var sb = window.getSupabase && window.getSupabase();
  if (sb) {
    var s = await sb.auth.getSession();
    if (!s.data.session) { location.href = '/index.html'; return; }
  }
  try {
    var res = await window.api.get('/api/mock-exams');
    var exams = (res && res.exams) || [];
    if (!exams.length) { show('state-empty'); return; }
    var host = el('exam-list'); host.innerHTML = '';
    exams.forEach(function (ex) {
      var c = document.createElement('div');
      c.className = 'ft-card';
      var retake = ex.exam_mode === 'retake';
      // C3 — a student sits one exam at a time. If another one is already in
      // progress, say so and link BACK to it, rather than offering a button
      // whose only outcome is a 409.
      var action = ex.blocked_by_sitting_id
        ? '<p class="ft-muted" style="color:var(--av-warning);margin:0 0 8px"><b>Bạn đang có một bài thi chưa hoàn thành.</b> Hãy hoàn thành bài đó trước.</p>' +
          '<a class="av-btn" style="display:inline-block" href="/mock-exam?sitting=' + encodeURIComponent(ex.blocked_by_sitting_id) + '">← Quay lại bài đang thi</a>'
        : '<a class="av-btn av-btn--primary" style="display:inline-block" href="/mock-exam?' +
          (ex.my_sitting_id
            ? 'sitting=' + encodeURIComponent(ex.my_sitting_id) + '">Tiếp tục bài đang làm →'
            : 'code=' + encodeURIComponent(ex.code) + '">Bắt đầu →') + '</a>';
      c.innerHTML =
        '<div class="ft-title">' + esc(ex.title || ex.code) +
          (retake ? ' <span class="av-badge av-badge-warning">Test lại</span>' : '') + '</div>' +
        '<p class="ft-muted" style="margin:6px 0 12px">' +
          (retake
            ? 'Bài test lại — chỉ làm kĩ năng được giao, có hẹn giờ, web tự thu bài khi hết giờ.'
            : 'Listening → Reading → Writing, giám thị mở lần lượt từng phần · Trả kết quả trong ~' + (ex.review_sla_days || 3) + ' ngày.') +
        '</p>' + action;
      host.appendChild(c);
    });
    show(); host.classList.remove('hidden');
  } catch (e) {
    el('state-error').textContent = 'Không tải được danh sách: ' + (e && e.message ? e.message : e);
    show('state-error');
  }
}

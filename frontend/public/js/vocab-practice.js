/**
 * Trang "Luyện tập từ vựng" — danh sách bài luyện theo bộ từ.
 *
 * TÁCH RA TỪ MÃ INLINE của `pages/vocab-practice.html` khi port sang Next (không
 * đổi một dòng logic nào). Bản Next chạy CHÍNH mã này, không chép lại — chép là
 * hai bản trôi khỏi nhau và cổng parity chỉ so được vỏ.
 *
 * KHÔNG tự gọi `initSupabase`: bản legacy gọi ngay trước khi gọi `mount()`, bản
 * Next để `AuthedShell` lo — cùng khuôn `/js/full-test.js`.
 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function mount() {
  let banks;
  try { banks = await window.api.get('/api/quiz/banks?skill_area=vocab'); }
  catch (e) {
    $('vp-loading').classList.add('hidden');
    $('vp-error').textContent = 'Không tải được danh sách bài luyện: ' + e.message;
    $('vp-error').classList.remove('hidden');
    return;
  }
  $('vp-loading').classList.add('hidden');
  $('vp-progress').classList.remove('hidden');

  banks = Array.isArray(banks) ? banks : [];
  if (!banks.length) { $('vp-empty').classList.remove('hidden'); return; }

  $('vp-list').innerHTML = banks.map((b) => {
    const n = b.words_count || 0;
    return '<a class="mode-card" href="/pages/quiz.html?bank=' + encodeURIComponent(b.id) + '">'
      + '<div class="head"><div class="vp-bank-state">Chưa bắt đầu</div><span class="arrow">→</span></div>'
      + '<h3>' + esc(b.title || b.code || 'Bài luyện') + '</h3>'
      + '<p class="lede vp-meta">'
      + (b.code ? '<span class="vp-code">' + esc(b.code) + '</span> · ' : '')
      + n + ' từ</p>'
      + '</a>';
  }).join('');
  $('vp-list').classList.remove('hidden');
}

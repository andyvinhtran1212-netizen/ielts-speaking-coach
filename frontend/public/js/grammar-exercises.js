/**
 * Trang "Bài tập Grammar" — gom bộ đề theo thư mục ngữ pháp.
 *
 * TÁCH RA TỪ MÃ INLINE của `pages/grammar-exercises.html` khi port sang Next
 * (không đổi một dòng logic nào). Bản Next chạy CHÍNH mã này, không chép lại.
 *
 * Trang CÔNG KHAI: không cần phiên đăng nhập, chỉ cần `window.api`.
 */
  var CATEGORIES = [
    'foundations', 'parts-of-speech', 'modifiers', 'sentence-structures',
    'tenses', 'verb-patterns', 'grammar-for-meaning', 'ielts-grammar-lab',
    'grammar-for-writing', 'error-clinic'
  ];
  function prettify(s) {
    return (s || '').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function categoryOf(code) {
    // code = G-<category>-<slug>; category may contain hyphens → longest match wins.
    var sorted = CATEGORIES.slice().sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < sorted.length; i++) {
      if (code && code.indexOf('G-' + sorted[i] + '-') === 0) return sorted[i];
    }
    return 'other';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function render(banks) {
    var skel = document.getElementById('ex-skeleton');
    var empty = document.getElementById('ex-empty');
    var wrap = document.getElementById('ex-groups');
    skel.classList.add('hidden');
    if (!banks || !banks.length) { empty.classList.remove('hidden'); return; }

    var byCat = {};
    banks.forEach(function (b) {
      var c = categoryOf(b.code);
      (byCat[c] = byCat[c] || []).push(b);
    });

    var order = CATEGORIES.concat(['other']);
    var html = order.filter(function (c) { return byCat[c]; }).map(function (c) {
      var items = byCat[c].map(function (b) {
        var count = b.words_count ? (b.words_count + ' điểm') : 'bài tập';
        return '<a href="/pages/quiz.html?bank=' + encodeURIComponent(b.id) + '" ' +
          'class="group flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 transition hover:border-teal/40 hover:bg-teal/[0.06]">' +
          '<span class="text-white/85 font-medium truncate">' + esc(b.title || b.code) + '</span>' +
          '<span class="text-xs text-white/40 whitespace-nowrap group-hover:text-teal-light">' + count + ' →</span>' +
          '</a>';
      }).join('');
      return '<section>' +
        '<h2 class="text-lg font-bold text-white mb-3">' + esc(prettify(c)) + '</h2>' +
        '<div class="grid gap-2 sm:grid-cols-2">' + items + '</div>' +
        '</section>';
    }).join('');

    wrap.innerHTML = html;
    wrap.classList.remove('hidden');
  }

export async function mount() {
  try {
    var data = await window.api.get('/api/grammar/exercises');
    render((data && data.banks) || []);
  } catch (e) {
    document.getElementById('ex-skeleton').textContent = 'Không tải được bài tập: ' + (e.message || e);
  }
}

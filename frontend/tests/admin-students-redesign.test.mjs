/**
 * frontend/tests/admin-students-redesign.test.mjs — Sprint 6.14b.
 *
 * Pins the migration of /pages/admin/students/index.html (admin student
 * management). Uses WC.bootstrap({onReady}) + real HTML <table> +
 * 2 modals (edit/create + Phase 2.5 student summary).
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

let html;
// `html` là HTML NỐI với JS, nên nó không phân biệt được "chuỗi này ở trang" với
// "chuỗi này trong mã". Vài khẳng định cần đúng một trong hai — ví dụ cắt lấy
// thân một hàm — nên giữ thêm hai nguồn rời.
let PAGE;
let JS;

// Sprint 12.1 — chrome assertions (theme toggle, header email, brand badge,
// back-link) bail when the page uses <aver-admin-chrome>. The chrome
// contract is pinned by frontend/tests/aver-admin-chrome.test.mjs.
const USES_ADMIN_CHROME = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/classes/index.html'), 'utf8').includes('<aver-admin-chrome');

let css;

before(() => {
  PAGE = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/classes/index.html'), 'utf8');
  JS   = readFileSync(path.join(REPO_ROOT, 'frontend/js/admin-students-panel.js'), 'utf8');
  // GĐ 1b: khung bảng Học viên ở trang gộp, mã ở panel JS — nối lại để
  // mọi khẳng định sẵn có giữ nguyên ý nghĩa.
  html = PAGE + JS;
  css  = readFileSync(path.join(REPO_ROOT, 'frontend/css/admin-writing.css'),     'utf8');
});


describe('admin-students.html / foundation + IIFE + WC.bootstrap', () => {
  if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
  test('foundation order tokens → components → admin-writing.css', () => {
    const t = html.indexOf('aver-design/tokens.css');
    const c = html.indexOf('aver-design/components.css');
    const p = html.indexOf('css/admin-writing.css');
    assert.ok(t > -1 && c > -1 && p > -1 && t < c && c < p);
  });

  test('Plus Jakarta Sans + JetBrains Mono fonts loaded (Inter dropped)', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.match(html, /JetBrains\+Mono/);
    assert.ok(!/family=Inter\b/.test(html));
  });

  test('no inline <style> block', () => {
    assert.equal((html.match(/<style[\s\S]*?<\/style>/g) || []).length, 0);
  });

  test('canonical anti-flash IIFE present', () => {
    assert.match(html, /localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/);
  });

  test('WC.bootstrap called with onReady callback', () => {
    assert.match(html, /WC\.bootstrap\(\s*\{[\s\S]*?onReady\s*:/);
  });

  test('writing-admin.js script loaded', () => {
    assert.match(html, /src=["']\/js\/writing-admin\.js["']/);
  });
});


describe('admin-students.html / 36 JS-coupled IDs preserved byte-identical', () => {
  const REQUIRED_IDS = [
    // WC.bootstrap state machine
    'state-loading', 'state-denied', 'state-ready', 'header-email',
    // page chrome
    'csv-input', 'btn-new', 'search-input', 'row-count', 'alert-area',
    // table
    'students-table', 'students-tbody',
    // edit/create modal
    'modal', 'modal-title',
    'f-code', 'f-name', 'f-target-band', 'f-current-band', 'f-target-date', 'f-notes',
    'student-form', 'btn-cancel', 'btn-save',
    // Phase 2.5 summary modal
    'summary-modal', 'summary-title', 'summary-subtitle', 'summary-close',
    'stat-total', 'stat-graded', 'stat-flagged', 'stat-avg-band',
    'summary-essays', 'summary-assignments',
  ];
  for (const id of REQUIRED_IDS) {
    test(`#${id} present in markup`, () => {
      // Sprint 12.1 — #header-email moved into <aver-admin-chrome> shadow DOM.
      if (USES_ADMIN_CHROME && id === 'header-email') return;
      assert.match(html, new RegExp(`id=["']${id}["']`), `Missing id="${id}"`);
    });
  }
});


describe('admin-students.html / table contract preserved', () => {
  test('semantic <table id="students-table" class="adm-table"> present', () => {
    // Sprint 18.3.2 migrated this page off the Writing-Coach chrome (.aw-table)
    // onto the shared admin components layer (.adm-table).
    assert.match(html, /<table\s+id=["']students-table["']\s+class=["']adm-table["']/);
  });

  test('thead 5 cột, ĐÚNG thứ tự, và bằng TIẾNG VIỆT', () => {
    // Trước là 7 cột. Ba trong số đó — Mục tiêu, Hiện tại, Hạn đích — đo được
    // trên prod là RỖNG 44/44 học viên: 237px bề ngang không mang một chữ nào,
    // trong khi cột Họ tên chỉ có 155px. Chúng nay gộp thành MỘT cột "Mục tiêu"
    // đọc là "hiện tại → đích" kèm hạn ở dòng dưới.
    //
    // Gộp chứ KHÔNG xoá: ba trường ấy sửa được trong hộp thoại và hiện trong
    // ngăn kéo, nên xoá khỏi bảng là bịt đường đọc khi có dữ liệu.
    // GĐ 1b: the merged page has more than one table, and the class list comes
    // first — scope to the students table or this asserts the wrong thead.
    //
    // Ghim THỨ TỰ, không ghim từng chữ rời: cột đọc theo vị trí, nên đảo chỗ
    // "Mục tiêu" với "Hiện tại" là đổi nghĩa cả bảng mà phép kiểm từng-chữ
    // không thấy.
    //
    // Nhãn nay là tiếng Việt. Người dùng màn này là giáo viên người Việt, và
    // bảng cũ trộn hai thứ tiếng ngay trên một hàng: `Code, Name, Lớp, Target`
    // (audit giao diện 06/08).
    const thead = html.match(/<table id="students-table"[\s\S]*?<\/thead>/);
    assert.ok(thead, 'students table not found on the merged page');
    const cols = [...thead[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    assert.deepEqual(cols,
      ['Mã HV', 'Họ tên', 'Lớp', 'Mục tiêu', 'Thao tác']);
  });

  test('ô Mục tiêu gộp ba trường mà không nuốt mất trường nào', () => {
    // Gộp cột dễ thành gộp DỮ LIỆU: một ô chỉ vẽ `target_band` là hai trường
    // kia biến mất khỏi bảng vĩnh viễn mà không ai thấy — đúng loại hồi quy mà
    // "bảng gọn hơn" che được.
    const fn = JS.slice(JS.indexOf('function goalCell'), JS.indexOf('function renderRows'));
    for (const f of ['target_band', 'current_band_estimate', 'target_date']) {
      assert.ok(fn.includes(f), `ô gộp đánh rơi ${f}`);
    }
    // Chưa đặt gì thì MỘT dấu gạch. Ba dấu gạch cạnh nhau đọc ra là ba thứ đang
    // hỏng, chứ không phải một mục tiêu chưa đặt.
    assert.match(fn, /t == null && c == null && !d/);
  });

  test('cột Thao tác bỏ nút trùng và hết lẫn tiếng Anh', () => {
    // "📊 Tổng quan" mang ĐÚNG `data-act="summary"` với đúng bộ dữ liệu như nút
    // tên ngay bên trái — hai nút một việc, nhân lên 44 hàng, và chính nó đẩy
    // cột Thao tác xuống hai dòng (dòng bảng cao 104px).
    const row = JS.slice(JS.indexOf('st-row-actions'), JS.indexOf('</div></td>'));
    assert.equal((row.match(/<button/g) || []).length, 3, 'phải còn đúng ba nút');
    assert.doesNotMatch(row, /Tổng quan/, 'nút trùng với nút tên');
    for (const en of ['New Essay', 'Edit', 'Delete']) {
      assert.ok(!row.includes(en), `còn nhãn tiếng Anh: ${en}`);
    }
    for (const vi of ['Giao bài viết', 'Sửa', 'Xoá']) {
      assert.ok(row.includes(vi), `thiếu nhãn: ${vi}`);
    }
    // Nút tên VẪN phải mở được tổng quan — bỏ nút kia mà quên nó là gỡ mất
    // đường vào ngăn kéo của cả 44 hàng.
    assert.match(JS, /class="st-namebtn" data-act="summary"/);
    // Và nó phải NÓI RA việc. Nút "Tổng quan" đi rồi thì với người đọc màn hình
    // cái tên trần là tất cả những gì còn lại: nghe "Chinh Le, nút" không cho
    // biết bấm vào sẽ ra gì (codex cục bộ 07/08).
    assert.match(JS, /aria-label="Xem tổng quan của[^"]*' \+ name/);
  });

  test('nhãn người dùng thấy KHÔNG còn emoji TRANG TRÍ và KHÔNG còn tiếng Anh', () => {
    // Design system: emoji không dùng làm dấu mục. Và màn này của giáo viên
    // người Việt — bảng cũ trộn hai thứ tiếng ngay trên một hàng.
    //
    // Chốt này nói về emoji TRANG TRÍ (📊 📝 📥 🎧 🏫 🎯 🚩 🔄 🔒), không phải mọi
    // ký tự ngoài bảng chữ. `⚠` ở nhãn "Đã gắn cờ" là một DẤU TRẠNG THÁI: nó
    // mang nghĩa, và bỏ nó đi thì trạng thái ấy chỉ còn phân biệt bằng màu —
    // người mù màu mất luôn. Nói rõ giới hạn ở đây, vì một chốt hứa rộng hơn
    // thứ nó kiểm là một lời bảo đảm sai (codex cục bộ 07/08).
    const EMOJI = /[\u{1F300}-\u{1FAFF}]/u;
    assert.doesNotMatch(JS, EMOJI, 'còn emoji trang trí trong admin-students-panel.js');
    assert.doesNotMatch(PAGE, EMOJI, 'còn emoji trang trí trong trang');
    // `⚠` được giữ CÓ CHỦ Ý — ghim lại để nó không bị "dọn" nhầm ở lượt sau.
    assert.ok(JS.includes('⚠ Đã gắn cờ'), 'dấu trạng thái ⚠ phải còn');
    for (const en of ['Admin Access Required', 'Under review', '>Flagged<', 'Target: ']) {
      assert.ok(!html.includes(en), `còn tiếng Anh: ${en}`);
    }
  });

  test('table renders Actions column with 4 button data-act values', () => {
    for (const act of ['summary', 'essay', 'edit', 'delete']) {
      assert.match(html, new RegExp(`data-act=["']${act}["']`), `Missing data-act="${act}"`);
    }
  });

  test('row code cell uses code-cell (monospace)', () => {
    // .adm-table td.code-cell carries var(--av-font-mono) (admin-components.css).
    assert.match(html, /class=["']code-cell["']/);
  });
});


describe('admin-students.html / endpoints preserved', () => {
  test('GET /admin/students with limit+search params', () => {
    assert.match(html, /\/admin\/students\?limit=200/);
    assert.ok(
      html.includes("'&search=' + encodeURIComponent(_searchValue)"),
      'Missing search-param concat: \'&search=\' + encodeURIComponent(_searchValue)',
    );
  });

  test('GET /admin/students/{id} (edit fetch)', () => {
    assert.match(html, /window\.api\.get\(\s*['"]\/admin\/students\/['"]\s*\+\s*id\s*\)/);
  });

  test('POST /admin/students (create)', () => {
    assert.match(html, /window\.api\.post\(\s*['"]\/admin\/students['"]/);
  });

  test('PATCH /admin/students/{id} (edit)', () => {
    assert.match(html, /window\.api\.patch\(\s*['"]\/admin\/students\/['"]\s*\+\s*_editingId/);
  });

  test('DELETE /admin/students/{id} (delete)', () => {
    assert.match(html, /window\.api\.delete\(\s*['"]\/admin\/students\/['"]\s*\+\s*id/);
  });

  test('POST /admin/students/import (CSV upload)', () => {
    assert.match(html, /window\.api\.upload\(\s*['"]\/admin\/students\/import['"]/);
  });

  test('GET /admin/writing/students/{id}/summary (Phase 2.5 summary modal)', () => {
    assert.match(html, /window\.api\.get\(\s*['"]\/admin\/writing\/students\/['"]\s*\+\s*studentId\s*\+\s*['"]\/summary['"]/);
  });
});


describe('admin-students.html / form payload preserved', () => {
  test('payload always includes student_code + full_name', () => {
    const block = html.match(/handleSave[\s\S]*?try\s*\{/);
    assert.ok(block);
    assert.match(block[0], /student_code\s*:/);
    assert.match(block[0], /full_name\s*:/);
  });

  test('optional payload keys conditional on non-empty input', () => {
    for (const key of ['target_band', 'current_band_estimate', 'target_date', 'persona_notes']) {
      assert.match(html, new RegExp(`payload\\.${key}\\s*=`), `Missing optional payload assignment: ${key}`);
    }
  });
});


describe('admin-students.html / Phase 2.5 summary modal contract preserved', () => {
  test('summary modal opens via openSummary(studentId, fallbackName)', () => {
    assert.match(html, /function\s+openSummary\(\s*studentId\s*,\s*fallbackName\s*\)/);
  });

  test('4 stat fields populated: total / graded / flagged / avg-band', () => {
    for (const field of ['stat-total', 'stat-graded', 'stat-flagged', 'stat-avg-band']) {
      assert.match(html, new RegExp(`getElementById\\(\\s*['"]${field}['"]\\s*\\)\\.textContent`), `Missing population for #${field}`);
    }
  });

  test('summary stats source fields preserved (total_essays, graded_count, flagged_count, average_band_last5)', () => {
    for (const f of ['total_essays', 'graded_count', 'flagged_count', 'average_band_last5']) {
      assert.match(html, new RegExp(`st\\.${f}`), `Missing st.${f} source`);
    }
  });

  test('_bandFromEssay handles both array and object writing_feedback shapes', () => {
    assert.match(html, /Array\.isArray\(fb\)\s*&&\s*fb\.length/);
    assert.match(html, /fb\s*&&\s*typeof\s+fb\s*===\s*['"]object['"]/);
  });

  test('Escape key closes summary modal', () => {
    assert.match(html, /e\.key\s*===\s*['"]Escape['"]/);
    assert.match(html, /closeSummary\(\)/);
  });
});


describe('admin-students.html / search debounce + delete confirm preserved', () => {
  test('debounce wraps the search handler with 300ms', () => {
    // Post-migration this page uses a local debounce() helper, not WC.debounce.
    assert.match(html, /\bdebounce\(function\s*\(\s*\)\s*\{[\s\S]*?_searchValue\s*=\s*document\.getElementById\(\s*['"]search-input['"][\s\S]*?\}\s*,\s*300\)/);
  });

  test('Delete confirm uses Vietnamese with embedded student code', () => {
    assert.match(html, /confirm\(\s*['"]Xóa học viên/);
    assert.match(html, /Tất cả essays của học viên này cũng sẽ bị xóa/);
  });
});


describe('admin-students.html / row action redirect to admin-writing-new.html', () => {
  test('Essay action navigates to admin-writing-new.html?student_id={id}', () => {
    if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
    assert.match(html, /\/pages\/admin-writing-new\.html\?student_id=/);
  });

  test('Summary essay rows link to admin-writing-grade.html?essay_id={id}', () => {
    if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
    assert.match(html, /\/pages\/admin-writing-grade\.html\?essay_id=/);
  });
});


describe('admin-students.html / body class + theme toggle', () => {
  if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
  test('body uses av-page', () => {
    assert.match(html, /<body[^>]*class=["'][^"']*\bav-page\b/);
  });

  test('canonical theme toggle present', () => {
    if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
    assert.match(html, /class=["']icon-sun["']/);
    assert.match(html, /class=["']icon-moon["']/);
  });
});


describe('admin-students.html / Vietnamese microcopy preserved', () => {
  if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
  const phrases = [
    'Students',
    'Quản lý profile + theo dõi lịch sử bài viết',
    'Import CSV',
    'New Student',
    'Tìm theo mã hoặc tên',
    'học viên',
    'Đang tải…',
    'Chưa có học viên.',
    'Tổng quan',
    'New Essay',
    'Edit',
    'Delete',
    'Mã học viên',
    'Họ và tên',
    'Target Band',
    'Current Band',
    'Target Date',
    'Persona Notes',
    'Cancel',
    'Save',
    'Đóng',
    'Tổng bài',
    'Đã chấm',
    'Flagged',
    'Avg band 5 bài gần nhất',
    'Bài viết gần đây',
    'Đề bài giao gần đây',
    'Chưa có bài viết.',
    'Chưa có bài giao.',
    'Đã cập nhật học viên.',
    'Đã tạo học viên mới.',
    'Đã xóa học viên.',
    'Tất cả essays của học viên này cũng sẽ bị xóa',
    'Import xong:',
    'Không tải được danh sách:',
    'Không tải được tổng quan:',
    'Under review',
  ];
  for (const phrase of phrases) {
    test(`microcopy preserved: "${phrase.slice(0, 40)}…"`, () => {
      assert.ok(html.includes(phrase), `Missing exact phrase: ${phrase}`);
    });
  }
});


describe('admin-writing.css / Sprint 6.14b table + stat-card primitives defined', () => {
  test('aw-table semantic primitives defined', () => {
    for (const sel of ['.aw-table', '.aw-table__code', '.aw-table__empty', '.aw-table__row-count']) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)));
    }
  });

  test('aw-stat-card + aw-stat-num + aw-stat-label primitives defined', () => {
    for (const sel of ['.aw-stat-card', '.aw-stat-num', '.aw-stat-num--flagged', '.aw-stat-label']) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)));
    }
  });

  test('aw-summary-list primitives defined', () => {
    for (const sel of ['.aw-summary-list', '.aw-summary-list__empty', '.aw-summary-section-heading']) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)));
    }
  });

  test('aw-mini-pill defined (flagged + plain)', () => {
    assert.match(css, /\.aw-mini-pill\b/);
    assert.match(css, /\.aw-mini-pill--flagged\b/);
  });

  test('aw-file-button + aw-search-meta defined', () => {
    assert.match(css, /\.aw-file-button\b/);
    assert.match(css, /\.aw-search-meta\b/);
  });

  test('stat numbers + table code use mono font (tnum)', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const sel of ['.aw-stat-num', '.aw-table__code']) {
      const escaped = sel.replace(/[.\-]/g, m => '\\' + m);
      const block = stripped.match(new RegExp('^' + escaped + '[^{]*\\{[^}]*\\}', 'm'));
      assert.ok(block, `${sel} block missing`);
      assert.match(block[0], /--av-font-mono/, `${sel} must use --av-font-mono`);
    }
  });
});


describe('admin-writing.css / token discipline (students page)', () => {
  test('no Era B / production-typo hex literals in runtime CSS', () => {
    const runtime = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const h of ['#0a1628', '#14b8a6', '#0d9488', '#14a8ae', '#f87171', '#fbbf24', '#5eead4']) {
      assert.ok(!runtime.includes(h), `runtime CSS should not contain ${h}`);
    }
  });

  test('--av-text-faint usage stays under the 10-instance cap (this page only)', () => {
    const total = (html.match(/--av-text-faint/g) || []).length;
    assert.ok(total <= 10, `--av-text-faint on this page ≤ 10, got ${total}`);
  });
});


// ── WF-1 — "Lớp" column + bulk-assign-to-cohort ─────────────────────────────

import { readFileSync as _rf } from 'node:fs';
const USERS_HTML = _rf(path.join(REPO_ROOT, 'frontend/pages/admin/users/index.html'), 'utf8');
const USERS_JS   = _rf(path.join(REPO_ROOT, 'frontend/js/admin-users.js'), 'utf8');

describe('admin-students.html / WF-1 Lớp column + bulk-assign', () => {
  test('Lớp column header + cell renders cohort_name with "—" fallback', () => {
    assert.match(html, /<th>Lớp<\/th>/);
    assert.match(html, /r\.cohort_name\s*\?\s*esc\(r\.cohort_name\)\s*:\s*'—'/);
  });

  test('per-row checkbox + select-all + selection Set', () => {
    assert.match(html, /id="bulk-select-all"/);
    assert.match(html, /class="row-check"[^>]*\bdata-id=/);   // a11y aria-label may sit between
    assert.match(html, /_selectedIds\s*=\s*new Set\(\)/);
  });

  test('bulk bar + assign POSTs to /students/bulk with student_ids[]', () => {
    assert.match(html, /id="bulk-bar"/);
    assert.match(html, /id="bulk-cohort"/);
    assert.match(html, /\/students\/bulk'/);
    assert.match(html, /student_ids:\s*ids/);
  });

  test('colspan khớp số cột THẬT của thead', () => {
    // Ghim con số trần ("phải là 8") là ghim một lần chụp: gộp ba cột mục tiêu
    // làm nó sai mà không nói được sai ở đâu. Đếm `<th>` rồi so — chốt này tự
    // đúng qua mọi lần đổi cột, và bắt được đúng thứ nó tồn tại để bắt: một
    // dòng "Chưa có học viên" trải sai số ô.
    const thead = PAGE.match(/<table id="students-table"[\s\S]*?<\/thead>/);
    const n = (thead[0].match(/<th[\s>]/g) || []).length;

    // Đọc `colspan` KHÔNG phụ thuộc thứ tự thuộc tính hay kiểu nháy: bản trước
    // chỉ khớp đúng chuỗi `colspan="N" class="st-empty"`, nên viết ngược thành
    // `class="st-empty" colspan="5"` là chốt lặng thinh (codex cục bộ 07/08).
    const colspanOf = (tag) => {
      const m = tag.match(/colspan\s*=\s*["']?(\d+)/);
      return m ? Number(m[1]) : null;
    };
    // Và soi ĐÚNG hai chỗ, không quét cả tệp: ô chờ trong `<tbody>` của bảng
    // học viên, và nhánh "chưa có học viên" của `renderRows`.
    const places = [
      ['ô chờ trong trang',
       PAGE.slice(PAGE.indexOf('<tbody id="students-tbody">'),
                  PAGE.indexOf('</tbody>', PAGE.indexOf('<tbody id="students-tbody">')))],
      ['nhánh rỗng của renderRows',
       JS.slice(JS.indexOf('function renderRows'), JS.indexOf('rows.map(function'))],
    ];
    for (const [what, src] of places) {
      const tags = [...src.matchAll(/<td[^>]*st-empty[^>]*>/g)].map((m) => m[0]);
      assert.equal(tags.length, 1, `${what}: phải có đúng một ô chờ`);
      assert.equal(colspanOf(tags[0]), n,
        `${what}: colspan=${colspanOf(tags[0])} nhưng thead có ${n} cột`);
    }
  });

  test('cohort dropdown batched once from GET /admin/cohorts (no N+1)', () => {
    assert.match(html, /api\.get\('\/admin\/cohorts'\)/);
    assert.match(html, /_cohortsLoaded/);
  });
});

describe('admin/users — WF-1 Lớp column', () => {
  test('users table has a Lớp header + admin-users.js renders cohort_name with "—"', () => {
    assert.match(USERS_HTML, /<th>Lớp<\/th>/);
    assert.match(USERS_JS, /escapeHtml\(u\.cohort_name\s*\|\|\s*'—'\)/);
  });
});

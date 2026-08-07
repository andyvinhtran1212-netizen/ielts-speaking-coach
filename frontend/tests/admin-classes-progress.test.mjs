/**
 * admin-classes.js — ma trận tiến độ 4 kỹ năng (GĐ 4).
 *
 * Executes the cell renderer rather than matching its source: what can be wrong
 * here is what a cell MEANS. "—" for a skill whose query failed and "—" for a
 * student who genuinely has not started look identical on screen, and only one
 * of them is true.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');
const PAGE = readFileSync(join(HERE, '..', 'public', 'pages', 'admin', 'classes', 'index.html'), 'utf8');

const codeOnly = (s) => s.replace(/\/\/[^\n]*/g, '');

function loadHelpers() {
  // Cắt từ `strip` chứ không từ `skillCell`: `skillCell` GỌI `strip`, nên lát
  // cắt bỏ nó lại thì hàm chạy trong ô thử ném ReferenceError.
  const start = SRC.indexOf('function strip');
  const end = SRC.indexOf('function renderProgress');
  assert.ok(start !== -1 && end > start, 'progress helpers not found');
  const esc = (s) => String(s == null ? '' : s);
  const countLabel = (n) => String(n);
  return new Function('esc', 'countLabel', `${SRC.slice(start, end)}
    return { skillCell, punctualityCell, lastAcrossSkills, strip };`)(esc, countLabel);
}

const { skillCell, punctualityCell, lastAcrossSkills, strip } = loadHelpers();


describe('a skill cell keeps "unknown" apart from "nothing yet"', () => {
  test('a failed skill says so — it must never read as zero', () => {
    const html = skillCell(null);
    assert.match(html, /không đọc được/);
    assert.doesNotMatch(html, /lượt/);
    assert.doesNotMatch(html, /^—$/);
  });

  test('genuinely nothing yet is a plain dash', () => {
    const html = skillCell({ attempts: 0, last_band: null, last_activity: null });
    assert.match(html, /—/);
    assert.doesNotMatch(html, /không đọc được/);
  });

  test('attempts show with the last real band', () => {
    const html = skillCell({ attempts: 4, last_band: 6.5, last_activity: '2026-08-01' });
    assert.match(html, /4 lượt/);
    assert.match(html, /band 6.5/);
  });

  test('attempts with no band yet show the count alone', () => {
    const html = skillCell({ attempts: 2, last_band: null, last_activity: '2026-08-01' });
    assert.match(html, /2 lượt/);
    assert.doesNotMatch(html, /band/);
  });

  test('undefined is treated as unknown, not as empty', () => {
    assert.match(skillCell(undefined), /không đọc được/);
  });
});


describe('last activity is the newest across all four skills', () => {
  test('picks the latest stamp', () => {
    assert.equal(lastAcrossSkills({
      speaking: { last_activity: '2026-08-01' },
      writing: { last_activity: '2026-08-05' },
      reading: { last_activity: '2026-08-03' },
      listening: { last_activity: null },
    }), '2026-08-05');
  });

  test('a failed (null) skill does not break the scan', () => {
    assert.equal(lastAcrossSkills({
      speaking: null,
      writing: { last_activity: '2026-08-02' },
    }), '2026-08-02');
  });

  test('nothing anywhere yields nothing', () => {
    assert.equal(lastAcrossSkills({ speaking: null, writing: null }), '');
    assert.equal(lastAcrossSkills({}), '');
  });
});


describe('the tab reports failure instead of an empty class', () => {
  const fn = codeOnly(SRC.slice(SRC.indexOf('async function loadProgress'),
                                SRC.indexOf('// ── Sub-tabs')));

  test('a failed load shows an error and hides the table', () => {
    // Qua trạng thái chung + renderProgressBanner, KHÔNG ghi thẳng DOM: ghi
    // thẳng sẽ xoá lời cảnh báo của bảng bài hằng ngày (chạy song song).
    assert.match(fn, /_progressNotes = \[/);
    assert.match(fn, /renderProgressBanner\(\)/);
    assert.match(fn, /Không đọc được tiến độ lớp/);
    assert.match(fn, /\$\('progress-table-wrap'\)\.hidden = true/);
    assert.match(fn, /\$\('progress-empty'\)\.hidden = true/,
      '"chưa có học viên" must not stand in for a failed request');
  });

  test('a failure releases the once-only latch so the tab can retry', () => {
    assert.match(fn, /_progressLoaded = false/);
  });
});


describe('Tiến độ là một ỐNG KÍNH, không còn là tab', () => {
  // Giáo viên không nghĩ theo tab, họ nghĩ theo HỌC VIÊN: "Sĩ số" và "Tiến độ"
  // là cùng một danh sách nhìn qua hai ống kính. Hàng đứng yên, chỉ cột đổi.
  test('có nút ống kính, KHÔNG còn tab riêng', () => {
    assert.match(PAGE, /data-lens="progress"/);
    assert.match(PAGE, /data-lens="today"/);
    assert.doesNotMatch(PAGE, /id="tab-progress"/,
      'còn tab là còn bốn tầng điều hướng');
    // Khung bảng 4 kỹ năng vẫn ở lại: ống kính đọc lại dữ liệu đã dựng vào đó.
    assert.match(PAGE, /id="panel-progress"/);
  });

  test('vẫn nạp LÚC CẦN, ở lần đổi ống kính đầu tiên', () => {
    const fn = codeOnly(SRC.slice(SRC.indexOf('function setLens'),
                                  SRC.indexOf('function renderDrawer')));
    assert.match(fn, /'progress'/);
    assert.match(fn, /_progressLoaded/);
    assert.match(fn, /loadProgress\(\)/);
  });

  test('bấm một hàng mở NGĂN KÉO, không mở hộp thoại', () => {
    assert.match(PAGE, /id="roster-drawer"/);
    const fn = codeOnly(SRC.slice(SRC.indexOf("$('roster-tbody').addEventListener"),
                                  SRC.indexOf("const lensBar")));
    assert.match(fn, /_picked/, 'phải nhớ hàng đang chọn để giữ nó sáng');
    assert.doesNotMatch(fn, /openModal|showModal/, 'hộp thoại làm mất chỗ đứng');
  });

  test('the four skill columns are all present', () => {
    for (const s of ['Speaking', 'Writing', 'Reading', 'Listening']) {
      assert.match(PAGE, new RegExp(`<th>${s}</th>`));
    }
  });
});


describe('a roster change invalidates the cached progress (Codex review)', () => {
  // The tab loads once and caches. Adding or removing a student made that cache
  // wrong, and reopening the tab showed the old class until a full page reload.
  const between = (from, to) => codeOnly(SRC.slice(SRC.indexOf(from), SRC.indexOf(to)));

  test('adding a student invalidates it', () => {
    const fn = between('async function submitMember', 'function removeMember');
    assert.match(fn, /invalidateProgress\(\)/);
  });

  test('removing a student invalidates it too', () => {
    // Pinned separately: the two mutations are different functions and fixing
    // one is exactly the shape of miss this whole programme kept repeating.
    const fn = between('function removeMember', '// ── Chi tiết lớp: buổi học');
    assert.match(fn, /invalidateProgress\(\)/);
  });

  test('invalidation clears the latch AND the stale rows', () => {
    const fn = between('function invalidateProgress', 'async function loadProgress');
    assert.match(fn, /_progressLoaded = false/);
    assert.match(fn, /_progress = \{ students: \[\], degraded: \[\] \}/,
      'leaving the old rows would flash the previous class on reopen');
  });

  test('ống kính đang mở thì nạp lại NGAY, không đợi lần mở sau', () => {
    // Câu hỏi đúng nay là "ống kính nào đang bật", không phải "panel-progress
    // có hiện không" — sau khi Tiến độ thành ống kính, khối ấy chỉ hiện khi
    // ống kính bật, nên điều kiện cũ trở thành vòng lặp tự nói về mình.
    const fn = between('function invalidateProgress', 'async function loadProgress');
    assert.match(fn, /_lens === 'progress'/);
    assert.match(fn, /loadProgress\(\)/);
  });

  test('bộ nhớ THỨ HAI của ống kính cũng bị xoá', () => {
    // Quên nó thì thêm một em vào lớp sẽ để những em cũ hiện số cũ trông y như
    // thật, còn em mới thì "chưa đọc được" — một bảng nửa cũ nửa mới, tệ hơn
    // một bảng nói thẳng là chưa đọc (codex #975).
    const fn = between('function invalidateProgress', 'async function loadProgress');
    assert.match(fn, /_progressBy = null/);
  });
});


describe('% nộp đúng hạn keeps "unknown" apart from "always late"', () => {
  test('a failed ledger read says so', () => {
    assert.match(punctualityCell(null), /không đọc được/);
    assert.doesNotMatch(punctualityCell(null), /%/);
  });

  test('nothing handed in yet is a dash, never 0%', () => {
    const html = punctualityCell({ assigned: 3, submitted: 0, late: 0, missing: 3, on_time_pct: null });
    assert.match(html, /—/);
    assert.doesNotMatch(html, /0%/,
      '0% reads as "always late" for someone who may simply be new');
  });

  test('a rate shows, with overdue work flagged beside it', () => {
    const html = punctualityCell({ assigned: 5, submitted: 4, late: 1, missing: 1, on_time_pct: 75 });
    assert.match(html, /75%/);
    assert.match(html, /1 chưa nộp/);
    assert.match(html, /cl-roster-gap/, 'overdue work is the part worth acting on');
  });

  test('a clean record shows the rate with no alarm', () => {
    const html = punctualityCell({ assigned: 4, submitted: 4, late: 0, missing: 0, on_time_pct: 100 });
    assert.match(html, /100%/);
    assert.doesNotMatch(html, /cl-roster-gap/);
  });

  test('the column exists in the table', () => {
    assert.match(PAGE, /<th>Nộp đúng hạn<\/th>/);
  });
});


// ── hai kiểu hỏng, hai câu khác nhau ─────────────────────────────────────
//
// A skill that failed to load shows "—" and the fix is to reload. A stale
// homework column is the opposite: the numbers ARE there and look canonical,
// but a Reading/Listening hand-in may not be folded in yet. Telling the admin
// to reload would send them chasing a number that is not wrong, just behind.

function loadBanner() {
  const SRC = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');
  const start = SRC.indexOf('  const DEGRADED_LABEL = {');
  const end = SRC.indexOf("  $('progress-empty')");
  const rb0 = SRC.indexOf('function renderProgressBanner');
  const rb1 = SRC.indexOf('async function loadDailyBoard');
  assert.ok(start !== -1 && end > start && rb0 !== -1 && rb1 > rb0,
    'degraded banner block not found');

  // Băng nay do renderProgressBanner vẽ, gộp ghi chú của CẢ HAI nguồn (tiến độ
  // + bảng bài hằng ngày) — hai lượt gọi chạy song song, bên nào ghi thẳng DOM
  // cũng sẽ xoá lời bên kia. Nên khung phải chạy qua đúng đường ấy.
  return (degraded, boardNote = '') => {
    const node = { hidden: null, textContent: '' };
    const $ = () => node;
    new Function('$', 'degraded', '_boardNote', `
      let _progressNotes = [];
      ${SRC.slice(rb0, rb1)}
      ${SRC.slice(start, end)}
    `)($, degraded, boardNote);
    return node;
  };
}

const banner = loadBanner();

describe('progress banner', () => {
  test('nothing wrong → no banner', () => {
    assert.equal(banner([]).hidden, true);
  });

  test('a failed skill read asks for a reload', () => {
    const n = banner(['listening']);
    assert.equal(n.hidden, false);
    assert.match(n.textContent, /Chưa đọc được số liệu: Listening/);
    assert.match(n.textContent, /Tải lại/);
  });

  test('a stale homework column says stale, not "reload"', () => {
    const n = banner(['homework_stale']);
    assert.equal(n.hidden, false);
    assert.match(n.textContent, /chưa cập nhật/);
    assert.doesNotMatch(n.textContent, /Tải lại/,
      'the numbers are behind, not unreadable — reloading is not the fix');
    assert.doesNotMatch(n.textContent, /homework_stale/,
      'the raw flag name must not reach the screen');
  });

  test('both at once → both sentences', () => {
    const n = banner(['writing', 'homework_stale']);
    assert.match(n.textContent, /Writing/);
    assert.match(n.textContent, /chưa cập nhật/);
  });

  test('lời cảnh báo KHÔNG nêu tên kỹ năng nào', () => {
    // Cờ này bật cho CẢ BA đường vá sổ — Speaking, Reading/Listening, và bài
    // tập theo buổi. Câu chữ cũ chỉ nhắc "Reading/Listening", nên khi đường
    // Speaking hay bài-theo-buổi hỏng thì giáo viên đọc xong vẫn yên tâm tin
    // con số của đúng hai chỗ đang cũ — một lời cảnh báo dẫn sai còn tệ hơn
    // không cảnh báo (codex 06/08).
    const n = banner(['homework_stale']);
    for (const skill of [/Reading/, /Listening/, /Speaking/, /theo buổi/]) {
      assert.doesNotMatch(n.textContent, skill,
        'nêu một kỹ năng là ngầm nói những kỹ năng kia vẫn đúng');
    }
  });

  test('ghi chú của bảng bài hằng ngày KHÔNG bị lời của tiến độ xoá mất', () => {
    // /speaking-daily hỏng trước, /progress xong sau — trước đây lời cảnh báo
    // của bảng biến mất, đúng thứ giáo viên cần thấy nhất (codex #931).
    const n = banner([], 'Không đọc được bảng bài hằng ngày: mạng lỗi.');
    assert.equal(n.hidden, false);
    assert.match(n.textContent, /bảng bài hằng ngày/);
  });

  test('cả hai nguồn cùng có chuyện thì nói CẢ HAI', () => {
    const n = banner(['listening'], 'Không đọc được bảng bài hằng ngày: mạng lỗi.');
    assert.match(n.textContent, /Listening/);
    assert.match(n.textContent, /bảng bài hằng ngày/);
  });
});

// ── Bốn cột kỹ năng phải phân biệt được bằng MÀU, không chỉ bằng vị trí ─────

describe('nhãn màu kỹ năng', () => {
  test('mỗi ô mang tên kỹ năng của nó', () => {
    // Không có `data-skill` thì CSS không có gì để bám, và bốn cột lại chỉ
    // phân biệt bằng thứ tự — đọc chéo một hàng phải đếm cột.
    const src = readFileSync(
      new URL('../public/js/admin-classes.js', import.meta.url), 'utf8');
    for (const s of ['speaking', 'writing', 'reading', 'listening']) {
      assert.ok(src.includes(`skillCell(r.skills.${s}, '${s}', r.target_band)`),
        `cột ${s} chưa truyền tên kỹ năng + mục tiêu`);
    }
    assert.ok(src.includes('data-skill="'), 'skillCell phải phát ra data-skill');
  });

  test('Speaking dùng token RIÊNG, không dùng chung amber', () => {
    // Amber (--av-accent) có đúng một vai: con số quan trọng nhất màn hình.
    // Dùng lại nó cho một cột bảng là làm nó hết nghĩa "nhìn đây".
    const css = readFileSync(
      new URL('../public/pages/admin/classes/index.html', import.meta.url), 'utf8');
    const rule = css.match(/\.cl-skill\[data-skill="speaking"\][^}]*}/);
    assert.ok(rule, 'chưa có quy tắc màu cho cột Speaking');
    assert.match(rule[0], /var\(--av-skill-speaking\)/);
    assert.doesNotMatch(rule[0], /--av-accent/);
  });

  test('token ấy có thật trong hệ, không phải tên bịa', () => {
    const tok = readFileSync(
      new URL('../public/css/aver-design/tokens.css', import.meta.url), 'utf8');
    assert.match(tok, /--av-skill-speaking:\s*#[0-9a-fA-F]{6}/);
  });
});


// ── Dải ô: bốn cột số thành bốn vệt đọc-trong-ba-giây ──────────────────────
//
// Bốn cột band số bắt mắt đọc bốn con số rồi tự so. Một vệt đậm thì thấy ngay.
// Quy ước MỰC = CHỖ CẦN CHÚ Ý, dùng lại đúng của `course-report.js` — học viên
// và giáo viên chỉ phải học nó một lần.

describe('dải ô', () => {
  test('không có dữ liệu thì KHÔNG vẽ gì', () => {
    // Một dải rỗng trông như "toàn đạt" — một khẳng định không có bằng chứng.
    assert.equal(strip(null, 6.0), '');
    assert.equal(strip([], 6.0), '');
    assert.equal(strip(undefined, 6.0), '');
  });

  test('ô tô kín là lượt DƯỚI MỤC TIÊU CỦA CHÍNH EM ẤY', () => {
    // Một ngưỡng chung cho cả lớp sẽ gọi một em mục tiêu 5.5 đạt 6.0 là yếu.
    const html = strip([5.5, 6.5, 5.0], 6.0);
    assert.equal((html.match(/data-w="1"/g) || []).length, 2);
    assert.equal((html.match(/data-w="0"/g) || []).length, 1);
  });

  test('cùng một dãy band, mục tiêu khác thì kết luận khác', () => {
    assert.equal((strip([6.0, 6.0], 6.5).match(/data-w="1"/g) || []).length, 2);
    assert.equal((strip([6.0, 6.0], 5.5).match(/data-w="1"/g) || []).length, 0);
  });

  test('chưa đặt mục tiêu thì KHÔNG tô ô nào', () => {
    // Đoán một ngưỡng rồi vẽ ra như sự thật còn tệ hơn vẽ một dải phẳng.
    const html = strip([4.0, 4.5, 5.0], null);
    assert.equal((html.match(/data-w="1"/g) || []).length, 0);
    assert.equal((html.match(/<i /g) || []).length, 3, 'vẫn vẽ dải, chỉ không kết luận');
  });

  test('chỉ giữ 8 lượt gần nhất — và giữ đúng CUỐI dãy', () => {
    const many = Array.from({ length: 12 }, (_, i) => (i >= 10 ? 4.0 : 7.0));
    const html = strip(many, 6.0);
    assert.equal((html.match(/<i /g) || []).length, 8);
    assert.equal((html.match(/data-w="1"/g) || []).length, 2,
      'lấy 8 lượt ĐẦU sẽ mất đúng hai lượt gần đây nhất');
  });

  test('band thiếu không bị đọc thành yếu', () => {
    // Lượt chưa chấm là chưa biết, không phải kém.
    assert.equal((strip([null, undefined, 7.0], 6.0).match(/data-w="1"/g) || []).length, 0);
  });

  test('dải ô là trang trí với trình đọc màn hình', () => {
    // Con số ngay bên cạnh đã nói đủ; đọc thêm tám ô rỗng là nhiễu.
    assert.match(strip([5.0], 6.0), /aria-hidden="true"/);
  });

  test('ô kín lấy đúng màu KỸ NĂNG của cột', () => {
    // `currentColor` KHÔNG dùng được: quy tắc kỹ năng chỉ đặt `border-left-color`
    // nên `currentColor` rơi về màu CHỮ thừa kế, và bốn dải tô cùng một màu —
    // đúng thứ mà nhãn màu sinh ra để phân biệt (codex #974).
    const css = readFileSync(
      new URL('../public/pages/admin/classes/index.html', import.meta.url), 'utf8');
    const rule = css.match(/\.cl-strip i\[data-w="1"\][^}]*}/);
    assert.ok(rule, 'chưa có quy tắc cho ô tô kín');
    assert.match(rule[0], /var\(--cl-skill-hue/);
    assert.doesNotMatch(rule[0], /currentColor/);
  });

  test('mỗi kỹ năng đặt biến màu RIÊNG', () => {
    const css = readFileSync(
      new URL('../public/pages/admin/classes/index.html', import.meta.url), 'utf8');
    const hues = {};
    for (const s of ['speaking', 'writing', 'reading', 'listening']) {
      const m = css.match(new RegExp(`\\.cl-skill\\[data-skill="${s}"\\][^}]*}`));
      assert.ok(m, `thiếu màu cho ${s}`);
      const v = m[0].match(/--cl-skill-hue:\s*var\((--av-[a-z-]+)\)/);
      assert.ok(v, `${s} chưa đặt --cl-skill-hue`);
      hues[s] = v[1];
    }
    assert.equal(new Set(Object.values(hues)).size, 4,
      'bốn kỹ năng phải bốn màu — trùng màu là không phân biệt được');
  });
});

describe('cột tên dính', () => {
  const css = readFileSync(
    new URL('../public/pages/admin/classes/index.html', import.meta.url), 'utf8');

  test('cột đầu dính khi màn đủ rộng để CÓ cuộn', () => {
    const block = css.match(/@media \(min-width: 900px\)[\s\S]*?#progress-table-wrap[\s\S]*?\}/);
    assert.ok(block, 'chưa ghim cột tên');
    assert.match(block[0], /position: sticky/);
    assert.match(block[0], /left: 0/);
  });

  test('nền ĐẶC, không trong suốt', () => {
    // Nội dung cuộn qua bên dưới sẽ hiện xuyên lên và hai lớp chữ chồng nhau.
    const i = css.indexOf('#progress-table-wrap th:first-child');
    const seg = css.slice(i, i + 500);
    assert.match(seg, /background: var\(--av-surface-card\)/);
    assert.doesNotMatch(seg, /rgba|transparent/);
  });
});


describe('trang đọc ĐÚNG TÊN trường máy chủ gửi', () => {
  test('`recent_bands` và `target_band`, không phải tên tôi tự đặt', () => {
    // Bẫy đã vấp: vẽ một thứ dựa vào trường máy chủ KHÔNG gửi thì nó không bao
    // giờ hiện, mà chốt phía trang vẫn xanh vì nó tự đưa dữ liệu vào.
    //
    // Phía MÁY CHỦ có chốt chạy thật trong `test_cohort_progress_aggregator.py`;
    // chốt này chỉ canh phía trang gọi đúng tên.
    const src = readFileSync(
      new URL('../public/js/admin-classes.js', import.meta.url), 'utf8');
    assert.ok(src.includes('strip(cell.recent_bands, target)'));
  });
});

// ── Ống kính Tiến độ KHÔNG được chôn mất các bảng khác ─────────────────────
//
// `panel-progress` không chỉ chứa bảng 4 kỹ năng: bảng liên tục hằng ngày,
// danh sách can thiệp Speaking và cờ "chưa đối chiếu được" đều sống trong đó.
// Giấu cả khối là làm chúng biến mất khỏi sản phẩm (codex #975).

describe('ống kính Tiến độ mở đủ mặt của nó', () => {
  const fn = codeOnly(SRC.slice(SRC.indexOf('function setLens'),
                                SRC.indexOf('function renderDrawer')));

  test('MỘT nơi quyết việc ẩn/hiện khối phụ trợ', () => {
    // Ba lỗi liên tiếp sinh ra vì việc ấy nằm rải rác: `setLens` bật nó,
    // `showPanel` không tắt (khối trôi xuống dưới tab Bài tập), và
    // `renderProgress` lại mở cái bảng đã bị thay ra (codex #976).
    for (const caller of ['function setLens', 'function showPanel',
                          'function renderProgress']) {
      const body = codeOnly(SRC.slice(SRC.indexOf(caller),
                                      SRC.indexOf(caller) + 1800));
      assert.match(body, /syncProgressPanel\(\)/, caller);
    }
    const owner = codeOnly(SRC.slice(SRC.indexOf('function syncProgressPanel'),
                                     SRC.indexOf('function renderDrawer')));
    assert.match(owner, /_lens === 'progress'/);
    assert.match(owner, /panel-roster/, 'rời sổ thì khối phụ trợ phải đi theo');
    assert.match(owner, /progress-table-wrap/);
  });

  test('KHÔNG tự đặt chốt của loadDailyBoard', () => {
    // `loadDailyBoard` có chốt riêng và thoát ngay nếu thấy chốt đã bật — đặt
    // hộ nó là làm nó KHÔNG BAO GIỜ chạy (codex #976).
    assert.match(fn, /loadDailyBoard\(\)/);
    assert.doesNotMatch(fn, /_dailyBoardLoaded = true/);
  });
});

describe('mở ngăn kéo bằng BÀN PHÍM', () => {
  test('tên học viên là một nút thật, không phải hàng bấm được', () => {
    // Một `<tr>` nghe click thì người dùng bàn phím không bao giờ mở được ngăn
    // kéo nào — họ chỉ tab tới được nút "Gỡ khỏi lớp" chẳng liên quan.
    assert.match(SRC, /class="cl-rowbtn"/);
    assert.match(SRC, /data-action="open-student"/);
    assert.match(SRC, /aria-expanded=/);
  });

  test('vẽ lại bảng xong phải trả TIÊU ĐIỂM về đúng nút vừa bấm', () => {
    // Không trả thì mỗi lần mở ngăn kéo là một lần bị ném về đầu trang.
    const fn = codeOnly(SRC.slice(SRC.indexOf("$('roster-tbody').addEventListener"),
                                  SRC.indexOf('const lensBar')));
    assert.match(fn, /\.focus\(\)/);
  });

  test('nút ấy có vòng tiêu điểm nhìn thấy được', () => {
    const css = readFileSync(
      new URL('../public/pages/admin/classes/index.html', import.meta.url), 'utf8');
    assert.match(css, /\.cl-rowbtn:focus-visible[^}]*outline/);
  });
});

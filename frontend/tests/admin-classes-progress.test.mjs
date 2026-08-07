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

// Bỏ CẢ hai kiểu chú thích. Bản cũ chỉ bỏ `//`, nên một chú thích doc `/** */`
// nhắc đúng chuỗi đang ghim sẽ tự làm chốt xanh — bắt được tại trận ở chốt cuộn
// ngăn kéo: đổi mã `'nearest'` → `'start'` mà không chốt nào đỏ.
const codeOnly = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

/**
 * Thân của `<div class="cl-roster-split">`, lấy bằng cách ĐẾM ĐỘ SÂU thẻ.
 *
 * Repo giữ `frontend/tests` không phụ thuộc gì, nên không có jsdom để hỏi cha
 * con. Cách rẻ tiền là cắt "từ thẻ mở tới một mốc phía sau" — nhưng thế thì dời
 * một khối ra NGOÀI cha mà vẫn trước mốc là chốt vẫn xanh trong khi lỗi quay
 * lại. Đếm `<div`/`</div>` cho ra ranh giới THẬT.
 */
function splitBody() {
  const open = PAGE.indexOf('<div class="cl-roster-split">');
  assert.ok(open !== -1, 'thiếu cha lưới .cl-roster-split');
  let i = open, depth = 0;
  // Chú thích HTML có thể chứa chữ "div" — bỏ chúng trước khi đếm.
  const src = PAGE.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
  const tag = /<(\/?)div\b/g;
  tag.lastIndex = open;
  for (let m = tag.exec(src); m; m = tag.exec(src)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) { i = m.index; break; }
  }
  assert.ok(i > open, 'không tìm được thẻ đóng của .cl-roster-split');
  return PAGE.slice(open, i);
}

const inSplit = (needle) => splitBody().includes(needle);

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

  // ── Ngăn kéo phải mở ở chỗ MẮT ĐANG NHÌN ────────────────────────────────
  //
  // Đo trên prod, màn 1920×935: hàng bấm ở y=541, ngăn kéo mở ở y=1571 — thấp
  // hơn 1030px và NGOÀI khung nhìn. Giáo viên bấm một cái tên, màn hình đứng
  // yên, đọc ra là web hỏng. "Mở trong trang" đã đúng; "mở dưới đáy trang" thì
  // không.
  test('bảng và ngăn kéo chung MỘT cha lưới, không phải trên-dưới', () => {
    // Cắt "từ thẻ mở tới một mốc phía sau" là chốt DƯƠNG TÍNH GIẢ: dời ngăn kéo
    // ra NGOÀI cha lưới mà vẫn trước mốc thì chốt vẫn xanh, trong khi lỗi gốc
    // quay lại nguyên vẹn (codex cục bộ 07/08). Repo không có jsdom, nên đếm độ
    // sâu thẻ để lấy đúng phần THÂN của cha lưới.
    assert.equal(inSplit('id="roster-table-wrap"'), true);
    assert.equal(inSplit('id="roster-drawer"'), true,
      'ngăn kéo nằm ngoài cha lưới thì nó lại rơi xuống đáy bảng');
  });

  test('hai cột trên màn rộng, và cột bảng CO được', () => {
    const block = PAGE.match(/@media \(min-width: 1400px\)\s*\{[\s\S]*?\n    \}/);
    // 1400px chứ không 1200px: `main.cl-shell` chốt ở `max-width: 1100px`, nên
    // ở khung nhìn 1200 cột bảng chỉ còn ~524px — một bảng 6 cột trong đó là
    // đổi lỗi này lấy lỗi khác (codex cục bộ 07/08).
    assert.ok(block, 'thiếu điểm ngắt hai cột ở 1400px');
    assert.match(block[0], /\.cl-roster-split\s*\{[^}]*display:\s*grid/);
    // `1fr` trần là `minmax(auto, 1fr)`: bảng không co được sẽ đẩy ngăn kéo ra
    // khỏi khung — đúng lỗi đã vá ở bảng nhận bài (#979).
    assert.match(block[0], /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    // Neo DƯỚI thanh tiêu đề `sticky` cao 56px, không neo ở 0 — neo ở 0 là dính
    // vào đúng chỗ bị nó che.
    assert.match(block[0], /top:\s*calc\(var\(--admin-header-h/);
  });

  test('màn hẹp thì CUỘN ngăn kéo vào tầm nhìn', () => {
    // Dưới 1200px vẫn xếp dọc (một cột 340px trên 990px bề ngang bóp chết cái
    // bảng), nên ở đó phải tự cuộn tới — nếu không thì lỗi gốc còn nguyên trên
    // laptop 13".
    const click = codeOnly(SRC.slice(SRC.indexOf("$('roster-tbody').addEventListener"),
                                     SRC.indexOf('const lensBar')));
    assert.match(click, /revealDrawer\(\)/, 'vẽ xong mà không đưa vào tầm nhìn');
    // Chú thích doc của `revealDrawer` nhắc đúng chuỗi đang ghim dưới đây, nên
    // chốt này chỉ có nghĩa khi `codeOnly` bỏ cả `/* */` — xem ghi chú ở đó.
    const body = codeOnly(SRC.slice(SRC.indexOf('function revealDrawer'),
                                    SRC.indexOf('function renderDrawer')));
    // `'nearest'` chứ không `'start'`: đã thấy đủ thì đứng yên, cuộn một trang
    // đang đọc được là tự tay làm mất chỗ giáo viên đang nhìn.
    assert.match(body, /block:\s*'nearest'/);
    assert.doesNotMatch(body, /block:\s*'(start|center|end)'/);
    assert.match(body, /prefers-reduced-motion/,
      'scrollIntoView không tự tôn trọng nó — phải hỏi rồi mới quyết');
    // Mốc "đã thấy" phải trừ thanh tiêu đề `sticky` và phải đòi thấy ĐỦ. Kiểm
    // giao-nhau (`r.top < innerHeight && r.bottom > 0`) coi cả phần khuất sau
    // tiêu đề là đã thấy, và hở một pixel là thoát sớm không cuộn gì.
    assert.match(body, /--admin-header-h/);
    assert.match(body, /r\.bottom <= window\.innerHeight/);
    // Mốc kiểm đúng vẫn CHƯA đủ: `scrollIntoView` không biết gì về thanh tiêu
    // đề đè lên, nên ở `0 < top < 56` nó tính "đã gần nhất" và không cuộn gì —
    // lệnh cuộn thành lệnh rỗng, khối vẫn khuất một nửa (codex #983).
    // `scroll-margin-top` phải ở quy tắc GỐC: màn hẹp cũng có tiêu đề ấy.
    const base = PAGE.match(/\n    \.cl-drawer \{[^}]*\}/);
    assert.ok(base, 'không thấy quy tắc gốc .cl-drawer');
    assert.match(base[0], /scroll-margin-top:\s*calc\(var\(--admin-header-h/);
    assert.doesNotMatch(body, /r\.bottom > 0/, 'đó là kiểm giao nhau, không phải thấy đủ');
    // Cuộn đi cả nghìn pixel mà để tiêu điểm ở lại là bỏ rơi người dùng bàn phím.
    assert.match(body, /\.focus\(/);
    assert.match(PAGE, /id="roster-drawer"[^>]*tabindex="-1"/,
      'không có tabindex thì `.focus()` là lệnh rỗng');
  });

  // ── Ngăn kéo phải DẪN TỚI BÀI, không chỉ mô tả em ấy ─────────────────────
  //
  // Đo trên prod: bấm vào một cái tên ra ba dòng dữ kiện và ĐÚNG 0 nút. Nhưng
  // việc giáo viên mở màn này để làm là "em ấy đã làm gì, cho tôi xem".
  test('ngăn kéo có danh sách bài, nạp LÚC MỞ chứ không nạp sẵn cả lớp', () => {
    // Khối này do `renderDrawer` sinh ra, không nằm sẵn trong trang — ngăn kéo
    // được vẽ lại mỗi lần đổi em.
    assert.match(SRC, /id="drawer-work"/);
    const click = codeOnly(SRC.slice(SRC.indexOf("$('roster-tbody').addEventListener"),
                                     SRC.indexOf('const lensBar')));
    assert.match(click, /loadStudentWork\(_picked\)/,
      'nạp sẵn cho 14 em là 14 lượt gọi mạng cho ngăn kéo có thể không ai mở');
  });

  test('nó KHÔNG tự vẽ lại bài làm — chỉ dẫn tới chỗ đã có', () => {
    // Mỗi loại bài đã có một mặt đọc chạy được (trang phiên Speaking, tab "Bài
    // từng em", màn bài tự luận). Dựng bản vẽ thứ hai ở đây là dựng chỗ để trôi
    // khỏi bản gốc — đúng họ lỗi cả chương trình này lặp lại.
    const fn = codeOnly(SRC.slice(SRC.indexOf('function workOpen'),
                                  SRC.indexOf('async function loadStudentWork')));
    assert.match(fn, /pages\/admin\/speaking\/sessions\.html\?session=/);
    assert.doesNotMatch(fn, /renderReport|questionCard|<audio/,
      'ngăn kéo tự vẽ bài làm là bản vẽ thứ hai');
  });

  test('chỉ hiện đường mở khi có BÀI THẬT để mở', () => {
    // Luật đã dùng ở bảng tổng kết: một liên kết dẫn tới trang trống tệ hơn
    // không có liên kết. Nên hỏi `artifact_id`/`has_writing`, KHÔNG hỏi "đã nộp
    // chưa" — sổ có thể ghi đã nộp trong khi khoá nối chưa có.
    const fn = codeOnly(SRC.slice(SRC.indexOf('function workOpen'),
                                  SRC.indexOf('async function loadStudentWork')));
    assert.match(fn, /it\.artifact_kind === 'session' && it\.artifact_id/);
    assert.match(fn, /it\.has_writing/);
    assert.match(fn, /it\.bank_id && it\.artifact_id/);
    assert.doesNotMatch(fn, /it\.submitted_at/, 'đã nộp ≠ có bài mở được');
  });

  test('chống đua bằng EM ĐANG CHỌN, không bằng một số lượt toàn cục', () => {
    // Kho lưu theo TỪNG EM nên không có chuyện bài em này ghi đè ngăn kéo em
    // kia — một số lượt toàn cục ở đây vừa thừa vừa GÂY KẸT: An → Bình → An
    // thì lượt của An mang số cũ hơn nên không vẽ được, trong khi chốt
    // `loading` đã chặn lượt thứ hai; ngăn kéo của An mắc "Đang tải…" vĩnh
    // viễn (codex cục bộ 07/08).
    const fn = codeOnly(SRC.slice(SRC.indexOf('async function loadStudentWork'),
                                  SRC.indexOf('async function openWorkItem')));
    assert.match(fn, /_picked === sid/);
    assert.doesNotMatch(fn, /_workSeq/, 'số lượt toàn cục làm kẹt ca An→Bình→An');
    // Và KHÔNG được dùng lại kết quả cũ: bộ nhớ đệm không có tuổi thì nó sai vô
    // thời hạn — em ấy nộp ở tab khác, hạn trôi qua, giáo viên chấm ở trang mở
    // bằng tab mới; không lần nào chạm tới trang này.
    assert.doesNotMatch(fn, /if \(!sid \|\| _work\.by\[sid\]/,
      'dùng lại kho cũ là để nó sai vô thời hạn');
  });

  test('MỘT số thế hệ làm chủ cả gộp-lượt lẫn vô-hiệu-hoá', () => {
    // Ba vòng review liên tiếp bắt cùng một họ lỗi ở `loadStudentWork` — số
    // lượt toàn cục gây kẹt, HTML không vẽ lại, lượt đang bay ghi đè bản
    // trước-khi-đổi. Đó là một lỗi THIẾT KẾ: ba cờ rời không biết gì về nhau,
    // nên mỗi lần vá lại hở một khe mới (codex #989 vòng 2, 3, 4).
    const fn = codeOnly(SRC.slice(SRC.indexOf('async function loadStudentWork'),
                                  SRC.indexOf('function refreshDrawerWork')));
    // Chụp thế hệ lúc bắt đầu…
    assert.match(fn, /const epoch = _work\.epoch/);
    // …gộp trong CÙNG thế hệ, không gộp xuyên thế hệ: một lượt bắt đầu trước
    // khi dữ liệu đổi không được chặn lượt đọc lại sau khi đổi.
    assert.match(fn, /_work\.inflight\[sid\] === epoch\) return/);
    // …và chỉ GHI được nếu thế hệ ấy còn hiện tại. Cả nhánh thành công lẫn
    // nhánh lỗi: một lỗi cũ ghi đè cũng là ghi đè.
    assert.equal((fn.match(/epoch !== _work\.epoch\) return/g) || []).length, 2,
      'phải chặn cả nhánh thành công lẫn nhánh lỗi');

    // Mọi đường làm dữ liệu cũ đi đều phải TĂNG thế hệ, không chỉ xoá kho.
    const inv = codeOnly(SRC.slice(SRC.indexOf('function invalidateProgress'),
                                   SRC.indexOf('async function loadProgress')));
    assert.match(inv, /_work\.epoch \+= 1/);
  });

  test('màn bài tự luận chặn ĐUA ở chính chỗ ghi, không chỉ ở nơi gọi', () => {
    // Mở bài giao A (mạng chậm) rồi mở B: bài của A về sau và ghi đè
    // `#tally-body` của B. Bẫy này có SẴN ở đường cũ từ bảng tổng kết, nên chốt
    // phải nằm trong `openStudentWriting` — vá ở nơi gọi chỉ che đường mới.
    const fn = codeOnly(SRC.slice(SRC.indexOf('async function openStudentWriting'),
                                  SRC.indexOf('let _tallyAsg')));
    assert.match(fn, /const gen = _mkGen/);
    assert.equal((fn.match(/gen !== _mkGen/g) || []).length, 2,
      'phải chặn CẢ nhánh thành công lẫn nhánh lỗi — nhánh lỗi ghi đè cũng hỏng');
    // Nơi gọi vẫn phải kiểm RIÊNG: `openStudentWriting` chụp thế hệ ở ĐẦU nó,
    // tức là sau khi `openWorkItem` đã chờ xong — nó sẽ chụp thế hệ MỚI và ghi
    // bài của bài giao cũ vào khung của bài giao mới.
    const caller = codeOnly(SRC.slice(SRC.indexOf('async function openWorkItem'),
                                      SRC.indexOf('async function populateStudentPicker')));
    assert.match(caller, /const gen = _mkGen[\s\S]*await done[\s\S]*gen !== _mkGen/);
  });

  test('đọc hỏng thì NÓI RA và mời thử lại, không hiện danh sách rỗng', () => {
    // Rỗng đọc ra "em ấy chưa được giao bài nào" — một khẳng định mà truy vấn
    // hỏng không chứng minh được.
    const fn = codeOnly(SRC.slice(SRC.indexOf('function renderWork'),
                                  SRC.indexOf('function workOpen')));
    assert.match(fn, /_work\.error\[sid\]/);
    assert.match(fn, /data-work-retry/);
    assert.match(fn, /homework_stale/, 'cờ chưa-đối-chiếu-được phải hiện ra');
  });

  test('mở bài tự luận phải ĐỢI bảng tổng kết vẽ xong', () => {
    // Cả hai ghi vào `#tally-body`, và màn tự luận chụp lại nội dung đang có để
    // làm đường "quay lại" — không đợi thì nó chụp nhầm dòng "Đang tải…".
    const fn = codeOnly(SRC.slice(SRC.indexOf('async function openWorkItem'),
                                  SRC.indexOf('async function populateStudentPicker')));
    assert.match(fn, /await done/);
    assert.match(fn, /const done = openMarking\(/);
    // Và `openMarking` phải THẬT SỰ trả promise ra, nếu không `await` là vô ích.
    const om = codeOnly(SRC.slice(SRC.indexOf('function openMarking'),
                                  SRC.indexOf('async function renderOneList')));
    assert.match(om, /return openTally\(/);
  });

  test('MỖI nút mang theo tên bài và kho câu hỏi, không tra ngược từ _homework', () => {
    // `_homework` chỉ nạp khi mở tab Bài tập; ngăn kéo mở được từ Sổ điểm danh,
    // tức đường CHÍNH là đường `_homework` còn rỗng. Thiếu hai thứ này thì khu
    // Nhận bài mở ra không tiêu đề và `openMarking` ẩn luôn hai tab
    // chỉ-bài-theo-buổi vì tưởng đây không phải bài theo buổi.
    //
    // Soi TỪNG NÚT, không soi cả khối: bản trước chỉ hỏi "có `data-title=` ở
    // đâu đó không" và nút "Xem tự luận" thiếu cả hai vẫn xanh (codex #989).
    const start = SRC.indexOf('const WORK_STATUS = {');
    const end = SRC.indexOf('async function loadStudentWork');
    const esc = (s) => String(s == null ? '' : s);
    const { workOpen, renderWork } = new Function('esc', 'SKILL_LABEL', '_work', '$',
      `${SRC.slice(start, end)} return { workOpen, renderWork };`)(
      esc, { course: 'bài tập theo buổi' },
      { by: { x: { items: [{ assignment_id: 'a1', title: 'Buổi 3', skill: 'course',
                             status: 'submitted', score: null, bank_id: 'b1' }] } },
        loading: {}, error: {} }, () => null);

    const item = { assignment_id: 'a1', title: 'Buổi 3', bank_id: 'b1', artifact_id: 'q1' };
    // MỌI nút, kể cả chính dòng: hai vòng review liên tiếp bắt đúng lỗi này ở
    // hai nút KHÁC nhau, nên chốt phải quét cả bộ chứ không đi từng cái.
    for (const [what, html] of [
      ['Xem tự luận', workOpen({ ...item, has_writing: true })],
      ['Xem từng câu', workOpen(item)],
      ['dòng', renderWork({ student_id: 'x' })],
    ]) {
      assert.match(html, /data-title="Buổi 3"/, `${what}: thiếu tên bài`);
      assert.match(html, /data-bank="b1"/, `${what}: thiếu kho câu hỏi`);
    }
    // Và chúng phải sinh ở MỘT chỗ, không chép vào từng nút — vá từng cái là
    // hẹn gặp lại ở nút thứ tư (codex #989 vòng 1 và vòng 2, cùng một lỗi).
    const src = codeOnly(SRC.slice(SRC.indexOf('function workCtx'),
                                   SRC.indexOf('async function loadStudentWork')));
    assert.equal((src.match(/data-title="/g) || []).length, 1,
      'tên bài viết ở nhiều chỗ là nhiều chỗ để quên');

    // VÀ chỗ nghe phải CHUYỂN TIẾP chúng. Ghim cái nút mà quên chỗ gọi là để
    // lọt đúng một nửa lỗi: thuộc tính có mặt, không ai đọc — bẫy "test đường,
    // đừng test hàm" đã lặp trong dự án này.
    // Chỗ nghe nằm ở khu nối sự kiện, SAU `openWorkItem` trong tệp — cắt theo
    // chiều ngược lại thì lát rỗng và mọi khẳng định bên dưới thành vô nghĩa.
    const hStart = SRC.indexOf("const drawer = $('roster-drawer')");
    assert.ok(hStart !== -1, 'không thấy chỗ nối sự kiện của ngăn kéo');
    const handler = codeOnly(SRC.slice(hStart, hStart + 1600));
    assert.match(handler, /data-open-writing/, 'lát cắt không chứa chỗ nghe');
    for (const [key, re] of [
      ['data-open-writing', /writing: true,[^}]*bank: w\.dataset\.bank[^}]*title: w\.dataset\.title/],
      ['data-open-one', /one: true,[^}]*bank: one\.dataset\.bank[^}]*title: one\.dataset\.title/],
    ]) {
      assert.match(handler, re, `${key}: nút mang dữ liệu mà chỗ nghe không đọc`);
    }
  });

  // CHẠY bộ vẽ, không soi chữ nó. Cái sai ở đây là một Ô ĐỌC RA GÌ: một dòng
  // không có đường mở và một dòng lẽ ra phải có mà mất, trông giống hệt nhau
  // trong mã nguồn.
  test('mỗi loại bài ra ĐÚNG một đường mở, và bài chưa có gì thì không có nút', () => {
    const start = SRC.indexOf('const WORK_STATUS = {');
    const end = SRC.indexOf('async function loadStudentWork');
    assert.ok(start !== -1 && end > start, 'không cắt được bộ vẽ');
    const esc = (s) => String(s == null ? '' : s).replace(/</g, '&lt;');
    const SKILL_LABEL = { speaking: 'Speaking', course: 'bài tập theo buổi',
                          reading: 'Reading', listening: 'Listening' };
    const { renderWork, workOpen } = new Function('esc', 'SKILL_LABEL', '_work', '$',
      `${SRC.slice(start, end)} return { renderWork, workOpen };`)(
      esc, SKILL_LABEL, { by: {}, loading: {}, error: {} }, () => null);

    // Speaking đã nộp → nghe thẳng ở trang phiên.
    const speak = workOpen({ artifact_kind: 'session', artifact_id: 's-1' });
    assert.match(speak, /sessions\.html\?session=s-1/);
    assert.match(speak, /Nghe bài/);

    // Bài theo buổi có tự luận → đọc bài viết. Ưu tiên hơn "xem từng câu" vì đó
    // là thứ giáo viên phải CHẤM, còn phần trắc nghiệm máy đã chấm rồi.
    assert.match(workOpen({ has_writing: true, assignment_id: 'a1',
                            bank_id: 'b1', artifact_id: 'q1' }), /data-open-writing="a1"/);

    // Bài theo buổi chưa có tự luận nhưng đã làm → xem từng câu.
    const one = workOpen({ bank_id: 'b1', artifact_id: 'q1', assignment_id: 'a1' });
    assert.match(one, /data-open-one="a1"/);
    assert.match(one, /data-bank="b1"/);

    // ĐÃ NỘP theo sổ nhưng CHƯA có khoá nối → không nút. Một liên kết dẫn tới
    // trang trống tệ hơn không có liên kết.
    assert.equal(workOpen({ bank_id: 'b1', artifact_id: null,
                            submitted_at: '2026-08-01T00:00:00Z' }), '');
    // Chưa làm gì → không nút.
    assert.equal(workOpen({ skill: 'reading' }), '');
  });

  test('danh sách rỗng KHÁC danh sách chưa đọc được', () => {
    const start = SRC.indexOf('const WORK_STATUS = {');
    const end = SRC.indexOf('async function loadStudentWork');
    const esc = (s) => String(s == null ? '' : s);
    const store = { by: {}, loading: {}, error: {} };
    const mk = () => new Function('esc', 'SKILL_LABEL', '_work', '$',
      `${SRC.slice(start, end)} return { renderWork };`)(
      esc, { course: 'bài tập theo buổi' }, store, () => null);

    // Chưa nạp xong: KHÔNG được nói "chưa được giao bài nào".
    assert.match(mk().renderWork({ student_id: 'x' }), /Đang tải/);

    store.by.x = { items: [], homework_stale: false };
    assert.match(mk().renderWork({ student_id: 'x' }), /chưa được giao bài nào/);

    delete store.by.x;
    store.error.x = 'mạng hỏng';
    const bad = mk().renderWork({ student_id: 'x' });
    assert.match(bad, /Không đọc được/);
    assert.doesNotMatch(bad, /chưa được giao bài nào/,
      'đọc hỏng mà nói "chưa được giao" là một khẳng định không có bằng chứng');
  });

  test('bài ĐÃ ĐÓNG nói ra là đã đóng, không đọc thành em ấy bỏ bài', () => {
    // Máy chủ trả `archived` mà trang bỏ qua thì một bài giáo viên tự tay đóng
    // hiện ra "chưa nộp" — đọc như lỗi của học viên (codex #989 vòng 2).
    const start = SRC.indexOf('const WORK_STATUS = {');
    const end = SRC.indexOf('async function loadStudentWork');
    const esc = (x) => String(x == null ? '' : x);
    const mk = (items) => new Function('esc', 'SKILL_LABEL', '_work', '$',
      `${SRC.slice(start, end)} return { renderWork };`)(
      esc, { course: 'bài tập theo buổi' },
      { by: { x: { items } }, loading: {}, error: {} }, () => null)
      .renderWork({ student_id: 'x' });

    const base = { assignment_id: 'a1', title: 'B', skill: 'course', status: 'pending' };
    assert.match(mk([{ ...base, archived: true }]), /đã đóng/);
    assert.doesNotMatch(mk([{ ...base, archived: false }]), /đã đóng/);
  });

  test('đổi dữ liệu hay quay về sổ thì ngăn kéo VẼ LẠI, không chỉ xoá kho', () => {
    // Xoá bộ nhớ đệm là chưa đủ: phần HTML đã vẽ đứng nguyên trên màn hình.
    // Giao thêm một bài, đóng một bài, hay chấm xong rồi quay lại — ngăn kéo
    // vẫn hiện danh sách của trước đó, và chỉ đúng lại sau khi giáo viên đóng
    // em ấy ra mở lại; tức màn hình mâu thuẫn với chính nó sau một lần tải lại
    // trang (codex #989 vòng 3).
    const fn = codeOnly(SRC.slice(SRC.indexOf('function refreshDrawerWork'),
                                  SRC.indexOf('async function openWorkItem')));
    assert.match(fn, /renderDrawer\(\)/, 'xoá kho mà không vẽ lại là không đổi gì');
    assert.match(fn, /loadStudentWork\(_picked\)/);

    // HAI đường tới, cùng một hàm — để chúng không trôi khỏi nhau.
    const inv = codeOnly(SRC.slice(SRC.indexOf('function invalidateProgress'),
                                   SRC.indexOf('async function loadProgress')));
    assert.match(inv, /refreshDrawerWork\(\)/);
    const sp = codeOnly(SRC.slice(SRC.indexOf('function showPanel'),
                                  SRC.indexOf('function showPanel') + 1400));
    assert.match(sp, /name === 'roster'[\s\S]{0,60}refreshDrawerWork\(\)/);
  });

  // CHẠY cuộc đua thật, không soi chữ nó. Chốt soi chữ chứng minh hình dạng của
  // mã; cái sai ở đây là THỨ TỰ THỜI GIAN, mà thứ tự thời gian không nhìn thấy
  // được trong một tệp nguồn.
  function workHarness(fetchImpl) {
    const start = SRC.indexOf('const _work = {');
    const end = SRC.indexOf('function refreshDrawerWork');
    assert.ok(start !== -1 && end > start, 'không cắt được khối bài-của-một-em');
    const box = { innerHTML: '' };
    const esc = (s) => String(s == null ? '' : s);
    const h = new Function('esc', 'SKILL_LABEL', 'api', '$', '_cohortId', '_who', `
      let _picked = null;
      ${SRC.slice(start, end)}
      return { loadStudentWork, _work, renderWork,
               pick: (v) => { _picked = v; } };
    `)(esc, { course: 'bài' }, { get: fetchImpl }, () => box, 'co-1',
       { members: [{ student_id: 'st-1', name: 'An' }] });
    h.box = box;
    return h;
  }

  test('lượt đọc bắt đầu TRƯỚC khi dữ liệu đổi không ghi đè được', async () => {
    // Ca của codex #989 vòng 4: giữ lượt đọc đầu, đổi dữ liệu (giao/đóng một
    // bài), rồi thả lượt cũ ra. Nếu nó ghi được thì ngăn kéo hiện ảnh chụp
    // TRƯỚC khi đổi, mâu thuẫn với chính nó sau một lần tải lại trang.
    let release;
    const held = new Promise((r) => { release = r; });
    let call = 0;
    const h = workHarness(async () => {
      call += 1;
      if (call === 1) { await held; return { items: [{ assignment_id: 'CŨ', title: 'CŨ' }] }; }
      return { items: [{ assignment_id: 'MỚI', title: 'MỚI' }] };
    });
    h.pick('st-1');

    const first = h.loadStudentWork('st-1');   // lượt 1, đang bị giữ
    h._work.epoch += 1;                        // dữ liệu đổi giữa chừng
    await h.loadStudentWork('st-1');           // lượt 2, về ngay
    assert.equal(h._work.by['st-1'].items[0].assignment_id, 'MỚI');

    release();
    await first;
    assert.equal(h._work.by['st-1'].items[0].assignment_id, 'MỚI',
      'lượt cũ đã ghi đè bản sau-khi-đổi');
    assert.equal(call, 2, 'lượt đang bay của thế hệ cũ đã CHẶN lượt đọc lại');
  });

  test('An → Bình → An không để An mắc "Đang tải…" vĩnh viễn', async () => {
    // Ca của vòng 2, nay chạy thật chứ không chỉ ghim tên biến.
    let release;
    const held = new Promise((r) => { release = r; });
    let calls = 0;
    const h = workHarness(async () => {
      calls += 1;
      if (calls === 1) await held;
      return { items: [{ assignment_id: 'a1', title: 'B' }] };
    });
    h.pick('st-1');
    const first = h.loadStudentWork('st-1');
    h.pick('st-2');                            // sang Bình
    h.pick('st-1');                            // rồi về An
    release();
    await first;
    assert.ok(h._work.by['st-1'], 'An không bao giờ nhận được dữ liệu');
  });

  // ── Ba tầng điều hướng phải TRÔNG khác nhau ──────────────────────────────
  //
  // Đo được trên trang: CHÍN phần tử cùng mang `.adm-subtab`, ở ba tầng lồng
  // nhau — `Lớp/Học viên`, `Sổ điểm danh/…`, `Ai nộp/…`. Trông giống hệt nhau
  // nên không đọc được mình đang đứng ở tầng nào, và bấm nhầm tầng là mất chỗ
  // đang xem.
  test('mỗi tầng một hình dạng, và hình dạng theo NGHĨA chứ không theo độ sâu', () => {
    // Tầng 1 giữ nguyên viên-có-viền (mặc định dùng chung); hai tầng trong
    // được đánh dấu để nhận luật riêng.
    assert.match(PAGE, /<nav class="adm-subtabs" data-level="section"/);
    assert.match(PAGE, /<nav class="adm-subtabs" data-level="view"/);

    // Tầng 2 — gạch chân, KHÔNG viền hộp.
    const sec = PAGE.match(
      /\.adm-subtabs\[data-level="section"\] \.adm-subtab \{[^}]*\}/);
    assert.ok(sec, 'tầng 2 chưa có hình dạng riêng');
    assert.match(sec[0], /border-bottom:\s*2px/);
    assert.match(sec[0], /border:\s*0/);

    // BỘ CHỌN PHẢI VỚI TỚI ĐƯỢC KHỐI NÓ NHẮM.
    //
    // Bản trước bó mọi luật bằng `.cl-shell` — nghe hợp lý, nhưng
    // `#panel-marking` (nơi chứa tầng 3) nằm NGOÀI shell: shell đóng ở giữa
    // tài liệu. Bộ chọn không bao giờ khớp, và tầng 3 giữ nguyên hình
    // viên-có-viền của tầng 1, tức lỗi cần chữa vẫn còn nguyên trong khi mọi
    // chốt hình-dạng đều xanh (codex #986).
    //
    // Nên kiểm ĐIỀU KIỆN THẬT: mỗi khối mang `data-level` phải nằm dưới một tổ
    // tiên mà bộ chọn của nó đi qua được. Repo không có jsdom, nên chứng minh
    // bằng cách rẻ nhất và chắc nhất: KHÔNG luật nào của `[data-level]` được
    // mang tiền tố tổ tiên nào cả.
    for (const m of PAGE.matchAll(/^\s*([^\n{]*\[data-level="(section|view)"\][^\n{]*)\{/gm)) {
      assert.doesNotMatch(m[1], /\.cl-shell|#view-detail|\.cl-marking/,
        `luật bó vào một tổ tiên: "${m[1].trim()}" — kiểm nó có với tới cả hai `
        + 'khối không, #panel-marking nằm NGOÀI .cl-shell');
    }
    // Và tầng 3 phải THẬT SỰ ở ngoài shell — nếu ai đó dời nó vào trong thì
    // lời giải thích trên hết đúng và chốt này phải được viết lại.
    // Tìm THẺ NAV, không tìm chuỗi `data-level="view"` trần: chuỗi ấy xuất hiện
    // trong khối CSS ở đầu tài liệu, tức trước shell, nên `indexOf` bắt nhầm
    // và chốt báo ngược.
    const shellEnd = PAGE.indexOf('</main>', PAGE.indexOf('id="view-detail"'));
    const navL3 = PAGE.indexOf('<nav class="adm-subtabs" data-level="view"');
    assert.ok(navL3 !== -1, 'không thấy thẻ nav tầng 3');
    assert.ok(navL3 > shellEnd,
      'tầng 3 nay nằm trong .cl-shell — xem lại lý do bó bằng thuộc tính');

    // Tầng 3 và ỐNG KÍNH cùng trả lời "đổi cách nhìn, không đổi chỗ đứng", nên
    // dùng CHUNG một hình dạng. Chia theo độ sâu thì hai thứ cùng nghĩa lại
    // trông khác nhau — ghim chúng ở CÙNG một quy tắc để không trôi khỏi nhau.
    const view = PAGE.match(
      /\.adm-subtabs\[data-level="view"\], \.cl-lens \{[^}]*\}/);
    assert.ok(view, 'tầng 3 và ống kính phải dùng chung một quy tắc');
    assert.match(view[0], /background:\s*var\(--av-surface-sunken\)/);

    // Hai bộ đánh dấu "đang mở" bằng hai cách khác nhau. Chỉ bắt một là một
    // trong hai bộ mất hẳn dấu ấy.
    const on = PAGE.match(
      /\.adm-subtabs\[data-level="view"\] \.adm-subtab\.is-active,\s*\n\s*\.cl-lens button\[aria-current="true"\] \{[^}]*\}/);
    assert.ok(on, 'thiếu một trong hai cách đánh dấu đang-mở');

    // Và ô ĐANG MỞ vẫn phải thấy được vầng tiêu điểm. Vầng sáng chung là
    // `body.av-page :focus-visible` — độ đặc hiệu (0,2,1) — còn luật "đang mở"
    // là (0,4,0), nên nó thắng ở `box-shadow` trong khi `outline: none` của
    // luật kia vẫn áp: ô đang mở khi lấy tiêu điểm bằng bàn phím thành VÔ HÌNH
    // hoàn toàn (codex #986). Phải giành lại bằng chính hai bộ chọn ấy.
    const halo = PAGE.match(
      /\.adm-subtabs\[data-level="view"\] \.adm-subtab\.is-active:focus-visible,\s*\n\s*\.cl-lens button\[aria-current="true"\]:focus-visible \{[^}]*\}/);
    assert.ok(halo, 'ô đang mở mất vầng tiêu điểm');
    assert.match(halo[0], /box-shadow:\s*var\(--av-shadow-focus\)/);
    // Và nó phải đứng SAU luật "đang mở" — cùng độ đặc hiệu thì thứ tự quyết.
    assert.ok(PAGE.indexOf(halo[0]) > PAGE.indexOf(on[0]),
      'đặt trước thì luật đang-mở ghi đè lại và vầng lại mất');

    // Luật gốc `.adm-subtabs` dùng chung với queue.html và users/index.html, nên
    // luật mới vẫn phải bó — chỉ là bó bằng `[data-level]` (thuộc tính chỉ
    // trang này đặt) chứ không bằng một tổ tiên.
    for (const m of PAGE.matchAll(/^\s*(\.adm-subtabs?[^\n{]*)\{/gm)) {
      assert.ok(/\[data-level=/.test(m[1]) || /\.cl-shell/.test(m[1])
                || /button\.adm-subtab/.test(m[1]),
        `luật không bó, sẽ đổi cả queue.html và users/index.html: ${m[1].trim()}`);
    }
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

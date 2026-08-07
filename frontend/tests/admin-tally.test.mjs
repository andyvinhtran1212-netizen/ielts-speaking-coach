/**
 * Bảng tổng kết nộp bài — đọc ra SỰ VẮNG MẶT.
 *
 * Việc của bảng này không phải liệt kê ai đã nộp; giữa lớp 30 em, 26 dấu tick
 * là nhiễu che mất 4 chỗ trống. Nó phải trả lời "ai chưa nộp" trong một cái
 * liếc, và phải phân biệt được TRƯỚC hạn (số còn đổi) với SAU hạn (đã chốt).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');
const CSS = readFileSync(join(HERE, '..', 'public', 'css', 'speaking-assignment.css'), 'utf8');
const HTML = readFileSync(join(HERE, '..', 'public', 'pages', 'admin', 'classes', 'index.html'), 'utf8');

function load() {
  const start = SRC.indexOf('const TALLY_WHEN = {');
  const end = SRC.indexOf('async function openTally(');
  assert.ok(start !== -1 && end > start, 'tally block not found');
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Bản CHỮ THUẦN — đúng thứ renderTally dùng. Cấp `dueLabel` (bản HTML) ở đây
  // sẽ che mất chính lỗi mà bộ test này tồn tại để bắt.
  const dueText = (iso) => (iso ? '19:00 · 03/08' : 'không hạn');
  return new Function('esc', 'dueText', `${SRC.slice(start, end)}
    return { renderTally, tallyRow, hhmm };`)(esc, dueText);
}

const { renderTally, tallyRow, hhmm } = load();

const DUE = '2026-08-03T19:00:00+07:00';

function tally(over = {}) {
  return {
    assignment: { id: 'a1', title: 'Bài hôm nay', skill: 'speaking', due_at: DUE },
    sealed: false,
    students: [],
    counts: { total: 0, submitted: 0, late: 0, missing: 0, no_account: 0 },
    ...over,
  };
}

describe('trạng thái từng dòng', () => {
  test('đã nộp đúng hạn hiện giờ nộp', () => {
    const html = tallyRow({ name: 'An', status: 'submitted',
      submitted_at: '2026-08-03T11:00:00+00:00', score: 6.5 });
    assert.match(html, /data-status="submitted"/);
    assert.match(html, /18:00/);           // 11:00Z = 18:00 giờ VN
    assert.match(html, />6\.5</);
  });

  test('nộp trễ được nói rõ là trễ, không chỉ đổi màu', () => {
    const html = tallyRow({ name: 'Bình', status: 'late',
      submitted_at: '2026-08-03T13:00:00+00:00', score: null });
    assert.match(html, /trễ/);
  });

  test('chưa chấm hiện dấu gạch, KHÔNG hiện 0.0', () => {
    // 0.0 là một ĐIỂM SỐ. Hiện nó nghĩa là nói học viên bị 0 điểm.
    const html = tallyRow({ name: 'Cường', status: 'submitted',
      submitted_at: '2026-08-03T11:00:00+00:00', score: null });
    assert.match(html, /data-empty="true"/);
    assert.match(html, />—</);
    assert.doesNotMatch(html, /0\.0/);
  });

  test('điểm 0 THẬT vẫn hiện là 0.0', () => {
    const html = tallyRow({ name: 'D', status: 'submitted',
      submitted_at: '2026-08-03T11:00:00+00:00', score: 0 });
    assert.match(html, />0\.0</);
    assert.match(html, /data-empty="false"/);
  });

  test('chưa kích hoạt tài khoản KHÁC chưa nộp', () => {
    // Em ấy chưa từng thấy bài — nhắc nộp là nhắc nhầm người.
    const html = tallyRow({ name: 'E', status: 'no-account', submitted_at: null, score: null });
    assert.match(html, /data-status="no-account"/);
    assert.match(html, /chưa kích hoạt/);
  });

  test('trước hạn là "chưa nộp", sau hạn là "không nộp"', () => {
    assert.match(tallyRow({ name: 'F', status: 'pending' }), /chưa nộp/);
    assert.match(tallyRow({ name: 'G', status: 'missing' }), /không nộp/);
  });
});

describe('giờ đọc theo giờ Việt Nam', () => {
  test('không đọc theo múi giờ máy admin', () => {
    // Hạn là 19:00 giờ VN; một giờ nộp đọc theo múi khác sẽ mâu thuẫn với chính
    // cột "trễ" ngay bên cạnh.
    assert.equal(hhmm('2026-08-03T11:00:00+00:00'), '18:00');
    assert.match(SRC, /timeZone:\s*'Asia\/Ho_Chi_Minh'/);
  });

  test('giờ hỏng không làm vỡ cả bảng', () => {
    assert.equal(hhmm('hôm nào đó'), '');
  });
});

describe('trước hạn và sau hạn phải phân biệt được', () => {
  test('trước hạn: đang nhận bài, danh sách còn đổi', () => {
    const html = renderTally(tally({ counts: { total: 30, submitted: 24, missing: 0 } }));
    assert.match(html, /data-state="live"/);
    assert.match(html, /Đang nhận bài/);
    assert.match(html, /còn đổi/);
  });

  test('sau hạn: đã chốt, và nói rõ không nhận bài nữa', () => {
    const html = renderTally(tally({
      sealed: true, counts: { total: 30, submitted: 24, missing: 6 } }));
    assert.match(html, /data-state="sealed"/);
    assert.match(html, /Đã chốt/);
    assert.match(html, /6 em không nộp/);
    assert.match(html, /không nhận bài nữa/);
  });

  test('trạng thái là một CHỮ, không chỉ một màu', () => {
    // Người mù màu vẫn phải đọc được khác biệt quan trọng nhất trên màn hình.
    const live = renderTally(tally());
    const sealed = renderTally(tally({ sealed: true }));
    assert.notEqual(
      live.match(/av-tally__state">([^<]+)</)[1],
      sealed.match(/av-tally__state">([^<]+)</)[1],
    );
  });

  test('số chưa kích hoạt được nói riêng', () => {
    const html = renderTally(tally({ counts: { total: 30, submitted: 24, no_account: 3 } }));
    assert.match(html, /3 em chưa kích hoạt/);
  });

  test('sổ chưa đối chiếu được thì nói ra', () => {
    const html = renderTally(tally({ homework_stale: true }));
    assert.match(html, /chưa đối chiếu được/i);
  });
});

describe('style và markup', () => {
  test('cột mép trái đọc dọc: chưa nộp mang mực, đã nộp im lặng', () => {
    assert.match(CSS, /\.av-tally__row\[data-status='missing'\] \.av-tally__mark\s*\{[^}]*background:\s*var\(--av-accent\)/);
    assert.match(CSS, /\.av-tally__mark\s*\{[^}]*transform:\s*scaleY\(0\.35\)/);
  });

  test('trước hạn nét đứt, sau hạn nét liền', () => {
    assert.match(CSS, /\.av-tally\[data-state='live'\] \.av-tally__rows\s*\{[^}]*dashed/);
  });

  test('bảng nộp bài nằm trong KHU NHẬN BÀI, và CSS nạp đúng một lần', () => {
    // Trước đây là một popup. Bảng 14 học viên × 7 cột không sống nổi trong một
    // hộp thoại, và giáo viên phải đóng cái này mới mở được cái kia.
    assert.match(HTML, /id="panel-marking"/);
    assert.match(HTML, /id="tally-body"/);
    assert.ok(!/id="tally-modal"/.test(HTML), 'popup cũ phải được gỡ, không để hai đường');
    assert.equal((HTML.match(/speaking-assignment\.css/g) || []).length, 1);
  });
});


// ── khu NHẬN BÀI: ba tab, chiếm trọn trang ──────────────────────────────

describe('nhận bài là một KHU, không phải popup', () => {
  test('ba tab, mỗi tab một khung', () => {
    for (const id of ['mtab-tally', 'mtab-effort', 'mtab-one',
                      'mpanel-tally', 'mpanel-effort', 'mpanel-one']) {
      assert.ok(HTML.includes(`id="${id}"`), `trang thiếu #${id}`);
    }
    assert.match(SRC, /function showMarkTab\(name\)/);
  });

  test('mỗi tab nạp ở lần mở ĐẦU TIÊN, không nạp cả ba lúc vào', () => {
    // Nạp cả ba là ba lượt gọi mạng cho hai tab giáo viên có thể không nhìn.
    const i = SRC.indexOf('function showMarkTab');
    const body = SRC.slice(i, i + 900);
    assert.match(body, /dataset\.loaded/);
  });

  test('tab "Nhận bài" chỉ hiện khi đang mở một bài giao', () => {
    // Nó là chỗ đứng tạm của một bài giao, không phải một mục thường trực của
    // lớp — một tab trống thì mời bấm vào chỗ không có gì.
    assert.match(HTML, /id="tab-marking"[^>]*hidden/);
    assert.match(SRC, /\$\('tab-marking'\)\.hidden = false/);
    assert.match(SRC, /\$\('tab-marking'\)\.hidden = true/);
  });

  test('bài KHÔNG phải theo buổi thì giấu hai tab không có nội dung', () => {
    const i = SRC.indexOf('function openMarking');
    const body = SRC.slice(i, i + 900);
    assert.match(body, /\$\('mtab-one'\)\.hidden = !bankId/);
    assert.match(body, /\$\('mtab-effort'\)\.hidden = !bankId/);
  });

  test('"Bài từng em" dùng LẠI bộ vẽ báo cáo của học viên', () => {
    // Hai bộ vẽ cho cùng một nội dung là hai chỗ để trôi khỏi nhau.
    assert.match(SRC, /import\('\/js\/course-report\.js'\)/);
    assert.match(SRC, /_CR\.renderReport\(d\)/);
    assert.match(SRC, /_CR\.bindReport\(box\)/);
  });

  test('trang admin NẠP tệp kiểu của bộ vẽ ấy', () => {
    // Vẽ lớp `.cr-*` mà không nạp tệp định nghĩa chúng thì ra màn hình trần
    // trụi và không có gì đỏ để báo — bài học PR #925.
    assert.match(HTML, /course-report\.css/);
  });
});

// ── hạn nộp trong ghi chú phải là CHỮ, không phải thẻ HTML ───────────────

describe('ghi chú hạn nộp không lộ thẻ', () => {
  test('không escape đầu ra HTML của dueLabel lần thứ hai', () => {
    // dueLabel tô mờ hạn ĐÃ QUA bằng <span>. Bọc nó trong esc() thì người dùng
    // đọc được nguyên thẻ — và chỗ dính lỗi là trạng thái CHÍNH của bảng.
    assert.doesNotMatch(SRC, /esc\(dueLabel\(/,
      'dueLabel trả HTML — chỗ tự escape phải dùng dueText');
  });

  test('dueText trả chữ thuần cho cả ba trường hợp', () => {
    const start = SRC.indexOf('function dueText(');
    const end = SRC.indexOf('function dueLabel(');
    const dueText = new Function(`${SRC.slice(start, end)} return dueText;`)();
    for (const v of [null, 'không-phải-ngày', '2026-08-03T19:00:00+07:00']) {
      const out = dueText(v);
      assert.doesNotMatch(out, /[<>]/, `"${out}" còn thẻ`);
    }
  });

  test('ghi chú sau hạn hiện giờ chốt, không hiện tag', () => {
    const html = renderTally(tally({ sealed: true,
      counts: { total: 10, submitted: 7, missing: 3 } }));
    const note = html.match(/<p class="av-tally__foot">([\s\S]*?)<\/p>/)[1];
    assert.doesNotMatch(note, /&lt;span/, 'thẻ bị escape thành chữ');
  });
});

describe('bài course: đạt/chưa đạt/đang làm (cổng thuộc bài)', () => {
  const row = (over) => tallyRow({
    name: 'An', status: 'submitted', submitted_at: '2026-08-03T11:00:00+00:00',
    score: 72, passed_at: null, retakes: 0, verdicts: 0, ...over,
  }, 'course');

  test('điểm là PHẦN TRĂM, không phải band', () => {
    assert.match(row({}), />72%/);
    assert.doesNotMatch(row({}), />72\.0</);
  });

  test('mới xong chặng đầu (chưa lượt xét nào) là ĐANG LÀM — không phải chưa đạt', () => {
    // mark_item_submitted đóng dấu ngay chặng 1; kết tội "chưa đạt" lúc ấy là
    // kết tội một bài đang làm dở (codex #928 R6).
    assert.match(row({ verdicts: 0 }), /đang làm/);
    assert.doesNotMatch(row({ verdicts: 0 }), /chưa đạt/);
  });

  test('đã có lượt xét trượt thì mới nói chưa đạt', () => {
    assert.match(row({ verdicts: 1 }), /chưa đạt/);
  });

  test('đạt hiện ✓, kèm số lần kiểm tra lại khi có', () => {
    // Ghim NỘI DUNG, không ghim cách xếp: ô điểm nay tách con số ra khỏi phần
    // phụ (`<small>`) để cột không phình theo chuỗi dài nhất và đẩy cả hàng
    // tràn khỏi khung. Ba mẩu tin vẫn còn đủ.
    const html = row({ passed_at: '2026-08-04T00:00:00Z', verdicts: 3, retakes: 2, score: 85 });
    assert.match(html, /85%/);
    assert.match(html, /✓/);
    assert.match(html, /KTL×2/);
    assert.doesNotMatch(html, /chưa đạt/);
  });

  test('bài KHÔNG phải course vẫn hiện band như cũ', () => {
    const html = tallyRow({ name: 'An', status: 'submitted',
      submitted_at: '2026-08-03T11:00:00+00:00', score: 6.5 }, 'speaking');
    assert.match(html, />6\.5</);
  });
});

describe('hai lỗi lặng của khu nhận bài (codex cục bộ 06/08)', () => {
  test('tab "Nhận bài" BẤM ĐƯỢC', () => {
    // Thiếu dây thì tab hiện ra nhưng bấm không có gì xảy ra: giáo viên rời
    // sang Bài tập rồi muốn quay lại khu đang mở là kẹt.
    assert.match(SRC, /\$\('tab-marking'\)\.addEventListener\('click', \(\) => showPanel\('marking'\)\)/);
  });

  test('mạng chậm không làm giáo viên đọc bài của SAI em', () => {
    // Bấm An rồi Bình: request của An về sau và ghi đè bài của Bình, trong khi
    // tên Bình vẫn sáng.
    //
    // Chắn phải đếm SỐ LƯỢT, không nhớ `userId`: mở bài giao A, sang bài giao B
    // rồi chọn ĐÚNG em ấy thì hai lượt mang cùng một userId và lượt của A vẫn
    // ghi đè được lên bảng của B (codex PR 952).
    const i = SRC.indexOf('async function openOneReport');
    const body = SRC.slice(i, i + 1600);
    assert.match(body, /const seq = \+\+_oneSeq;/);
    assert.equal((body.match(/if \(seq !== _oneSeq \|\| gen !== _mkGen\) return;/g) || []).length, 2,
      'phải chắn ở CẢ nhánh thành công lẫn nhánh hỏng');
    assert.ok(!/_oneWant/.test(SRC), 'chắn theo userId không đủ');
  });
});

describe('đổi bài giao không kéo theo bảng của bài cũ (codex cục bộ 06/08)', () => {
  test('mỗi lần mở một bài giao là một THẾ HỆ mới', () => {
    // Mở bài A (mạng chậm) rồi mở bài B: bảng của A ghi đè lên B, tiêu đề vẫn
    // là B. Chắn theo `userId` không đỡ được vì đây là đổi BÀI GIAO.
    assert.match(SRC, /let _mkGen = 0;/);
    const i = SRC.indexOf('function openMarking');
    assert.match(SRC.slice(i, i + 200), /_mkGen \+= 1;/);
    assert.match(SRC, /btn-marking-back'\)\.addEventListener\('click', \(\) => \{\s*\n\s*_mkGen \+= 1;/);
  });

  test('CẢ BỐN lượt gọi của khu đều chụp thế hệ và kiểm lại', () => {
    // Vá ba chỗ rồi sót chỗ thứ tư thì đúng chỗ ấy vẫn ghi đè, và không có gì
    // đỏ để báo.
    for (const fn of ['async function openTally', 'async function openEffort',
                      'async function renderOneList', 'async function openOneReport']) {
      const i = SRC.indexOf(fn);
      assert.ok(i !== -1, `không thấy ${fn}`);
      assert.match(SRC.slice(i, i + 1200), /const gen = _mkGen;/, `${fn} chưa chụp thế hệ`);
    }
    assert.ok((SRC.match(/gen !== _mkGen/g) || []).length >= 4,
      'phải kiểm lại ở mọi chỗ vẽ');
  });
});

// ── Hàng KHÔNG được tràn ra khỏi khung ────────────────────────────────────
//
// `1fr` thực chất là `minmax(auto, 1fr)`: cột tên không co được dưới bề rộng
// nội dung. Cộng ba cột `auto` (giờ nộp, điểm, nút mở bài) thì một tên dài
// hoặc một ô điểm dài — "85% · chưa đạt · KTL×2" — đẩy cả hàng vượt khung.

describe('bảng nhận bài không tràn viền', () => {
  const css = readFileSync(
    new URL('../public/css/speaking-assignment.css', import.meta.url), 'utf8');

  test('cột tên dùng minmax(0, 1fr), không phải 1fr', () => {
    const rule = css.match(/\.av-tally__row\s*\{[^}]*\}/);
    assert.ok(rule, 'không thấy .av-tally__row');
    assert.match(rule[0], /minmax\(0,\s*1fr\)/);
    assert.doesNotMatch(rule[0], /columns:[^;]*\s1fr\s/,
      '`1fr` trần không co được dưới bề rộng nội dung');
  });

  test('và cột tên vẫn giữ quyền xuống dòng của nó', () => {
    // `min-width: 0` + `overflow-wrap` ĐÃ có sẵn — thiếu chỉ là quyền CO
    // (`minmax`). Thêm `text-overflow: ellipsis` ở đây sẽ đổi tên dài từ
    // XUỐNG DÒNG thành CẮT CỤT: một hồi quy đội lốt bản vá.
    const rules = [...css.matchAll(/\.av-tally__name\s*\{[^}]*\}/g)].map((m) => m[0]);
    const main = rules.find((r) => /min-width/.test(r));
    assert.ok(main, 'không thấy quy tắc chính của .av-tally__name');
    assert.match(main, /overflow-wrap:\s*anywhere/);
    assert.doesNotMatch(main, /text-overflow|white-space:\s*nowrap/);
    assert.equal(rules.filter((r) => /min-width/.test(r)).length, 1,
      'hai quy tắc cùng tên là hai chỗ tranh nhau');
  });

  test('hẹp thì XUỐNG DÒNG, không cuộn ngang', () => {
    // Cuộn ngang từng hàng là bắt tìm lại cái tên sau mỗi lần cuộn.
    assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.av-tally__row/);
    assert.doesNotMatch(css.match(/\.av-tally__row\s*\{[^}]*\}/)[0], /overflow-x/);
  });

  test('ô điểm cho phần phụ xuống dòng riêng', () => {
    const rule = css.match(/\.av-tally__band small\s*\{[^}]*\}/);
    assert.ok(rule, 'chưa tách phần phụ');
    assert.match(rule[0], /display:\s*block/);
  });
});

describe('lỗi đọc bảng tổng kết là LỜI MỜI, không phải ngõ cụt', () => {
  const SRC2 = readFileSync(
    new URL('../public/js/admin-classes.js', import.meta.url), 'utf8');

  test('có nút Thử lại', () => {
    const fn = SRC2.slice(SRC2.indexOf('async function openTally'),
                          SRC2.indexOf('async function openTally') + 1800);
    assert.match(fn, /data-action="retry-tally"/);
    assert.match(fn, /Thử lại/);
  });

  test('và nút ấy được nối', () => {
    assert.match(SRC2, /button\[data-action="retry-tally"\]/);
    assert.match(SRC2, /openTally\(_mk\.asg\)/);
  });

  test('phân biệt lỗi THOÁNG QUA với lỗi thật', () => {
    // Ghim HÀNH VI: bản trước soi chữ trong mã, nên đổi `transient` thành
    // `false` vẫn xanh — chốt canh một nhánh không bao giờ chạy.
    const fn = new Function(
      SRC2.slice(SRC2.indexOf('function isTransientNetworkError'),
                 SRC2.indexOf('async function openTally'))
      + ' return isTransientNetworkError;')();
    for (const m of ['Failed to fetch', 'NetworkError when attempting to fetch',
                     'Load failed']) {
      assert.equal(fn(m), true, m);
    }
    // Bấm lại một 404/500 chỉ hỏng y hệt — mời bấm lại là mời phí thời gian.
    for (const m of ['404 Not Found', 'Lỗi máy chủ 500', '', null]) {
      assert.equal(fn(m), false, String(m));
    }
  });

  test('và lời nhắn ấy có mặt', () => {
    const fn = SRC2.slice(SRC2.indexOf('async function openTally'),
                          SRC2.indexOf('async function openTally') + 1800);
    assert.match(fn, /khởi động lại/);
  });
});

/**
 * Bảng bài Speaking hằng ngày (học viên × ngày) + đường mở thẳng bài làm.
 *
 * Hai thứ giáo viên trước đây KHÔNG làm được: nhìn một phát ra "em nào đứt
 * quãng", và nghe bài của một em mà không phải mò trong danh sách phiên toàn
 * hệ thống.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');
const HTML = readFileSync(
  join(HERE, '..', 'public', 'pages', 'admin', 'classes', 'index.html'), 'utf8');
const CSS = readFileSync(
  join(HERE, '..', 'public', 'css', 'speaking-assignment.css'), 'utf8');
const SESS = readFileSync(
  join(HERE, '..', 'public', 'js', 'admin-speaking-sessions.js'), 'utf8');

/** Chạy THẬT renderDailyBoard + tallyRow với DOM giả. */
function load() {
  const s0 = SRC.indexOf('const BOARD_MARK = {');
  const s1 = SRC.indexOf('async function loadSpeakingPerf() {');
  const t0 = SRC.indexOf('function tallyRow(');
  // Lấy KÈM `hhmm` — tallyRow gọi nó. Cắt ngay trước nó thì hàm chạy là hàm
  // thiếu chân, và phép kiểm đo một thứ không tồn tại trên trang thật.
  const t1 = SRC.indexOf('function renderTally(');
  assert.ok(s0 !== -1 && s1 > s0 && t0 !== -1 && t1 > t0, 'không tìm thấy vùng mã');

  const nodes = {};
  const mk = () => ({ innerHTML: '', textContent: '', hidden: false });
  for (const id of ['daily-board', 'board-scope', 'board-head', 'board-body', 'board-foot'])
    nodes[id] = mk();
  const esc = (x) => String(x == null ? '' : x)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const TALLY_WHEN = { missing: 'chưa nộp', pending: 'chưa tới hạn', 'no-account': '—' };
  const fn = new Function('$', 'esc', 'TALLY_WHEN', `
    ${SRC.slice(s0, s1)}
    ${SRC.slice(t0, t1)}
    return { renderDailyBoard, boardDay, tallyRow, BOARD_MARK };
  `)((id) => nodes[id], esc, TALLY_WHEN);
  return { ...fn, nodes };
}

const { renderDailyBoard, boardDay, tallyRow, nodes } = load();

const cell = (state, over = {}) => ({ state, score: null, session_id: null, ...over });
const board = (over = {}) => ({
  days: ['2026-08-01', '2026-08-02'],
  assignment_count: 2,
  students: [{ student_id: 's1', name: 'An', student_code: 'A1', activated: true,
               cells: [cell('done'), cell('missing')], done: 1, missing: 1,
               avg_band: 6.5 }],
  ...over,
});

describe('lưới ngày', () => {
  test('một cột một ngày, kèm cột tên và cột tổng', () => {
    renderDailyBoard(board());
    const head = nodes['board-head'].innerHTML;
    assert.match(head, /Học viên/);
    assert.match(head, /01\/08/);
    assert.match(head, /02\/08/);
    assert.match(head, /Đã nộp/);
  });

  test('mỗi trạng thái một KÝ TỰ riêng, không chỉ khác màu', () => {
    // Lưới phân biệt bằng xanh/đỏ là lưới người mù màu không đọc được.
    renderDailyBoard(board({
      students: [{ ...board().students[0],
                   cells: [cell('done'), cell('late'), cell('missing'),
                           cell('pending'), cell('none')] }],
      days: ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'],
    }));
    const body = nodes['board-body'].innerHTML;
    const marks = [...body.matchAll(/data-state="(\w+)"[^>]*>([^<]*)</g)]
      .map((m) => [m[1], m[2].trim()]);
    const seen = new Map(marks);
    assert.equal(new Set([...seen.values()].filter(Boolean)).size, 4,
      'bốn trạng thái có thật phải có bốn ký tự khác nhau');
    assert.equal(seen.get('none'), '', 'không được giao thì để trống');
  });

  test('ô có bài thì bấm được để nghe', () => {
    renderDailyBoard(board({
      students: [{ ...board().students[0],
                   cells: [cell('done', { session_id: 'sess-9', score: 6.5 }),
                           cell('missing')] }],
    }));
    const body = nodes['board-body'].innerHTML;
    assert.match(body, /sessions\.html\?session=sess-9/);
    // Ô không có bài thì KHÔNG có liên kết dẫn tới trang trống.
    assert.equal((body.match(/<a /g) || []).length, 1);
  });

  test('ô mang nhãn đọc được cho chuột và trình đọc màn hình', () => {
    renderDailyBoard(board({
      students: [{ ...board().students[0],
                   cells: [cell('late', { score: 5.5 }), cell('missing')] }],
    }));
    assert.match(nodes['board-body'].innerHTML, /title="An · 01\/08 · nộp trễ · band 5\.5"/);
  });

  test('học viên chưa kích hoạt được ĐÁNH DẤU, không đọc thành lười', () => {
    renderDailyBoard(board({
      students: [{ ...board().students[0], activated: false }],
    }));
    assert.match(nodes['board-body'].innerHTML, /chưa kích hoạt/);
  });

  test('hàng có buổi bỏ bài được gắn cờ để liếc là thấy', () => {
    renderDailyBoard(board());
    assert.match(nodes['board-body'].innerHTML, /data-alarm="true"/);
    renderDailyBoard(board({
      students: [{ ...board().students[0], cells: [cell('done'), cell('done')], missing: 0 }],
    }));
    assert.doesNotMatch(nodes['board-body'].innerHTML, /data-alarm/);
  });

  test('không có ngày nào thì ẨN hẳn, không hiện lưới rỗng', () => {
    // Lưới rỗng đọc như "lớp chưa có bài hằng ngày", mà sự thật có thể là chưa
    // đọc được.
    renderDailyBoard({ days: [], students: [], assignment_count: 0 });
    assert.equal(nodes['daily-board'].hidden, true);
  });

  test('chú giải nói đủ năm trạng thái', () => {
    renderDailyBoard(board());
    for (const w of ['đã nộp', 'nộp trễ', 'không nộp', 'chưa tới hạn', 'không được giao']) {
      assert.ok(nodes['board-foot'].textContent.includes(w), w);
    }
  });

  test('ngày rút gọn còn ngày/tháng — cột hẹp, năm dùng chung', () => {
    assert.equal(boardDay('2026-08-05'), '05/08');
    assert.equal(boardDay('rác'), 'rác');
  });
});

describe('mở thẳng bài làm từ bảng tổng kết', () => {
  const row = (over) => ({ name: 'An', status: 'submitted', score: 6.5,
                           submitted_at: '2026-08-03T11:00:00+00:00', ...over });

  test('có phiên thì có nút Nghe & xem', () => {
    const html = tallyRow(row({ artifact_kind: 'session', artifact_id: 'sess-9' }), 'speaking');
    assert.match(html, /sessions\.html\?session=sess-9/);
    assert.match(html, /Nghe/);
  });

  test('chưa có bài thì KHÔNG có liên kết dẫn tới trang trống', () => {
    assert.doesNotMatch(tallyRow(row({ status: 'missing', score: null }), 'speaking'),
      /sessions\.html/);
  });

  test('bài KHÔNG phải Speaking không mở bằng trang phiên Speaking', () => {
    // Mỗi kỹ năng mở ở một trang khác; đoán từ id là đoán sai.
    assert.doesNotMatch(
      tallyRow(row({ artifact_kind: 'quiz_session', artifact_id: 'q1' }), 'course'),
      /sessions\.html/);
  });
});

describe('DÂY NỐI', () => {
  test('trang lớp có khung lưới và JS được gọi khi mở thẻ Tiến độ', () => {
    assert.match(HTML, /id="daily-board"/);
    assert.match(HTML, /id="board-body"/);
    assert.ok((SRC.match(/loadDailyBoard\(\)/g) || []).length >= 3,
      'phải gọi ở CẢ hai đường mở thẻ, không chỉ một');
  });

  test('cột tên DÍNH khi cuộn ngang — mất tên thì cả hàng vô nghĩa', () => {
    const m = /\.av-board__name,\s*\.av-board__name-h \{([^}]*)\}/.exec(CSS);
    assert.ok(m && /position:\s*sticky/.test(m[1]));
  });

  test('lưới cuộn NGANG trong khung của nó, không đẩy cả trang', () => {
    assert.match(CSS, /\.av-board__scroll \{[^}]*overflow-x:\s*auto/);
  });

  test('trang phiên Speaking nhận deep-link ?session=', () => {
    assert.match(SESS, /URLSearchParams\(location\.search\)\.get\('session'\)/);
    assert.match(SESS, /if \(wanted\) loadDetail\(wanted\)/);
  });

  test('modal phiên có BÁO CÁO NHẬN XÉT, không chỉ band + audio', () => {
    assert.match(SESS, /function feedbackReport/);
    assert.match(SESS, /html \+= feedbackReport\(r\);/);
    for (const k of ['fc_feedback', 'lr_feedback', 'gra_feedback', 'p_feedback',
                     'strengths', 'improvements', 'grammar_issues']) {
      assert.ok(SESS.includes(k), `báo cáo phải đọc ${k}`);
    }
  });
});

describe('bảng ngày nói thật khi hỏng, và không nói CŨ (codex #931 vòng 3)', () => {
  test('đọc hỏng thì HIỆN cảnh báo, không nuốt im lặng', () => {
    // Đây là mặt đọc dùng để tìm em bỏ bài — im lặng ở đây là giấu đúng thứ nó
    // sinh ra để hiện.
    const i = SRC.indexOf('async function loadDailyBoard');
    const body = SRC.slice(i, SRC.indexOf('const BOARD_MARK', i));
    // Ghi vào trạng thái chung rồi vẽ, chứ KHÔNG ghi thẳng DOM — xem phép kiểm
    // "MỘT băng cảnh báo" bên dưới.
    assert.ok(/_boardNote = 'Không đọc được bảng bài hằng ngày/.test(body),
      'phải ghi lời cảnh báo vào trạng thái chung');
    assert.ok(/renderProgressBanner\(\)/.test(body), 'và vẽ lại băng');
    assert.ok(/_dailyBoardLoaded = false/.test(body), 'và cho lần mở sau thử lại');
  });

  test('đổi bài tập làm bảng ngày CŨ — mọi đường mutate đều báo', () => {
    // Bảng dựng TỪ danh sách bài giao; giao/lưu trữ/xoá mà không báo thì admin
    // quay lại thẻ Tiến độ vẫn thấy bảng của trước đó.
    const inv = SRC.indexOf('function invalidateProgress');
    assert.ok(/_dailyBoardLoaded = false/.test(SRC.slice(inv, inv + 700)),
      'invalidateProgress phải làm cũ cả bảng ngày');
    // Mỗi lần nạp lại bảng bài tập là một lần dữ liệu bài giao vừa đổi.
    const loads = (SRC.match(/await loadHomework\(\);/g) || []).length;
    const paired = (SRC.match(/await loadHomework\(\);\s*(?:\/\/[^\n]*\n\s*)*invalidateProgress\(\);/g) || []).length;
    assert.equal(paired, loads,
      `${loads} đường đổi bài tập nhưng chỉ ${paired} đường báo bảng ngày cũ`);
  });

  test('chốt nằm TRONG hàm, không phải ở chỗ gọi', () => {
    // Đặt lời gọi trong chốt `_progressLoaded` thì việc mở chốt riêng của bảng
    // (lúc hỏng) trở thành vô nghĩa: rời thẻ rồi quay lại vẫn treo cảnh báo cũ
    // tới khi tải lại cả trang (codex #931 vòng 5).
    const i = SRC.indexOf('async function loadDailyBoard');
    assert.match(SRC.slice(i, i + 220), /_dailyBoardLoaded\) return;/);

    const sp = SRC.indexOf('function showPanel');
    const body = SRC.slice(sp, SRC.indexOf('\n}', sp));
    const call = body.indexOf('loadDailyBoard();');
    const latch = body.indexOf('if (!_progressLoaded) {');
    const latchEnd = body.indexOf('    }', latch);
    assert.ok(call !== -1 && latch !== -1);
    assert.ok(call > latchEnd,
      'lời gọi phải nằm NGOÀI chốt _progressLoaded, không thì lần hỏng không bao giờ thử lại');
  });
});

describe('MỘT băng cảnh báo, hai nguồn ghi vào (codex #931 vòng 4)', () => {
  test('không bên nào ghi thẳng vào DOM — hai lượt gọi song song sẽ xoá lời nhau', () => {
    // /speaking-daily hỏng trước, /progress xong sau → cảnh báo bị xoá sạch.
    const writes = [...SRC.matchAll(/\$\('progress-degraded'\)/g)].length;
    const inBanner = SRC.indexOf('function renderProgressBanner');
    assert.ok(inBanner !== -1, 'phải có một chỗ vẽ chung');
    const bannerBody = SRC.slice(inBanner, inBanner + 400);
    assert.ok(/_progressNotes/.test(bannerBody) && /_boardNote/.test(bannerBody),
      'chỗ vẽ chung phải gộp CẢ HAI nguồn');
    // CHỈ chỗ vẽ chung được chạm DOM. Mọi đường khác phải đi qua trạng thái —
    // kể cả đường lỗi cứng của loadProgress (tự soát bắt được, cùng họ lỗi ở
    // chiều ngược lại: /progress hỏng thì xoá lời của bảng ngày).
    assert.equal(writes, 1,
      `còn ${writes} chỗ chạm DOM — mỗi chỗ ngoài renderProgressBanner là một lần xoá lời bên kia`);
  });

  test('bảng nạp lại THÀNH CÔNG thì gỡ cảnh báo cũ của chính nó', () => {
    const i = SRC.indexOf('async function loadDailyBoard');
    const body = SRC.slice(i, i + 700);
    assert.ok(/_boardNote = '';/.test(body), 'không gỡ thì cảnh báo cũ dính mãi');
  });
});

describe('màn đọc bài tự luận của admin', () => {
  const ADMIN_HTML = readFileSync(
    join(HERE, '..', 'public', 'pages', 'admin', 'classes', 'index.html'), 'utf8');
  const CX = readFileSync(
    join(HERE, '..', 'public', 'css', 'course-exercises.css'), 'utf8');

  test('trang NẠP tệp CSS định nghĩa những lớp nó vẽ', () => {
    // Bài học PR #925: trang không nạp tệp định nghĩa lớp mình vẽ thì ra màn
    // hình trần trụi, và không phép kiểm nào bắt được vì test đọc CSS từ đĩa.
    const linked = [...ADMIN_HTML.matchAll(/<link[^>]+href="(\/css\/[^"]+\.css)"/g)]
      .map((m) => m[1]);
    const css = linked
      .map((h) => readFileSync(join(HERE, '..', 'public', h.replace(/^\//, '')), 'utf8'))
      .join('\n');
    const src = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');
    const i = src.indexOf('function renderStudentWriting');
    const emitted = new Set();
    for (const m of src.slice(i, src.indexOf('async function openStudentWriting'))
      .matchAll(/class="([^"$]+)"/g)) {
      for (const c of m[1].split(/\s+/)) if (c.startsWith('cw-')) emitted.add(c);
    }
    assert.ok(emitted.size >= 5, `phải gom được lớp cw-*, đang có ${emitted.size}`);
    const missing = [...emitted].filter(
      (c) => !new RegExp(`\\.${c.replace(/[^\w-]/g, '\\$&')}(?![\\w-])`).test(css));
    assert.deepEqual(missing, [],
      `trang admin không nạp CSS định nghĩa: ${missing.join(', ')}`);
  });

  test('vẽ CÙNG một cách học viên đang thấy — không phải bộ vẽ rút gọn thứ hai', () => {
    // Giáo viên và học viên phải nhìn cùng một bản chấm, kẻo hai bên nói về hai
    // thứ khác nhau khi ngồi lại.
    const src = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');
    for (const cls of ['cw-diff', 'cw-issues', 'cw-issue__kind', 'cw-model', 'cw-done']) {
      assert.ok(src.includes(cls), `thiếu ${cls}`);
      assert.ok(CX.includes('.' + cls), `${cls} phải do course-exercises.css định nghĩa`);
    }
  });

  test('chưa nộp thì NÓI RÕ, không hiện một khung rỗng', () => {
    const src = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');
    const i = src.indexOf('function renderStudentWriting');
    assert.match(src.slice(i, i + 300), /chưa nộp phần tự luận/);
  });

  test('nút chỉ hiện khi THẬT SỰ có bài để đọc', () => {
    const html = tallyRow({ name: 'An', status: 'submitted', score: 80,
      submitted_at: '2026-08-05T11:00:00+00:00', student_id: 's1',
      has_writing: true }, 'course');
    assert.match(html, /data-writing="s1"/);
    assert.doesNotMatch(
      tallyRow({ name: 'An', status: 'submitted', score: 80,
                 submitted_at: '2026-08-05T11:00:00+00:00', student_id: 's1' }, 'course'),
      /data-writing/);
  });
});

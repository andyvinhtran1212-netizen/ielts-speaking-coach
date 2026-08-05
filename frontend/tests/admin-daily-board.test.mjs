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

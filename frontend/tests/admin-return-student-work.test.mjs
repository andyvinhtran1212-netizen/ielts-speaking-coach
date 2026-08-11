/**
 * Nút TRẢ BÀI trong khu Nhận bài của giáo viên.
 *
 * Ngày 07/08 em Lê Ngọc Hà Linh nộp nhầm phần tự luận sau bốn giây, và mở lại
 * cho em ấy phải chạy SQL tay trên máy chủ thật. Đây là đường trong sản phẩm
 * cho đúng việc ấy — nên nó phải có ba tính chất, và cả ba đều dễ đánh rơi:
 *
 *   · HỎI TRƯỚC — nó vứt lượt nộp hiện tại khỏi sổ;
 *   · ĐỌC LẠI bảng từ máy chủ sau khi ghi, không tự sửa dòng đang cầm trên tay;
 *   · lỗi thì kể NGUYÊN CÂU của máy chủ, vì câu ấy nói phải làm gì trước
 *     ("dời hạn nộp trước đã").
 *
 * Chạy THẬT hàm ấy với `confirmDanger` / `api` / `toast` giả: chốt "chỉ ghi khi
 * đã xác nhận" là chuyện của luồng chạy, và một biểu thức chính quy trên mã
 * nguồn không phân biệt được "có gọi" với "gọi đúng lúc".
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');

function load({ postFails = null, postReturns = { returned: true, draft_restored: 10 } } = {}) {
  const start = SRC.indexOf('function returnStudentWork');
  const end = SRC.indexOf('let _tallyAsg');
  assert.ok(start !== -1 && end > start, 'không tìm thấy hàm trả bài — module bị dựng lại?');

  const seen = { confirms: [], posts: [], toasts: [], tally: [] };
  const win = {
    confirmDanger(opts) { seen.confirms.push(opts); },
  };
  const api = {
    async post(path, body) {
      seen.posts.push({ path, body });
      if (postFails) throw postFails;
      return postReturns;
    },
  };
  const toast = (msg, kind) => seen.toasts.push({ msg, kind });
  const openTally = (id) => seen.tally.push(id);

  // `refreshActionLogIfOpen` là hàng xóm mới của luồng này (nhật ký thao tác):
  // trả bài xong thì khung nhật ký đang mở phải vẽ lại. Bộ giả phải có nó, và
  // đếm luôn — thiếu thì lượt trả bài ném ReferenceError giữa chừng.
  const fn = new Function('window', 'api', 'toast', 'openTally', '_cohortId',
    'refreshActionLogIfOpen',
    `${SRC.slice(start, end)}
     return returnStudentWork;`)(win, api, toast, openTally, 'coh-1',
      () => { seen.logRefresh = (seen.logRefresh || 0) + 1; });
  return { fn, seen };
}

describe('trả bài: hỏi trước, ghi sau, rồi đọc lại', () => {
  test('bấm nút chỉ MỞ hộp hỏi — chưa ghi gì', () => {
    const { fn, seen } = load();
    fn('asg-1', 'st-1');
    assert.equal(seen.confirms.length, 1);
    assert.equal(seen.posts.length, 0, 'chưa xác nhận mà đã vứt lượt nộp khỏi sổ');
  });

  test('hộp hỏi nói rõ chuyện gì xảy ra, kể cả chỗ bài viết vẫn được giữ', () => {
    const { fn, seen } = load();
    fn('asg-1', 'st-1');
    const o = seen.confirms[0];
    assert.match(o.title, /Trả bài/);
    assert.match(o.body, /không còn tính là đã nộp/);
    assert.match(o.body, /đưa lại vào ô nhập/, 'phải nói rõ em ấy KHÔNG phải gõ lại');
    assert.match(o.body, /vẫn được giữ|giữ để tra lại/);
    assert.match(o.body, /còn hạn/, 'giáo viên phải biết trước cái chốt sẽ từ chối mình');
  });

  test('xác nhận rồi mới gọi đúng đường của lớp/bài giao/học viên ấy', async () => {
    const { fn, seen } = load();
    fn('asg-1', 'st-1');
    await seen.confirms[0].onConfirm();
    assert.equal(seen.posts.length, 1);
    assert.equal(seen.posts[0].path,
      '/admin/cohorts/coh-1/assignments/asg-1/return/st-1');
  });

  test('ghi xong thì ĐỌC LẠI bảng tổng kết, không tự sửa dòng đang cầm', async () => {
    const { fn, seen } = load();
    fn('asg-1', 'st-1');
    await seen.confirms[0].onConfirm();
    assert.deepEqual(seen.tally, ['asg-1']);
    assert.equal(seen.toasts[0].kind, undefined);
    assert.equal(seen.logRefresh, 1, 'nhật ký đang mở phải thấy ngay dòng vừa tạo');
  });

  test('nói luôn em ấy mở ra thấy BÀI CŨ hay TRANG TRẮNG', async () => {
    // Giáo viên nhắn cho học viên ngay sau khi bấm — đây là thứ họ cần biết lúc
    // này, và "khôi phục được 0 câu" phải kêu chứ không lẫn vào lời báo xong.
    const ok = load();
    ok.fn('asg-1', 'st-1');
    await ok.seen.confirms[0].onConfirm();
    assert.match(ok.seen.toasts[0].msg, /10 câu/);

    const blank = load({ postReturns: { returned: true, draft_restored: 0 } });
    blank.fn('asg-1', 'st-1');
    await blank.seen.confirms[0].onConfirm();
    assert.match(blank.seen.toasts[0].msg, /phải viết lại/);
    assert.equal(blank.seen.toasts[0].kind, 'error');
    assert.deepEqual(blank.seen.tally, ['asg-1'], 'vẫn phải đọc lại bảng — bài ĐÃ trả');
  });

  test('máy chủ từ chối thì kể NGUYÊN CÂU, và KHÔNG báo là đã trả', async () => {
    // Câu của máy chủ nói phải làm gì trước ("dời hạn nộp trước, rồi mới trả
    // bài được"). Đắp một câu chung chung lên trên là lấy mất chỉ dẫn ấy.
    const err = new Error('Bài giao đã quá hạn nhận bài. Dời hạn nộp trước, rồi mới trả bài được');
    const { fn, seen } = load({ postFails: err });
    fn('asg-1', 'st-1');
    await seen.confirms[0].onConfirm();
    assert.equal(seen.toasts.length, 1);
    assert.equal(seen.toasts[0].kind, 'error');
    assert.match(seen.toasts[0].msg, /Dời hạn nộp trước/);
    assert.deepEqual(seen.tally, [], 'trả hụt mà vẽ lại bảng là làm ra vẻ đã xong');
  });
});

describe('nút chỉ hiện khi CÓ bài để trả', () => {
  test('màn bài tự luận gắn nút theo `submission`, không gắn vô điều kiện', () => {
    const i = SRC.indexOf('async function openStudentWriting');
    const body = SRC.slice(i, i + 1600);
    assert.match(body, /const canReturn = !!\(d && d\.submission\)/);
    assert.match(body, /canReturn[\s\S]{0,200}id="cw-return"/);
    assert.match(body, /returnStudentWork\(assignmentId, studentId\)/);
  });
});

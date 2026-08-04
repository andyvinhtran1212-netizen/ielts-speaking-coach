/**
 * Lớp logic của bài tập theo buổi — CHẠY THẬT, không khớp chuỗi nguồn.
 *
 * Vòng review đầu bắt sáu lỗi, năm cái quy về cùng một chỗ: vòng đời phiên làm
 * bài. Bộ test cũ khớp chuỗi trong tệp nguồn nên không chứng minh được gì về nó
 * — một `PATCH` có mặt trong mã không có nghĩa là nó được gọi ĐÚNG LÚC, đúng SỐ
 * LẦN, và với đúng PHIÊN.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createRunner, splitStem, md, esc, STAGE } from '../js/course-runner.js';

// ── Bộ giả ────────────────────────────────────────────────────────────────

function mcq(i, over = {}) {
  return {
    qid: `Q${i}`, type: 'mcq', subtype: 'A1', skill: 'NONG-COT',
    item_key: `trục ${i}`, prompt: `Câu ${i}?\nThe council **opened** it.`,
    options: ['a', 'b', 'c', 'd'], answer: 0,
    explain: `giải thích ${i}`,
    why_wrong: { 1: `bẫy 1 của ${i}`, 2: `bẫy 2 của ${i}`, 3: `bẫy 3 của ${i}` },
    points: 2, ...over,
  };
}

function essay(i) {
  return {
    qid: `E${i}`, type: 'writing', subtype: 'E1', skill: 'TU-LUAN',
    item_key: 'RB1', prompt: 'Viết lại:', options: null, answer: null,
    explain: '**Đáp án mẫu:** x', why_wrong: null, points: 1,
  };
}

function fakeApi({ questions, failSession = false, failProgress = false, failPatch = false } = {}) {
  const calls = { post: [], patch: [], postWith: [] };
  let n = 0;
  return {
    calls,
    async get() { return { bank: { id: 'b1', title: 'Buổi 1' }, questions }; },
    async post(path, body) {
      calls.post.push({ path, body });
      if (path === '/api/quiz/sessions') {
        if (failSession) throw new Error('mạng hỏng');
        n += 1;
        return { id: 'sess-' + n };
      }
      if (failProgress) throw new Error('progress hỏng');
      return {};
    },
    async postWith(path, body, _h, opts) {
      calls.postWith.push({ path, body, opts });
      if (failProgress) throw new Error('progress hỏng');
      return {};
    },
    async patch(path, body) {
      calls.patch.push({ path, body });
      if (failPatch) throw new Error('patch hỏng');
      return {};
    },
  };
}

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), _m: m };
}

async function run(opts = {}) {
  const questions = opts.questions || Array.from({ length: 25 }, (_, i) => mcq(i));
  const api = fakeApi({ ...opts, questions });
  const storage = opts.storage || memStore();
  const r = createRunner({ api, storage, now: () => 1000 });
  await r.load('b1');
  return { r, api, storage };
}

/** Làm hết một chặng, trả về kết quả chốt chặng. */
async function playStage(r, { wrongAt = [] } = {}) {
  const list = r.stageQuestions();
  for (let i = 0; i < list.length; i++) {
    r.show();
    if (list[i].type === 'writing') r.selfCheck();
    else r.answer(wrongAt.includes(i) ? 1 : list[i].answer);
    r.next();
  }
  return r.finishStage();
}

// ── Dựng nội dung ─────────────────────────────────────────────────────────

describe('dựng nội dung đề', () => {
  test('**in đậm** thành <mark>', () => {
    assert.equal(md('a **b** c'), 'a <mark>b</mark> c');
  });

  test('HTML bị thoát TRƯỚC khi dựng thẻ', () => {
    const out = md('<script>x</script> **đậm**');
    assert.ok(!out.includes('<script>'));
    assert.ok(out.includes('&lt;script&gt;') && out.includes('<mark>đậm</mark>'));
  });

  test('dòng đầu là câu hỏi, phần còn lại là mẫu vật', () => {
    assert.deepEqual(splitStem('Hỏi gì?\nThe council opened it.'),
      { ask: 'Hỏi gì?', spec: 'The council opened it.' });
  });

  test('mẫu vật nhiều dòng giữ nguyên các dòng', () => {
    // Dạng B3 cho hai câu để so sánh — gộp làm một dòng là xoá thứ đang được hỏi.
    const s = splitStem('Khác gì?\n(1) A made B uniforms.\n(2) A made B happier.');
    assert.ok(s.spec.includes('\n') && s.spec.includes('(2)'));
  });

  test('đề một dòng thì không có mẫu vật', () => {
    assert.deepEqual(splitStem('Câu nào ĐÚNG?'), { ask: 'Câu nào ĐÚNG?', spec: '' });
  });
});

// ── Bẫy tới đúng ô đã chọn ────────────────────────────────────────────────

describe('cái bẫy', () => {
  test('chọn sai thì trả về bẫy CỦA PHƯƠNG ÁN ĐÃ CHỌN', async () => {
    const { r } = await run();
    r.show();
    assert.equal(r.answer(2).trap, 'bẫy 2 của 0', 'phải là bẫy của ô số 2, không phải ô khác');
  });

  test('chọn đúng thì không có bẫy nào', async () => {
    const { r } = await run();
    r.show();
    const res = r.answer(0);
    assert.equal(res.correct, true);
    assert.equal(res.trap, null);
  });

  test('câu không có dữ liệu bẫy thì trả null, không nổ', async () => {
    const { r } = await run({ questions: [mcq(0, { why_wrong: null })] });
    r.show();
    assert.equal(r.answer(1).trap, null);
  });

  test('bấm lần thứ hai vào cùng một câu không đổi kết quả', async () => {
    const { r } = await run();
    r.show();
    r.answer(0);
    assert.equal(r.answer(3), null, 'câu đã trả lời thì khoá lại');
    assert.deepEqual(r.marks[0], 'right');
  });
});

// ── MỘT PHIÊN = MỘT CHẶNG ─────────────────────────────────────────────────

describe('vòng đời phiên', () => {
  test('mỗi chặng mở một phiên MỚI', async () => {
    // Dùng lại một phiên cho mọi chặng thì chặng 2 ghi đè lên một phiên đã chốt
    // bằng con số của riêng nó — giáo viên chỉ thấy chặng cuối.
    const { r, api } = await run();
    await playStage(r);
    await r.nextStage();
    await playStage(r);
    const opened = api.calls.post.filter((c) => c.path === '/api/quiz/sessions');
    assert.equal(opened.length, 2, 'hai chặng phải là hai phiên');
    const patched = api.calls.patch.map((c) => c.path);
    assert.deepEqual(patched, ['/api/quiz/sessions/sess-1', '/api/quiz/sessions/sess-2'],
      'mỗi phiên được chốt đúng một lần, bằng chính id của nó');
  });

  test('con số chốt là của CHÍNH chặng đó', async () => {
    const { r, api } = await run();
    await playStage(r, { wrongAt: [0, 1] });      // chặng 1: 8/10
    await r.nextStage();
    await playStage(r, { wrongAt: [0] });         // chặng 2: 9/10
    assert.equal(api.calls.patch[0].body.total_correct, 8);
    assert.equal(api.calls.patch[1].body.total_correct, 9);
  });

  test('câu tự luận KHÔNG tính vào tổng chấm được', async () => {
    const qs = [...Array.from({ length: 8 }, (_, i) => mcq(i)), essay(1), essay(2)];
    const { r, api } = await run({ questions: qs });
    const res = await playStage(r);
    assert.equal(res.graded, 8);
    assert.equal(api.calls.patch[0].body.total_questions, 8);
  });

  test('câu tự luận không gửi lượt làm nào', async () => {
    const { r, api } = await run({ questions: [essay(1)] });
    r.show(); r.selfCheck(); r.next();
    await r.finishStage();
    const progress = api.calls.post.filter((c) => c.path.includes('/progress'));
    assert.deepEqual(progress.flatMap((c) => c.body.attempts), []);
  });
});

// ── Không chốt khi bài chưa tới máy chủ ───────────────────────────────────

describe('trung thực về việc đã lưu được hay chưa', () => {
  test('đẩy lượt làm hỏng thì KHÔNG chốt phiên', async () => {
    // Chốt trong lúc lượt làm còn kẹt sẽ báo với giáo viên rằng chặng đã xong
    // trong khi chi tiết thì thiếu.
    const { r, api } = await run({ failProgress: true });
    const res = await playStage(r);
    assert.equal(res.persisted, false, 'phải nói ra là chưa lưu được');
    assert.equal(api.calls.patch.length, 0, 'không được chốt phiên');
  });

  test('lượt làm hỏng vẫn nằm lại hàng đợi để thử lại', async () => {
    const { r } = await run({ failProgress: true });
    await playStage(r);
    assert.ok(r.pendingCount > 0, 'mất lượt làm là giáo viên đọc số thấp hơn thực tế');
  });

  test('tạo phiên hỏng thì nói ra, nhưng VẪN cho làm', async () => {
    // Chặn lại thì em ấy mất cả buổi vì một lỗi mạng.
    const { r } = await run({ failSession: true });
    assert.equal(r.sessionFailed, true);
    r.show();
    assert.equal(r.answer(0).correct, true, 'vẫn làm bài được');
    const res = await playStage(r);
    assert.equal(res.persisted, false);
  });

  test('chốt phiên hỏng cũng phải nói ra', async () => {
    const { r } = await run({ failPatch: true });
    const res = await playStage(r);
    assert.equal(res.persisted, false);
  });

  test('mọi thứ trơn tru thì persisted = true', async () => {
    const { r } = await run();
    assert.equal((await playStage(r)).persisted, true);
  });
});

// ── Đóng tab giữa chừng ───────────────────────────────────────────────────

describe('rời trang', () => {
  test('dùng fetch keepalive THẬT, không phải một cờ tự đặt', async () => {
    const { r, api } = await run();
    r.show(); r.answer(0); r.next();
    await r.leave();
    assert.equal(api.calls.postWith.length, 1);
    assert.deepEqual(api.calls.postWith[0].opts, { keepalive: true });
  });

  test('không có gì chờ gửi thì không gọi mạng', async () => {
    const { r, api } = await run();
    await r.leave();
    assert.equal(api.calls.postWith.length, 0);
  });
});

// ── Quay lại làm tiếp ─────────────────────────────────────────────────────

describe('nhớ chỗ đang làm', () => {
  test('bỏ dở giữa chặng thì quay lại ĐÚNG câu đang làm', async () => {
    const store = memStore();
    const a = await run({ storage: store });
    for (let i = 0; i < 4; i++) { a.r.show(); a.r.answer(0); a.r.next(); }
    const b = await run({ storage: store });
    assert.equal(b.r.at, 4, 'làm lại bốn câu vừa làm là thứ khiến người ta bỏ hẳn');
    assert.deepEqual(b.r.marks.slice(0, 4), ['right', 'right', 'right', 'right']);
  });

  test('tải lại trang ở MÀN KẾT QUẢ thì sang chặng sau, không làm lại', async () => {
    // Bản trước suy "đã xong" từ `at >= STAGE` rồi coi là trạng thái hỏng và đặt
    // lại về đầu chặng — nên tải lại ở màn kết quả là làm lại cả mười câu.
    const store = memStore();
    const a = await run({ storage: store });
    await playStage(a.r);
    const b = await run({ storage: store });
    assert.equal(b.r.stage, 1, 'phải sang chặng 2');
    assert.equal(b.r.at, 0);
  });

  test('xong CHẶNG CUỐI thì đứng lại ở màn kết quả, không quay về đầu', async () => {
    const store = memStore();
    const qs = Array.from({ length: STAGE }, (_, i) => mcq(i));   // đúng một chặng
    const a = await run({ storage: store, questions: qs });
    await playStage(a.r);
    const b = await run({ storage: store, questions: qs });
    assert.equal(b.r.stage, 0);
    assert.ok(b.r.isStageDone(), 'chặng cuối đã xong thì không bắt làm lại');
  });

  test('bài bị soạn ngắn lại thì vị trí cũ bị bỏ, không mở ra trang trắng', async () => {
    const store = memStore();
    store.setItem('cx:b1', JSON.stringify({ stage: 9, at: 3, marks: [] }));
    const { r } = await run({ storage: store, questions: [mcq(0), mcq(1)] });
    assert.equal(r.stage, 0);
    assert.equal(r.at, 0);
    assert.ok(r.current(), 'phải có câu để làm');
  });

  test('bộ nhớ trình duyệt bị chặn thì vẫn làm bài được', async () => {
    const blocked = { getItem() { throw new Error('chặn'); }, setItem() { throw new Error('chặn'); } };
    const { r } = await run({ storage: blocked });
    r.show();
    assert.equal(r.answer(0).correct, true);
  });
});

// ── Tổng kết chặng ────────────────────────────────────────────────────────

describe('hết chặng', () => {
  test('nói TRỤC nào sai nhiều nhất, xếp giảm dần', async () => {
    const qs = [mcq(0, { item_key: 'X' }), mcq(1, { item_key: 'X' }),
                mcq(2, { item_key: 'Y' }), mcq(3, { item_key: 'X' }),
                ...Array.from({ length: 6 }, (_, i) => mcq(10 + i))];
    const { r } = await run({ questions: qs });
    const res = await playStage(r, { wrongAt: [0, 1, 2] });
    assert.deepEqual(res.axes, [{ axis: 'X', n: 2 }, { axis: 'Y', n: 1 }]);
  });

  test('không sai câu nào thì danh sách trục rỗng', async () => {
    const { r } = await run();
    assert.deepEqual((await playStage(r)).axes, []);
  });

  test('còn chặng sau thì báo còn', async () => {
    const { r } = await run();                       // 25 câu = 3 chặng
    assert.equal((await playStage(r)).hasMore, true);
  });

  test('chặng cuối thì báo hết', async () => {
    const { r } = await run({ questions: Array.from({ length: 8 }, (_, i) => mcq(i)) });
    assert.equal((await playStage(r)).hasMore, false);
  });
});

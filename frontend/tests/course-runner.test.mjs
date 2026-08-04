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

// ── Cổng thuộc bài: kiểm tra lại (mẫu nhỏ, trộn câu + trộn đáp án) ──────────

import { retakeClone, shuffled } from '../js/course-runner.js';

/** LCG — rng tái lập được cho test. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

describe('retakeClone — trộn đáp án mà không đổi nghĩa', () => {
  test('đáp án đúng vẫn là ĐÚNG PHƯƠNG ÁN ấy, chỉ đổi chỗ', () => {
    const q = mcq(0, { answer: 2 });          // đáp án đúng là 'c'
    for (let seed = 1; seed <= 20; seed++) {
      const c = retakeClone(q, lcg(seed));
      assert.equal(c.options[c.answer], 'c', 'chữ của đáp án đúng phải theo nó');
      assert.equal(c.options.length, 4);
      assert.deepEqual([...c.options].sort(), ['a', 'b', 'c', 'd']);
    }
  });

  test('why_wrong đi theo phương án của nó', () => {
    const q = mcq(0);                          // why_wrong cho gốc 1,2,3
    const c = retakeClone(q, lcg(7));
    for (let disp = 0; disp < 4; disp++) {
      const orig = c._perm[disp];
      const want = (q.why_wrong || {})[String(orig)] || null;
      assert.equal(c.why_wrong[String(disp)] || null, want,
        `bẫy ở vị trí hiển thị ${disp} phải là bẫy của phương án gốc ${orig}`);
    }
  });

  test('có seed cho hoán vị KHÁC nguyên trạng (trộn thật, không phải danh nghĩa)', () => {
    const moved = Array.from({ length: 20 }, (_, s) => retakeClone(mcq(0), lcg(s + 1)))
      .some((c) => c._perm.some((v, i) => v !== i));
    assert.ok(moved, 'cả 20 seed đều giữ nguyên thứ tự thì shuffle không tồn tại');
  });
});

describe('bài kiểm tra lại', () => {
  test('bốc đúng cỡ mẫu, loại câu tự luận, phiên mang kind=retake', async () => {
    const questions = Array.from({ length: 12 }, (_, i) => mcq(i)).concat([essay(12), essay(13)]);
    const { r, api } = await run({ questions });
    const n = await r.startRetake(5, lcg(3));
    assert.equal(n, 5);
    assert.equal(r.mode, 'retake');
    const list = r.stageQuestions();
    assert.equal(list.length, 5);
    assert.ok(list.every((q) => q.type !== 'writing'), 'tự luận không vào mẫu');
    const open = api.calls.post.filter((c) => c.path === '/api/quiz/sessions');
    assert.deepEqual(open[open.length - 1].body, { bank_id: 'b1', kind: 'retake' });
  });

  test('cỡ mẫu vượt kho thì lấy cả kho — không lặp câu', async () => {
    const { r } = await run({ questions: Array.from({ length: 4 }, (_, i) => mcq(i)) });
    const n = await r.startRetake(20, lcg(1));
    assert.equal(n, 4);
    const qids = r.stageQuestions().map((q) => q.qid);
    assert.equal(new Set(qids).size, 4, 'mỗi câu một lần');
  });

  test('lượt làm gửi vị trí GỐC của phương án, không phải vị trí hiển thị', async () => {
    const { r, api } = await run({ questions: Array.from({ length: 6 }, (_, i) => mcq(i)) });
    await r.startRetake(6, lcg(9));
    const list = r.stageQuestions();
    // chọn phương án hiển thị số 1 ở mọi câu
    for (let i = 0; i < list.length; i++) { r.show(); r.answer(1); r.next(); }
    await r.finishStage();
    const sent = api.calls.post
      .filter((c) => c.path.includes('/progress'))
      .flatMap((c) => c.body.attempts);
    assert.equal(sent.length, 6);
    sent.forEach((a, i) => {
      assert.equal(a.answer_given, String(list[i]._perm[1]),
        'answer_given phải là chỉ số GỐC sau khi giải hoán vị');
    });
  });

  test('retake không có "chặng sau" và không đè trạng thái lượt chính', async () => {
    const store = memStore();
    const { r } = await run({ storage: store, questions: Array.from({ length: 8 }, (_, i) => mcq(i)) });
    await playStage(r);                       // chặng 1 xong, đã save
    const savedBefore = store.getItem('cx:b1');
    await r.startRetake(3, lcg(2));
    const list = r.stageQuestions();
    for (let i = 0; i < list.length; i++) { r.show(); r.answer(list[i].answer); r.next(); }
    const out = await r.finishStage();
    assert.equal(out.hasMore, false, 'kiểm tra lại chỉ có MỘT chặng');
    assert.equal(store.getItem('cx:b1'), savedBefore,
      'trạng thái lượt chính không được đè trong lúc kiểm tra lại');
  });
});

describe('xét đạt (verdict)', () => {
  test('lượt chính: gửi đúng các phiên chặng ĐÃ CHỐT', async () => {
    const { r, api } = await run({ questions: Array.from({ length: 15 }, (_, i) => mcq(i)) });
    await playStage(r); await r.nextStage(); await playStage(r);
    await r.verdict();
    const v = api.calls.post.filter((c) => c.path === '/api/quiz/course/verdict');
    assert.equal(v.length, 1);
    assert.deepEqual(v[0].body, { bank_id: 'b1', session_ids: ['sess-1', 'sess-2'] });
  });

  test('chặng không chốt được thì KHÔNG có tên trong lượt xét', async () => {
    const { r, api } = await run({
      questions: Array.from({ length: 5 }, (_, i) => mcq(i)), failPatch: true,
    });
    const out = await playStage(r);
    assert.equal(out.persisted, false);
    await r.verdict();
    const v = api.calls.post.filter((c) => c.path === '/api/quiz/course/verdict');
    assert.deepEqual(v[0].body.session_ids, [],
      'phiên chưa completed mà nêu tên là server bác cả lượt');
  });

  test('kiểm tra lại: gửi đúng MỘT phiên của nó', async () => {
    const { r, api } = await run({ questions: Array.from({ length: 6 }, (_, i) => mcq(i)) });
    await playStage(r);                        // sess-1 (run)
    await r.startRetake(3, lcg(4));            // sess-2 (retake)
    const list = r.stageQuestions();
    for (let i = 0; i < list.length; i++) { r.show(); r.answer(list[i].answer); r.next(); }
    await r.finishStage();
    await r.verdict();
    const v = api.calls.post.filter((c) => c.path === '/api/quiz/course/verdict');
    assert.deepEqual(v[0].body.session_ids, ['sess-2']);
  });

  test('runSessions sống qua reload (localStorage)', async () => {
    const store = memStore();
    const first = await run({ storage: store, questions: Array.from({ length: 5 }, (_, i) => mcq(i)) });
    await playStage(first.r);
    // mở lại trang: runner mới, cùng storage
    const second = await run({ storage: store, questions: Array.from({ length: 5 }, (_, i) => mcq(i)) });
    await second.r.verdict();
    const v = second.api.calls.post.filter((c) => c.path === '/api/quiz/course/verdict');
    assert.deepEqual(v[0].body.session_ids, ['sess-1'],
      'đóng tab ở màn kết quả rồi mở lại vẫn xét được lượt đã làm');
  });
});

describe('F5 ở màn kết quả cuối (codex #928)', () => {
  test('không mở phiên mới, không chốt lại, lượt xét giữ nguyên', async () => {
    const store = memStore();
    const qsn = Array.from({ length: 5 }, (_, i) => mcq(i));   // 1 chặng duy nhất
    const first = await run({ storage: store, questions: qsn });
    await playStage(first.r);                                  // done cuối, sess-1
    // mở lại trang: runner MỚI, cùng storage — đứng ngay màn kết quả
    const second = await run({ storage: store, questions: qsn });
    const opened = second.api.calls.post.filter((c) => c.path === '/api/quiz/sessions');
    assert.equal(opened.length, 0, 'màn kết quả không có gì để ghi — mở phiên là đẻ rác');
    // trang sẽ gọi finishStage lần nữa (isStageDone) — phải vô hại
    const res = await second.r.finishStage();
    assert.equal(res.persisted, true);
    assert.equal(second.api.calls.patch.length, 0, 'không được chốt một phiên không tồn tại');
    await second.r.verdict();
    const v = second.api.calls.post.filter((c) => c.path === '/api/quiz/course/verdict');
    assert.deepEqual(v[0].body.session_ids, ['sess-1'],
      'mỗi lần F5 mà lượt xét phình thêm phiên là điểm bị pha loãng');
  });

  test('khôi phục GIỮA bài (chưa xong) thì vẫn mở phiên như cũ', async () => {
    const store = memStore();
    const qsn = Array.from({ length: 15 }, (_, i) => mcq(i));  // 2 chặng
    const first = await run({ storage: store, questions: qsn });
    await playStage(first.r);                                  // xong chặng 1/2
    const second = await run({ storage: store, questions: qsn });
    const opened = second.api.calls.post.filter((c) => c.path === '/api/quiz/sessions');
    assert.equal(opened.length, 1, 'chặng 2 còn phải làm — phiên là bắt buộc');
  });
});

/**
 * Phần TỰ LUẬN của bài tập theo buổi — lớp logic, chạy thật.
 *
 * Ba luật của người dùng, và cả ba đều là chỗ mất mát không lấy lại được nếu
 * hỏng: nộp MỘT lần, đủ câu mới nhận, và chưa-chấm-được khác câu-của-em-đúng.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createWriting, inlineDiff, md, draftKey } from '../public/js/course-writing.js';

function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m,
  };
}

const Q = (qid, over = {}) => ({ qid, prompt: `Viết lại: ${qid}`, subtype: 'E1', ...over });

function fakeApi({ questions = [Q('E1'), Q('E2')], submitted = false,
                   submission = null, onPost } = {}) {
  const calls = { get: [], post: [] };
  return {
    calls,
    async get(path) { calls.get.push(path); return { questions, submitted, submission }; },
    async post(path, body) {
      calls.post.push({ path, body });
      if (onPost) return onPost(body);
      return { items: [], total: questions.length, clean: questions.length };
    },
  };
}

async function load(opts = {}) {
  const api = fakeApi(opts);
  const storage = opts.storage || memStore();
  const w = createWriting({ api, storage });
  await w.load('b1');
  return { w, api, storage };
}

// ── Sai → sửa trên cùng một dòng ─────────────────────────────────────────────

describe('inlineDiff', () => {
  test('chỉ đánh dấu phần THẬT SỰ đổi', () => {
    const out = inlineDiff('The buildings very modern.', 'The buildings are very modern.');
    assert.match(out, /<ins>are <\/ins>/);
    assert.ok(!/<del>/.test(out), 'không có gì bị xoá thì đừng vẽ gạch bỏ');
    assert.match(out, /^The buildings /);
  });

  test('thay một từ thì gạch từ cũ, viết từ mới', () => {
    const out = inlineDiff('She go to school.', 'She goes to school.');
    assert.match(out, /<del>go<\/del>/);
    assert.match(out, /<ins>goes<\/ins>/);
  });

  test('câu không đổi thì không có dấu nào', () => {
    const out = inlineDiff('I am fine.', 'I am fine.');
    assert.equal(out, 'I am fine.');
  });

  test('so theo TỪ, không theo ký tự', () => {
    // So ký tự sẽ biến gần cả câu thành đỏ vì lệch một chữ ở đầu.
    const out = inlineDiff('a bb ccc dddd', 'a bb XXX dddd');
    assert.match(out, /<del>ccc<\/del>/);
    assert.ok(out.startsWith('a bb '), 'phần đầu giống nhau phải giữ nguyên');
    assert.ok(out.endsWith(' dddd'), 'phần cuối giống nhau phải giữ nguyên');
  });

  test('HTML trong bài học viên bị thoát', () => {
    const out = inlineDiff('<script>x</script>', '<script>y</script>');
    assert.ok(!out.includes('<script>'));
    assert.ok(out.includes('&lt;script&gt;'));
  });
});

// ── Đủ câu mới nhận ──────────────────────────────────────────────────────────

describe('đủ câu mới nộp được', () => {
  test('thiếu câu thì KHÔNG gọi mạng — lượt chấm chỉ có một', async () => {
    const { w, api } = await load();
    w.write('E1', 'I am a student.');
    const r = await w.submit();
    assert.deepEqual(r.missing, ['E2']);
    assert.equal(api.calls.post.length, 0, 'không được tiêu lượt chấm cho bài dở');
  });

  test('khoảng trắng không tính là đã viết', async () => {
    const { w } = await load();
    w.write('E1', 'ok'); w.write('E2', '   \n ');
    assert.deepEqual((await w.submit()).missing, ['E2']);
  });

  test('đủ câu thì gửi đúng bộ câu trả lời, đã cắt khoảng trắng thừa', async () => {
    const { w, api } = await load();
    w.write('E1', '  I am a student.  ');
    w.write('E2', 'She works here.');
    await w.submit();
    assert.equal(api.calls.post.length, 1);
    assert.deepEqual(api.calls.post[0].body.answers,
      { E1: 'I am a student.', E2: 'She works here.' });
  });
});

// ── Một lượt duy nhất ────────────────────────────────────────────────────────

describe('nộp một lần', () => {
  test('đã nộp thì không gửi lần nữa', async () => {
    const { w, api } = await load();
    w.write('E1', 'a'); w.write('E2', 'b');
    await w.submit();
    const again = await w.submit();
    assert.deepEqual(again, { already: true });
    assert.equal(api.calls.post.length, 1);
  });

  test('trạng thái đã-nộp do SERVER giữ, không phải localStorage', async () => {
    // Xoá bộ nhớ trình duyệt không được biến một lượt đã dùng thành lượt mới.
    const { w } = await load({ submitted: true, submission: { items: [], total: 2, clean: 2 } });
    assert.equal(w.submitted, true);
    assert.deepEqual(await w.submit(), { already: true });
  });
});

// ── Nháp ─────────────────────────────────────────────────────────────────────

describe('bản nháp', () => {
  test('gõ tới đâu lưu tới đó, mở lại còn nguyên', async () => {
    const storage = memStore();
    const a = await load({ storage });
    a.w.write('E1', 'câu đang viết dở');
    const b = await load({ storage });
    assert.equal(b.w.draft.E1, 'câu đang viết dở');
    assert.deepEqual(b.w.missing, ['E2']);
  });

  test('nháp khoá theo BANK — hai bài không đè nhau', async () => {
    assert.notEqual(draftKey('b1'), draftKey('b2'));
  });

  test('nộp xong thì XOÁ nháp', async () => {
    const storage = memStore();
    const { w } = await load({ storage });
    w.write('E1', 'a'); w.write('E2', 'b');
    await w.submit();
    assert.equal(storage.getItem(draftKey('b1')), null);
  });

  test('mở lại một bài ĐÃ NỘP thì nháp cũ bị dọn, không đè lên bài đã chấm', async () => {
    const storage = memStore();
    storage.setItem(draftKey('b1'), JSON.stringify({ E1: 'rác cũ' }));
    const { w } = await load({ storage, submitted: true,
                              submission: { items: [], total: 2, clean: 0 } });
    assert.deepEqual(w.draft, {});
    assert.equal(storage.getItem(draftKey('b1')), null);
  });

  test('bộ nhớ trình duyệt bị chặn thì vẫn viết và nộp được', async () => {
    const blocked = { getItem() { throw new Error('chặn'); },
                      setItem() { throw new Error('chặn'); },
                      removeItem() { throw new Error('chặn'); } };
    const { w, api } = await load({ storage: blocked });
    w.write('E1', 'a'); w.write('E2', 'b');
    await w.submit();
    assert.equal(api.calls.post.length, 1);
  });
});

// ── Vẽ ───────────────────────────────────────────────────────────────────────

describe('màn hình', () => {
  test('màn viết: mỗi câu một ô nhập, mang đúng qid', async () => {
    const { w } = await load();
    const html = w.renderForm();
    assert.match(html, /data-qid="E1"/);
    assert.match(html, /data-qid="E2"/);
    assert.match(html, /id="cw-submit"/);
    assert.match(html, /chỉ nộp được một lần|Chỉ nộp được một lần/i);
  });

  test('còn thiếu thì cho NHẢY THẲNG tới câu ấy, không chỉ đếm số', async () => {
    const { w } = await load();
    w.write('E1', 'xong');
    const note = w.renderNote();
    assert.match(note, /Còn <strong>1<\/strong>/);
    assert.match(note, /href="#cw-E2"/);
  });

  test('đủ câu thì dòng trạng thái nói đủ, không còn đường nhảy', async () => {
    const { w } = await load();
    w.write('E1', 'a'); w.write('E2', 'b');
    const note = w.renderNote();
    assert.match(note, /2\/2/);
    assert.ok(!note.includes('href='));
  });

  test('màn đã chấm: câu sai hiện sai→sửa cùng một dòng + lý do', async () => {
    const { w } = await load({
      submitted: true,
      questions: [Q('E1', { explain: '**Đáp án mẫu:** The buildings are very modern.' })],
      submission: { total: 1, clean: 0, items: [{
        qid: 'E1', answer: 'The buildings very modern.',
        corrected: 'The buildings are very modern.', ok: false,
        issues: [{ type: 'grammar', before: '', after: 'are', note: 'Thiếu động từ be.' }],
      }] },
    });
    const html = w.renderResult();
    assert.match(html, /<ins>are <\/ins>/);
    assert.match(html, /ngữ pháp/);
    assert.match(html, /Thiếu động từ be/);
    assert.match(html, /data-ok="false"/);
    assert.match(html, /Đáp án mẫu/, 'đáp án mẫu chỉ hiện sau khi đã nộp');
  });

  test('câu đúng thì nói KHÔNG CÓ LỖI, không vẽ diff rỗng', async () => {
    const { w } = await load({
      submitted: true, questions: [Q('E1')],
      submission: { total: 1, clean: 1, items: [{
        qid: 'E1', answer: 'I am fine.', corrected: 'I am fine.', ok: true, issues: [] }] },
    });
    const html = w.renderResult();
    assert.match(html, /Không có lỗi/);
    assert.match(html, /data-ok="true"/);
  });

  test('CHƯA CHẤM ĐƯỢC khác hẳn câu-của-em-đúng', async () => {
    // Đây là điều tệ nhất phần này có thể làm: khen một câu chưa ai đọc.
    const { w } = await load({
      submitted: true, questions: [Q('E1')],
      submission: { total: 1, clean: 0, items: [{
        qid: 'E1', answer: 'x', corrected: null, ok: null,
        error: 'Bộ chấm tạm thời không dùng được.' }] },
    });
    const html = w.renderResult();
    assert.match(html, /data-ok="null"/);
    assert.match(html, /Bộ chấm tạm thời không dùng được/);
    assert.ok(!/Không có lỗi/.test(html), 'không được đọc thành lời khen');
  });
});

// ── Dây nối ở trang (codex #935) ────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = readFileSync(join(
  dirname(fileURLToPath(import.meta.url)), '..', 'app', '(authed)',
  'course-exercises', 'course-behavior.tsx'), 'utf8');

describe('màn kết luận không được vẽ TRƯỚC khi biết có phần tự luận không', () => {
  test('giữ LỜI HỨA của lượt nạp, không chỉ một cờ', () => {
    // Cờ `false` lúc vẽ làm nút "Làm phần tự luận" biến mất vĩnh viễn cho tới
    // khi học viên tự tải lại trang và thắng cuộc đua.
    assert.match(PAGE, /const writingLoaded = writing\.load\(bankId\)/);
    const i = PAGE.indexOf('async function renderVerdict');
    const body = PAGE.slice(i, i + 700);
    assert.ok(/await writingLoaded;/.test(body), 'renderVerdict phải chờ lượt nạp ấy');
    assert.ok(body.indexOf('await writingLoaded;') < body.indexOf('runner.verdict()'),
      'chờ phải đứng TRƯỚC lúc dựng nội dung');
  });

  test('lượt nạp hỏng KHÔNG treo màn kết luận', () => {
    // `catch` phải nuốt, nếu không `await` sẽ ném và học viên không thấy điểm.
    const i = PAGE.indexOf('const writingLoaded');
    assert.match(PAGE.slice(i, i + 300), /\.catch\(/);
  });

  test('bank chỉ có tự luận vào THẲNG màn tự luận', () => {
    assert.match(PAGE, /if \(!runner\.total && runner\.hasWriting\)/);
  });
});

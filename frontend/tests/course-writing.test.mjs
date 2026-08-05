/**
 * Phần TỰ LUẬN của bài tập theo buổi — lớp logic, chạy thật.
 *
 * Ba luật của người dùng, và cả ba đều là chỗ mất mát không lấy lại được nếu
 * hỏng: nộp MỘT lần, đủ câu mới nhận, và chưa-chấm-được khác câu-của-em-đúng.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createWriting, inlineDiff, md, draftKey, PUSH_DELAY_MS }
  from '../public/js/course-writing.js';

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
                   submission = null, itemId = 'it1', onPost, draft = null,
                   failDraft = false, draftUnavailable = false } = {}) {
  const calls = { get: [], post: [] };
  return {
    calls,
    // Bản nháp máy chủ giữ — mặc định "chưa có gì", đúng với một em mở lần đầu.
    get drafts() { return calls.post.filter((c) => c.path.includes('/writing/draft')); },
    async get(path) {
      calls.get.push(path);
      return { questions, submitted, submission, item_id: itemId, draft,
               draft_unavailable: draftUnavailable };
    },
    // `postWith` là đường có `keepalive` THẬT. Máy chủ giả phải phân biệt được
    // hai đường, không thì chốt keepalive chẳng chứng minh gì.
    async postWith(path, body, _h, opts) {
      calls.post.push({ path, body, opts });
      if (path.includes('/writing/draft')) {
        if (failDraft) throw new Error('mạng hỏng');
        return { saved: Object.keys(body.answers || {}).length };
      }
      return {};
    },
    async post(path, body) {
      calls.post.push({ path, body });
      if (path.includes('/writing/draft')) {
        if (failDraft) throw new Error('mạng hỏng');
        return { saved: Object.keys(body.answers || {}).length };
      }
      if (onPost) return onPost(body);
      return { items: [], total: questions.length, clean: questions.length };
    },
  };
}

async function load(opts = {}) {
  const api = fakeApi(opts);
  const storage = opts.storage || memStore();
  const w = createWriting({ api, storage, userId: opts.userId || 'u1' });
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

  test('nháp khoá theo BANK — hai bài không đè nhau', () => {
    assert.notEqual(draftKey('b1', 'u1', 'it1'), draftKey('b2', 'u1', 'it1'));
  });

  test('nháp khoá theo MỤC BÀI GIAO — giao lại là lượt mới, không rót nháp cũ', async () => {
    // Cùng học viên, cùng bộ bài, bài giao KHÁC: nháp của lần trước mà chảy
    // sang lần này thì nộp nhầm bài cũ dưới mục mới.
    assert.notEqual(draftKey('b1', 'u1', 'it-CU'), draftKey('b1', 'u1', 'it-MOI'));
    const storage = memStore();
    const a = await load({ storage, itemId: 'it-CU' });
    a.w.write('E1', 'bài của lần giao trước');
    const b = await load({ storage, itemId: 'it-MOI' });
    assert.equal(b.w.draft.E1, undefined);
  });

  test('nháp khoá theo NGƯỜI DÙNG — hai học viên chung máy không đọc bài nhau', () => {
    // localStorage là bộ nhớ CHUNG của trình duyệt, không phải của tài khoản.
    assert.notEqual(draftKey('b1', 'u1', 'it1'), draftKey('b1', 'u2', 'it1'));
  });

  test('học viên khác mở cùng bank thì KHÔNG thấy nháp của người trước', async () => {
    const storage = memStore();
    const a = await load({ storage, userId: 'u1' });
    a.w.write('E1', 'bài của bạn A');
    const b = await load({ storage, userId: 'u2' });
    assert.equal(b.w.draft.E1, undefined, 'nộp nhầm bài người khác là mất mát không sửa được');
  });

  test('nộp xong thì XOÁ nháp', async () => {
    const storage = memStore();
    const { w } = await load({ storage });
    w.write('E1', 'a'); w.write('E2', 'b');
    await w.submit();
    assert.equal(storage.getItem(draftKey('b1', 'u1', 'it1')), null);
  });

  test('mở lại một bài ĐÃ NỘP thì nháp cũ bị dọn, không đè lên bài đã chấm', async () => {
    const storage = memStore();
    storage.setItem(draftKey('b1', 'u1', 'it1'), JSON.stringify({ E1: 'rác cũ' }));
    const { w } = await load({ storage, submitted: true,
                              submission: { items: [], total: 2, clean: 0 } });
    assert.deepEqual(w.draft, {});
    assert.equal(storage.getItem(draftKey('b1', 'u1', 'it1')), null);
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

describe('màn đã chấm dựng từ BẢN CHỤP, không từ đề hiện hành (codex #935)', () => {
  test('câu bị XOÁ khỏi bộ đề vẫn còn trong bản chấm', async () => {
    // Bộ đề CÓ THỂ được soạn lại — Buổi 1 vừa đổi 31/100 câu. Lấy đề hiện hành
    // làm gốc thì bài học viên đã nộp biến mất khỏi màn hình.
    const { w } = await load({
      submitted: true,
      questions: [],                                  // đề đã bị soạn lại, mất E1
      submission: { total: 1, clean: 1, items: [{
        qid: 'E1', prompt: 'Viết lại: E1 (đề lúc nộp)',
        answer: 'I am fine.', corrected: 'I am fine.', ok: true, issues: [] }] },
    });
    const html = w.renderResult();
    assert.match(html, /I am fine\./);
    assert.match(html, /đề lúc nộp/, 'đề phải lấy từ bản chụp');
  });

  test('câu giữ mã nhưng ĐỔI ĐỀ thì hiện đề LÚC NỘP, không phải đề mới', async () => {
    const { w } = await load({
      submitted: true,
      questions: [Q('E1', { prompt: 'ĐỀ MỚI hoàn toàn khác' })],
      submission: { total: 1, clean: 0, items: [{
        qid: 'E1', prompt: 'đề lúc nộp', answer: 'x', corrected: 'y',
        ok: false, issues: [] }] },
    });
    const html = w.renderResult();
    assert.match(html, /đề lúc nộp/);
    assert.ok(!html.includes('ĐỀ MỚI'), 'hiện bài cũ dưới đề mới là nói dối cả hai phía');
  });

  test('đáp án mẫu lấy từ BẢN CHỤP, không từ đề hiện hành (codex #935)', async () => {
    const { w } = await load({
      submitted: true,
      questions: [Q('E1', { explain: 'ĐÁP ÁN MẪU CỦA ĐỀ MỚI' })],
      submission: { total: 1, clean: 1, items: [{
        qid: 'E1', prompt: 'đề lúc nộp', explain: 'đáp án mẫu LÚC NỘP',
        answer: 'x', corrected: 'x', ok: true, issues: [] }] },
    });
    const html = w.renderResult();
    assert.match(html, /đáp án mẫu LÚC NỘP/);
    assert.ok(!html.includes('ĐỀ MỚI'), 'ghép bài cũ với đáp án mẫu của đề khác là nói dối');
  });
});

describe('bản nháp sống trên MÁY CHỦ, không chỉ trong một trình duyệt', () => {
  // Tới nay nháp chỉ nằm trong `localStorage`: đổi máy, xoá bộ nhớ trình duyệt,
  // hay dùng máy phòng lab là mất trắng — và phần tự luận chỉ có MỘT lượt nộp
  // nên học viên thường viết dần trong nhiều buổi.

  const tick = () => new Promise((r) => setTimeout(r, PUSH_DELAY_MS + 40));

  test('gõ xong thì đẩy lên máy chủ, KHÔNG phải mỗi phím', async () => {
    const { w, api } = await load();
    w.write('E1', 'M');
    w.write('E1', 'Một');
    w.write('E1', 'Một câu');
    assert.equal(api.drafts.length, 0, 'chưa ngừng gõ thì chưa gửi');
    await tick();
    assert.equal(api.drafts.length, 1, 'ba phím → MỘT request');
    assert.deepEqual(api.drafts[0].body.answers, { E1: 'Một câu' });
  });

  test('rời trang thì đẩy NGAY, không chờ hết đếm ngược', async () => {
    // Đóng tab đúng lúc đang đếm ngược là mất đoạn vừa gõ — mà đoạn vừa gõ mới
    // là đoạn em ấy nhớ nhất.
    const { w, api } = await load();
    w.write('E1', 'vừa gõ xong thì đóng tab');
    await w.flushDraft();
    assert.equal(api.drafts.length, 1);
    assert.deepEqual(api.drafts[0].body.answers, { E1: 'vừa gõ xong thì đóng tab' });
  });

  test('máy chủ CÓ nháp thì máy chủ thắng — đây là bản sống qua đổi máy', async () => {
    const store = memStore();
    store.setItem(draftKey('b1', 'u1', 'it1'), JSON.stringify({ E1: 'bản cũ trên máy này' }));
    const { w } = await load({ storage: store, draft: { answers: { E1: 'bản trên máy chủ' } } });
    assert.equal(w.draft.E1, 'bản trên máy chủ');
  });

  test('máy chủ RỖNG mà máy này có nháp thì đẩy lên ngay', async () => {
    // Không làm thế thì bản đang gõ dở trên máy quen biến mất ngay lần mở đầu
    // tiên sau khi lên bản mới.
    const store = memStore();
    store.setItem(draftKey('b1', 'u1', 'it1'), JSON.stringify({ E1: 'đang viết dở' }));
    const { w, api } = await load({ storage: store, draft: null });
    assert.equal(w.draft.E1, 'đang viết dở');
    assert.equal(api.drafts.length, 1, 'phải cứu bản cũ lên máy chủ');
    assert.deepEqual(api.drafts[0].body.answers, { E1: 'đang viết dở' });
  });

  test('không có gì để đẩy thì KHÔNG gọi mạng', async () => {
    const { api } = await load();
    await tick();
    assert.equal(api.drafts.length, 0);
  });

  test('nội dung không đổi thì không gửi lại', async () => {
    const { w, api } = await load();
    w.write('E1', 'x');
    await tick();
    w.write('E1', 'x');
    await tick();
    assert.equal(api.drafts.length, 1, 'gõ rồi xoá rồi gõ lại y hệt = một lần gửi');
  });

  test('đã NỘP thì không đẩy nháp nữa', async () => {
    // Một lượt chấm duy nhất: sau khi chấm, ghi tiếp chỉ tạo một bản nháp mãi
    // mãi không ai đọc, nằm cạnh bài đã chấm như thể còn sửa được.
    const { w, api } = await load({ submitted: true,
                                    submission: { items: [], total: 2, clean: 2 } });
    w.write('E1', 'cố gõ thêm');
    await tick();
    await w.flushDraft();
    assert.equal(api.drafts.length, 0);
  });

  test('máy chủ hỏng thì vẫn viết được, và lần sau gửi LẠI', async () => {
    const { w, api } = await load({ failDraft: true });
    w.write('E1', 'câu một');
    await tick();
    assert.equal(api.drafts.length, 1, 'đã thử');
    assert.equal(w.draft.E1, 'câu một', 'hỏng mạng không được nuốt bài của em ấy');
    w.write('E1', 'câu một');            // y hệt — nhưng lần trước HỎNG
    await tick();
    assert.equal(api.drafts.length, 2, 'gửi hỏng thì lần sau phải gửi lại');
  });
});

describe('ba ca lệch nhau giữa hai máy (codex PR 949)', () => {
  const tick = () => new Promise((r) => setTimeout(r, PUSH_DELAY_MS + 40));

  test('máy chủ có dòng RỖNG cũng thắng — xoá là xoá thật', async () => {
    // Em ấy xoá sạch bài trên máy A. Máy chủ giữ một dòng `{}`. Máy B còn nháp
    // cũ mà đọc dòng ấy thành "máy chủ chưa có gì" sẽ DỰNG LẠI đúng những câu
    // em ấy vừa xoá — và đẩy chúng lên đè bản đã xoá.
    const store = memStore();
    store.setItem(draftKey('b1', 'u1', 'it1'), JSON.stringify({ E1: 'câu đã xoá' }));
    const { w, api } = await load({ storage: store, draft: { answers: {} } });
    assert.deepEqual(w.draft, {}, 'không được dựng lại thứ đã xoá');
    await tick();
    assert.equal(api.drafts.length, 0, 'và không được đẩy bản cũ lên đè');
  });

  test('LƯU TỰ ĐỘNG nối đuôi, không chồng lên nhau', () => {
    // Hai lượt lưu tự động bắn song song có thể tới máy chủ ngược thứ tự. Lượt
    // rời trang thì KHÁC: nó bắn ngay (xem chốt dưới), và `seq` lo phần thứ tự.
    let live = 0;
    let overlapped = false;
    const order = [];
    const api = fakeApi();
    const raw = api.post.bind(api);
    api.post = async (path, body) => {
      if (!String(path).includes('/writing/draft')) return raw(path, body);
      live += 1;
      if (live > 1) overlapped = true;
      await new Promise((r) => setTimeout(r, 2000));
      order.push(body.answers.E1);
      live -= 1;
      return raw(path, body);
    };
    const w = createWriting({ api, storage: memStore(), userId: 'u1' });
    return w.load('b1').then(async () => {
      w.write('E1', 'một');
      await new Promise((r) => setTimeout(r, PUSH_DELAY_MS + 40));   // lượt 1 bay
      w.write('E1', 'hai');
      await new Promise((r) => setTimeout(r, PUSH_DELAY_MS + 40));   // lượt 2 xếp hàng
      await new Promise((r) => setTimeout(r, 2600));
      assert.equal(overlapped, false, 'hai lượt lưu tự động không được bay cùng lúc');
      assert.deepEqual(order, ['một', 'hai'], 'và phải tới ĐÚNG thứ tự');
    });
  });

  test('rời trang BẮN NGAY, không xếp sau lượt lưu tự động đang bay', async () => {
    // Xếp hàng thì trang có thể đóng TRƯỚC khi request kịp được tạo ra — và
    // `keepalive` không cứu được một request chưa tồn tại (codex PR 949 vòng 3).
    let release;
    const api = fakeApi();
    const raw = api.post.bind(api);
    api.post = async (path, body) => {
      if (!String(path).includes('/writing/draft')) return raw(path, body);
      await new Promise((r) => { release = r; });     // treo cho tới khi nhả
      return raw(path, body);
    };
    const w = createWriting({ api, storage: memStore(), userId: 'u1' });
    await w.load('b1');
    w.write('E1', 'đang lưu tự động');
    await new Promise((r) => setTimeout(r, PUSH_DELAY_MS + 40));
    assert.ok(release, 'lượt lưu tự động phải đang treo');

    w.write('E1', 'đoạn cuối cùng');
    w.flushDraft();
    await new Promise((r) => setTimeout(r, 20));
    const ka = api.calls.post.filter((c) => c.opts && c.opts.keepalive);
    assert.equal(ka.length, 1, 'phải bắn NGAY dù lượt kia còn treo');
    assert.equal(ka[0].body.answers.E1, 'đoạn cuối cùng');
    release();
  });

  test('gõ thêm trong lúc chờ thì lượt gửi mang bản MỚI NHẤT', async () => {
    const api = fakeApi();
    const raw = api.post.bind(api);
    api.post = async (path, body) => {
      await new Promise((r) => setTimeout(r, 25));
      return raw(path, body);
    };
    const w = createWriting({ api, storage: memStore(), userId: 'u1' });
    await w.load('b1');
    w.write('E1', 'một');
    await new Promise((r) => setTimeout(r, PUSH_DELAY_MS + 40));
    w.write('E1', 'hai');
    const p = new Promise((r) => setTimeout(r, PUSH_DELAY_MS + 40));
    w.write('E1', 'ba');                       // gõ thêm TRƯỚC khi lượt 2 rời máy
    await p;
    await new Promise((r) => setTimeout(r, 60));
    const sent = api.calls.post.filter((c) => c.path.includes('/writing/draft'));
    assert.equal(sent[sent.length - 1].body.answers.E1, 'ba',
      'chụp lúc XẾP HÀNG sẽ gửi đi "hai" — một bản đã cũ trước cả khi rời máy');
  });

  test('rời trang gửi bằng KEEPALIVE, không phải post thường', async () => {
    // Không có keepalive thì trình duyệt huỷ request giữa lúc đóng trang —
    // đúng ca đường này tồn tại để phục vụ.
    const { w, api } = await load();
    w.write('E1', 'đoạn cuối cùng');
    await w.flushDraft();
    const sent = api.calls.post.filter((c) => c.path.includes('/writing/draft'));
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].opts, { keepalive: true });
  });

  test('lưu tự động BÌNH THƯỜNG thì không cần keepalive', async () => {
    const { w, api } = await load();
    w.write('E1', 'gõ giữa chừng');
    await tick();
    const sent = api.calls.post.filter((c) => c.path.includes('/writing/draft'));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].opts, undefined);
  });
});

describe('KHÔNG ĐỌC ĐƯỢC khác CHƯA CÓ GÌ (codex PR 949 vòng 2)', () => {
  const tick = () => new Promise((r) => setTimeout(r, PUSH_DELAY_MS + 40));

  test('máy chủ đọc hỏng thì KHÔNG đẩy bản cục bộ lên đè', async () => {
    // Một lỗi đọc tạm thời không được biến thành mất dữ liệu vĩnh viễn: dòng
    // thật trên máy chủ có thể mới hơn nhiều so với bản trong máy này.
    const store = memStore();
    store.setItem(draftKey('b1', 'u1', 'it1'), JSON.stringify({ E1: 'bản cũ máy này' }));
    const { w, api } = await load({ storage: store, draft: null, draftUnavailable: true });
    assert.equal(w.draft.E1, 'bản cũ máy này', 'vẫn phải viết tiếp được');
    await tick();
    assert.equal(api.drafts.length, 0, 'nhưng KHÔNG được đẩy lên đè');
  });

  test('gõ TIẾP sau đó thì vẫn lưu — đó là bài mới của em ấy', async () => {
    const store = memStore();
    store.setItem(draftKey('b1', 'u1', 'it1'), JSON.stringify({ E1: 'cũ' }));
    const { w, api } = await load({ storage: store, draft: null, draftUnavailable: true });
    w.write('E1', 'cũ và phần vừa gõ thêm');
    await tick();
    assert.equal(api.drafts.length, 1, 'bài vừa gõ là bài thật, phải lưu');
  });

  test('máy chủ nói rõ CHƯA CÓ GÌ thì vẫn cứu bản cục bộ lên', async () => {
    // Ranh giới giữa hai ca: `draft: null` + không báo hỏng = biết chắc trống.
    const store = memStore();
    store.setItem(draftKey('b1', 'u1', 'it1'), JSON.stringify({ E1: 'đang viết dở' }));
    const { api } = await load({ storage: store, draft: null, draftUnavailable: false });
    assert.equal(api.drafts.length, 1);
  });
});

describe('hai chắn chống XOÁ NHẦM (codex PR 949 vòng 3)', () => {
  test('rời trang GIỮA LÚC ĐANG NẠP thì không gửi gì', async () => {
    // `bankId` đã đặt nhưng chưa biết máy chủ giữ gì, và `draft` còn rỗng: gửi
    // lúc ấy là đẩy `{}` lên ĐÈ một bản nháp thật. Chỉ cần mở trang trên mạng
    // chậm rồi chuyển app là mất sạch bài đã viết.
    let release;
    const api = fakeApi({ draft: { answers: { E1: 'bài thật trên máy chủ' }, seq: 7 } });
    const rawGet = api.get.bind(api);
    api.get = async (path) => {
      await new Promise((r) => { release = r; });
      return rawGet(path);
    };
    const w = createWriting({ api, storage: memStore(), userId: 'u1' });
    const loading = w.load('b1');
    await new Promise((r) => setTimeout(r, 10));
    await w.flushDraft();                       // rời trang khi GET còn bay
    assert.equal(api.drafts.length, 0, 'chưa nạp xong thì không được gửi gì');
    release();
    await loading;
  });

  test('số thứ tự GIEO MẦM từ máy chủ, không đặt lại về 0', async () => {
    // Tải lại trang mà đếm lại từ 0 thì mọi lượt gửi mới đều bị máy chủ coi là
    // bản cũ và bỏ qua — nháp đóng băng vĩnh viễn.
    const { w, api } = await load({ draft: { answers: { E1: 'cũ' }, seq: 12 } });
    w.write('E1', 'mới');
    await w.flushDraft();
    assert.equal(api.drafts.length, 1);
    assert.equal(api.drafts[0].body.seq, 13, 'phải tiếp tục từ con số máy chủ giữ');
  });

  test('mỗi lượt gửi mang số LỚN HƠN lượt trước', async () => {
    const { w, api } = await load();
    w.write('E1', 'a'); await w.flushDraft();
    w.write('E1', 'b'); await w.flushDraft();
    w.write('E1', 'c'); await w.flushDraft();
    const seqs = api.drafts.map((c) => c.body.seq);
    assert.deepEqual(seqs, [1, 2, 3]);
  });
});

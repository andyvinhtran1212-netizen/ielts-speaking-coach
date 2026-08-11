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
    w.arm();
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
    w.arm();
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
    w.arm();
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
    w.arm();
    await w.submit();
    assert.equal(api.calls.post.length, 1);
  });
});

// ── Vẽ ───────────────────────────────────────────────────────────────────────

describe('nộp phải qua HAI bước (nộp nhầm 07/08)', () => {
  // Em Lê Ngọc Hà Linh lưu nháp lúc 08:22:02 và nộp lúc 08:22:06. Bốn giây là
  // một cú bấm, không phải một quyết định — mà lượt nộp chỉ có MỘT và trong sản
  // phẩm không có đường lùi.
  const full = async (over = {}) => {
    const { w, api } = await load(over);
    w.write('E1', 'I am fine.'); w.write('E2', 'She works here.');
    return { w, api };
  };

  test('bấm Nộp một nhát KHÔNG gọi mạng — luật nằm ở module, không ở trang', async () => {
    const { w, api } = await full();
    const out = await w.submit();
    assert.deepEqual(out, { needsConfirm: true });
    assert.equal(api.calls.post.filter((c) => !c.path.includes('draft')).length, 0,
      'chưa xác nhận mà đã tiêu lượt nộp duy nhất');
  });

  test('xác nhận rồi mới nộp thật', async () => {
    const { w, api } = await full();
    assert.equal(w.arm(), true);
    const out = await w.submit();
    assert.ok(out.graded, 'đã xác nhận thì phải nộp được');
    assert.equal(api.calls.post.filter((c) => !c.path.includes('draft')).length, 1);
  });

  test('thiếu câu thì KHÔNG vào được bước xác nhận', async () => {
    const { w } = await load();
    w.write('E1', 'chỉ một câu');
    assert.equal(w.arm(), false);
    assert.equal(w.armed, false);
    assert.deepEqual(await w.submit(), { missing: ['E2'] });
  });

  test('gõ thêm một chữ là quay về bước một', async () => {
    // Lời xác nhận vừa rồi nói về một bài KHÁC với bài đang nằm trên màn hình.
    const { w } = await full();
    w.arm();
    assert.equal(w.armed, true);
    w.write('E1', 'I am fine, thanks.');
    assert.equal(w.armed, false, 'sửa bài rồi thì phải đọc lại và xác nhận lại');
    assert.deepEqual(await w.submit(), { needsConfirm: true });
  });

  test('bấm "đọc lại" đưa thanh nộp về bước một', async () => {
    const { w } = await full();
    w.arm();
    w.disarm();
    assert.match(w.renderBar(), /id="cw-submit"/);
    assert.ok(!/id="cw-confirm"/.test(w.renderBar()));
  });

  test('thanh nộp bước hai nói rõ hậu quả, và nút AN TOÀN đứng trước', async () => {
    const { w } = await full();
    w.arm();
    const html = w.renderBar();
    assert.match(html, /không sửa được nữa/);
    assert.match(html, /chỉ nộp được một lần/);
    assert.ok(html.indexOf('id="cw-cancel"') < html.indexOf('id="cw-confirm"'),
      'nút nộp thật không được là nút đầu tiên tay chạm tới');
    assert.ok(!/id="cw-submit"/.test(html));
  });

  test('bước một: nút TẮT khi còn thiếu câu, BẬT khi đã đủ', async () => {
    const { w } = await load();
    assert.match(w.renderBar(), /id="cw-submit"[^>]*disabled/);
    w.write('E1', 'a'); w.write('E2', 'b');
    assert.ok(!/disabled/.test(w.renderBar()));
  });
});

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

  test('đúng ngữ pháp mà còn lỗi trình bày: vẫn hiện chỗ sửa, KHÔNG đọc thành sai', async () => {
    // Em Hà Linh, 07/08: 8/10 câu bị trừ vì viết thường đầu câu. Giấu lời nhắc
    // đi là dạy sai; tô đỏ cả câu cũng là nói sai. Phải nói được cả hai.
    const { w } = await load({
      submitted: true, questions: [Q('E1')],
      submission: { total: 1, clean: 1, items: [{
        qid: 'E1', answer: 'i find the new timetable confusing',
        corrected: 'I find the new timetable confusing.', ok: true,
        issues: [{ type: 'mechanics', before: 'i', after: 'I',
                   note: "Đại từ 'I' luôn phải viết hoa." }] }] },
    });
    const html = w.renderResult();
    assert.match(html, /data-ok="true"/);
    assert.match(html, /data-form="true"/, 'phải phân biệt được với câu sạch hẳn');
    assert.match(html, /hình thức/, 'nhãn loại lỗi nói đúng tên nó');
    assert.match(html, /Đại từ 'I' luôn phải viết hoa|Đại từ &#39;I&#39;/,
      'lời nhắc vẫn phải tới tay em ấy');
    assert.match(html, /vẫn tính là đúng/);
    assert.match(html, /1 câu đúng ngữ pháp nhưng còn lỗi trình bày/);
    assert.ok(!/Không có lỗi/.test(html), 'còn chỗ phải sửa thì đừng nói là không có lỗi');
  });

  test('câu sai thật vẫn là sai, và con số đếm theo NGỮ PHÁP', async () => {
    const { w } = await load({
      submitted: true, questions: [Q('E1')],
      submission: { total: 2, clean: 1, items: [{
        qid: 'E1', answer: 'air pollution make him tired',
        corrected: 'Air pollution makes him tired.', ok: false,
        issues: [{ type: 'mechanics', before: 'air', after: 'Air' },
                 { type: 'grammar', before: 'make', after: 'makes' }] }] },
    });
    const html = w.renderResult();
    assert.match(html, /data-ok="false"/);
    assert.ok(!/data-form="true"/.test(html), 'có lỗi ngữ pháp thì không phải "chỉ lỗi hình thức"');
    assert.match(html, /1<small>\/ 2 câu đúng ngữ pháp/);
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

describe('dây nối bước xác nhận ở trang', () => {
  // Chốt thật nằm trong module (`submit()` từ chối khi chưa xác nhận), nhưng
  // nếu trang nối sai thì lỗi lại thành "bấm mãi không nộp được" — im lặng và
  // tệ ngang. Ba nút, ba việc, và cả ba phải có mặt.
  test('cw-submit MỞ bước xác nhận, không nộp thẳng', () => {
    assert.match(PAGE, /t\.id === 'cw-submit'\) return onWritingArm\(\)/);
  });

  test('cw-cancel về bước một, cw-confirm mới gọi lượt nộp', () => {
    assert.match(PAGE, /t\.id === 'cw-cancel'\) \{ writing\.disarm\(\);/);
    assert.match(PAGE, /t\.id === 'cw-confirm'\) return void onWritingSubmit\(\)/);
  });

  test('vẽ lại CẢ thanh nộp, không riêng dòng chữ', () => {
    // Nút và trạng thái tắt/bật nằm cùng một khối do module dựng; vá riêng dòng
    // chữ là để nút nói một đằng, trạng thái một nẻo.
    const i = PAGE.indexOf('function syncWritingNote');
    assert.match(PAGE.slice(i, i + 300), /writing\.renderBar\(\)/);
  });

  test('con trỏ về nút AN TOÀN sau khi mở bước xác nhận', () => {
    const i = PAGE.indexOf('function onWritingArm');
    assert.match(PAGE.slice(i, i + 900), /cw-cancel'\)[\s\S]{0,60}\.focus\(\)/);
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

describe('bản nháp: máy đang gõ là nguồn thật, máy chủ là DỰ PHÒNG', () => {
  // Bản đầu cho máy chủ làm nguồn thật, và đẻ ra ba đường mất bài: tải lại
  // trang đè mất bản chưa gửi được, lượt ghi không-biết-thứ-tự đè lên bản thật,
  // và nếu lượt gửi cuối không kịp tạo thì bản duy nhất cũng mất.
  //
  // Đảo lại: máy này thắng khi nó có nội dung; máy chủ chỉ được đọc ra khi máy
  // này trống — đúng ca tính năng sinh ra để phục vụ.

  const tick = () => new Promise((r) => setTimeout(r, PUSH_DELAY_MS + 40));

  test('máy này CÓ bài thì máy chủ không đè lên được', async () => {
    // Ca mất bài số 1 của bản cũ: gửi hỏng rồi tải lại trang là mất đoạn vừa gõ.
    const store = memStore();
    store.setItem(draftKey('b1', 'u1', 'it1'), JSON.stringify({ E1: 'bản chưa gửi được' }));
    const { w } = await load({ storage: store,
                              draft: { answers: { E1: 'bản cũ trên máy chủ' } } });
    assert.equal(w.draft.E1, 'bản chưa gửi được');
  });

  test('máy này TRỐNG thì lấy bản dự phòng — đây là lý do tính năng tồn tại', async () => {
    const { w } = await load({ storage: memStore(),
                              draft: { answers: { E1: 'viết ở máy cũ' } } });
    assert.equal(w.draft.E1, 'viết ở máy cũ');
  });

  test('đọc hỏng cũng chỉ là "không có bản dự phòng"', async () => {
    // Không cần một cờ riêng: hai ca dẫn tới cùng một hành động.
    const store = memStore();
    store.setItem(draftKey('b1', 'u1', 'it1'), JSON.stringify({ E1: 'bài trong máy' }));
    const { w } = await load({ storage: store, draft: null });
    assert.equal(w.draft.E1, 'bài trong máy');
  });

  test('gõ xong thì sao lưu, KHÔNG phải mỗi phím', async () => {
    const { w, api } = await load();
    w.write('E1', 'M'); w.write('E1', 'Một'); w.write('E1', 'Một câu');
    assert.equal(api.drafts.length, 0, 'chưa ngừng gõ thì chưa gửi');
    await tick();
    assert.equal(api.drafts.length, 1, 'ba phím → MỘT request');
    assert.deepEqual(api.drafts[0].body.answers, { E1: 'Một câu' });
  });

  test('rời trang đẩy nốt bằng keepalive', async () => {
    const { w, api } = await load();
    w.write('E1', 'đoạn cuối');
    await w.flushDraft();
    const ka = api.calls.post.filter((c) => c.opts && c.opts.keepalive);
    assert.equal(ka.length, 1);
    assert.equal(ka[0].body.answers.E1, 'đoạn cuối');
  });

  test('mở trang trên mạng chậm rồi chuyển app: KHÔNG gửi gì', async () => {
    // `bankId` đã đặt nhưng chưa nạp xong, `draft` còn rỗng — gửi lúc ấy là đẩy
    // `{}` lên đè bản dự phòng.
    let release;
    const api = fakeApi({ draft: { answers: { E1: 'bản dự phòng thật' } } });
    const rawGet = api.get.bind(api);
    api.get = async (path) => { await new Promise((r) => { release = r; }); return rawGet(path); };
    const w = createWriting({ api, storage: memStore(), userId: 'u1' });
    const loading = w.load('b1');
    await new Promise((r) => setTimeout(r, 10));
    await w.flushDraft();
    assert.equal(api.drafts.length, 0);
    release(); await loading;
  });

  test('máy này có bài mà bản dự phòng khác đi thì sao lưu NGAY', async () => {
    const store = memStore();
    store.setItem(draftKey('b1', 'u1', 'it1'), JSON.stringify({ E1: 'đang viết dở' }));
    const { api } = await load({ storage: store, draft: null });
    assert.equal(api.drafts.length, 1);
    assert.deepEqual(api.drafts[0].body.answers, { E1: 'đang viết dở' });
  });

  test('bản dự phòng đã trùng thì không gửi lại', async () => {
    const store = memStore();
    store.setItem(draftKey('b1', 'u1', 'it1'), JSON.stringify({ E1: 'y hệt' }));
    const { api } = await load({ storage: store, draft: { answers: { E1: 'y hệt' } } });
    assert.equal(api.drafts.length, 0);
  });

  test('đã NỘP thì không sao lưu nữa', async () => {
    const { w, api } = await load({ submitted: true,
                                    submission: { items: [], total: 2, clean: 2 } });
    w.write('E1', 'cố gõ thêm');
    await tick(); await w.flushDraft();
    assert.equal(api.drafts.length, 0);
  });

  test('gửi hỏng thì bài vẫn còn, và lần sau gửi lại', async () => {
    const { w, api } = await load({ failDraft: true });
    w.write('E1', 'câu một');
    await tick();
    assert.equal(api.drafts.length, 1);
    assert.equal(w.draft.E1, 'câu một', 'hỏng mạng không được nuốt bài của em ấy');
    w.write('E1', 'câu một');
    await tick();
    assert.equal(api.drafts.length, 2, 'gửi hỏng thì lần sau phải gửi lại');
  });
});

describe('lưu tự động NỐI ĐUÔI (codex cục bộ 05/08)', () => {
  test('hai lượt không bay cùng lúc, và tới ĐÚNG thứ tự', async () => {
    // Bắn song song thì bản `upsert` đến sau kéo bản dự phòng LÙI về nội dung
    // cũ — `lastPushed` khi ấy vẫn là bản mới nên không có lần gửi lại, và một
    // máy khác sẽ khôi phục đúng bản cũ ấy.
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
    await w.load('b1');
    w.write('E1', 'một');
    await new Promise((r) => setTimeout(r, PUSH_DELAY_MS + 40));
    w.write('E1', 'hai');
    await new Promise((r) => setTimeout(r, PUSH_DELAY_MS + 40));
    await new Promise((r) => setTimeout(r, 2600));
    assert.equal(overlapped, false, 'hai lượt lưu tự động không được bay cùng lúc');
    assert.deepEqual(order, ['một', 'hai'], 'và phải tới ĐÚNG thứ tự');
  });

  test('gõ thêm trong lúc xếp hàng thì lượt gửi mang bản MỚI NHẤT', async () => {
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
    w.write('E1', 'ba');
    await p;
    await new Promise((r) => setTimeout(r, 60));
    const sent = api.calls.post.filter((c) => c.path.includes('/writing/draft'));
    assert.equal(sent[sent.length - 1].body.answers.E1, 'ba');
  });

  test('rời trang vẫn bắn NGAY dù lượt kia còn treo', async () => {
    let release;
    const api = fakeApi();
    const raw = api.post.bind(api);
    api.post = async (path, body) => {
      if (!String(path).includes('/writing/draft')) return raw(path, body);
      await new Promise((r) => { release = r; });
      return raw(path, body);
    };
    const w = createWriting({ api, storage: memStore(), userId: 'u1' });
    await w.load('b1');
    w.write('E1', 'đang lưu tự động');
    await new Promise((r) => setTimeout(r, PUSH_DELAY_MS + 40));
    assert.ok(release, 'lượt kia phải đang treo');
    w.write('E1', 'đoạn cuối cùng');
    w.flushDraft();
    await new Promise((r) => setTimeout(r, 20));
    const ka = api.calls.post.filter((c) => c.opts && c.opts.keepalive);
    assert.equal(ka.length, 1, 'phải tạo request NGAY, không xếp hàng');
    assert.equal(ka[0].body.answers.E1, 'đoạn cuối cùng');
    release();
  });
});

// ── Bộ chấm hỏng: lượt nộp KHÔNG bị tiêu ──────────────────────────────────
//
// Lượt nộp tự luận chỉ có MỘT. Ngày 06/08 model bị ngừng cấp và TÁM em mất
// lượt duy nhất — máy chủ nay trả 503 thay vì ghi một dòng rỗng, còn trang thì
// phải GIỮ NGUYÊN bài để em ấy bấm Nộp lại mà không gõ lại chữ nào.

describe('bộ chấm hỏng khi nộp', () => {
  // Mã câu phải là mã THẬT của bộ giả (`E1`/`E2`). Viết vào một mã không tồn
  // tại thì `submit()` thoát sớm vì "thiếu câu" và chốt chẳng gọi tới mạng —
  // xanh mà không kiểm gì.
  // `arm()` liền sau khi viết: bước xác nhận là chuyện của luồng bấm nút, còn
  // các ca dưới đây nói về chuyện xảy ra SAU khi đã xác nhận.
  const fill = (w) => { w.write('E1', 'câu một'); w.write('E2', 'câu hai'); w.arm(); };
  const draftKeys = (storage) =>
    [...storage._m.entries()].filter(([k]) => k.startsWith('cw:'));
  const boom = () => {
    const e = new Error('503');
    e.detail = { message: 'Bộ chấm đang không dùng được nên chưa chấm được bài '
      + 'của em. Bài vẫn còn nguyên — bấm Nộp lại sau ít phút.', grader_down: true };
    throw e;
  };

  test('bài KHÔNG bị xoá khỏi nháp', async () => {
    const { w, storage } = await load({ onPost: boom });
    fill(w);
    const before = JSON.stringify(draftKeys(storage));
    assert.notEqual(before, '[]', 'chưa có nháp thì chốt này vô nghĩa');
    await w.submit().catch(() => {});
    assert.equal(JSON.stringify(draftKeys(storage)), before,
      'xoá nháp là bắt em ấy gõ lại từ đầu');
  });

  test('và trang vẫn cho bấm Nộp lần nữa', async () => {
    const { w, api } = await load({ onPost: boom });
    fill(w);
    await w.submit().catch(() => {});
    const again = await w.submit().catch(() => null);
    assert.ok(!(again && again.already),
      'đánh dấu đã-nộp sau một lượt chấm hỏng là khoá em ấy ra khỏi bài của mình');
    assert.equal(api.calls.post.filter((c) => c.path === '/api/quiz/course/writing').length,
      2, 'lần bấm thứ hai phải THỰC SỰ gọi lại máy chủ');
  });

  test('nộp được thì mới xoá nháp', async () => {
    const { w, storage } = await load();
    fill(w);
    assert.equal(draftKeys(storage).length, 1, 'chưa có nháp thì chốt này vô nghĩa');
    await w.submit();
    assert.deepEqual(draftKeys(storage), [], 'nộp xong thì nháp hết việc');
  });
});

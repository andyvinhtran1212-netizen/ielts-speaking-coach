// Bản khai luồng ghi phải được kiểm ở ÍT NHẤT một vế.
//
// `nextPending` cho phép hoãn vế Next khi bản khai được dựng TRƯỚC trang (cách
// làm cố ý: khai từ legacy thì hợp đồng độc lập với bản port). Nhưng một cờ hoãn
// không có chốt là một lỗ trống chờ mục: gắn `nextPending` mà quên `legacyRoute`
// thì luồng đó không được kiểm ở ĐÂU CẢ, và cổng vẫn xanh — đúng họ lỗi "chốt
// tồn tại mà không bao giờ nổ" mà `workflow-path-coverage.test.mjs` sinh ra để
// diệt, chỉ khác lớp.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateFlow } from '../tooling/write-flow-core.mjs';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tooling', 'write-flows');
const files = readdirSync(DIR).filter((f) => f.endsWith('.mjs'));
const flows = await Promise.all(
  files.map(async (f) => ({ file: f, flow: (await import(path.join(DIR, f))).default })),
);

describe('bản khai luồng ghi', () => {
  test('có ít nhất một bản khai', () => {
    // Thư mục rỗng ⇒ mọi khẳng định dưới thành xanh-rỗng.
    assert.ok(flows.length >= 1, 'không đọc được bản khai nào');
  });

  for (const { file, flow } of flows) {
    test(`${file} — đủ trường bắt buộc`, () => {
      assert.ok(flow.name, 'thiếu `name`');
      assert.ok(flow.route, 'thiếu `route`');
      assert.ok(Array.isArray(flow.steps) && flow.steps.length, 'thiếu `steps`');
      assert.ok(Array.isArray(flow.writes), 'thiếu `writes` (mảng rỗng cũng được — nhưng phải KHAI)');
    });

    test(`${file} — không bị bỏ kiểm ở cả hai vế`, () => {
      if (!flow.nextPending) return;
      assert.equal(typeof flow.nextPending, 'string',
        '`nextPending` phải là LÝ DO dạng chuỗi, không phải `true` — cờ không lời giải thích sẽ nằm lại mãi');
      assert.ok(flow.legacyRoute,
        `${file} hoãn vế Next mà KHÔNG có \`legacyRoute\` ⇒ luồng này không được kiểm ở đâu cả`);
    });
  }

  test('Speaking dựng đủ canonical bootstrap qua staging forward rollback', () => {
    const speaking = flows.find(({ file }) => file === 'speaking-start.mjs')?.flow;
    assert.ok(speaking, 'thiếu bản khai speaking-start.mjs');

    const created = (speaking.canned || []).find(([re]) => re.test('http://localhost:8000/sessions'))?.[1];
    assert.match(created?.id || '', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      'session tạo mới phải dùng UUID hợp lệ như backend thật');

    const detailUrl = `http://localhost:8000/sessions/${created.id}`;
    const questionsUrl = `${detailUrl}/questions`;
    const detail = speaking.canned.find(([re]) => re.test(detailUrl))?.[1];
    const questions = speaking.canned.find(([re]) => re.test(questionsUrl))?.[1];
    assert.equal(detail?.id, created.id, 'fixture phải dựng canonical session cho player Next');
    assert.ok(Array.isArray(questions) && questions.length > 0,
      'fixture phải dựng câu hỏi để player Next không rơi vào đường sinh AI');
    assert.equal(speaking.expectFinalUrl,
      `/pages/practice.html?session_id=${created.id}`,
      'forward rollback phải đưa session mới về Legacy theo admission policy hiện tại');
    assert.ok(speaking.steps.some((step) =>
      step.expectText?.[0] === '#p2a-question'
      && step.expectText?.[1] === 'Describe a useful skill you learned.'
    ), 'luồng phải chờ player render câu hỏi, không chỉ chờ request tạo session');
    assert.ok(!(speaking.ignoreWrites || []).includes('/api/error-logs'),
      'không được tha error log — lỗi bootstrap thật phải làm cổng đỏ');
  });

  test('Writing claim renderer Next trước khi mở lượt làm bài', () => {
    const writing = flows.find(({ file }) => file === 'writing-submit.mjs')?.flow;
    assert.ok(writing, 'thiếu bản khai writing-submit.mjs');

    const claimPath = '/api/writing/my-assignments/asg-1/renderer-affinity';
    const startPath = '/api/writing/my-assignments/asg-1/start';
    const claimIndex = writing.writes.findIndex(({ method, path }) =>
      method === 'POST' && path === claimPath);
    const startIndex = writing.writes.findIndex(({ method, path }) =>
      method === 'POST' && path === startPath);
    assert.ok(claimIndex !== -1, 'phải khai write claim renderer affinity');
    assert.ok(startIndex !== -1 && claimIndex < startIndex,
      'claim renderer affinity phải đứng trước /start');
    assert.deepEqual(writing.writes[claimIndex].body, { renderer_affinity: 'next' });

    const cannedClaim = writing.canned.find(([re]) =>
      re.test(`http://localhost:8000${claimPath}`))?.[1];
    assert.deepEqual(cannedClaim, {
      assignment_id: 'asg-1',
      renderer_affinity: 'next',
    }, 'fixture claim phải trả renderer canonical để client tiếp tục');
  });
});


describe('lược đồ bản khai', () => {
  // Chốt TĨNH cho bộ kiểm mà bộ chạy trình duyệt cũng dùng. Có nó thì một bản
  // khai sai kiểu đỏ ngay ở `node --test`, không phải đợi tới lượt chạy cổng —
  // và quan trọng hơn: nó đỏ kể cả khi cổng ghi KHÔNG được kích hoạt bởi
  // `paths` của PR đó.
  test('mọi bản khai đều hợp lệ', () => {
    const bad = [];
    for (const { file, flow } of flows) {
      for (const e of validateFlow(flow)) bad.push(`${file}: ${e}`);
    }
    assert.deepEqual(bad, []);
  });

  test('`waitForWrites` khai đúng thì HỢP LỆ (có và không có hạn giờ)', () => {
    for (const v of [['/a', 2], ['/a', 2, 45000]]) {
      assert.deepEqual(validateFlow({ name: 'x', route: '/r',
        steps: [{ waitForWrites: v }], writes: [{ method: 'POST', path: '/a' }] }), []);
    }
  });

  test('`clickIfPresent` là bước selector hợp lệ cho khác biệt xác nhận legacy/Next', () => {
    assert.deepEqual(validateFlow({ name: 'x', route: '/r',
      steps: [{ clickIfPresent: '.confirm-modal button' }],
      writes: [{ method: 'POST', path: '/submit' }] }), []);
  });

  test('xoá trắng một ô là HỢP LỆ — `fill` được phép giá trị rỗng', () => {
    // Chiều ngược của mọi chốt ở trên: bộ kiểm chặt quá thì nó CHẶN việc đúng.
    // Ghi đè bản nháp bằng chuỗi rỗng chính là thứ `NON_EMPTY` sinh ra để bắt,
    // nên bản khai phải gõ được thao tác đó (codex cục bộ #973 vòng 4).
    const flow = { name: 'x', route: '/r', steps: [{ fill: ['#a', ''] }],
      writes: [{ method: 'POST', path: '/a' }] };
    assert.deepEqual(validateFlow(flow), []);
  });

  test('bộ kiểm KHÔNG BAO GIỜ ném — vật vào gì cũng trả về mảng lỗi', () => {
    // Một bộ kiểm ném lỗi giữa chừng thì các lỗi còn lại không ai thấy, và người
    // đọc nhận một stack trace thay vì danh sách việc (codex cục bộ #973 vòng 3).
    const junk = [null, undefined, 0, '', 'x', [], new Map(), new Date(),
      { name: 'x', steps: {} }, { name: 'x', writes: {} },
      { name: 'x', steps: [{ expectStorage: {} }] },
      { name: 'x', steps: [{ fill: 'khong-phai-mang' }] }];
    for (const j of junk) {
      const errs = validateFlow(j);
      assert.ok(Array.isArray(errs) && errs.length, `phải trả lỗi cho ${JSON.stringify(j)}`);
    }
  });

  test('bộ kiểm bắt được các cách khai hỏng', () => {
    // Bốn ca này là bốn vòng review liên tiếp cùng một loại lỗi: khai sai kiểu
    // thì `Object.entries` trả rỗng và bản khai qua âm thầm.
    const base = { name: 'x', route: '/r', steps: [{ click: '#a' }],
      writes: [{ method: 'POST', path: '/a' }] };
    const cases = [
      [{ ...base, expectFinalUrl: '' }, /expectFinalUrl/],
      [{ ...base, writes: [{ method: 'POST', path: '/a', bodyAll: true }] }, /bodyAll/],
      [{ ...base, writes: [{ method: 'POST', path: '/a', headers: new Map([['a', 'b']]) }] }, /headers/],
      [{ ...base, writes: [{ method: 'POST', path: '/a', headers: {} }] }, /KHÁC RỖNG/],
      [{ ...base, steps: [{ expectStorage: ['k', null] }] }, /expectStorage/],
      [{ ...base, ignoreWrite: [] }, /khoá lạ/],
      [{ ...base, steps: [{ clickk: '#a' }] }, /ĐÚNG MỘT hành động/],
      [{ ...base, steps: [{ clickIfPresent: '' }] }, /clickIfPresent/],
      // Vòng 3 codex: hình dạng BÊN TRONG mỗi hành động.
      [{ ...base, steps: [{ fill: ['#a'] }] }, /fill/],
      [{ ...base, steps: [{ dispatch: ['#a'] }] }, /dispatch/],
      [{ ...base, steps: [{ expectStorage: 'kv' }] }, /expectStorage/],
      [{ ...base, steps: [{ wait: -1 }] }, /wait/],
      [{ ...base, steps: [{ advance: 100 }] }, /fakeClock/],
      [{ ...base, writes: [{ method: 'POST', path: '/a', unordered: 'false' }] }, /unordered/],
      [{ ...base, writes: [{ method: 'POST', path: '/a', body: {} }] }, /body/],
      [{ ...base, writes: [{ method: 'POST', path: '/a', body: Symbol('go-nham') }] }, /body/],
      [{ ...base, steps: [{ click: '#a' }], writes: [] }, /writes/],
      [{ name: 'x', route: '/r', writes: [{ method: 'POST', path: '/a' }] }, /steps/],
      [{ ...base, canned: '' }, /canned/],
      [{ ...base, ignoreWrites: '' }, /ignoreWrites/],
      [{ ...base, settleMs: -5 }, /settleMs/],
      // Luồng không ghim đường ghi nào vẫn là LỖI — kể cả khi ý định là "không
      // được ghi gì". Ca đó cần một ĐỐI CHỨNG DƯƠNG chứ không phải một cờ miễn
      // trừ: không có đối chứng thì bản khai cũng xanh khi mã chưa chạy tới nơi.
      [{ name: 'x', route: '/r', steps: [{ click: '#a' }], writes: [] }, /mảng khác rỗng/],
      [{ ...base, initStorage: {} }, /initStorage/],
      [{ ...base, initStorage: { k: 1 } }, /initStorage/],
      [{ ...base, initSessionStorage: {} }, /initSessionStorage/],
      [{ ...base, initSessionStorage: { k: 1 } }, /initSessionStorage/],
      // `waitForWrites` — đồng bộ theo SỐ REQUEST thay cho đồng hồ tường.
      [{ ...base, steps: [{ waitForWrites: ['/a'] }] }, /waitForWrites/],
      [{ ...base, steps: [{ waitForWrites: ['/a', 0] }] }, /waitForWrites/],
      [{ ...base, steps: [{ waitForWrites: ['/a', 2.5] }] }, /waitForWrites/],
      [{ ...base, steps: [{ waitForWrites: ['', 2] }] }, /waitForWrites/],
      [{ ...base, steps: [{ waitForWrites: ['/a', 2, -1] }] }, /waitForWrites/],
      // Vòng 4 codex — ba ca có rủi ro THẬT (khác với các ca chỉ xảy ra khi cố
      // tình viết bản khai quái dị):
      // · `async` trả Promise, mà Promise LUÔN truthy ⇒ mọi thân request đều qua;
      [{ ...base, writes: [{ method: 'POST', path: '/a', body: async () => false }] }, /async/],
      [{ ...base, writes: [{ method: 'POST', path: '/a', bodyAll: async () => false }] }, /async/],
      [{ ...base, writes: [{ method: 'POST', path: '/a',
        headers: { A: async () => false } }] }, /async/],
      [{ ...base, writes: [{ method: 'POST', path: '/a', query: new Map([['x', 'y']]) }] }, /query/],
      [{ ...base, writes: [{ method: 'POST', path: '/a', query: {} }] }, /query.*rỗng/],
      [{ ...base, writes: [{ method: 'POST', path: '/a',
        query: { class_item: async () => false } }] }, /query\.class_item.*async/],
      // · vị từ LỒNG SÂU bị `JSON.stringify` xoá mất — khai rồi mà không chạy;
      [{ ...base, writes: [{ method: 'POST', path: '/a',
        body: { extra: { id: (v) => v === 1 } } }] }, /LỒNG SÂU/],
    ];
    for (const [flow, re] of cases) {
      const errs = validateFlow(flow);
      assert.ok(errs.length, `phải ĐỎ: ${JSON.stringify(Object.keys(flow))}`);
      assert.ok(errs.some((e) => re.test(e)), `thông báo không khớp ${re}: ${errs.join(' | ')}`);
    }
  });

  test('khai hỏng chỉ báo MỘT lần dù `times` bao nhiêu', () => {
    const errs = validateFlow({ name: 'x',
      writes: [{ method: 'POST', path: '/a', times: 3, headers: true }] });
    assert.equal(errs.filter((e) => /headers/.test(e)).length, 1);
  });
});

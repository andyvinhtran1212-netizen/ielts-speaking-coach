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

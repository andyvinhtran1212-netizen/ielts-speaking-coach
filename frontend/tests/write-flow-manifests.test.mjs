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

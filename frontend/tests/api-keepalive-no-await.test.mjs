/**
 * Đường `keepalive` không được CHỜ lấy token trước khi gọi `fetch`.
 *
 * `keepalive` chỉ cứu được một request ĐÃ TỒN TẠI. Chờ một `await` trước đó là
 * nhường quyền cho trình duyệt: nó có thể dừng JS ngay sau `pagehide`, và khi
 * ấy `fetch` chưa bao giờ được tạo ra — mọi lượt lưu lúc rời trang thành trang
 * trí. Sáu chỗ đang dùng `keepalive` đều dính, kể cả báo cáo tính toàn vẹn của
 * bài thi thử (codex cục bộ 05/08).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'public', 'js', 'api.js'), 'utf8');
// Bỏ chú thích DÒNG TRƯỚC, khối SAU — thứ tự này quan trọng.
//
// Trong tệp có dòng `// pages/*.html are one level deep`. Bỏ khối trước thì
// `/*` trong dòng ấy bắt cặp với một `*/` mãi phía dưới và nuốt gọn 1351 ký tự
// — kể cả chính hàm cần soi. Bộ quét khi ấy đọc một tệp đã vỡ và báo xanh vì
// không tìm thấy gì để kiểm.
//
// Và chỉ bỏ dòng BẮT ĐẦU bằng `//`: cắt mọi `//` sẽ nuốt luôn `https://…` nằm
// trong chuỗi.
const CODE = SRC
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('keepalive tạo fetch NGAY, không chờ token', () => {
  test('không có `await` nào giữa đầu hàm và lệnh fetch trên đường keepalive', () => {
    const i = CODE.indexOf('async function _apiRequest(');
    const j = CODE.indexOf('await fetch(', i);
    assert.ok(i !== -1 && j > i);
    const head = CODE.slice(i, j);
    // Lấy token PHẢI nằm sau một phép rẽ nhánh có `opts.keepalive`, không phải
    // một `await` vô điều kiện.
    assert.match(head, /opts && opts\.keepalive && _lastToken !== null/,
      'phải có nhánh dùng token đã có sẵn');
    assert.ok(!/^\s*var token = await _getAuthToken\(\);/m.test(head),
      'không được await token vô điều kiện');
  });

  test('token được nhớ lại ở mỗi lần lấy thành công', () => {
    // Không nhớ thì nhánh trên chẳng bao giờ dùng được, và bản vá thành vô hiệu.
    const i = CODE.indexOf('async function _getAuthToken(');
    const body = CODE.slice(i, CODE.indexOf('\n  }', i));
    assert.match(body, /_lastToken =/);
  });

  test('chỉ đường keepalive mới đi tắt — lượt gọi thường vẫn lấy token mới', () => {
    // Đi tắt cho MỌI lượt gọi là gửi token cũ suốt phiên, và phiên hết hạn thì
    // cả trang 401.
    const i = CODE.indexOf('async function _apiRequest(');
    const head = CODE.slice(i, CODE.indexOf('await fetch(', i));
    assert.match(head, /: await _getAuthToken\(\)/, 'nhánh thường vẫn phải lấy mới');
  });

  test('mọi chỗ gọi keepalive đều đi qua đúng đường này', () => {
    // Ghim ĐƯỜNG, không ghim hàm: thêm một `fetch` thứ hai trong api.js là bản
    // vá này lặng lẽ không áp dụng cho nó.
    const fetches = (CODE.match(/fetch\(/g) || []).length;
    assert.equal(fetches, 1, `api.js chỉ được có MỘT lệnh fetch, đang có ${fetches}`);
  });
});

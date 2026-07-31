#!/usr/bin/env node
/**
 * legacy-browser-scan.mjs — DEBT-2026-07-29-K.
 *
 * Quét CHUNK ĐÃ BUILD tìm thứ mà sàn trình duyệt của chúng ta không chạy được.
 *
 * Vì sao cần: 2026-07-28 production ghi 6 lỗi `SyntaxError: Unexpected token
 * '{'` từ iPhone iOS 15.8.5. Nguyên nhân là chunk của CHÍNH Next chứa
 * `class X { static { ... } }` — class static block, chỉ có từ Safari 16.4,
 * đúng bằng mặc định browserslist của Next 16. Cả chunk không parse được ⇒
 * KHÔNG hydrate trên mọi route Next; nội dung SSR vẫn đọc được nhưng phần
 * JS chết. Bản vá là hạ `browserslist`, và file này là cái chốt để nó không
 * âm thầm quay lại sau một lần nâng Next.
 *
 * Hai lớp kiểm, khác nhau về hậu quả:
 *   1. CÚ PHÁP — cả file không parse được ⇒ hỏng toàn bộ. Không polyfill được.
 *   2. API — chỉ hỏng khi dòng đó chạy. Vá được bằng instrumentation-client.
 *      Vì thế API nào ĐÃ polyfill thì cho qua, kèm tên hàm vá.
 *
 * Dùng: `node tooling/legacy-browser-scan.mjs` sau `npm run build`.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Tham số 1 = thư mục chunk cần quét (mặc định là output build). Có tham số để
// test chỉ được vào fixture — nếu không thì chính bộ quét này không kiểm được.
const CHUNKS = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(FRONTEND, '.next', 'static', 'chunks');

// Sàn hiện tại = iOS/Safari 15 (xem `browserslist` trong package.json).
// Mỗi mục ghi rõ phiên bản Safari ĐẦU TIÊN hỗ trợ, để lần sau nâng sàn thì
// biết bỏ mục nào đi.
const SYNTAX_BANNED = [
  { pattern: 'static{', label: 'class static block', since: 'Safari 16.4' },
  { pattern: 'static {', label: 'class static block', since: 'Safari 16.4' },
  { pattern: '(?<=', label: 'regexp lookbehind', since: 'Safari 16.4' },
  { pattern: '(?<!', label: 'regexp lookbehind phủ định', since: 'Safari 16.4' },
];

// API vượt sàn mà KHÔNG có trong instrumentation-client.ts ⇒ báo lỗi.
// Sàn là ios_saf 15 = **15.0**, nên mọi thứ mốc 15.4 cũng phải tính (review
// #882): một máy iOS 15.0–15.3 vẫn nằm trong cam kết của chúng ta.
// `requires` = TẤT CẢ token phải có mặt trong khai báo POLYFILLED thì mới cho
// qua. `.at(` trong code đã minify không cho biết receiver là Array, String hay
// typed array (typed array dùng %TypedArray%.prototype riêng, KHÔNG kế thừa
// Array.prototype — review #882), nên đòi đủ cả ba mới coi là an toàn.
const API_BANNED = [
  { pattern: 'Object.hasOwn', since: 'Safari 16.4', requires: ['Object.hasOwn'] },
  { pattern: 'Object.groupBy', since: 'Safari 17.4', requires: null },
  {
    pattern: '.at(',
    since: 'Safari 15.4',
    requires: ['Array.prototype.at', 'String.prototype.at', 'TypedArray.prototype.at'],
  },
  { pattern: 'structuredClone(', since: 'Safari 15.4', requires: null },
  { pattern: '.findLast(', since: 'Safari 15.4', requires: null },
  { pattern: '.toSorted(', since: 'Safari 16.4', requires: null },
  { pattern: '.toReversed(', since: 'Safari 16.4', requires: null },
];

// Review #882 — FAIL CLOSED. Trước đây thiếu thư mục thì thoát 0 kèm lời nhắc
// "chạy build trước". Nhưng trong CI bước build ĐÃ chạy, nên thư mục thiếu chỉ
// có thể nghĩa là Next đổi bố cục output — tức đúng lúc nâng phiên bản, đúng
// lúc cổng này cần lên tiếng nhất, thì nó lại tự tắt và báo xanh.
if (!existsSync(CHUNKS)) {
  console.error(
    `legacy-browser-scan: KHÔNG thấy thư mục chunk: ${CHUNKS}\n`
    + '  - Chạy cục bộ? `npm run build` trước đã.\n'
    + '  - Trong CI (đã build)? Next có thể đã đổi bố cục output — CẬP NHẬT đường dẫn\n'
    + '    trong bộ quét này, đừng bỏ qua: đây đúng là ca mà cổng phải chặn.',
  );
  process.exit(1);
}

// Hợp đồng với instrumentation-client: PHÂN TÍCH đúng dòng `POLYFILLED: a, b`
// thành tập token. Review #882 (vòng 3): bản trước dò `includes()` trên TOÀN BỘ
// file, nên chỉ cần cái tên API xuất hiện trong phần bình luận là đã được coi
// như đã vá — xoá sạch phần cài đặt mà cổng vẫn xanh. Tham số 2 để test trỏ vào
// fixture.
const DECL_FILES = process.argv[3]
  ? [path.resolve(process.argv[3])]
  : ['instrumentation-client.ts', 'instrumentation-client.js'].map((f) => path.join(FRONTEND, f));

const polyfilled = new Set();
for (const f of DECL_FILES.filter(existsSync)) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /POLYFILLED:\s*(.+)$/.exec(line);
    if (!m) continue;
    for (const token of m[1].split(',')) {
      const name = token.trim().replace(/\s*\*\/\s*$/, '');
      if (name) polyfilled.add(name);
    }
  }
}

// Review #882 — ĐI ĐỆ QUY. Next đặt chunk theo route xuống các thư mục con
// (`.next/static/chunks/app/...`) tuỳ cấu hình/phiên bản; đọc phẳng một tầng
// thì cổng này báo "sạch" trong khi chunk lỗi nằm ngay dưới đó.
function walkJs(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = walkJs(CHUNKS);

// Cùng một lớp thất bại: thư mục còn đó nhưng rỗng (bố cục đổi, chunk sang chỗ
// khác) thì "quét 0 file, sạch" là câu trả lời sai.
if (files.length === 0) {
  console.error(
    `legacy-browser-scan: thư mục chunk RỖNG: ${CHUNKS}\n`
    + '  Không có gì để quét ⇒ không thể kết luận "sạch". Kiểm tra bố cục output của Next.',
  );
  process.exit(1);
}

const problems = [];

for (const full of files) {
  const file = path.relative(CHUNKS, full);
  const src = readFileSync(full, 'utf8');
  for (const { pattern, label, since } of SYNTAX_BANNED) {
    if (src.includes(pattern)) {
      problems.push(`CÚ PHÁP  ${file}: ${label} (\`${pattern}\`) — cần ${since}; cả chunk sẽ không parse được dưới sàn đó`);
    }
  }
  for (const { pattern, since, requires } of API_BANNED) {
    if (!src.includes(pattern)) continue;
    // Chính dòng định nghĩa polyfill (`Object.hasOwn||(...)`) không tính là dùng.
    const isPolyfillDefinition = src.includes(`${pattern}||`) || src.includes(`!${pattern}`);
    if (isPolyfillDefinition) continue;
    const missing = (requires || []).filter((token) => !polyfilled.has(token));
    if (requires && missing.length === 0) continue;
    const detail = requires
      ? `khai báo POLYFILLED thiếu: ${missing.join(', ')}`
      : 'chưa có polyfill nào';
    problems.push(`API      ${file}: ${pattern} — cần ${since}; ${detail}`);
  }
}

if (problems.length) {
  console.error('legacy-browser-scan: PHÁT HIỆN thứ vượt sàn trình duyệt\n');
  for (const p of problems) console.error('  ' + p);
  console.error(
    '\nSửa: hạ `browserslist` trong frontend/package.json (cho lỗi CÚ PHÁP),'
    + '\nhoặc thêm polyfill vào frontend/instrumentation-client.ts (cho lỗi API).'
    + '\nĐừng nới sàn để test xanh — DEBT-2026-07-29-K sinh ra từ đúng việc đó.',
  );
  process.exit(1);
}

console.log(`legacy-browser-scan: sạch — ${files.length} chunk, sàn iOS/Safari 15.`);

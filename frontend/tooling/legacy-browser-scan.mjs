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

// Review #882 (vòng 6) — chunk KHÔNG phải nơi duy nhất chạy trên máy khách.
// `public/**/*.js` được phục vụ NGUYÊN XI: không qua bundler, không hạ target,
// và **instrumentation-client KHÔNG chạy trên trang legacy** nên polyfill của
// Next không cứu được chúng. Vì vậy thư mục này quét ở chế độ NGHIÊM: mọi API
// vượt sàn đều bị chặn, không có miễn trừ theo khai báo POLYFILLED.
// (Đợt này tìm ra lookbehind trong `listening-test-player.js` — file học viên
// nạp ở trang làm bài nghe: iOS ≤16.3 không parse nổi cả file.) Quét CẢ
// `public/assets/**` vì có bundle vendor được import động — review #882 vòng 7.
const STATIC_JS = process.env.LEGACY_SCAN_STATIC_DIR
  ? path.resolve(process.env.LEGACY_SCAN_STATIC_DIR)
  : (process.argv[2] ? null : path.join(FRONTEND, 'public'));

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
  { pattern: '.findLastIndex(', since: 'Safari 15.4', requires: null },
  { pattern: '.toSorted(', since: 'Safari 16.4', requires: null },
  { pattern: '.toReversed(', since: 'Safari 16.4', requires: null },
  { pattern: '.toSpliced(', since: 'Safari 16.4', requires: null },
  // `.with(` là tên khá chung nên có thể báo nhầm với method cùng tên của thư
  // viện khác. Vẫn giữ: báo nhầm thì thêm vào khai báo POLYFILLED hoặc đổi tên
  // — rẻ hơn nhiều so với bỏ lọt một lời gọi hỏng trên iOS 15 (review #882).
  { pattern: '.with(', since: 'Safari 16.4', requires: null },
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

const chunkFiles = walkJs(CHUNKS);

// Cùng một lớp thất bại: thư mục còn đó nhưng rỗng (bố cục đổi, chunk sang chỗ
// khác) thì "quét 0 file, sạch" là câu trả lời sai.
if (chunkFiles.length === 0) {
  console.error(
    `legacy-browser-scan: thư mục chunk RỖNG: ${CHUNKS}\n`
    + '  Không có gì để quét ⇒ không thể kết luận "sạch". Kiểm tra bố cục output của Next.',
  );
  process.exit(1);
}

// Hai nhóm nguồn, khác nhau ở chỗ có được hưởng polyfill hay không:
//  - chunk Next: instrumentation-client chạy trước ⇒ API đã khai là an toàn;
//  - public/js: phục vụ nguyên xi, trang legacy KHÔNG nạp instrumentation ⇒
//    không miễn trừ gì hết.
const ROOTS = [{ dir: CHUNKS, files: chunkFiles, allowPolyfilled: true, kind: 'chunk' }];
if (STATIC_JS && existsSync(STATIC_JS)) {
  ROOTS.push({
    dir: STATIC_JS, files: walkJs(STATIC_JS), allowPolyfilled: false, kind: 'script tĩnh',
  });
}

/**
 * Có ít nhất một lần xuất hiện KHÔNG phải là định nghĩa polyfill hay không.
 * Định nghĩa = ngay sau tên API là `||` (dạng guard `X||(X=…)` / `X||function`)
 * hoặc một dấu `=` đơn (gán). Mọi dạng khác — kể cả `!X(...)` — là lời gọi
 * thật và phải bị tính.
 */
function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regex khớp một API, CHO PHÉP khoảng trắng trước dấu `(`. Code trong
 * `public/**` chưa qua minify nên `values.at (-1)` là hợp lệ và trước đây vô
 * hình với phép so chuỗi cứng (review #882 vòng 7).
 */
function apiMatcher(pattern) {
  return pattern.endsWith('(')
    ? new RegExp(escapeRe(pattern.slice(0, -1)) + '\\s*\\(', 'g')
    : new RegExp(escapeRe(pattern), 'g');
}

function hasRealUse(src, pattern) {
  const re = apiMatcher(pattern);
  let m;
  while ((m = re.exec(src)) !== null) {
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 4);
    const isDefinition = /^\s*(\|\||=[^=])/.test(after);
    if (!isDefinition) return true;
  }
  return false;
}

const problems = [];

for (const root of ROOTS) {
for (const full of root.files) {
  const file = `${root.kind}: ${path.relative(root.dir, full)}`;
  const src = readFileSync(full, 'utf8');
  for (const { pattern, label, since } of SYNTAX_BANNED) {
    if (src.includes(pattern)) {
      problems.push(`CÚ PHÁP  ${file}: ${label} (\`${pattern}\`) — cần ${since}; cả chunk sẽ không parse được dưới sàn đó`);
    }
  }
  for (const { pattern, since, requires } of API_BANNED) {
    if (!apiMatcher(pattern).test(src)) continue;
    // Bản trước miễn trừ CẢ FILE khi thấy `!<pattern>` ở bất kỳ đâu, nên
    // `if(!structuredClone(v))` — một lời gọi THẬT — cũng được tha (review
    // #882 vòng 4). Nay xét TỪNG lần xuất hiện: chỉ dạng `X||…` hoặc `X=…`
    // (Next tự chèn `Object.hasOwn||(Object.hasOwn=function…)`) mới là định
    // nghĩa; còn một lần xuất hiện không phải định nghĩa là còn lời gọi thật.
    if (!hasRealUse(src, pattern)) continue;
    const missing = (requires || []).filter((token) => !polyfilled.has(token));
    if (root.allowPolyfilled && requires && missing.length === 0) continue;
    const detail = !root.allowPolyfilled
      ? 'script tĩnh KHÔNG nạp instrumentation-client ⇒ không có polyfill nào áp dụng'
      : requires
        ? `khai báo POLYFILLED thiếu: ${missing.join(', ')}`
        : 'chưa có polyfill nào';
    problems.push(`API      ${file}: ${pattern} — cần ${since}; ${detail}`);
  }
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

console.log(
  'legacy-browser-scan: sạch — '
  + ROOTS.map((r) => `${r.files.length} ${r.kind}`).join(' + ')
  + ', sàn iOS/Safari 15.',
);

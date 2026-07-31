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
const CHUNKS = path.join(FRONTEND, '.next', 'static', 'chunks');

// Sàn hiện tại = iOS/Safari 15 (xem `browserslist` trong package.json).
// Mỗi mục ghi rõ phiên bản Safari ĐẦU TIÊN hỗ trợ, để lần sau nâng sàn thì
// biết bỏ mục nào đi.
const SYNTAX_BANNED = [
  { pattern: 'static{', label: 'class static block', since: 'Safari 16.4' },
  { pattern: 'static {', label: 'class static block', since: 'Safari 16.4' },
  { pattern: '(?<=', label: 'regexp lookbehind', since: 'Safari 16.4' },
  { pattern: '(?<!', label: 'regexp lookbehind phủ định', since: 'Safari 16.4' },
];

// API mốc >15 mà KHÔNG có trong instrumentation-client.ts ⇒ báo lỗi.
const API_BANNED = [
  { pattern: 'Object.hasOwn', since: 'Safari 16.4', polyfilledAs: 'Object.hasOwn' },
  { pattern: 'Object.groupBy', since: 'Safari 17.4', polyfilledAs: null },
  { pattern: '.findLast(', since: 'Safari 15.4', polyfilledAs: null },
  { pattern: '.toSorted(', since: 'Safari 16.4', polyfilledAs: null },
  { pattern: '.toReversed(', since: 'Safari 16.4', polyfilledAs: null },
];

if (!existsSync(CHUNKS)) {
  console.log('legacy-browser-scan: chưa có .next/static/chunks — chạy `npm run build` trước.');
  process.exit(0);
}

const instrumentation = ['instrumentation-client.ts', 'instrumentation-client.js']
  .map((f) => path.join(FRONTEND, f))
  .filter(existsSync)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const files = readdirSync(CHUNKS).filter((f) => f.endsWith('.js'));
const problems = [];

for (const file of files) {
  const src = readFileSync(path.join(CHUNKS, file), 'utf8');
  for (const { pattern, label, since } of SYNTAX_BANNED) {
    if (src.includes(pattern)) {
      problems.push(`CÚ PHÁP  ${file}: ${label} (\`${pattern}\`) — cần ${since}; cả chunk sẽ không parse được dưới sàn đó`);
    }
  }
  for (const { pattern, since, polyfilledAs } of API_BANNED) {
    if (!src.includes(pattern)) continue;
    // Chính dòng định nghĩa polyfill (`Object.hasOwn||(...)`) không tính là dùng.
    const isPolyfillDefinition = src.includes(`${pattern}||`) || src.includes(`!${pattern}`);
    const covered = polyfilledAs && instrumentation.includes(polyfilledAs);
    if (covered || isPolyfillDefinition) continue;
    problems.push(`API      ${file}: ${pattern} — cần ${since}; chưa có trong instrumentation-client`);
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

/**
 * legacy-browser-scan.test.mjs — kiểm CHÍNH BỘ QUÉT.
 *
 * Review #882 tìm ra một lỗ mà không ai thấy được nếu chỉ chạy bộ quét trên
 * output build đang sạch: `readdirSync` phẳng một tầng, nên chunk nằm trong
 * thư mục con (`.next/static/chunks/app/...` — Next đặt chunk theo route ở đó
 * tuỳ cấu hình) bị bỏ qua, và cổng CI vẫn báo "sạch". Một cổng chỉ biết nói
 * "sạch" thì vô dụng; các bài dưới đây bắt nó phải nói "bẩn" đúng lúc.
 *
 * Bộ quét nhận tham số thư mục để test trỏ vào fixture — không đụng .next.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCANNER = path.join(__dirname, '..', 'tooling', 'legacy-browser-scan.mjs');

function scan(files, declSource) {
  const dir = mkdtempSync(path.join(tmpdir(), 'chunkscan-'));
  for (const [rel, source] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, source);
  }
  const args = [SCANNER, dir];
  if (declSource !== undefined) {
    const decl = path.join(dir, '..', path.basename(dir) + '-decl.ts');
    writeFileSync(decl, declSource);
    args.push(decl);
  }
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/** Quét thư mục script tĩnh (public/js) — chế độ NGHIÊM, không miễn trừ. */
function scanStatic(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'staticscan-'));
  for (const [rel, source] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, source);
  }
  const chunkDir = mkdtempSync(path.join(tmpdir(), 'chunkok-'));
  writeFileSync(path.join(chunkDir, 'ok.js'), 'export const x=1;');
  const r = spawnSync(process.execPath, [SCANNER], {
    encoding: 'utf8',
    env: { ...process.env, LEGACY_SCAN_STATIC_DIR: dir },
    cwd: path.join(SCANNER, '..', '..'),
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), chunkDir };
}

describe('legacy-browser-scan (DEBT-2026-07-29-K)', () => {
  test('chunk sạch → exit 0', () => {
    const r = scan({ 'a.js': 'export const x=1;const y=[1,2].map(v=>v+1);' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /sạch/);
  });

  test('class static block ở THƯ MỤC CON vẫn bị bắt (lỗ của review #882)', () => {
    const r = scan({
      'a.js': 'export const ok=1;',
      'app/(marketing)/page-abc.js': 'class X{static{this.y=1}}',
    });
    assert.equal(r.code, 1, 'phải đỏ — nếu xanh thì bộ quét lại đọc phẳng một tầng\n' + r.out);
    assert.match(r.out, /class static block/);
    assert.match(r.out, /app/, 'thông báo phải chỉ ra đường dẫn tương đối của chunk lỗi');
  });

  test('lookbehind regexp bị bắt — không polyfill được, hỏng cả file khi parse', () => {
    const r = scan({ 'deep/nested/b.js': 'const re=/(?<=x)y/;' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /lookbehind/);
  });

  test('API đã vá trong instrumentation-client thì cho qua (Object.hasOwn, .at)', () => {
    const r = scan({ 'c.js': 'if(Object.hasOwn(o,"k")){}const last=arr.at(-1);' });
    assert.equal(r.code, 0, 'hai API này ĐÃ được vá — chặn nữa là báo động giả\n' + r.out);
  });

  test('API CHƯA vá thì chặn — kể cả khi chỉ nằm ở thư mục con', () => {
    const r = scan({ 'app/x/d.js': 'const s=list.toSorted();' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /toSorted/);
  });

  // Review #882 vòng 2 — cổng phải FAIL CLOSED. Nếu Next đổi bố cục output thì
  // thư mục chunk biến mất/rỗng ĐÚNG lúc nâng phiên bản, tức đúng lúc cần chặn;
  // trả "sạch" lúc đó là tự tắt cổng.
  test('thư mục chunk không tồn tại → đỏ, KHÔNG phải "sạch"', () => {
    const missing = path.join(tmpdir(), 'chunkscan-khong-ton-tai-' + process.pid);
    const r = spawnSync(process.execPath, [SCANNER, missing], { encoding: 'utf8' });
    assert.equal(r.status, 1, 'thiếu thư mục mà báo xanh = cổng tự tắt\n' + (r.stdout + r.stderr));
    assert.match(r.stdout + r.stderr, /KHÔNG thấy thư mục chunk/);
  });

  test('thư mục chunk rỗng → đỏ (quét 0 file thì không kết luận được)', () => {
    const r = scan({});
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /RỖNG/);
  });

  // Review #882 vòng 3 — cổng phải đọc ĐÚNG dòng khai báo, không phải "cái tên
  // có xuất hiện đâu đó trong file". Bản trước dò includes() toàn file, nên chỉ
  // cần tên API nằm trong bình luận là đã coi như đã vá.
  test('chỉ nhắc tên API trong văn xuôi thì KHÔNG được tính là đã vá', () => {
    const proseOnly = '// Bàn về Object.hasOwn và Array.prototype.at nhưng không khai báo gì.';
    const r = scan({ 'a.js': 'if(Object.hasOwn(o,"k")){}' }, proseOnly);
    assert.equal(r.code, 1, 'văn xuôi không phải hợp đồng\n' + r.out);
    assert.match(r.out, /POLYFILLED thiếu/);
  });

  test('.at() cần ĐỦ cả ba receiver — thiếu TypedArray là chưa an toàn', () => {
    // Typed array dùng %TypedArray%.prototype riêng, không kế thừa Array.prototype.
    const partial = '// POLYFILLED: Array.prototype.at, String.prototype.at';
    const r = scan({ 'a.js': 'const b=new Uint8Array(4).at(-1);' }, partial);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /TypedArray\.prototype\.at/);

    const full = '// POLYFILLED: Array.prototype.at, String.prototype.at, TypedArray.prototype.at';
    assert.equal(scan({ 'a.js': 'const b=new Uint8Array(4).at(-1);' }, full).code, 0);
  });

  test('dòng ĐỊNH NGHĨA polyfill không bị tính là dùng', () => {
    // Next tự chèn `Object.hasOwn||(Object.hasOwn=function(){})` vào bundle.
    const r = scan({ 'e.js': 'Object.hasOwn||(Object.hasOwn=function(e,t){return false});' });
    assert.equal(r.code, 0, r.out);
  });

  // Review #882 vòng 6 — public/js phục vụ NGUYÊN XI và trang legacy KHÔNG nạp
  // instrumentation-client, nên ở đó khai báo POLYFILLED không cứu được gì.
  test('script tĩnh: API đã khai POLYFILLED vẫn bị chặn (legacy không nạp polyfill)', () => {
    const r = scanStatic({ 'legacy.js': 'const last=arr.at(-1);' });
    assert.equal(r.code, 1, 'public/js không được hưởng miễn trừ\n' + r.out);
    assert.match(r.out, /script tĩnh/);
    assert.match(r.out, /KHÔNG nạp instrumentation-client/);
  });

  test('script tĩnh: cú pháp vượt sàn bị chặn (đúng ca listening-test-player)', () => {
    const r = scanStatic({ 'player.js': "const p=s.split(/(?<=\\.)\\s+/);" });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /lookbehind/);
  });

  // Review #882 vòng 5 — danh sách API bỏ sót anh em của findLast/toSorted.
  // Mỗi API dưới đây đều vượt sàn và KHÔNG được browserslist vá.
  for (const [api, snippet] of Object.entries({
    'findLast': 'const a=xs.findLast(Boolean);',
    'findLastIndex': 'const i=xs.findLastIndex(Boolean);',
    'toSorted': 'const s=xs.toSorted();',
    'toReversed': 'const r=xs.toReversed();',
    'toSpliced': 'const t=xs.toSpliced(0,1);',
    'with': 'const w=xs.with(0,9);',
    'Object.groupBy': 'const g=Object.groupBy(xs,f);',
    'structuredClone': 'const c=structuredClone(o);',
  })) {
    test(`API vượt sàn bị chặn: ${api}`, () => {
      const r = scan({ 'a.js': snippet });
      assert.equal(r.code, 1, `${api} phải bị chặn\n` + r.out);
      assert.ok(r.out.includes(api.split('.').pop()), r.out);
    });
  }

  // Review #882 vòng 4 — miễn trừ cũ dò `!<pattern>` trên cả file, nên một lời
  // gọi phủ định THẬT cũng được tha.
  test('lời gọi phủ định là lời gọi THẬT, không phải định nghĩa', () => {
    const r = scan({ 'f.js': 'if(!structuredClone(v)){doSomething()}' });
    assert.equal(r.code, 1, 'if(!structuredClone(v)) là dùng thật, phải bị chặn\n' + r.out);
    assert.match(r.out, /structuredClone/);
  });

  test('file vừa ĐỊNH NGHĨA vừa DÙNG thì vẫn bị chặn (không tha cả file)', () => {
    const r = scan({
      'g.js': 'Object.hasOwn||(Object.hasOwn=function(){return false});if(Object.hasOwn(o,"k")){}',
    }, '// POLYFILLED: (không khai gì)');
    assert.equal(r.code, 1, 'có định nghĩa không có nghĩa là mọi lời gọi khác đều an toàn\n' + r.out);
  });
});

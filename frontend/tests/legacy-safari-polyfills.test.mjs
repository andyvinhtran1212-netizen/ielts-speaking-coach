/**
 * legacy-safari-polyfills.test.mjs — DEBT-2026-07-29-K, vòng 4 của review #882.
 *
 * Cổng CI trước đây chỉ TIN vào dòng `POLYFILLED:` trong instrumentation-client:
 * xoá sạch phần cài đặt mà chunk dùng `Object.hasOwn` / `.at()` vẫn qua, CI vẫn
 * xanh, và lỗi iOS mở lại trong im lặng. Bài test này đóng lỗ đó bằng cách CHẠY
 * THẬT phần cài đặt trong một realm sạch (`vm`) đã xoá API gốc — đúng hoàn cảnh
 * của iOS 15 — rồi kiểm hành vi từng receiver.
 *
 * Danh sách receiver KHÔNG viết cứng trong test: nó được đọc từ chính dòng
 * `POLYFILLED:`. Thêm tên vào khai báo mà không cài đặt ⇒ đỏ; xoá cài đặt mà
 * quên xoá tên ⇒ đỏ. Khai báo và hiện thực buộc phải đi cùng nhau.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(__dirname, '..');
const DECL = readFileSync(path.join(FRONTEND, 'instrumentation-client.ts'), 'utf8');
const IMPL = readFileSync(
  path.join(FRONTEND, 'lib', 'polyfills', 'legacy-safari.js'), 'utf8');

const declared = (() => {
  const line = DECL.split('\n').find((l) => /POLYFILLED:/.test(l));
  assert.ok(line, 'instrumentation-client phải có dòng POLYFILLED: — hợp đồng của cổng CI');
  return line.replace(/^.*POLYFILLED:\s*/, '').split(',').map((s) => s.trim()).filter(Boolean);
})();

/** Realm sạch, đã gỡ đúng những API mà iOS 15.0 không có. */
function legacyRealm() {
  const ctx = vm.createContext({});
  vm.runInContext(`
    delete Object.hasOwn;
    delete Array.prototype.at;
    delete String.prototype.at;
    delete Object.getPrototypeOf(Uint8Array.prototype).at;
  `, ctx);
  return ctx;
}

// Mỗi token trong khai báo phải có một phép thử hành vi ở đây.
const PROBES = {
  'Object.hasOwn': `
    (function () {
      if (Object.hasOwn({a: 1}, 'a') !== true) return 'hasOwn({a:1},"a") phải true';
      if (Object.hasOwn({}, 'a') !== false) return 'hasOwn({},"a") phải false';
      if (Object.hasOwn(Object.create({inherited: 1}), 'inherited') !== false)
        return 'hasOwn không được tính thuộc tính kế thừa';
      try { Object.hasOwn(null, 'a'); return 'hasOwn(null) phải ném TypeError'; }
      catch (e) { if (!(e instanceof TypeError)) return 'phải là TypeError'; }
      return null;
    })()`,
  'Array.prototype.at': `
    (function () {
      if ([1, 2, 3].at(-1) !== 3) return 'at(-1) phải trả phần tử cuối';
      if ([1, 2, 3].at(0) !== 1) return 'at(0) phải trả phần tử đầu';
      if ([1, 2, 3].at(9) !== undefined) return 'ngoài khoảng phải trả undefined, không throw';
      if ([1, 2, 3].at(-9) !== undefined) return 'âm ngoài khoảng phải trả undefined';
      if ([1, 2, 3].at() !== 1) return 'không tham số coi như 0';
      return null;
    })()`,
  'String.prototype.at': `
    (function () {
      if ('abc'.at(-1) !== 'c') return 'chuỗi: at(-1) phải là ký tự cuối';
      if ('abc'.at(1) !== 'b') return 'chuỗi: at(1) sai';
      if ('abc'.at(5) !== undefined) return 'chuỗi: ngoài khoảng phải undefined';
      return null;
    })()`,
  'TypedArray.prototype.at': `
    (function () {
      var u = new Uint8Array([10, 20, 30]);
      if (u.at(-1) !== 30) return 'typed array: at(-1) sai — %TypedArray%.prototype là prototype RIÊNG';
      if (u.at(0) !== 10) return 'typed array: at(0) sai';
      if (u.at(7) !== undefined) return 'typed array: ngoài khoảng phải undefined';
      var f = new Float64Array([1.5, 2.5]);
      if (f.at(-1) !== 2.5) return 'polyfill phải áp cho MỌI typed array, không riêng Uint8Array';
      return null;
    })()`,
};

describe('polyfill sàn iOS 15 — kiểm HÀNH VI, không chỉ khai báo', () => {
  test('mọi API trong khai báo POLYFILLED đều có phép thử hành vi', () => {
    const missing = declared.filter((name) => !(name in PROBES));
    assert.deepEqual(missing, [],
      'thêm tên vào khai báo thì phải thêm phép thử tương ứng — nếu không thì cổng lại quay về'
      + ' "tin vào lời khai" đúng như review #882 đã bắt');
  });

  test('realm iOS-15 giả lập thực sự THIẾU các API đó (nếu không thì bài test này vô nghĩa)', () => {
    const ctx = legacyRealm();
    const before = vm.runInContext(`[
      typeof Object.hasOwn, typeof Array.prototype.at, typeof String.prototype.at,
      typeof Object.getPrototypeOf(Uint8Array.prototype).at
    ].join(',')`, ctx);
    assert.equal(before, 'undefined,undefined,undefined,undefined');
  });

  for (const name of declared) {
    test(`${name} — chạy thật sau khi nạp polyfill`, () => {
      const ctx = legacyRealm();
      vm.runInContext(IMPL, ctx);
      const failure = vm.runInContext(PROBES[name], ctx);
      assert.equal(failure, null, failure || '');
    });
  }

  test('polyfill KHÔNG đè lên bản có sẵn của trình duyệt mới', () => {
    const ctx = vm.createContext({});
    vm.runInContext('globalThis.__origAt = Array.prototype.at;', ctx);
    vm.runInContext(IMPL, ctx);
    assert.equal(
      vm.runInContext('Array.prototype.at === globalThis.__origAt', ctx), true,
      'máy mới phải giữ bản gốc — polyfill chỉ được lấp chỗ trống');
  });

  test('instrumentation-client chỉ import phần cài đặt, không giữ bản sao thứ hai', () => {
    assert.match(DECL, /import '\.\/lib\/polyfills\/legacy-safari\.js'/);
    assert.ok(!/hasOwnProperty/.test(DECL),
      'hai bản cài đặt song song sẽ lệch nhau — chỉ giữ một chỗ');
  });
});

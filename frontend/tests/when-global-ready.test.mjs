/**
 * when-global-ready.test.mjs
 *
 * Ghim lại bản vá cho lỗi đua có thật, đo được trên production 2026-08-03:
 * trang bài Grammar (route Next của pilot 2, ĐÃ qua cửa sổ soak 48h) mất nút
 * "Lưu bài" và thanh CTA khách ở **9/20** lượt tải ẩn danh — trong khi
 * `window.api` và `window.getSupabase` có mặt **20/20** sau khi trang lắng.
 * Global tới muộn hơn effect, mà effect kiểm một lần rồi `return` im lặng.
 *
 * Test hành vi thật, không phải regex trên mã nguồn: vòng review trước đã chỉ
 * ra chốt chặn bằng regex là yếu. Đồng hồ và giấc ngủ được tiêm vào để không
 * phải chờ thật.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { whenGlobalReady } from '../lib/when-global-ready.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BEHAVIOR = readFileSync(
  path.join(__dirname, '..', 'app', '(public-content)', 'grammar', '[category]', '[slug]',
    'article-behavior.tsx'),
  'utf8');

/** Đồng hồ giả: `sleep` đẩy thời gian, nên vòng chờ chạy tức thì. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms) => { t += ms; },
    advance: (ms) => { t += ms; },
  };
}

describe('whenGlobalReady', () => {
  test('global đã có ⇒ trả true NGAY, không chờ một nhịp nào', async () => {
    const c = fakeClock();
    let slept = 0;
    const ok = await whenGlobalReady(() => true, 'x',
      { now: c.now, sleep: async (ms) => { slept += 1; c.advance(ms); } });
    assert.equal(ok, true);
    assert.equal(slept, 0, 'đường nhanh không được trả giá bằng một nhịp chờ');
  });

  test('global tới MUỘN ⇒ vẫn bắt được (đây chính là ca hỏng thật)', async () => {
    const c = fakeClock();
    let present = false;
    // Mô phỏng `/js/api.js` chạy xong ở mốc ~400ms, sau khi effect đã mount.
    const ok = await whenGlobalReady(() => present, 'window.api', {
      now: c.now,
      sleep: async (ms) => { c.advance(ms); if (c.now() >= 400) present = true; },
    });
    assert.equal(ok, true, 'bản cũ trả về ngay tại đây và mất tính năng vĩnh viễn');
  });

  test('hết giờ ⇒ trả false và BÁO LÊN, không nuốt im lặng', async () => {
    const c = fakeClock();
    const reported = [];
    const ok = await whenGlobalReady(() => false, 'window.api (nút Lưu bài)', {
      timeoutMs: 1000, now: c.now, sleep: c.sleep, report: (m) => reported.push(m),
    });
    assert.equal(ok, false);
    assert.equal(reported.length, 1, 'im lặng chính là thứ giúp lỗi sống qua soak 48h');
    assert.match(reported[0], /window\.api \(nút Lưu bài\)/, 'phải nêu global nào thiếu');
    assert.match(reported[0], /1000ms/);
  });

  test('không chờ quá hạn', async () => {
    const c = fakeClock();
    await whenGlobalReady(() => false, 'x',
      { timeoutMs: 500, stepMs: 50, now: c.now, sleep: c.sleep, report: () => {} });
    assert.ok(c.now() <= 550, `dừng đúng hạn, dừng ở ${c.now()}ms`);
  });
});

describe('article-behavior dùng bản chờ, không kiểm-một-lần', () => {
  test('cả ba chốt global đều đi qua whenGlobalReady', () => {
    assert.equal(
      (BEHAVIOR.match(/await whenGlobalReady\(/g) || []).length, 3,
      'ba chỗ: đếm lượt xem, nút Lưu bài, CTA khách');
    // Dạng cũ — kiểm một lần rồi thoát — không được quay lại.
    assert.ok(!/if \(!\(window as any\)\.(api|getSupabase)[^\n]*\) return;/.test(BEHAVIOR),
      'còn chốt kiểm-một-lần nghĩa là lỗi đua quay lại');
  });

  test('chờ thất bại thì NHẢ cờ CTA ra, không khoá vĩnh viễn', () => {
    // Bản cũ đặt `_guestCTAInited = true` TRƯỚC khi kiểm global, nên một lần
    // thua cuộc đua là khối CTA tắt vĩnh viễn cho cả vòng đời trang.
    assert.match(BEHAVIOR, /_guestCTAInited = false;/,
      'phải nhả cờ khi chờ thất bại, nếu không thử lại cũng vô ích');
  });

  test('không dựng nút Lưu bài hai lần sau khi chờ', () => {
    assert.match(BEHAVIOR, /if \(document\.getElementById\('save-article-btn'\)\) return;/,
      'chờ xong mới dựng ⇒ phải chống dựng trùng nếu effect chạy lại');
  });
});

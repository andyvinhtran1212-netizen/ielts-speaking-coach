/**
 * g2-floor.test.mjs — sàn G2 của ADR-013-A1 phải TỪ CHỐI đúng những ca mà
 * review PR #909 chỉ ra là lách được.
 *
 * Ca quan trọng nhất: **72 probe bắn dồn trong ít phút**. Bản đầu của A1 để
 * nhịp là biến số ("mỗi N phút suốt một khoảng xác định"), nên một chùm dày
 * vẫn PASS trong khi vế thời-gian-trôi — thứ duy nhất G2 sinh ra để phủ — bị
 * xoá sạch. Nếu test này xanh khi đưa vào một chùm như vậy thì sàn vô dụng.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateG2, formatG2, G2_FLOOR } from '../tooling/g2-floor.mjs';

const T0 = 1_785_000_000_000; // mốc cố định; không dùng Date.now() trong test
const MIN = 60_000;

/** Dãy mẫu đạt chuẩn: n mẫu, cách đều `stepMin` phút, tất cả OK. */
const series = (n, stepMin, over = {}) =>
  Array.from({ length: n }, (_, i) => ({
    at: T0 + i * stepMin * MIN, ok: true, status: 200, route: '/profile', ...over,
  }));

/** Dãy đạt cả sàn authenticated (có request hai phía mốc refresh). */
function authedSeries() {
  const rows = series(73, 20);
  rows.forEach((r, i) => { r.afterRefresh = i >= 4; }); // refresh sau ~80 phút
  return rows;
}

describe('sàn G2 — ca ĐẠT', () => {
  test('72 mẫu, cách đều 20 phút, trải đúng 24h ⇒ ĐẠT (lớp ẩn danh)', () => {
    const r = evaluateG2(series(73, 20));
    assert.equal(r.pass, true, formatG2(r));
    assert.equal(r.stats.n, 73);
    assert.ok(r.stats.spanHours >= 24);
    assert.ok(r.stats.maxGapMinutes <= 20);
  });

  test('lớp có đăng nhập cần thêm token refresh — dãy đủ thì ĐẠT', () => {
    const r = evaluateG2(authedSeries(), { authenticated: true });
    assert.equal(r.pass, true, formatG2(r));
  });
});

describe('sàn G2 — những ca PHẢI bị từ chối', () => {
  test('BẮN DỒN: 72 mẫu trong 5 phút ⇒ TỪ CHỐI (đây là ca của review #909)', () => {
    // 72 mẫu cách nhau 4 giây: thoả n, thoả nhịp, nhưng trải vỏn vẹn ~4,7 phút.
    const burst = Array.from({ length: 72 }, (_, i) => ({
      at: T0 + i * 4000, ok: true, status: 200,
    }));
    const r = evaluateG2(burst);
    assert.equal(r.pass, false, 'chùm dày mà PASS thì sàn vô dụng');
    assert.ok(r.findings.some((f) => f.code === 'span-too-short'),
      'phải từ chối vì TRẢI quá ngắn — n và nhịp đều đẹp nên chỉ mình nó chặn được');
  });

  test('đủ trải nhưng có MỘT quãng đứt 25 phút ⇒ TỪ CHỐI', () => {
    const rows = series(80, 20);
    for (let i = 40; i < rows.length; i++) rows[i].at += 5 * MIN; // chèn quãng đứt
    const r = evaluateG2(rows);
    assert.equal(r.pass, false);
    assert.ok(r.findings.some((f) => f.code === 'gap-too-long'));
  });

  test('nhịp TRUNG BÌNH đẹp vẫn không cứu được quãng đứt dài', () => {
    // Chốt chặn cho lựa chọn thiết kế: đo khoảng cách LỚN NHẤT, không đo trung
    // bình. Dãy dưới có trung bình ~20 phút nhưng đứt một quãng 6 tiếng.
    const dense = Array.from({ length: 60 }, (_, i) => ({ at: T0 + i * MIN, ok: true }));
    const later = Array.from({ length: 20 }, (_, i) => ({
      at: T0 + 6 * 60 * MIN + i * 20 * MIN, ok: true,
    }));
    const r = evaluateG2([...dense, ...later]);
    assert.ok(r.findings.some((f) => f.code === 'gap-too-long'),
      'trung bình đẹp mà vẫn có lỗ 6 tiếng — phải bị bắt');
  });

  test('thiếu số mẫu ⇒ TỪ CHỐI dù trải đủ 24h', () => {
    const r = evaluateG2(series(30, 60)); // 30 mẫu, cách 1 tiếng
    assert.equal(r.pass, false);
    assert.ok(r.findings.some((f) => f.code === 'too-few-samples'));
    assert.ok(r.findings.some((f) => f.code === 'gap-too-long'));
  });

  test('có probe hỏng ⇒ TỪ CHỐI, và nêu đích danh', () => {
    const rows = series(73, 20);
    rows[10] = { ...rows[10], ok: false, status: 401, note: 'token hết hạn' };
    const r = evaluateG2(rows);
    assert.equal(r.pass, false);
    const f = r.findings.find((x) => x.code === 'probe-failed');
    assert.match(f.detail, /401/);
    assert.match(f.detail, /token hết hạn/);
  });

  test('lớp có đăng nhập mà KHÔNG qua token refresh ⇒ TỪ CHỐI', () => {
    const r = evaluateG2(series(73, 20), { authenticated: true });
    assert.equal(r.pass, false);
    assert.ok(r.findings.some((f) => f.code === 'no-token-refresh'));
    // …trong khi cùng dãy đó ở lớp ẩn danh thì ĐẠT — chốt chặn cho thấy điều
    // kiện này thật sự riêng của lớp authenticated, không phải luôn-đỏ.
    assert.equal(evaluateG2(series(73, 20)).pass, true);
  });

  test('chỉ có request SAU mốc refresh, không có trước ⇒ TỪ CHỐI', () => {
    const rows = series(73, 20).map((r) => ({ ...r, afterRefresh: true }));
    const r = evaluateG2(rows, { authenticated: true });
    assert.equal(r.pass, false, 'không có mẫu trước mốc thì không chứng minh được gì');
  });

  test('KHÔNG có sổ ⇒ TỪ CHỐI, không phải "chưa có dữ liệu nên cho qua"', () => {
    for (const empty of [[], null, undefined]) {
      const r = evaluateG2(empty);
      assert.equal(r.pass, false);
      assert.ok(r.findings.some((f) => f.code === 'no-samples'));
    }
  });
});

describe('chi tiết', () => {
  test('mẫu không theo thứ tự vẫn tính đúng', () => {
    const rows = series(73, 20);
    const shuffled = [rows[40], ...rows.slice(0, 40), ...rows.slice(41)];
    assert.equal(evaluateG2(shuffled).pass, true);
  });

  test('mốc thời gian hỏng thì bị loại, không làm sai phép đo', () => {
    const rows = [...series(73, 20), { at: NaN, ok: true }, { ok: true }];
    const r = evaluateG2(rows);
    assert.equal(r.stats.n, 73);
    assert.equal(r.pass, true);
  });

  test('sàn khớp đúng ADR-013-A1', () => {
    assert.equal(G2_FLOOR.minSamples, 72);
    assert.equal(G2_FLOOR.minSpanMs, 24 * 60 * 60 * 1000);
    assert.equal(G2_FLOOR.maxGapMs, 20 * 60 * 1000);
    // 72 × 20 phút = đúng 24h — ba con số phải nhất quán, không phải ba ràng
    // buộc rời rạc chọn tuỳ hứng.
    assert.equal(G2_FLOOR.minSamples * G2_FLOOR.maxGapMs, G2_FLOOR.minSpanMs);
  });

  test('formatG2 nói rõ ĐẠT hay CHƯA, không mập mờ', () => {
    assert.match(formatG2(evaluateG2(series(73, 20))), /ĐẠT sàn ADR-013-A1/);
    assert.match(formatG2(evaluateG2([])), /CHƯA ĐẠT[\s\S]*no-samples/);
  });
});

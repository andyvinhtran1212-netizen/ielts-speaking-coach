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

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateG2, formatG2, G2_FLOOR, G2_FLOOR_TRADEOFF, planSession, parseLedger, mergeLedgers,
} from '../tooling/g2-floor.mjs';

const PROBE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tooling',
    'authed-probe.mjs'), 'utf8');

const WF_RAW = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..',
    '.github', 'workflows', 'g2-authed-probe.yml'), 'utf8');

// BỎ DÒNG CHÚ THÍCH TRƯỚC KHI KHỚP. Review #910 vòng 2 chỉ ra: chốt quét cả
// file thì một chuỗi nằm trong chú thích cũng làm test xanh, trong khi cấu hình
// thật đã bị đổi về tick-only. Cùng bài học với lần đếm nhầm hit trong CSS.
const WF = WF_RAW.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
/** Riêng khối `PROBE_MODE:` — chốt phải nhắm đúng chỗ quyết định hành vi. */
const PROBE_MODE_BLOCK = (/PROBE_MODE:[\s\S]*?(?=\njobs:)/.exec(WF) || [''])[0];

const T0 = 1_785_000_000_000; // mốc cố định; không dùng Date.now() trong test
const MIN = 60_000;

/** Dãy mẫu đạt chuẩn: n mẫu, cách đều `stepMin` phút, tất cả OK. */
const series = (n, stepMin, over = {}) =>
  Array.from({ length: n }, (_, i) => ({
    at: T0 + i * stepMin * MIN, ok: true, status: 200, route: '/profile', ...over,
  }));

/**
 * Chấm với `now` tiêm vào = ngay sau mẫu cuối.
 *
 * Thời gian phải là tham số, không phải biến ẩn: verdict nay đòi sổ còn TƯƠI
 * (review #910 vòng 2), nên một test dùng mốc cố định trong quá khứ mà đọc
 * `Date.now()` sẽ đỏ dần theo lịch — kiểu test hỏng theo thời gian, tệ nhất là
 * nó hỏng vào lúc không ai đang sửa gì.
 */
const judge = (rows, opts = {}) => {
  const last = Math.max(...rows.map((r) => r.at).filter(Number.isFinite));
  return evaluateG2(rows, { now: last + 60_000, ...opts });
};

/** Dãy đạt cả sàn authenticated (có request hai phía mốc refresh). */
function authedSeries() {
  const rows = series(73, 20);
  rows.forEach((r, i) => { r.afterRefresh = i >= 4; }); // refresh sau ~80 phút
  return rows;
}

describe('sàn G2 — ca ĐẠT', () => {
  test('72 mẫu, cách đều 20 phút, trải đúng 24h ⇒ ĐẠT (lớp ẩn danh)', () => {
    const r = judge(series(73, 20));
    assert.equal(r.pass, true, formatG2(r));
    assert.equal(r.stats.n, 73);
    assert.ok(r.stats.spanHours >= 24);
    assert.ok(r.stats.maxGapMinutes <= 20);
  });

  test('lớp có đăng nhập cần thêm token refresh — dãy đủ thì ĐẠT', () => {
    const r = judge(authedSeries(), { authenticated: true });
    assert.equal(r.pass, true, formatG2(r));
  });
});

describe('sàn G2 — những ca PHẢI bị từ chối', () => {
  test('BẮN DỒN: 72 mẫu trong 5 phút ⇒ TỪ CHỐI (đây là ca của review #909)', () => {
    // 72 mẫu cách nhau 4 giây: thoả n, thoả nhịp, nhưng trải vỏn vẹn ~4,7 phút.
    const burst = Array.from({ length: 72 }, (_, i) => ({
      at: T0 + i * 4000, ok: true, status: 200,
    }));
    const r = judge(burst);
    assert.equal(r.pass, false, 'chùm dày mà PASS thì sàn vô dụng');
    assert.ok(r.findings.some((f) => f.code === 'span-too-short'),
      'phải từ chối vì TRẢI quá ngắn — n và nhịp đều đẹp nên chỉ mình nó chặn được');
  });

  test('đủ trải nhưng có MỘT quãng đứt vượt sàn ⇒ TỪ CHỐI', () => {
    // Quãng đứt phải vượt SÀN HIỆN HÀNH (360′). Đây là lần thứ ba phải chỉnh
    // con số này theo sàn — mỗi lần nới sàn mà quên chỉnh thì test xanh trong
    // khi chẳng kiểm gì. Neo vào chính hằng số sàn để lần sau khỏi lệch.
    const overFloor = G2_FLOOR.maxGapMs / MIN + 60; // vượt sàn 1 tiếng
    const rows = series(80, 20);
    for (let i = 40; i < rows.length; i++) rows[i].at += overFloor * MIN;
    const r = judge(rows);
    assert.equal(r.pass, false);
    // Đứt quãng nay CẮT dãy: phần sau khoảng trống quá ngắn để đạt sàn.
    assert.ok(r.findings.some((f) => f.code === 'span-too-short'));
    assert.ok(r.findings.some((f) => f.code === 'coverage-interrupted'));
  });

  test('nhịp TRUNG BÌNH đẹp vẫn không cứu được quãng đứt dài', () => {
    // Chốt chặn cho lựa chọn thiết kế: đo khoảng cách LỚN NHẤT, không đo trung
    // bình. Dãy dưới có trung bình ~20 phút nhưng đứt một quãng 6 tiếng.
    const dense = Array.from({ length: 60 }, (_, i) => ({ at: T0 + i * MIN, ok: true }));
    const later = Array.from({ length: 20 }, (_, i) => ({
      // Cách xa hơn SÀN (neo vào hằng số, không gõ tay con số).
      at: T0 + G2_FLOOR.maxGapMs + 60 * MIN + i * 20 * MIN, ok: true,
    }));
    const r = judge([...dense, ...later]);
    assert.equal(r.pass, false, 'trung bình đẹp mà vẫn có lỗ 6 tiếng — phải bị bắt');
    assert.ok(r.findings.some((f) => f.code === 'coverage-interrupted'),
      'và phải NÊU TÊN chỗ đứt, không chỉ nói "thiếu mẫu"');
  });

  test('KHÔNG còn đếm mẫu: 6 mẫu trải 25h, lỗ 5h ⇒ ĐẠT', () => {
    // ADR-013-A2 bỏ `n≥72`: probe TẤT ĐỊNH nên đếm mẫu không thêm thông tin;
    // thứ có nghĩa là phủ được bao nhiêu THỜI GIAN. Số mẫu tối thiểu tự suy ra
    // từ trải/lỗ (≈4). Test này chốt việc bỏ đó là CÓ CHỦ Ý, không phải sót.
    const H = 60 * MIN;
    const rows = [0, 5, 10, 15, 20, 25].map((h) => ({ at: T0 + h * H, ok: true }));
    const r = evaluateG2(rows, { now: rows[rows.length - 1].at + MIN });
    assert.equal(r.pass, true, formatG2(r));
    assert.equal(r.stats.n, 6, 'sáu mẫu là đủ khi chúng phủ trọn một ngày');
    assert.ok(!('minSamples' in G2_FLOOR), 'sàn không được có lại ngưỡng đếm mẫu');
  });

  test('trải chưa đủ 24h ⇒ TỪ CHỐI dù không có lỗ nào', () => {
    const H = 60 * MIN;
    const rows = [0, 4, 8, 12].map((h) => ({ at: T0 + h * H, ok: true }));
    const r = evaluateG2(rows, { now: rows[rows.length - 1].at + MIN });
    assert.equal(r.pass, false);
    assert.ok(r.findings.some((f) => f.code === 'span-too-short'));
  });

  test('có probe hỏng ⇒ TỪ CHỐI, và nêu đích danh', () => {
    const rows = series(73, 20);
    rows[10] = { ...rows[10], ok: false, status: 401, note: 'token hết hạn' };
    const r = judge(rows);
    assert.equal(r.pass, false);
    const f = r.findings.find((x) => x.code === 'probe-failed');
    assert.match(f.detail, /401/);
    assert.match(f.detail, /token hết hạn/);
  });

  test('lớp có đăng nhập mà KHÔNG qua token refresh ⇒ TỪ CHỐI', () => {
    const r = judge(series(73, 20), { authenticated: true });
    assert.equal(r.pass, false);
    assert.ok(r.findings.some((f) => f.code === 'no-token-refresh'));
    // …trong khi cùng dãy đó ở lớp ẩn danh thì ĐẠT — chốt chặn cho thấy điều
    // kiện này thật sự riêng của lớp authenticated, không phải luôn-đỏ.
    assert.equal(judge(series(73, 20)).pass, true);
  });

  test('chỉ có request SAU mốc refresh, không có trước ⇒ TỪ CHỐI', () => {
    const rows = series(73, 20).map((r) => ({ ...r, afterRefresh: true }));
    const r = judge(rows, { authenticated: true });
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
    assert.equal(judge(shuffled).pass, true);
  });

  test('mốc thời gian hỏng thì bị loại, không làm sai phép đo', () => {
    const rows = [...series(73, 20), { at: NaN, ok: true }, { ok: true }];
    const r = judge(rows);
    assert.equal(r.stats.n, 73);
    assert.equal(r.pass, true);
  });

  test('sàn khớp đúng ADR-013-A2', () => {
    assert.ok(!('minSamples' in G2_FLOOR), 'A2 bỏ đếm mẫu — xem bình luận nguồn');
    assert.equal(G2_FLOOR.minSpanMs, 24 * 60 * 60 * 1000,
      'trải ≥24h giữ nguyên — sàn cho cache hết hạn (ADR-008 expire=86400)');
    assert.equal(G2_FLOOR.maxGapMs, 360 * 60 * 1000,
      'lỗ suy từ mốc MẪU (max thật 221′), không phải mốc chạy');
  });

  test('formatG2 nói rõ ĐẠT hay CHƯA, không mập mờ', () => {
    assert.match(formatG2(judge(series(73, 20))), /ĐẠT sàn ADR-013-A1/);
    assert.match(formatG2(evaluateG2([])), /CHƯA ĐẠT[\s\S]*no-samples/);
  });
});

describe('planSession — lịch phiên đi qua mốc token refresh (review #910)', () => {
  const H = 60 * 60_000;

  test('KHÔNG probe bằng token cũ ở hoặc sau hạn — đây là ca hỏng thật', () => {
    // Bản đầu probe ở phút 60 (đúng hạn) rồi refresh ở phút 75 ⇒ mẫu phút 60
    // đã hết hạn, ghi vào sổ là HỎNG, và verdict đánh trượt một phiên khoẻ.
    const p = planSession({ expiresInMs: H, stepMs: 15 * 60_000 });
    assert.deepEqual(p.preOffsets.map((x) => x / 60_000), [0, 15, 30, 45]);
    for (const off of p.preOffsets) {
      assert.ok(off < H, `nhịp phút ${off / 60000} phải nằm TRƯỚC hạn 60 phút`);
      assert.ok(off <= p.safeUntil, 'và phải trong biên an toàn');
    }
  });

  test('refresh nằm SAU hạn, không phải refresh sớm cho tiện', () => {
    const p = planSession({ expiresInMs: H, stepMs: 15 * 60_000 });
    assert.ok(p.refreshAt > H, 'refresh trước hạn thì không chứng minh đi qua mốc');
    assert.equal(p.refreshAt / 60_000, 61);
  });

  test('trần thời gian không đủ ⇒ nói ra, không lặng lẽ ghi khống', () => {
    const p = planSession({ expiresInMs: H, stepMs: 15 * 60_000, maxMs: 30 * 60_000 });
    assert.equal(p.coversRefresh, false);
  });

  test('token sống ngắn hơn thì lịch co lại theo, không hardcode 60 phút', () => {
    const p = planSession({ expiresInMs: 20 * 60_000, stepMs: 5 * 60_000, marginMs: 2 * 60_000 });
    assert.deepEqual(p.preOffsets.map((x) => x / 60_000), [0, 5, 10, 15]);
    assert.equal(p.refreshAt / 60_000, 21);
  });
});

describe('workflow chọn đúng chế độ theo cron (review #910)', () => {
  test('cron phiên-dài phải ra `session`, không phải `tick`', () => {
    // `schedule` không có `inputs`, nên `inputs.mode || 'tick'` biến CẢ HAI cron
    // thành tick và sổ authed vĩnh viễn thiếu afterRefresh.
    assert.ok(PROBE_MODE_BLOCK, 'phải có khối env PROBE_MODE');
    assert.match(PROBE_MODE_BLOCK, /github\.event\.schedule == '17 3 \* \* \*' && 'session'/,
      'biểu thức chọn chế độ phải nằm trong CHÍNH khối PROBE_MODE, không phải trong chú thích');
    assert.ok(!/--mode "\$\{\{ inputs\.mode \|\| 'tick' \}\}"/.test(WF),
      'dạng cũ chọn chế độ chỉ từ inputs — cron sẽ luôn ra tick');
  });

  test('tick và session KHÔNG dùng chung concurrency group', () => {
    // Dùng chung group: phiên ~61 phút chiếm chỗ, tick trong khoảng đó bị huỷ
    // (GitHub chỉ giữ MỘT run pending mỗi group) ⇒ mỗi ngày thủng lỗ >60 phút
    // ⇒ dãy liên tục bị cắt ⇒ verdict trượt vĩnh viễn dù hệ thống khoẻ.
    // Regex phải nuốt cả GIÁ TRỊ của `cancel-in-progress`; bản lười dừng ngay
    // ở dấu hai chấm nên khẳng định về `false` không bao giờ đúng được.
    const block = (/concurrency:[\s\S]*?cancel-in-progress:\s*\S+/.exec(WF) || [''])[0];
    assert.ok(block, 'phải có khối concurrency');
    assert.match(block, /group:[\s\S]*inputs\.mode/,
      'group phải phân biệt theo chế độ, không phải một chuỗi cố định');
    assert.ok(!/group:\s*g2-authed-probe\s*$/m.test(block),
      'group cố định = tick bị phiên dài nuốt mất');
    assert.match(block, /cancel-in-progress: false/,
      'huỷ giữa chừng phiên dài là mất vế token refresh');
  });

  test('verdict CHƯA ĐẠT không được đánh đỏ nhịp tick', () => {
    // Đo thật ở lần chạy tay đầu tiên: probe OK (200/200) nhưng job vẫn đỏ vì
    // `n=1 < 72`. Bật cron với cấu hình đó = ~72 job đỏ/ngày trong ngày đầu,
    // và một cổng bị phớt lờ thì không còn là cổng.
    const step = (/- name: Chấm sàn[\s\S]*$/.exec(WF) || [''])[0];
    assert.ok(step, 'phải có bước chấm sàn');
    assert.match(step, /if \[ "\$PROBE_MODE" = "verdict" \]/,
      'chỉ chế độ verdict mới được đánh đỏ job');
    assert.ok(!/run: node tooling\/authed-probe\.mjs --mode verdict\s*$/m.test(step),
      'gọi trần = mã thoát của verdict đánh đỏ mọi nhịp tick');
  });

  test('cron ĐÃ bật, đúng hai lịch của sàn ADR-013-A1', () => {
    assert.match(WF, /^\s*schedule:/m, 'schedule phải đang hoạt động');
    // Nhịp 20 phút là ĐIỀU KIỆN của sàn (n≥72 · trải ≥24h · nhịp ≤20 phút),
    // không phải lựa chọn tuỳ ý: 72 × 20 phút = đúng 24h.
    // 15 phút chứ KHÔNG 20: xem test mô phỏng độ trễ bên dưới.
    assert.match(WF, /cron: "\*\/15 \* \* \* \*"/);
    assert.ok(!/cron: "\*\/20 \* \* \* \*"/.test(WF),
      'cron đúng bằng sàn 20 phút = một lần trễ là mất sạch lịch sử');
    // Và lịch phiên dài phải khớp CHÍNH chuỗi mà PROBE_MODE dò để chọn
    // `session`; lệch một ký tự là cron đó âm thầm chạy `tick`.
    assert.match(WF, /cron: "17 3 \* \* \*"/);
    assert.match(PROBE_MODE_BLOCK, /'17 3 \* \* \*'/,
      'chuỗi cron phiên-dài phải khớp giữa `schedule` và `PROBE_MODE`');
    assert.match(WF, /PROBE_EMAIL/);
  });
});

describe('probe gọi ĐÚNG endpoint (review #910)', () => {
  test('không có tiền tố /api — router auth gắn prefix /auth', () => {
    // Đo trên production 2026-08-03:
    //   /api/auth/me → 404      /auth/me      → 401
    //   /api/profile → 404      /auth/profile → 401
    // 404 = không có route. Bản đầu dùng /api/... nên MỌI mẫu sẽ HỎNG và G2
    // không bao giờ đạt được — công cụ chết ngay khi bật, mà lại chết theo
    // kiểu trông như "production hỏng".
    assert.match(PROBE, /'--routes', '\/auth\/profile,\/auth\/check-active'/);
    assert.ok(!/--routes', '\/api\//.test(PROBE),
      'tiền tố /api quay lại nghĩa là probe trỏ vào route không tồn tại');
  });

  test('chỉ phát GET tới backend — CHỈ ĐỌC là ràng buộc cứng', () => {
    const methods = [...PROBE.matchAll(/method: '([A-Z]+)'/g)].map((m) => m[1]);
    // Hai POST duy nhất là của Supabase auth (đăng nhập + refresh), không phải
    // ghi vào dữ liệu sản phẩm.
    assert.equal(methods.filter((m) => m === 'GET').length, 1, 'đúng một chỗ gọi backend');
    assert.ok(!/method: '(PUT|PATCH|DELETE)'/.test(PROBE), 'không có nhánh ghi nào');
  });
});

describe('sổ phải TƯƠI và LÀNH (review #910 vòng 2)', () => {
  test('sổ tốt nhưng cũ ⇒ TỪ CHỐI, không "hôm kia đạt nên hôm nay đạt"', () => {
    const rows = series(73, 20);
    const last = rows[rows.length - 1].at;
    const r = evaluateG2(rows, { now: last + 3 * 24 * 3600_000 });
    assert.equal(r.pass, false);
    assert.ok(r.findings.some((f) => f.code === 'ledger-stale'));
    // …mà chính dãy đó, chấm đúng lúc, thì ĐẠT — chốt chặn để chắc rằng chốt
    // mới không phải "luôn đỏ".
    assert.equal(evaluateG2(rows, { now: last + 60_000 }).pass, true);
  });

  test('một lỗi CŨ của đợt trước không đầu độc đợt hiện tại mãi mãi', () => {
    // Trước bản này, verdict chấm toàn bộ sổ nên một lần 500 thoáng qua nằm
    // lại là mọi verdict về sau đỏ vĩnh viễn, kể cả sau trọn một ngày sạch.
    const good = series(73, 20);
    const ancient = { at: good[0].at - 10 * 24 * 3600_000, ok: false, status: 500 };
    const r = judge([ancient, ...good]);
    assert.equal(r.pass, true, 'đợt cũ phải rơi ra vì cách một khoảng trống lớn');
    assert.equal(r.stats.droppedOlderRuns, 1);
  });

  test('lỗi TRONG đợt hiện tại thì vẫn chặn', () => {
    const rows = series(73, 20);
    rows[50] = { ...rows[50], ok: false, status: 500 };
    assert.equal(judge(rows).pass, false, 'không được nhân danh "cửa sổ" mà bỏ lỗi thật');
  });

  test('parseLedger ĐẾM dòng hỏng thay vì vứt im lặng', () => {
    // Negative control lần đầu KHÔNG đỏ khi gỡ phép đếm, vì test lúc đó truyền
    // thẳng `corruptLines` vào bộ chấm — tức chỉ kiểm bộ chấm, không kiểm bộ
    // đọc. Nay phân tích sổ nằm ở lõi và được kiểm bằng dữ liệu thật.
    const text = [
      '{"at":1,"ok":true}',
      '{"at":2,"ok":fal',        // dòng bị cắt cụt giữa chừng
      '',
      '{"at":3,"ok":true}',
      'null',                     // JSON hợp lệ nhưng không phải bản ghi
    ].join('\n');
    const { samples, corruptLines } = parseLedger(text);
    assert.equal(samples.length, 2);
    assert.equal(corruptLines, 2, 'cả dòng cụt lẫn `null` đều phải bị tính là hỏng');
  });

  test('dòng sổ hỏng ⇒ TỪ CHỐI, không lặng lẽ vứt đi', () => {
    const r = judge(series(73, 20), { corruptLines: 2 });
    assert.equal(r.pass, false);
    assert.ok(r.findings.some((f) => f.code === 'ledger-corrupt'));
  });
});

describe('probe không gọi endpoint CÓ GHI (review #910 vòng 2)', () => {
  test('/auth/me bị loại khỏi mặc định — nó INSERT + UPDATE last_seen_at', () => {
    // auth.py:188–214: GET /auth/me tạo hàng users nếu chưa có và cập nhật
    // last_seen_at MỖI lần gọi. Cron 20 phút = 72 lần ghi/ngày vào bảng người
    // dùng. "Phương thức GET" không có nghĩa là "không tác dụng phụ".
    assert.match(PROBE, /'--routes', '\/auth\/profile,\/auth\/check-active'/);
    assert.ok(!/--routes'[^)]*\/auth\/me/.test(PROBE),
      '/auth/me quay lại mặc định nghĩa là probe lại ghi vào dữ liệu thật');
  });
});

describe('sổ tách theo chế độ rồi gộp (review #911)', () => {
  test('mẫu của CẢ HAI nhánh song song đều còn — không bên nào bị đè', () => {
    // Kịch bản thật: session giữ sổ ~61 phút; trong lúc đó 3 tick ghi thêm.
    // Nếu dùng chung một tệp thì bên lưu sau đè mất bên kia.
    const tickRows = [
      { at: 1000, ok: true }, { at: 2000, ok: false, status: 500 }, { at: 3000, ok: true },
    ];
    const sessionRows = [
      { at: 500, ok: true, afterRefresh: false }, { at: 4000, ok: true, afterRefresh: true },
    ];
    const merged = mergeLedgers([
      { samples: tickRows, corruptLines: 0 },
      { samples: sessionRows, corruptLines: 1 },
    ]);
    assert.equal(merged.samples.length, 5, 'đủ 5 mẫu của cả hai nhánh');
    assert.equal(merged.corruptLines, 1, 'dòng hỏng của mọi sổ đều được cộng dồn');
    assert.deepEqual(merged.samples.map((r) => r.at), [500, 1000, 2000, 3000, 4000],
      'gộp xong phải theo thứ tự thời gian');
    // Và lần 500 do tick ghi PHẢI còn để verdict bắt được.
    assert.ok(merged.samples.some((r) => r.status === 500),
      'mất mẫu hỏng nghĩa là verdict cho qua trên bằng chứng khuyết');
  });

  test('gộp sổ rỗng không làm hỏng phép đo', () => {
    assert.deepEqual(mergeLedgers([]), { samples: [], corruptLines: 0 });
    assert.deepEqual(mergeLedgers(null), { samples: [], corruptLines: 0 });
  });

  test('workflow lưu sổ RIÊNG cho từng chế độ', () => {
    assert.match(WF, /path: frontend\/out\/g2-ledger-\$\{\{ env\.PROBE_MODE \}\}\.jsonl/);
    assert.match(WF, /key: g2-ledger-\$\{\{ env\.PROBE_MODE \}\}-/);
    assert.ok(!/key: g2-ledger-\$\{\{ github\.run_id \}\}\s*$/m.test(WF),
      'khoá cache dùng chung = hai chế độ đè sổ của nhau');
    // Và verdict phải khôi phục CẢ HAI sổ, nếu không nó chấm trên nửa bằng chứng.
    assert.match(WF, /restore-keys:[\s\S]*g2-ledger-tick-/);
    assert.match(WF, /restore-keys:[\s\S]*g2-ledger-session-/);
  });
});

describe('lịch cron phải CHẶT HƠN sàn (review #913)', () => {
  const T0b = 1_785_000_000_000;
  const MINb = 60_000;
  // Độ trễ tất định, lặp lại được — không dùng Math.random để test khỏi chớp.
  const JITTER = [0, 3, 1, 4, 2];
  const runsOverDay = (stepMin, hours = 26) => {
    const n = Math.floor((hours * 60) / stepMin);
    return Array.from({ length: n }, (_, k) => ({
      at: T0b + (k * stepMin + JITTER[k % JITTER.length]) * MINb, ok: true,
    }));
  };
  const judgeRuns = (rows) =>
    evaluateG2(rows, { now: rows[rows.length - 1].at + MINb });

  test('lỗ mẫu THỰC ĐO tới 221 phút vẫn nằm dưới sàn', () => {
    // Đây là điều kiện tối thiểu để G2 có nghĩa: sàn phải KHẢ THI với hành vi
    // thật của bộ lập lịch. Lỗ lớn nhất đo được giữa các MẪU là 221 phút.
    assert.ok(221 * 60_000 < G2_FLOOR.maxGapMs,
      'sàn phải nằm trên lỗ lớn nhất từng đo, nếu không dãy đứt liên tục');
  });

  test('nhịp THỰC ĐO ~84 phút vẫn đạt được sàn hiện hành', () => {
    // Đây là điều kiện tối thiểu để G2 có nghĩa: sàn phải KHẢ THI với bộ lập
    // lịch thật. Dãy dưới mô phỏng đúng phân bố đã đo (84′ ± dao động lớn).
    const jitter = [0, 26, -23, 73, 1, -17, 92, -20];
    const rows = Array.from({ length: 80 }, (_, k) => ({
      at: T0b + (k * 84 + jitter[k % jitter.length]) * MINb, ok: true,
      afterRefresh: k >= 3,
    }));
    const r = judgeRuns(rows);
    assert.equal(r.pass, true, formatG2(r));
    assert.ok(r.stats.spanHours >= 24);
  });

  test('lịch khai vẫn phải chặt hơn sàn — bài học không mất đi', () => {
    // Nới sàn KHÔNG có nghĩa là đặt lịch sát mép cũng được. Lịch khai `*/15`
    // giữ nguyên: nó là thứ ta điều khiển được, và càng dày thì càng nhiều mẫu.
    // Cái không điều khiển được là bộ lập lịch có chạy đúng hay không.
    const declared = 15 * 60_000;
    assert.ok(declared < G2_FLOOR.maxGapMs,
      'lịch khai phải nằm dưới sàn, kể cả khi sàn đã nới');
  });

  test('nới sàn PHẢI kèm cơ sở đo và lời khai cái bị mất', () => {
    // Chốt cũ khoá cứng `maxGapMs === 20 phút` để chặn việc hạ sàn cho hết đỏ.
    // Nay sàn ĐÃ đổi — nhưng đổi vì ĐO, không vì tiện. Nên chốt đổi thứ nó gác:
    // ai chỉnh sàn lần sau cũng phải cập nhật cơ sở đo và ghi cái đánh mất,
    // không được lặng lẽ sửa một con số.
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tooling', 'g2-floor.mjs'),
      'utf8');
    assert.match(src, /lỗ 12·4·221·176·157·110·83·85·67·61·69 phút/,
      'phải giữ số liệu thô đã dùng để chọn sàn');
    assert.match(src, /221 phút/, 'phải ghi lỗ MẪU lớn nhất, không phải lỗ giữa các lần chạy');
    assert.ok(G2_FLOOR_TRADEOFF && /lọt/.test(G2_FLOOR_TRADEOFF),
      'phải khai rõ cái bị mất khi nới sàn');
  });
});

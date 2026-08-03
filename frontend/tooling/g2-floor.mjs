// Lõi thuần chấm sàn G2 của ADR-013-A1. Không I/O, không mạng — để `node --test`
// kiểm được HÀNH VI, không phải regex trên mã nguồn.
//
// SÀN (ADR-013 mục "Sửa đổi A1"), cả ba bắt buộc:
//   n ≥ 72           giữ cơ sở power của A0 (DEBT-2026-07-22-H)
//   trải ≥ 24h       ADR-008 đặt expire=86400 cho cache công khai; dưới 24h
//                    thì không đi qua lần hết hạn cứng nào
//   nhịp ≤ 20 phút   72 × 20 phút = đúng 24h, ba con số nhất quán
//
// Vì sao đo KHOẢNG CÁCH LỚN NHẤT chứ không đo nhịp trung bình: review PR #909
// chỉ ra rằng để nhịp là biến số thì 72 probe bắn dồn trong ít phút vẫn PASS,
// xoá sạch chính vế thời-gian-trôi mà G2 sinh ra để phủ. Trung bình cũng vậy —
// một chùm dày cộng một quãng đứt dài vẫn cho trung bình đẹp. Chỉ khoảng cách
// lớn nhất mới bảo chứng "trải đều".
//
// Lớp authenticated có thêm điều kiện: phiên probe phải SỐNG QUA ít nhất một
// lần token refresh, với request ở CẢ HAI phía mốc đó — token refresh là chế độ
// hỏng thời-gian-trôi riêng của lớp này, và một probe đăng nhập lại mỗi lần gọi
// sẽ không bao giờ chạm tới nó.

export const G2_FLOOR = {
  minSamples: 72,
  minSpanMs: 24 * 60 * 60 * 1000,
  maxGapMs: 20 * 60 * 1000,
};

/**
 * @typedef {{at: number, ok: boolean, status?: number, route?: string,
 *            tokenAgeMs?: number, afterRefresh?: boolean, note?: string}} Sample
 */

/**
 * @param {Sample[]} samples
 * @param {{authenticated?: boolean, floor?: typeof G2_FLOOR}} [opts]
 */
export function evaluateG2(samples, opts = {}) {
  const { authenticated = false, floor = G2_FLOOR } = opts;
  const findings = [];
  const add = (code, detail) => findings.push({ code, detail });

  const rows = [...(samples || [])]
    .filter((s) => s && Number.isFinite(s.at))
    .sort((a, b) => a.at - b.at);

  if (!rows.length) {
    // Không có sổ = KHÔNG ĐẠT, không phải "chưa có dữ liệu nên cho qua". Đây là
    // đúng chỗ mà một cổng dễ tự biến thành con dấu.
    add('no-samples', 'chưa có mẫu nào — G2 chưa chạy, không phải G2 đã đạt');
    // `authenticated` phải có mặt cả ở nhánh này, nếu không dòng in ra sẽ ghi
    // nhầm "lớp ẩn danh" cho một lần chấm lớp có-đăng-nhập — nhãn sai trên
    // báo cáo là cách nhanh nhất để một cổng bị hiểu nhầm.
    return { pass: false, findings,
             stats: { n: 0, spanMs: 0, spanHours: 0, maxGapMs: null,
                      maxGapMinutes: 0, failed: 0, authenticated } };
  }

  const n = rows.length;
  const spanMs = rows[n - 1].at - rows[0].at;
  let maxGapMs = 0;
  let maxGapAt = null;
  for (let i = 1; i < n; i++) {
    const gap = rows[i].at - rows[i - 1].at;
    if (gap > maxGapMs) { maxGapMs = gap; maxGapAt = rows[i].at; }
  }

  if (n < floor.minSamples) add('too-few-samples', `n=${n} < ${floor.minSamples}`);
  if (spanMs < floor.minSpanMs) {
    add('span-too-short',
      `trải ${(spanMs / 3600000).toFixed(1)}h < ${floor.minSpanMs / 3600000}h`);
  }
  if (n > 1 && maxGapMs > floor.maxGapMs) {
    add('gap-too-long',
      `khoảng cách lớn nhất ${(maxGapMs / 60000).toFixed(1)} phút > `
      + `${floor.maxGapMs / 60000} phút (tại mốc ${maxGapAt})`);
  }

  const failed = rows.filter((s) => !s.ok);
  for (const f of failed.slice(0, 10)) {
    add('probe-failed', `mốc ${f.at}${f.status ? ` HTTP ${f.status}` : ''}${f.note ? ` — ${f.note}` : ''}`);
  }
  if (failed.length > 10) add('probe-failed', `… và ${failed.length - 10} lần hỏng nữa`);

  if (authenticated) {
    const covered = rows.some((s) => s.afterRefresh === true);
    const before = rows.some((s) => s.afterRefresh === false);
    if (!covered || !before) {
      add('no-token-refresh',
        'phiên probe chưa sống qua một lần token refresh có request ở cả hai phía '
        + `(trước=${before}, sau=${covered})`);
    }
  }

  return {
    pass: findings.length === 0,
    findings,
    stats: {
      n,
      spanMs,
      spanHours: Number((spanMs / 3600000).toFixed(2)),
      maxGapMs,
      maxGapMinutes: Number((maxGapMs / 60000).toFixed(2)),
      failed: failed.length,
      authenticated,
    },
  };
}

/** In gọn cho CI. */
export function formatG2(result) {
  const s = result.stats;
  const head = `G2: n=${s.n} · trải ${s.spanHours ?? 0}h · khoảng cách lớn nhất `
    + `${s.maxGapMinutes ?? 0} phút · hỏng ${s.failed ?? 0}`
    + (s.authenticated ? ' · lớp CÓ ĐĂNG NHẬP' : ' · lớp ẩn danh');
  if (result.pass) return `${head}\n✓ ĐẠT sàn ADR-013-A1`;
  return `${head}\n✗ CHƯA ĐẠT:\n`
    + result.findings.map((f) => `  · [${f.code}] ${f.detail}`).join('\n');
}

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
  // KHÔNG CÓ `minSamples`. Bỏ có chủ ý (ADR-013-A2).
  //
  // `n≥72` đến từ phân tích power cho LƯU LƯỢNG ORGANIC — lấy mẫu một quá trình
  // ngẫu nhiên. Probe này TẤT ĐỊNH: cùng tài khoản, cùng endpoint, cùng đường
  // đi. 72 lần thành công giống hệt nhau không cho biết nhiều hơn 20 lần, vì
  // chúng lấy mẫu THỜI GIAN chứ không lấy mẫu ngẫu nhiên. Giữ con số đó chỉ tạo
  // vẻ chặt chẽ giả. Số mẫu tối thiểu nay TỰ SUY RA từ trải/lỗ (≈4).

  // Phải đi qua ít nhất một lần cache hết hạn cứng (ADR-008 `expire: 86400`).
  minSpanMs: 24 * 60 * 60 * 1000,

  // 360 PHÚT — và đây là lần hiệu chỉnh THỨ HAI, vì lần đầu tôi đo sai đại lượng.
  //   A1        : 20 phút, giả định bộ lập lịch giao đúng nhịp khai → sai.
  //   nháp A2   : 240 phút, dựa khoảng cách giữa các LẦN CHẠY (max 176) → vẫn sai
  //               đại lượng: mốc mẫu tính SAU khi runner khởi động + đăng nhập +
  //               gọi HTTP, nên lỗ thật giữa các MẪU lên tới 221 phút ⇒ chỉ 8% biên.
  //   A2        : 360 phút = 1,63× lỗ mẫu lớn nhất đo được (221).
  // Số liệu thô (12 mẫu / 17,5h, 03/08): lỗ 12·4·221·176·157·110·83·85·67·61·69 phút.
  maxGapMs: 360 * 60 * 1000,
};

/**
 * CÁI G2 KHÔNG bảo đảm — ghi ra để không ai đọc nhầm nó là giám sát liên tục.
 * Với lỗ cho phép tới 6 giờ, cổng này chỉ chứng nhận: "route còn phục vụ được
 * suốt một ngày, và có đi qua một lần refresh token". Sự cố ngắn lọt hết.
 */
export const G2_FLOOR_TRADEOFF =
  'lỗ tới 6h được chấp nhận: sự cố tự khỏi trong vài giờ có thể lọt';

/**
 * Phân tích sổ JSONL. Nằm ở lõi chứ không nằm trong runner vì đây là chỗ
 * quyết định "sổ có lành không" — negative control cho thấy khi phép đếm dòng
 * hỏng nằm trong runner thì gỡ nó đi mà KHÔNG test nào đỏ, tức là chốt chặn
 * chỉ tồn tại trên giấy.
 */
export function parseLedger(text) {
  const samples = [];
  let corruptLines = 0;
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (v && typeof v === 'object') samples.push(v);
      else corruptLines += 1;
    } catch { corruptLines += 1; }
  }
  return { samples, corruptLines };
}

/**
 * Gộp nhiều sổ thành một.
 *
 * Vì sao phải TÁCH SỔ THEO CHẾ ĐỘ rồi gộp (review PR #911): sau khi tách
 * concurrency group, `tick` và `session` chạy SONG SONG. Nếu dùng chung một
 * tệp sổ trong cache thì cả hai cùng khôi phục một bản, mỗi bên ghi thêm phần
 * của mình, và bên LƯU SAU đè mất phần của bên kia — một lần 500 do tick ghi
 * có thể biến mất, để lại bằng chứng khuyết mà verdict vẫn cho qua. Mỗi chế độ
 * một tệp ⇒ mỗi tệp chỉ có một người ghi tại một thời điểm ⇒ không mất mẫu.
 */
export function mergeLedgers(parsed) {
  const samples = [];
  let corruptLines = 0;
  for (const one of parsed || []) {
    samples.push(...(one.samples || []));
    corruptLines += one.corruptLines || 0;
  }
  samples.sort((a, b) => (a.at || 0) - (b.at || 0));
  return { samples, corruptLines };
}

/**
 * Lấy DÃY LIÊN TỤC MỚI NHẤT: đi ngược từ mẫu cuối, dừng ở khoảng trống đầu
 * tiên vượt `maxGapMs`.
 *
 * Vì sao cần (review PR #910 vòng 2): trước bản này verdict chấm TOÀN BỘ sổ,
 * không có cửa sổ gần đây. Hai hệ quả ngược nhau đều sai:
 *   · 73 mẫu tốt từ hôm kia làm verdict xanh hôm nay dù hôm nay không phủ gì;
 *   · một lần 500 thoáng qua nằm lại trong sổ làm mọi verdict về sau đỏ mãi,
 *     kể cả khi đã có trọn một ngày sạch.
 * Dãy-liên-tục-mới-nhất giải quyết cả hai mà không cần dọn sổ thủ công: đợt cũ
 * tự rơi ra vì có khoảng trống lớn ngăn cách.
 */
export function trailingRun(rows, maxGapMs) {
  if (!rows.length) return [];
  let start = 0;
  for (let i = rows.length - 1; i > 0; i--) {
    if (rows[i].at - rows[i - 1].at > maxGapMs) { start = i; break; }
  }
  return rows.slice(start);
}

/**
 * @typedef {{at: number, ok: boolean, status?: number, route?: string,
 *            tokenAgeMs?: number, afterRefresh?: boolean, note?: string}} Sample
 */

/**
 * @param {Sample[]} samples
 * @param {{authenticated?: boolean, floor?: typeof G2_FLOOR}} [opts]
 */
export function evaluateG2(samples, opts = {}) {
  const {
    authenticated = false,
    floor = G2_FLOOR,
    now = Date.now(),
    staleGraceMs = 10 * 60_000,
    corruptLines = 0,
  } = opts;
  const findings = [];
  const add = (code, detail) => findings.push({ code, detail });

  let rows = [...(samples || [])]
    .filter((s) => s && Number.isFinite(s.at))
    .sort((a, b) => a.at - b.at);

  // Dòng sổ hỏng thì ĐỔ, không lặng lẽ bỏ qua: một dòng JSONL bị cắt cụt của
  // đúng lần probe HỎNG mà bị vứt đi sẽ biến sổ bẩn thành sổ sạch.
  if (corruptLines > 0) {
    add('ledger-corrupt',
      `${corruptLines} dòng sổ không đọc được — không thể kết luận trên bằng chứng hỏng`);
  }

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

  // Chỉ chấm ĐỢT HIỆN TẠI, và đợt đó phải còn tươi.
  const all = rows;
  const run = trailingRun(all, floor.maxGapMs);
  const dropped = all.length - run.length;
  const ageMs = now - run[run.length - 1].at;
  if (ageMs > floor.maxGapMs + staleGraceMs) {
    add('ledger-stale',
      `mẫu mới nhất cách đây ${(ageMs / 60000).toFixed(1)} phút — sổ cũ, `
      + 'không phải bằng chứng của hiện tại');
  }

  rows = run;
  const n = rows.length;
  const spanMs = rows[n - 1].at - rows[0].at;
  let maxGapMs = 0;
  let maxGapAt = null;
  for (let i = 1; i < n; i++) {
    const gap = rows[i].at - rows[i - 1].at;
    if (gap > maxGapMs) { maxGapMs = gap; maxGapAt = rows[i].at; }
  }

  if (spanMs < floor.minSpanMs) {
    add('span-too-short',
      `trải ${(spanMs / 3600000).toFixed(1)}h < ${floor.minSpanMs / 3600000}h`);
  }
  // KHÔNG còn kiểm `gap-too-long` ở đây: sau khi cắt theo dãy liên tục, mọi
  // khoảng trống > maxGap đều đã nằm NGOÀI dãy, nên nhánh đó là mã chết. Để
  // lại thì nó trông như một lớp bảo vệ đang hoạt động trong khi không hề —
  // đúng kiểu cổng giả mà cả đợt này đi dọn. Đứt quãng nay thể hiện qua việc
  // dãy bị cắt ngắn ⇒ trượt `span-too-short`/`too-few-samples`, và được nêu
  // tên bằng `coverage-interrupted` bên dưới cho dễ chẩn đoán.
  if (dropped > 0) {
    const boundary = all[all.length - run.length - 1];
    const gapMin = ((run[0].at - boundary.at) / 60000).toFixed(1);
    add('coverage-interrupted',
      `đợt đo bị đứt ${gapMin} phút trước mẫu đầu của đợt hiện tại; `
      + `${dropped} mẫu của (các) đợt cũ không được tính`);
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

  // `coverage-interrupted` là NGỮ CẢNH, không tự nó đánh trượt: một đợt 24h
  // sạch nối sau một đợt cũ là chuyện bình thường và đáng PASS.
  const blocking = findings.filter((f) => f.code !== 'coverage-interrupted');
  return {
    pass: blocking.length === 0,
    findings,
    stats: {
      n,
      spanMs,
      spanHours: Number((spanMs / 3600000).toFixed(2)),
      maxGapMs,
      maxGapMinutes: Number((maxGapMs / 60000).toFixed(2)),
      failed: failed.length,
      authenticated,
      // Phân bố khoảng cách THẬT — để lần chỉnh sàn sau dựa vào số liệu.
      gapsMinutes: (() => {
        const g = [];
        for (let i = 1; i < rows.length; i++) g.push((rows[i].at - rows[i - 1].at) / 60000);
        g.sort((a, b) => a - b);
        return g.length
          ? { p50: Number(g[Math.floor(g.length / 2)].toFixed(1)),
              p90: Number(g[Math.max(0, Math.ceil(g.length * 0.9) - 1)].toFixed(1)),
              max: Number(g[g.length - 1].toFixed(1)), n: g.length }
          : null;
      })(),
      droppedOlderRuns: dropped,
      ageMinutes: Number((ageMs / 60000).toFixed(1)),
    },
  };
}

/** In gọn cho CI. */
export function formatG2(result) {
  const s = result.stats;
  const g = s.gapsMinutes;
  const head = `G2: n=${s.n} · trải ${s.spanHours ?? 0}h · khoảng cách lớn nhất `
    + `${s.maxGapMinutes ?? 0} phút · hỏng ${s.failed ?? 0}`
    + (s.authenticated ? ' · lớp CÓ ĐĂNG NHẬP' : ' · lớp ẩn danh')
    + (g ? `\n     phân bố khoảng cách (n=${g.n}): p50 ${g.p50}′ · p90 ${g.p90}′ · max ${g.max}′` : '');
  if (result.pass) return `${head}\n✓ ĐẠT sàn ADR-013-A1`;
  return `${head}\n✗ CHƯA ĐẠT:\n`
    + result.findings.map((f) => `  · [${f.code}] ${f.detail}`).join('\n');
}

/**
 * Lịch của một phiên probe đi QUA mốc token refresh — hàm thuần để kiểm được
 * bằng đồng hồ giả, đúng đề nghị của review PR #910.
 *
 * Bản đầu chạy vòng lặp `waited < holdMin` với holdMin=65, step=15 ⇒ probe ở
 * phút 0/15/30/45/**60** rồi mới ngủ thêm và refresh ở phút **75**. Access
 * token của Supabase sống 60 phút, nên mẫu phút 60 đã hết hạn ⇒ ghi vào sổ
 * dưới dạng HỎNG, và verdict đánh trượt một phiên thực ra hoàn toàn khoẻ.
 * Tức bản vá tự làm mình trượt.
 *
 * Luật đúng: mọi probe bằng token CŨ phải nằm **an toàn trước** hạn (trừ hao
 * `marginMs`), rồi ngủ tới **sau** hạn (thêm `graceMs`) mới refresh — có vậy
 * mới chứng minh được là đã đi qua mốc chứ không phải refresh sớm cho tiện.
 */
export function planSession({
  expiresInMs,
  stepMs,
  marginMs = 5 * 60_000,
  graceMs = 60_000,
  maxMs = 80 * 60_000,
} = {}) {
  const safeUntil = Math.max(0, expiresInMs - marginMs);
  const preOffsets = [];
  for (let t = 0; t <= safeUntil; t += stepMs) preOffsets.push(t);
  const refreshAt = expiresInMs + graceMs;
  // Không đủ trần thời gian để đi qua hạn thì phải NÓI RA, không được lặng lẽ
  // refresh sớm rồi ghi `afterRefresh: true` — đó là ghi khống bằng chứng.
  const coversRefresh = refreshAt <= maxMs;
  return { preOffsets, refreshAt, safeUntil, coversRefresh };
}

// Lõi THUẦN của cổng đường-ghi: khớp request và phán xét.
//
// VÌ SAO CÓ CỔNG NÀY: cổng parity G1 so TRẠNG THÁI TĨNH. Với trang chỉ đọc,
// rủi ro là "nút không làm gì" — đã bịt bằng chốt móc DOM và bộ kiểm luồng.
// Với trang GHI, rủi ro nặng hơn hẳn: **"nút làm SAI việc"** — nộp bài lên
// nhầm assignment, ghi đè bản nháp bằng chuỗi rỗng, nộp hai lần. Không phép so
// tĩnh nào thấy được những chuyện đó.
//
// NGUYÊN TẮC CỦA CỔNG: mọi lời gọi ghi đều phải được KHAI BÁO TRƯỚC. Một
// request ghi không nằm trong bản khai là LỖI, kể cả khi nó "trông vô hại" —
// đó đúng là hình dạng của "nút làm sai việc".
//
// Tách `.mjs` thuần để `node --test` kiểm được phán xét mà không cần trình
// duyệt. Cùng khuôn `lib/when-global-ready.mjs`, `lib/home-metrics.mjs`.

/** Phương thức được coi là GHI. GET/HEAD/OPTIONS thì không. */
export const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const isWrite = (method) => WRITE_METHODS.has(String(method || '').toUpperCase());

/**
 * Chuẩn hoá đường dẫn để so: bỏ origin, bỏ query, và thay các đoạn "giống id"
 * bằng `:id`.
 *
 * VÌ SAO THAY ID: bản khai không thể biết trước uuid do backend sinh. Nhưng
 * KHÔNG được thay bừa — chỉ thay đoạn thật sự giống định danh (uuid, số dài,
 * chuỗi hex). Thay quá tay sẽ khiến `/submit` và `/draft` trông giống nhau và
 * cổng mất khả năng phân biệt hai thao tác có hậu quả rất khác nhau.
 */
export function normalizePath(url) {
  let p = String(url || '');
  p = p.replace(/^[a-z]+:\/\/[^/]+/i, '');   // bỏ origin
  p = p.split('?')[0].split('#')[0];
  return p
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':id';
      if (/^\d{3,}$/.test(seg)) return ':id';
      if (/^[0-9a-f]{16,}$/i.test(seg)) return ':id';
      return seg;
    })
    .join('/');
}

/**
 * Thân request có khớp bản khai không.
 *
 * `expected` là khớp BỘ PHẬN: chỉ những khoá được khai mới bị kiểm. Cố ý —
 * payload thật hay có thêm trường phụ (timestamp, cờ máy khách) mà việc ghim
 * cứng chúng chỉ tạo ra test giòn.
 *
 * Giá trị đặc biệt:
 *   · một hàm  → gọi với giá trị thật, phải trả true
 *   · `NON_EMPTY` → phải là chuỗi/mảng khác rỗng (dùng cho `draft_text`,
 *     `essay_text`: ghi đè bài bằng chuỗi rỗng là mất bài, phải chặn được)
 *   · `NO_LIST` / `NO_TEXT` → khoá không được MANG DỮ LIỆU, theo ĐÚNG kiểu
 *     khai ở backend (xem chú thích tại chỗ khai báo).
 *   · `NO_BODY` (dùng cho cả `body`) → request KHÔNG được có thân.
 *
 * `body` cũng có thể là MỘT HÀM nhận cả thân request — dùng khi các trường phải
 * TƯƠNG QUAN với nhau (ví dụ `q_num` phải khớp đúng `user_answer` của nó); khai
 * từng trường riêng thì một cặp bị hoán đổi vẫn qua (codex cục bộ #969).
 */
export const NON_EMPTY = Symbol('non-empty');


/**
 * "Trường này không được MANG DỮ LIỆU" — hai biến thể theo KIỂU khai ở backend.
 *
 *   `NO_LIST` → trường kiểu danh sách: chỉ nhận VẮNG hoặc `[]`
 *   `NO_TEXT` → trường kiểu chuỗi:     chỉ nhận VẮNG hoặc `''`
 *
 * Dành cho các trường CHÉO-CHẾ-ĐỘ: ba trang Listening dùng chung một đích ghi
 * `POST /api/listening/attempts` và khác nhau đúng ở tên trường bài làm
 * (`mcq_answers` · `answers` · `user_transcript`). Điều cần chặn là DỮ LIỆU rơi
 * vào ô của chế độ khác: `answers: []` ở chế độ MCQ thì vô hại, `answers: ['T']`
 * là hỏng.
 *
 * VÌ SAO TÁCH LÀM HAI thay vì một ký hiệu nhận cả `''` lẫn `[]`: cách gộp mù
 * kiểu, nên một bản port gửi `answers: ''` (trường khai `list[str]`) hay
 * `user_transcript: []` (khai `str`) vẫn xanh — trong khi production trả 422.
 * Ký hiệu phải chặt đúng bằng kiểu nó mô tả, không hơn không kém (bot bắt ở
 * #966 vòng 3).
 *
 * VÌ SAO `null` LUÔN ĐỎ: cả ba trường đều khai kiểu KHÔNG cho null
 * (`user_transcript: str`, `answers: list[str]`, `mcq_answers: list[int]` —
 * `routers/listening.py:326-329`). Nhận null tức bản khai xanh cho một thân
 * request không tồn tại được — đúng loại lỗi ba vòng review ở #962 đã bắt.
 *
 * Ngược lại, `listening_session_id: str | None` (dòng 331) CHO PHÉP null, nên
 * trường đó KHÔNG dùng hai ký hiệu này; nó chỉ cần "vắng hoặc null". Ghim nó
 * bằng "phải vắng hẳn" là đỏ oan với bản port tuần tự hoá đúng luật (bot #966).
 */
/** Request KHÔNG được có thân. Bỏ trống `body` nghĩa là "không soi", nên một
 *  bản port gửi kèm thân tuỳ ý vẫn qua — khác hẳn với "phải rỗng". */
export const NO_BODY = Symbol('no-body');

export const NO_LIST = Symbol('no-list-data');
export const NO_TEXT = Symbol('no-text-data');

export function bodyMatches(actual, expected) {
  if (expected === NO_BODY) {
    const empty = actual == null || actual === '';
    return empty ? { ok: true }
      : { ok: false, why: `phải KHÔNG có thân request, nhận ${JSON.stringify(actual).slice(0, 80)}` };
  }
  if (expected == null) return { ok: true };
  if (actual == null) return { ok: false, why: 'không có thân request' };
  // Hàm ở MỨC ĐỈNH: soi cả thân một lượt. Không có nhánh này thì
  // `Object.entries(fn)` trả mảng RỖNG và bản khai qua âm thầm — một bản khai
  // viết đúng ý định vẫn không kiểm gì cả.
  if (typeof expected === 'function') {
    return expected(actual) ? { ok: true }
      : { ok: false, why: `thân request không thoả điều kiện: ${JSON.stringify(actual).slice(0, 120)}` };
  }
  for (const [k, want] of Object.entries(expected)) {
    const got = actual[k];
    if (want === NO_LIST || want === NO_TEXT) {
      const isList = want === NO_LIST;
      const kind = isList ? 'danh sách' : 'chuỗi';
      if (got === null) {
        return { ok: false, why: `«${k}» = null — kiểu khai ở backend không nhận null (422)` };
      }
      if (got !== undefined) {
        // Sai KIỂU cũng đỏ: `answers: ''` với trường `list[str]` là 422, dù nó
        // "rỗng". Ký hiệu chặt đúng bằng kiểu nó mô tả.
        const rightType = isList ? Array.isArray(got) : typeof got === 'string';
        if (!rightType) {
          return { ok: false, why: `«${k}» phải là ${kind} (nhận ${JSON.stringify(got)})` };
        }
        if (got.length !== 0) {
          return { ok: false, why: `«${k}» mang dữ liệu của chế độ khác (= ${JSON.stringify(got)})` };
        }
      }
      continue;
    }
    if (want === NON_EMPTY) {
      const empty = got == null || (typeof got === 'string' && got.trim() === '')
        || (Array.isArray(got) && got.length === 0);
      if (empty) return { ok: false, why: `«${k}» rỗng — ghi đè bằng rỗng là mất dữ liệu` };
      continue;
    }
    if (typeof want === 'function') {
      if (!want(got)) return { ok: false, why: `«${k}» không thoả điều kiện (nhận ${JSON.stringify(got)})` };
      continue;
    }
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      return { ok: false, why: `«${k}» = ${JSON.stringify(got)}, khai ${JSON.stringify(want)}` };
    }
  }
  return { ok: true };
}

/**
 * Phán xét toàn bộ lượt chạy.
 *
 * @param observed  [{method, url, body}] — theo đúng thứ tự xảy ra
 * @param declared  [{method, path, body?, times?}] — `times` mặc định 1
 * @param opts.ignore  đường dẫn được phép ghi mà không cần khai (telemetry)
 */
export function judge(observed, declared, { ignore = [] } = {}) {
  const findings = [];
  const writes = (observed || []).filter((r) => isWrite(r.method));
  const ignored = new Set(ignore.map(normalizePath));

  const remaining = writes.filter((r) => !ignored.has(normalizePath(r.url)));
  const used = new Array(remaining.length).fill(false);

  // THỨ TỰ CÓ NGHĨA. Bản đầu khớp mỗi bản khai với BẤT KỲ request chưa dùng nào
  // trong cả lượt, nên `submit` xảy ra TRƯỚC `draft` vẫn qua một bản khai ghi
  // `draft` trước `submit` (Codex bắt ở PR #944). Với luồng ghi thì đó đúng là
  // hồi quy cần bắt: nộp bài trước khi lưu nháp nghĩa là nộp bản cũ.
  //
  // Nên khớp theo CON TRỎ TIẾN: mỗi bản khai chỉ nhận request từ vị trí con trỏ
  // trở đi. Bản khai nào thật sự không phụ thuộc thứ tự thì khai `unordered:
  // true` — phải nói ra, không mặc định.
  let cursor = 0;

  for (const d of declared || []) {
    const wantPath = normalizePath(d.path);
    const wantMethod = String(d.method).toUpperCase();
    const times = d.times == null ? 1 : d.times;
    const from = d.unordered ? 0 : cursor;

    const matchAt = (i) => !used[i]
      && String(remaining[i].method).toUpperCase() === wantMethod
      && normalizePath(remaining[i].url) === wantPath;

    const hits = [];
    for (let i = from; i < remaining.length && hits.length < times; i += 1) {
      if (matchAt(i)) hits.push(i);
    }

    if (hits.length !== times) {
      // Phân biệt "không xảy ra" với "xảy ra SAI THỨ TỰ" — hai lỗi khác nhau,
      // và gộp chúng lại thì người đọc báo cáo đi sai hướng.
      const earlier = [];
      for (let i = 0; i < from; i += 1) if (matchAt(i)) earlier.push(i);
      if (earlier.length && !d.unordered) {
        findings.push({
          kind: 'write-order',
          what: `${wantMethod} ${wantPath}`,
          why: 'xảy ra TRƯỚC bản khai đứng trước nó — sai thứ tự là sai nghiệp vụ '
            + '(ví dụ nộp bài trước khi lưu nháp = nộp bản cũ)',
        });
        earlier.forEach((i) => { used[i] = true; });
      } else {
        findings.push({
          kind: hits.length === 0 ? 'write-missing' : 'write-count',
          what: `${wantMethod} ${wantPath}`,
          why: `khai ${times} lần, thấy ${hits.length}`
            + (times === 1 && hits.length > 1 ? ' — nộp hai lần là hỏng dữ liệu thật' : ''),
        });
      }
    }

    // THỪA so với bản khai cũng phải gọi ĐÚNG TÊN. Nếu chỉ để chúng rơi xuống
    // "write-undeclared" thì báo cáo nói "có một đường ghi lạ", trong khi sự
    // thật là "nộp hai lần" — người đọc sẽ đi sai hướng ngay từ đầu.
    if (hits.length === times) {
      const extra = [];
      for (let i = 0; i < remaining.length; i += 1) {
        if (!hits.includes(i) && matchAt(i)) extra.push(i);
      }
      if (extra.length) {
        findings.push({
          kind: 'write-count',
          what: `${wantMethod} ${wantPath}`,
          why: `khai ${times} lần, thấy ${times + extra.length}`
            + (times === 1 ? ' — nộp hai lần là hỏng dữ liệu thật' : ''),
        });
        extra.forEach((i) => { used[i] = true; });
      }
    }

    for (const i of hits) {
      used[i] = true;
      if (!d.unordered) cursor = Math.max(cursor, i + 1);
      const m = bodyMatches(remaining[i].body, d.body);
      if (!m.ok) {
        findings.push({ kind: 'write-body', what: `${wantMethod} ${wantPath}`, why: m.why });
      }
      // TIÊU ĐỀ cũng là một phần hợp đồng. Tên tiêu đề KHÔNG phân biệt hoa
      // thường (RFC 9110 §5.1) nên hạ về chữ thường cả hai vế — so thẳng thì một
      // bản port viết `x-reading-anon` sẽ đỏ oan.
      // Khai `headers` sai kiểu là LỖI, không phải "bỏ qua": `headers: true` hay
      // một hàm đều làm `Object.entries` trả mảng RỖNG, nên bản khai đọc như
      // đang ghim tiêu đề trong khi nó không ghim gì. Cùng họ với `bodyAll` ở
      // #969 (codex cục bộ #973).
      if (d.headers != null
          && (typeof d.headers !== 'object' || Array.isArray(d.headers))) {
        findings.push({
          kind: 'write-header',
          what: `${wantMethod} ${wantPath}`,
          why: `\`headers\` phải là object thường, nhận ${
            Array.isArray(d.headers) ? 'mảng' : typeof d.headers}`,
        });
      }
      if (d.headers && typeof d.headers === 'object' && !Array.isArray(d.headers)) {
        const got = remaining[i].headers || {};
        const lower = {};
        for (const [k, v] of Object.entries(got)) lower[k.toLowerCase()] = v;
        for (const [k, want] of Object.entries(d.headers)) {
          const have = lower[k.toLowerCase()];
          const ok = typeof want === 'function' ? want(have) : have === want;
          if (!ok) {
            findings.push({
              kind: 'write-header',
              what: `${wantMethod} ${wantPath}`,
              why: `tiêu đề «${k}» = ${JSON.stringify(have)}, khai ${
                typeof want === 'function' ? '(điều kiện)' : JSON.stringify(want)}`,
            });
          }
        }
      }
    }

    // `bodyAll` soi CẢ TẬP thân request đã khớp, không phải từng cái một.
    //
    // VÌ SAO CẦN: với `times: 2`, `body` được gọi riêng cho từng request, nên một
    // vị từ dạng "là cặp câu 1 HOẶC cặp câu 2" vẫn qua khi trang gửi HAI LẦN
    // CÙNG một câu — tức câu còn lại không được lưu, đúng thứ bản khai tưởng
    // mình đang chặn (bot bắt ở #969). Chỉ nhìn cả tập mới thấy "thiếu một câu".
    // Khai `bodyAll` mà không phải hàm là LỖI, không phải "bỏ qua". Bỏ qua
    // nghĩa là `bodyAll: true` — một cách viết rất dễ gõ nhầm — làm bản khai
    // đọc như đang chặn trùng lặp trong khi nó không chặn gì (codex cục bộ #969).
    if (d.bodyAll != null && typeof d.bodyAll !== 'function') {
      findings.push({
        kind: 'write-body',
        what: `${wantMethod} ${wantPath}`,
        why: `\`bodyAll\` phải là HÀM, nhận ${typeof d.bodyAll}`,
      });
    }
    if (typeof d.bodyAll === 'function' && hits.length === times) {
      const bodies = hits.map((i) => remaining[i].body);
      if (!d.bodyAll(bodies)) {
        findings.push({
          kind: 'write-body',
          what: `${wantMethod} ${wantPath}`,
          why: `cả tập ${times} thân request không thoả điều kiện: `
            + JSON.stringify(bodies).slice(0, 160),
        });
      }
    }
  }

  // Bất biến cốt lõi: ghi KHÔNG KHAI là lỗi. Đây mới là thứ bắt được
  // "nút làm sai việc" — một request đúng cú pháp, gửi đúng lúc, nhưng đi tới
  // chỗ không ai định.
  remaining.forEach((r, i) => {
    if (used[i]) return;
    findings.push({
      kind: 'write-undeclared',
      what: `${String(r.method).toUpperCase()} ${normalizePath(r.url)}`,
      why: 'không có trong bản khai — mọi đường ghi phải được khai trước',
    });
  });

  return { pass: findings.length === 0, findings, writeCount: writes.length };
}

export function formatFindings(findings) {
  if (!findings.length) return '  ✓ mọi đường ghi khớp bản khai';
  return findings.map((f) => `  ✗ [${f.kind}] ${f.what} — ${f.why}`).join('\n');
}

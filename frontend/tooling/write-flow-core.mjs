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
 *   · `NO_DATA` → khoá không được MANG DỮ LIỆU: vắng, hoặc `''`, hoặc `[]`.
 *     `null` KHÔNG được nhận (xem chú thích tại chỗ khai báo).
 */
export const NON_EMPTY = Symbol('non-empty');


/**
 * "Trường này không được MANG DỮ LIỆU."
 *
 * Dành cho các trường CHÉO-CHẾ-ĐỘ: ba trang Listening dùng chung một đích ghi
 * `POST /api/listening/attempts` và khác nhau đúng ở tên trường bài làm
 * (`mcq_answers` · `answers` · `user_transcript`). Điều cần chặn là DỮ LIỆU rơi
 * vào ô của chế độ khác, chứ không phải sự có mặt của khoá: một bản port gửi
 * `answers: []` ở chế độ MCQ thì vô hại, còn gửi `answers: ['T']` là hỏng.
 *
 * VÌ SAO `null` VẪN ĐỎ: ba trường đó khai kiểu KHÔNG cho null
 * (`user_transcript: str`, `answers: list[str]`, `mcq_answers: list[int]` —
 * `routers/listening.py:326-329`), nên `answers: null` là thân request mà
 * production trả 422. Nhận nó ở đây tức bản khai xanh cho một trạng thái không
 * tồn tại được — đúng loại lỗi ba vòng review ở #962 đã bắt.
 *
 * Ngược lại, `listening_session_id: str | None` (dòng 331) CHO PHÉP null, nên
 * trường đó KHÔNG dùng ký hiệu này; nó chỉ cần "vắng hoặc null" (bot bắt ở #966
 * bằng "phải vắng hẳn" là đỏ oan với bản port tuần tự hoá đúng luật (bot #966).
 */
export const NO_DATA = Symbol('no-data');

export function bodyMatches(actual, expected) {
  if (expected == null) return { ok: true };
  if (actual == null) return { ok: false, why: 'không có thân request' };
  for (const [k, want] of Object.entries(expected)) {
    const got = actual[k];
    if (want === NO_DATA) {
      if (got === null) {
        return { ok: false, why: `«${k}» = null — kiểu khai ở backend không nhận null (422)` };
      }
      const carries = got !== undefined
        && !(typeof got === 'string' && got === '')
        && !(Array.isArray(got) && got.length === 0);
      if (carries) {
        return { ok: false, why: `«${k}» mang dữ liệu của chế độ khác (= ${JSON.stringify(got)})` };
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

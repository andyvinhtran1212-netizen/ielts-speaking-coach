// Lõi thuần của bộ so parity legacy ↔ Next. Không chạm trình duyệt, không I/O
// — để chính nó kiểm được bằng `node --test` với dữ liệu dựng sẵn.
//
// VÌ SAO CÓ FILE NÀY
// ------------------
// Đo ngày 03/08: 8,6 page_view/giờ toàn site, 31 người dùng, 42/51 route có
// dưới 20 lượt xem trong 14 NGÀY. Cổng soak đòi n≥20 views/48h nên chỉ 6/127
// trang thoả được. Với 121 trang còn lại, chờ 48h không cho ra dữ liệu ít — nó
// cho ra KHÔNG CÓ GÌ, và "0 lỗi/0 view" là bằng chứng vắng mặt chứ không phải
// bằng chứng an toàn.
//
// Bằng chứng cụ thể rằng so parity thay được phần lớn việc đó: cả BA lỗi của
// PR #897 (mục Bài nổi bật rỗng do đọc sai `featured`, mất `<aver-chrome>`,
// bịa tên thư mục cho slug không tồn tại) đều KHÔNG cần người dùng nào để lộ.
// Chúng là lệch parity, so hai bản render là thấy. `parity-core.test.mjs` dựng
// lại đúng ba ca đó làm negative control — nếu bộ so không bắt được thì test
// đỏ, tức là công cụ này không được phép tự khen.
//
// NGUYÊN TẮC
// ----------
// 1. So SAU khi JS chạy. Trang legacy render phía client (`grammar.js` dựng
//    DOM từ fetch); so HTML thô sẽ là "vỏ rỗng vs trang đầy" — vô nghĩa.
// 2. Hướng lệch có ý nghĩa khác nhau: THIẾU ở bản mới là hồi quy, THỪA ở bản
//    mới thường là tính năng thêm. Không gộp hai loại vào một con số.
// 3. Mọi ngoại lệ phải có `reason`. Allowlist không lý do = tự cấp phép.

/** Chuẩn hoá khoảng trắng; giữ nguyên chữ và dấu. */
export function normalizeText(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/**
 * Đưa một href về dạng so sánh được giữa hai stack.
 *
 * Di trú CỐ Ý đổi URL, nên so href thô sẽ báo lệch ở mọi link — đúng kiểu ồn
 * làm người ta tắt công cụ đi. Bảng dưới là hợp đồng URL đã chốt (mục §8.5 kế
 * hoạch tổng): legacy nào tương ứng canonical nào.
 */
export function canonicalHref(href, { origin = '' } = {}) {
  if (href == null) return null;
  let raw = String(href).trim();
  if (!raw || raw.startsWith('#')) return null;
  if (/^(mailto:|tel:|javascript:|data:)/i.test(raw)) return null;

  // Bỏ origin cùng site; link ra ngoài giữ nguyên để vẫn so được.
  if (origin && raw.startsWith(origin)) raw = raw.slice(origin.length) || '/';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!raw.startsWith('/')) raw = '/' + raw.replace(/^\.?\//, '');

  const qi = raw.indexOf('?');
  let path = qi === -1 ? raw : raw.slice(0, qi);
  const query = qi === -1 ? '' : raw.slice(qi + 1);
  const hi = query.indexOf('#');
  const cleanQuery = hi === -1 ? query : query.slice(0, hi);

  const params = new URLSearchParams(cleanQuery);
  const sortedQuery = () => {
    const keys = [...params.keys()].sort();
    const out = keys.map((k) => `${k}=${params.get(k)}`).join('&');
    return out ? `?${out}` : '';
  };

  // ── Hợp đồng URL: legacy → canonical ───────────────────────────────────
  if (path === '/index.html') path = '/';
  else if (path === '/grammar.html') path = '/grammar';
  else if (path === '/pages/profile.html') path = '/profile';
  else if (path === '/pages/grammar-article.html') {
    // Dạng cũ nhất: ?category=&slug= → /grammar/:category/:slug
    const c = params.get('category');
    const s = params.get('slug');
    if (c && s) {
      params.delete('category');
      params.delete('slug');
      path = `/grammar/${encodeURIComponent(c)}/${encodeURIComponent(s)}`;
    }
  }

  path = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return path + sortedQuery();
}

/** Khác biệt đa-tập (multiset): giữ số lần lặp, vì mất 1/3 thẻ cũng là hồi quy. */
function multisetDiff(a, b) {
  const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const ca = count(a);
  const cb = count(b);
  const onlyA = [];
  const onlyB = [];
  for (const [k, n] of ca) {
    const d = n - (cb.get(k) || 0);
    for (let i = 0; i < d; i++) onlyA.push(k);
  }
  for (const [k, n] of cb) {
    const d = n - (ca.get(k) || 0);
    for (let i = 0; i < d; i++) onlyB.push(k);
  }
  return { onlyA, onlyB };
}

/**
 * Hình dạng "page facts" mà runner trình duyệt trích ra, và là thứ duy nhất
 * hàm so sánh đọc — nhờ vậy test không cần trình duyệt:
 *
 *   { url, status, title, headings: string[], links: string[],
 *     lines: string[], components: string[], apiPaths: string[],
 *     consoleErrors: string[] }
 */
export const FACT_KEYS = [
  'status', 'title', 'headings', 'links', 'lines', 'components',
  'apiPaths', 'consoleErrors',
];

const SEVERITY = {
  'status-mismatch': 'high',
  'console-error': 'high',
  'component-missing': 'high',
  'link-missing': 'high',
  'line-missing': 'high',
  'heading-missing': 'high',
  'title-mismatch': 'medium',
  'api-missing': 'medium',
  'heading-extra': 'low',
  'link-extra': 'low',
  'line-extra': 'low',
  'api-extra': 'low',
  'component-extra': 'low',
};

/**
 * So hai bản render. `legacy` là mốc tham chiếu, `next` là bản đang xét.
 *
 * `allow` là mảng ngoại lệ, mỗi phần tử BẮT BUỘC có `reason`:
 *   { kind: 'line-extra', value: 'Đang cập nhật', reason: '...' }
 * `value` khớp tuyệt đối, hoặc dùng `startsWith` khi có hậu tố `*`.
 */
export function comparePages(legacy, next, { allow = [] } = {}) {
  for (const a of allow) {
    if (!a || !a.kind || !a.reason) {
      throw new Error(
        'ngoại lệ parity phải có cả `kind` lẫn `reason` — ngoại lệ không lý do '
        + 'là tự cấp phép, đúng lỗi đã mắc ở các cổng trước: '
        + JSON.stringify(a));
    }
  }
  const findings = [];
  const push = (kind, value, extra) => {
    const exempt = allow.some((a) => a.kind === kind && (
      a.value === value
      || (typeof a.value === 'string' && a.value.endsWith('*')
          && String(value).startsWith(a.value.slice(0, -1)))));
    if (exempt) return;
    findings.push({ kind, severity: SEVERITY[kind] || 'low', value, ...extra });
  };

  if (legacy.status !== next.status) {
    push('status-mismatch', `${legacy.status} → ${next.status}`);
  }
  if (normalizeText(legacy.title) !== normalizeText(next.title)) {
    push('title-mismatch', `${normalizeText(legacy.title)} → ${normalizeText(next.title)}`);
  }
  for (const e of next.consoleErrors || []) push('console-error', e);

  const pairs = [
    ['heading', legacy.headings, next.headings],
    ['link', legacy.links, next.links],
    ['line', legacy.lines, next.lines],
    ['component', legacy.components, next.components],
    ['api', legacy.apiPaths, next.apiPaths],
  ];
  for (const [name, a, b] of pairs) {
    const { onlyA, onlyB } = multisetDiff(a || [], b || []);
    for (const v of onlyA) push(`${name}-missing`, v);
    for (const v of onlyB) push(`${name}-extra`, v);
  }

  const high = findings.filter((f) => f.severity === 'high').length;
  return {
    url: { legacy: legacy.url, next: next.url },
    findings,
    counts: {
      high,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length,
    },
    // Chỉ mức `high` chặn. `low` là tiếng ồn dự kiến của một lần viết lại;
    // gộp chung sẽ khiến người ta bỏ qua cả bảng.
    pass: high === 0,
  };
}

/** In gọn cho console CI. */
export function formatReport(results) {
  const lines = [];
  let high = 0;
  for (const r of results) {
    if (r.pass && !r.findings.length) continue;
    high += r.counts.high;
    lines.push(`\n${r.pass ? '○' : '✗'} ${r.url.legacy}  ↔  ${r.url.next}`);
    for (const f of r.findings.slice(0, 25)) {
      const mark = f.severity === 'high' ? '  ✗' : f.severity === 'medium' ? '  !' : '  ·';
      lines.push(`${mark} [${f.kind}] ${String(f.value).slice(0, 160)}`);
    }
    if (r.findings.length > 25) lines.push(`  … còn ${r.findings.length - 25} mục`);
  }
  const failed = results.filter((r) => !r.pass).length;
  lines.push(`\nparity: ${results.length} cặp · ${failed} cặp lệch nghiêm trọng · ${high} phát hiện mức cao`);
  return lines.join('\n');
}

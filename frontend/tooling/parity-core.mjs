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
// PR #897 đều KHÔNG cần người dùng nào để lộ. `parity-core.test.mjs` dựng lại
// đúng ba ca đó làm negative control — bộ so không bắt được thì test đỏ.
//
// RANH GIỚI FILE NÀY / RUNNER
// ---------------------------
// Vòng review đầu chỉ ra: test lúc đó chứng minh phép so đa-tập chạy đúng,
// nhưng RUNNER lại `new Set()` mọi link trước khi đưa vào so — nên nhánh đa-tập
// không bao giờ được dùng thật. Test xanh vì lý do sai. Nay mọi phép biến đổi
// (chuẩn hoá URL, ghép chữ↔link, khử trùng) nằm trong `buildFacts` ở ĐÂY;
// runner chỉ còn moi DOM thô. Cái gì quyết định kết quả thì cái đó phải kiểm
// được mà không cần trình duyệt.
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

// Gốc giả chỉ dùng để phân giải đường dẫn khi caller không đưa `base`.
const SYNTHETIC_BASE = 'https://parity.invalid/';

/**
 * Đưa một href về dạng so sánh được giữa hai stack.
 *
 * Di trú CỐ Ý đổi URL, nên so href thô sẽ báo lệch ở mọi link — đúng kiểu ồn
 * làm người ta tắt công cụ đi. Bảng dưới là hợp đồng URL đã chốt (§8.5 kế
 * hoạch tổng): legacy nào tương ứng canonical nào.
 *
 * `base` là URL ĐẦY ĐỦ của trang chứa link, không phải origin. Cần thật, vì
 * `grammar.js` đặt `_appRoot='../'` cho trang trong `/pages/` ⇒ href thật là
 * `../grammar.html`. Nối chuỗi thủ công sẽ ra `/../grammar.html` và báo lệch
 * giả hàng loạt trên mọi cặp bài viết (phát hiện #5 vòng review đầu).
 */
export function canonicalHref(href, { base = SYNTHETIC_BASE } = {}) {
  if (href == null) return null;
  const raw = String(href).trim();
  if (!raw || raw.startsWith('#')) return null;
  if (/^(mailto:|tel:|javascript:|data:|blob:)/i.test(raw)) return null;

  let u;
  let baseUrl;
  try {
    baseUrl = new URL(base);
    u = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  // Link ra ngoài site: giữ nguyên tuyệt đối để vẫn so được, không nuốt mất.
  if (u.origin !== baseUrl.origin) return u.href;

  let path = u.pathname;
  const params = u.searchParams;

  // ── Hợp đồng URL: legacy → canonical ───────────────────────────────────
  if (path === '/index.html') path = '/';
  else if (path === '/grammar.html') path = '/grammar';
  else if (path === '/pages/profile.html') path = '/profile';
  else if (path === '/pages/grammar-article.html') {
    const c = params.get('category');
    const s = params.get('slug');
    if (c && s) {
      params.delete('category');
      params.delete('slug');
      path = `/grammar/${encodeURIComponent(c)}/${encodeURIComponent(s)}`;
    }
  }

  path = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const keys = [...params.keys()].sort();
  const query = keys.map((k) => `${k}=${params.get(k)}`).join('&');
  return path + (query ? `?${query}` : '');
}

/**
 * Ghép nhãn nhìn thấy với đích đến. So hai TẬP RỜI (chữ riêng, href riêng) sẽ
 * bỏ lọt lỗi đấu dây: đổi chỗ href của hai thẻ "Tenses" và "Conditionals" thì
 * cả tập chữ lẫn tập href đều y nguyên, parity vẫn xanh trong khi điều hướng
 * đã sai (phát hiện #2 vòng review đầu).
 */
export function linkFact(text, canonical) {
  return `${normalizeText(text) || '(không có chữ)'} → ${canonical}`;
}

/**
 * Moi ra đích đến của "link giả lập bằng JS".
 *
 * `grammar.js:110` dựng thẻ thư mục bằng `onclick="window.location.href='…'"`
 * chứ không phải `<a href>`. Nếu không đọc dạng này, phía legacy không có gì
 * để so, và mọi link thư mục của bản Next đều rơi vào diện "thừa" — vòng review
 * đầu tôi đã miễn trừ cả cụm bằng một dòng allowlist tiền tố, nghĩa là **một
 * slug thư mục sai cũng lọt** (phát hiện #4). Đọc được onclick thì so được
 * thật, và allowlist đó bỏ đi luôn.
 */
export function hrefFromInlineHandler(attr) {
  if (!attr) return null;
  const m = /(?:window\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/.exec(String(attr));
  return m ? m[1] : null;
}

export const FACT_KEYS = [
  'status', 'title', 'headings', 'links', 'lines', 'components',
  'apiPaths', 'consoleErrors', 'finalUrl',
];

/**
 * Dựng "page facts" từ dữ liệu DOM THÔ mà runner moi ra. Thuần — đây là nơi
 * mọi quyết định ảnh hưởng kết quả nằm, nên test không cần trình duyệt.
 *
 * raw  = { title, headings:[{tag,text}], links:[{text,href}],
 *          components:[string], lines:[string] }
 * meta = { url, finalUrl, status, apiCalls:[{method,pathname,search}],
 *          consoleErrors:[string] }
 */
export function buildFacts(raw, meta) {
  const base = meta.finalUrl || meta.url;
  return {
    url: meta.url,
    finalUrl: meta.finalUrl || meta.url,
    status: meta.status,
    title: raw.title || '',
    headings: (raw.headings || []).map((h) => normalizeText(`${h.tag}:${h.text}`)),
    // KHÔNG khử trùng: mất 1 trong 2 nút "Đăng nhập" cũng là hồi quy, và phép
    // so đa-tập bên dưới chỉ có tác dụng nếu dữ liệu vào còn giữ số lần lặp.
    links: (raw.links || [])
      .map((l) => {
        const c = canonicalHref(l.href, { base });
        return c === null ? null : linkFact(l.text, c);
      })
      .filter(Boolean)
      .sort(),
    lines: (raw.lines || []).map(normalizeText).filter((s) => s.length > 1),
    components: [...(raw.components || [])].sort(),
    // API thì CÓ khử trùng, và đây là chủ ý: số lần gọi phụ thuộc retry,
    // prefetch và cache trình duyệt — đếm số lần chỉ sinh nhiễu. Nhưng giữ
    // method + query, vì `?q=tenses` với `?q=conditionals` là hai hành vi khác
    // nhau mà chỉ so pathname sẽ không thấy (phát hiện #7).
    apiPaths: [...new Set((meta.apiCalls || []).map(
      (c) => `${c.method || 'GET'} ${c.pathname}${c.search || ''}`))].sort(),
    consoleErrors: meta.consoleErrors || [],
  };
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

const SEVERITY = {
  'same-final-url': 'high',
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
  // Ngoại lệ nào chưa từng khớp thì báo lên. Bản vá #7 (thêm method vào dữ kiện
  // API) đã làm hai ngoại lệ `/api/grammar/home` im lặng hết khớp — chúng vẫn
  // nằm đó trông như đang che một khác biệt đã biết, trong khi thực tế không
  // che gì cả. Ngoại lệ mục ruỗng nguy hiểm hơn ngoại lệ sai, vì nó vô hình.
  const used = new Set();
  const push = (kind, value, extra) => {
    const hit = allow.find((a) => a.kind === kind && (
      a.value === value
      || (typeof a.value === 'string' && a.value.endsWith('*')
          && String(value).startsWith(a.value.slice(0, -1)))));
    if (hit) { used.add(hit); return; }
    findings.push({ kind, severity: SEVERITY[kind] || 'low', value, ...extra });
  };

  // Chốt chặn quan trọng nhất: hai vế phải là HAI trang khác nhau. `/pages/
  // profile.html` nay 307 sang `/profile`, nên một cặp cấu hình nhầm sẽ tải
  // cùng một trang hai lần, tự so với chính mình và LUÔN xanh — kiểu hỏng tệ
  // nhất vì nó trông y như bằng chứng (phát hiện #1 vòng review đầu).
  if (legacy.finalUrl && next.finalUrl && legacy.finalUrl === next.finalUrl) {
    push('same-final-url',
      `cả hai vế cùng dừng ở ${legacy.finalUrl} — cặp này không so gì cả`);
  }

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
  const unusedAllow = allow.filter((a) => !used.has(a));
  return {
    url: { legacy: legacy.url, next: next.url },
    findings,
    unusedAllow,
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

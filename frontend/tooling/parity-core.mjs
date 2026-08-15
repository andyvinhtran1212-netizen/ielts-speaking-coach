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

import { resolveCorePlayerAdmissionFromParams } from '../lib/core-player-affinity.mjs';

/** Chuẩn hoá khoảng trắng; giữ nguyên chữ và dấu. */
export function normalizeText(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/**
 * Keep DOM/API parity deterministic without masking executable third-party
 * dependencies. Google Fonts is presentation-only for this text/contract
 * extractor; its CSS has repeatedly returned WOFF2 URLs that later 404 in CI
 * (runs 31439749380 and 31440757513), making an unchanged Legacy baseline red.
 * Stub only the exact stylesheet host. Scripts, CDNs, and even direct gstatic
 * font URLs remain visible failures, so a real broken dependency is not hidden.
 */
export function externalPresentationFixture(url) {
  try {
    if (new URL(url).hostname === 'fonts.googleapis.com') {
      return { status: 200, contentType: 'text/css', body: '' };
    }
  } catch { /* malformed URL is not eligible for a fixture */ }
  return null;
}

// Lỗi TẦNG VẬN CHUYỂN: request không bao giờ tới nơi, nên không có phản hồi để
// nói lên điều gì về TRANG. Đây là hỏng của DỤNG CỤ ĐO, không phải khuyết tật
// của thứ đang đo — và phân biệt được hai thứ đó là cả điểm của danh sách này.
//
// CA ĐÃ XẢY RA (2026-08-07, lượt `full` của cổng G1): backend production từ chối
// kết nối giữa chừng. Khi nó từ chối RẢI RÁC, hai lần chụp khác nhau ⇒ báo
// `unstable-extraction`. Nhưng khi nó từ chối ỔN ĐỊNH trong một quãng, hai lần
// chụp GIỐNG NHAU (cùng hỏng) ⇒ harness kết luận "ổn định" rồi đem so với vế
// kia vốn gọi được ⇒ 87/150 cặp báo lệch, 610 phát hiện mức cao. Không cái nào
// là khuyết tật thật. Một cổng đỏ vì lý do sai vài lần là một cổng người ta bắt
// đầu bỏ qua, nên đây không phải chuyện thẩm mỹ.
//
// `ERR_ABORTED` CỐ Ý ĐỨNG NGOÀI: nó xảy ra bình thường (điều hướng bị huỷ, tải
// media bị dừng) và gộp vào đây sẽ biến mọi lượt chạy thành "hạ tầng hỏng".
const TRANSPORT_ERRORS = new Set([
  'net::ERR_CONNECTION_REFUSED',
  'net::ERR_CONNECTION_RESET',
  'net::ERR_CONNECTION_CLOSED',
  'net::ERR_CONNECTION_TIMED_OUT',
  'net::ERR_CONNECTION_FAILED',
  'net::ERR_NAME_NOT_RESOLVED',
  'net::ERR_INTERNET_DISCONNECTED',
  'net::ERR_NETWORK_CHANGED',
  'net::ERR_ADDRESS_UNREACHABLE',
  'net::ERR_EMPTY_RESPONSE',
  'net::ERR_SOCKET_NOT_CONNECTED',
  'net::ERR_TIMED_OUT',
  // TCP FIN/dữ liệu không được ACK ⇒ Chromium phát mã này. Thiếu nó là quay lại
  // đúng hành vi cũ: đem bản chụp hỏng đi so rồi sinh hàng loạt lệch giả.
  'net::ERR_CONNECTION_ABORTED',
  // `net::ERR_FAILED` CỐ Ý ĐỨNG NGOÀI, dù nghe rất giống "mất kết nối".
  // Chromium dùng chính mã này cho LỖI CORS. Đưa vào đây thì một hồi quy CORS
  // của bản Next — tức đúng loại khuyết tật cổng này sinh ra để bắt — sẽ bị dán
  // nhãn "hạ tầng hỏng" và biến mất khỏi báo cáo. Một bộ lọc chống-đỏ-giả mà
  // nuốt luôn lỗi thật thì tệ hơn là không có.
]);

/**
 * `errorText` của Playwright có phải lỗi tầng vận chuyển không?
 *
 * So BẰNG, không so CHỨA. `includes` sẽ khiến `net::ERR_FAILED` khớp luôn vào
 * những mã dài hơn có cùng tiền tố, và mọi mã `net::ERR_*` chưa biết cũng dễ
 * bị kéo vào — mà mở rộng nhầm ở đây nghĩa là giấu một lỗi thật dưới nhãn "hạ
 * tầng hỏng". Muốn thêm mã nào thì thêm tường minh vào danh sách trên.
 *
 * `errorText` đôi khi kèm mô tả sau dấu cách, nên cắt ở khoảng trắng đầu tiên.
 */
export function isTransportError(errorText) {
  if (typeof errorText !== 'string' || !errorText) return false;
  return TRANSPORT_ERRORS.has(errorText.trim().split(/\s+/)[0]);
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
  // KHÔNG bỏ neo trong trang. `grammar.html` dùng `href="#groups-section"` cho
  // nút chính của hero; bỏ qua nghĩa là neo trỏ sai id cũng không ai thấy
  // (phát hiện #3 vòng 2). Neo được phân giải theo URL trang nên so được.
  if (!raw) return null;
  if (/^(mailto:|tel:|javascript:|data:|blob:)/i.test(raw)) return null;
  // `href="#"` TRỐNG là link vô-tác-dụng: nó không có đích, chỉ tồn tại để phần
  // tử nhận được focus/con trỏ bàn tay còn hành vi do JS lo. Phân giải nó theo
  // URL trang biến nó thành "link tới chính trang này" — và hai vế của một cặp
  // parity LUÔN ở hai URL khác nhau, nên nó KHÔNG BAO GIỜ khớp được, ở bất kỳ
  // cặp nào, mãi mãi.
  //
  // Đo được (khi Speaking còn dark-launch ở `/speaking-preview`): cặp đó báo 3
  // `link-missing` + 3 `link-extra` chỉ vì ba thẻ `.mode-card` dùng `href="#"`.
  // Không phải lỗi port — hai vế có ĐÚNG cùng ba thẻ đó.
  //
  // Neo THẬT (`#groups-section`) vẫn phân giải như cũ: một neo trỏ sai id là lỗi
  // thật và phải bắt được (phát hiện #3 vòng 2).
  if (raw === '#') return '#';

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

  // Launcher của Next cố ý không trỏ thẳng vào một implementation:
  // deployment nhận navigation mới quyết định legacy/Next để một tab đã
  // mở không giữ quyết định cutover cũ. Parity phải so đích mà policy
  // HIỆN TẠI sẽ chọn, không so URL admission trung gian với URL player
  // legacy. Dùng chính resolver production để không sinh thêm một bảng ánh xạ
  // có thể trôi khỏi source of truth.
  //
  // Tham số không hợp lệ KHÔNG bị nuốt: giữ nguyên launcher trong facts
  // để parity vẫn báo lệch. Cả route runtime lẫn parity gọi cùng một
  // parser, nên validation key lặp/surface không thể trôi lệch giữa hai bên.
  if (path === '/core-player/launch') {
    let destination;
    try {
      destination = resolveCorePlayerAdmissionFromParams(params);
    } catch {
      // Cố ý fall through: URL admission hỏng phải hiện trong báo cáo.
    }
    // Policy cấm launcher làm player path, nên lời gọi này không thể đệ quy.
    // Đặt ngoài try để lỗi canonical downstream không bị gán nhầm cho input.
    if (destination) return canonicalHref(destination, { base });
  }

  // ── Hợp đồng URL: legacy → canonical ───────────────────────────────────
  if (path === '/index.html') path = '/';
  else if (path === '/grammar.html') path = '/grammar';
  // `/grammar/search` cutover 2026-08-15. Giữ trang HTML làm rollback/parity,
  // nhưng mọi link tới nó phải so theo chủ sở hữu canonical mới; query `q`
  // vẫn được giữ nguyên ở bước dựng URL bên dưới.
  else if (path === '/pages/grammar-search.html') path = '/grammar/search';
  // `/grammar/compare` cutover 2026-08-15. Query `slug` là một phần của hợp
  // đồng backend và được giữ nguyên ở bước dựng URL bên dưới.
  else if (path === '/pages/grammar-compare.html') path = '/grammar/compare';
  // `/grammar/roadmap` giữ hai mode trên cùng URL: `?slug=` public và không
  // query là lộ trình cá nhân. Canonicalization chỉ đổi owner, không đổi mode.
  else if (path === '/pages/grammar-roadmap.html') path = '/grammar/roadmap';
  // Pricing remains intentionally closed before launch. The Next route owns
  // that server redirect; the legacy HTML is now rollback-only.
  else if (path === '/pricing.html') path = '/pricing';
  else if (path === '/pages/profile.html') path = '/profile';
  // `/exercises` + `/flashcards` cutover 2026-08-06. CẦN ánh xạ dù sweep đã đổi
  // link ở cả hai vế: bản legacy dùng đường TƯƠNG ĐỐI (`href="exercises.html"`)
  // nên lượt sweep đầu của tôi — khớp `"/pages/exercises.html"` — trượt sạch.
  // Bot bắt ở #958. Giữ ánh xạ để neo trong trang và mọi link còn sót vẫn khớp.
  else if (path === '/pages/exercises.html') path = '/exercises';
  else if (path === '/pages/flashcards.html') path = '/flashcards';
  // `/home` đã cutover (PR #932). Ánh xạ này KHÔNG còn cần cho link nội bộ —
  // sweep cutover đã đổi hết sang `/home` ở CẢ HAI vế — nhưng nó CẦN cho NEO
  // TRONG TRANG: `#x` phân giải theo URL trang, nên thiếu ánh xạ thì
  // `/pages/home.html#x` và `/home#x` không bao giờ khớp. Đó đúng là lý do khu
  // Grammar khớp được (`/grammar.html` → `/grammar`) còn nơi khác thì không.
  else if (path === '/pages/home.html') path = '/home';
  // `/speaking` cutover 2026-08-05 — cùng lý do: NEO TRONG TRANG.
  // `practice.html` có `href="/speaking#history"`, và không có ánh xạ thì
  // `/pages/speaking.html#history` ≠ `/speaking#history` ⇒ báo lệch giả.
  else if (path === '/pages/speaking.html') path = '/speaking';
  else if (path === '/pages/admin/writing/grade.html') path = '/admin/writing/grade';
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
  // `entries()` chứ không `keys()+get()`: `?tag=a&tag=b` mà dùng `get()` sẽ
  // thành `tag=a&tag=a` (phát hiện #8 vòng 2).
  const query = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`).sort().join('&');
  return path + (query ? `?${query}` : '') + (u.hash || '');
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
  const str = String(attr);
  // Gán trực tiếp, hoặc `assign()`/`replace()` — cả ba đều là điều hướng.
  const m = /(?:window\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/.exec(str)
    || /(?:window\.)?location\.(?:assign|replace)\(\s*['"]([^'"]+)['"]/.exec(str);
  return m ? m[1] : null;
}

export const FACT_KEYS = [
  'status', 'title', 'headings', 'links', 'lines', 'components',
  'apiPaths', 'resourceFailures', 'blockedMutations', 'consoleErrors', 'finalUrl',
];

/**
 * GIỚI HẠN ĐÃ BIẾT — ghi ra để không ai nhầm đây là bộ lọc kín:
 *  · Nhãn link lấy DÒNG ĐẦU nhìn thấy, nên thẻ mà tiêu đề thật nằm ở dòng hai
 *    có thể đổi tên mà không lộ. Đánh đổi có chủ ý: dùng toàn bộ chữ bên trong
 *    thì legacy (cả thẻ bấm được) nuốt luôn danh sách con ⇒ 11 lệch giả.
 *  · Không so hình ảnh: đổi màu, sai khoảng cách, chữ tràn — không thấy.
 *  · Không so hành vi sau tương tác (mở/đóng, cuộn, gõ phím).
 *  · Chỉ đi vào shadow root MỞ; component dùng `mode:'closed'` sẽ không thấy.
 */

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
    // Chuẩn hoá CHỮ TRƯỚC rồi mới ghép với tên thẻ. Ghép trước rồi chuẩn hoá
    // thì khoảng trắng ĐẦU chuỗi của legacy (xuống dòng + thụt lề trong HTML)
    // biến thành `H1: Học…` trong khi Next cho `H1:Học…` — hai bên hiện y hệt
    // nhau trên màn hình mà bộ so báo lệch. Đúng loại nhiễu khiến cổng CI đỏ ở
    // mọi PR rồi bị tắt đi.
    headings: (raw.headings || []).map((h) => `${h.tag}:${normalizeText(h.text)}`),
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
    // Tài nguyên tải hỏng (CSS, chunk, ảnh…). DOM khớp mà CSS 404 thì trang vỡ.
    resourceFailures: [...new Set(meta.resourceFailures || [])].sort(),
    // Ghi lại đúng những gì đã bị chặn, để việc "công cụ đo không ghi" là điều
    // NHÌN THẤY ĐƯỢC trong báo cáo chứ không phải lời hứa trong bình luận.
    blockedMutations: [...new Set(meta.blockedMutations || [])].sort(),
    consoleErrors: meta.consoleErrors || [],
  };
}

/**
 * Chuẩn hoá URL chỉ để hỏi "có phải cùng một trang không".
 *
 * KHÔNG dùng `canonicalHref` cho việc này, dù thoạt nghe hợp lý: nó ánh xạ
 * legacy→canonical (`/grammar.html` → `/grammar`), tức là hai vế của MỌI cặp
 * hợp lệ đều hội tụ về một chuỗi, và chốt tự-so sẽ nổ ở mọi cặp. Ở đây chỉ gạt
 * khác biệt vô nghĩa: dấu / cuối, thứ tự tham số, neo.
 */
export function sameDocumentUrl(a, b) {
  const norm = (x) => {
    try {
      const u = new URL(x);
      const q = [...u.searchParams.entries()].map(([k, v]) => `${k}=${v}`).sort().join('&');
      const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;
      return `${u.origin}${path}${q ? `?${q}` : ''}`;
    } catch { return String(x); }
  };
  return norm(a) === norm(b);
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
  'unexpected-status': 'high',
  'baseline-suspect': 'high',
  'resource-failed': 'high',
  'unstable-extraction': 'high',
  'heading-order-mismatch': 'medium',
  'line-order-mismatch': 'medium',
  'resource-failed-legacy-only': 'low',
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
export function comparePages(legacy, next,
  { allow = [], minBaselineLines = 5, expectStatus = 200 } = {}) {
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
  // Khác nhau mỗi dấu / cuối, thứ tự tham số hay neo vẫn là cùng một trang —
  // chốt phải bắt được (phát hiện #10 vòng 2).
  if (legacy.finalUrl && next.finalUrl && sameDocumentUrl(legacy.finalUrl, next.finalUrl)) {
    push('same-final-url',
      `cả hai vế cùng dừng ở ${legacy.finalUrl} — cặp này không so gì cả`);
  }

  if (legacy.status !== next.status) {
    push('status-mismatch', `${legacy.status} → ${next.status}`);
  }
  // Hai vế cùng hỏng thì `status-mismatch` im lặng, và nếu hai trang lỗi trông
  // giống nhau (rất dễ, chúng thường là cùng một template) thì cặp đó BÁO
  // XANH. Một file cặp gõ sai URL, một sự cố hạ tầng, hay cả site sập đều sẽ
  // được "chứng nhận sạch". Mặc định đòi status thành công; route cố ý lỗi thì
  // khai `expectStatus` tường minh cho từng cặp.
  if (expectStatus != null) {
    for (const [side, f] of [['legacy', legacy], ['next', next]]) {
      if (typeof f.status === 'number' && f.status > 0 && f.status !== expectStatus) {
        push('unexpected-status', `${side}: ${f.status} (mong đợi ${expectStatus})`);
      }
    }
  }
  if (normalizeText(legacy.title) !== normalizeText(next.title)) {
    push('title-mismatch', `${normalizeText(legacy.title)} → ${normalizeText(next.title)}`);
  }
  for (const e of next.consoleErrors || []) push('console-error', e);
  // Nếu chính VẾ THAM CHIẾU hỏng thì mọi so sánh sau đó vô giá trị: legacy
  // render lỗi ⇒ nội dung của nó ít đi ⇒ bản Next chỉ toàn "thừa" (mức thấp)
  // ⇒ cả bảng xanh. Đây là biến thể của lỗi đã mắc nhiều lần: tin số đo mà
  // không kiểm dụng cụ đo (phát hiện #5 vòng 2).
  for (const e of legacy.consoleErrors || []) push('baseline-suspect', `legacy lỗi: ${e}`);
  const legacyLines = (legacy.lines || []).length;
  if (legacyLines < minBaselineLines) {
    push('baseline-suspect',
      `legacy chỉ render ${legacyLines} dòng — vế tham chiếu nhiều khả năng hỏng`);
  }

  // #6 tài nguyên hỏng: DOM có thể khớp hoàn toàn trong khi CSS/chunk 404 làm
  // trang vỡ bố cục. So cả danh sách response lỗi.
  {
    const { onlyA, onlyB } = multisetDiff(legacy.resourceFailures || [], next.resourceFailures || []);
    for (const v of onlyB) push('resource-failed', v);
    for (const v of onlyA) push('resource-failed-legacy-only', v);
  }

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
  // Thứ tự tài liệu: đảo thứ tự mục bài mà giữ nguyên chữ và link thì đa-tập
  // không thấy gì, nhưng người học đọc sai mạch (phát hiện #4 vòng 2). Chỉ
  // báo khi hai bên giống hệt về NỘI DUNG — nếu không mỗi lần chèn thêm một
  // mục sẽ đẩy lệch cả dãy và sinh nhiễu vô ích.
  for (const [name, a, b] of [['heading', legacy.headings, next.headings],
                              ['line', legacy.lines, next.lines]]) {
    const A = a || [];
    const B = b || [];
    const { onlyA, onlyB } = multisetDiff(A, B);
    if (!onlyA.length && !onlyB.length && A.join('\u0000') !== B.join('\u0000')) {
      push(`${name}-order-mismatch`,
        `cùng nội dung nhưng khác thứ tự (${A.length} mục)`);
    }
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

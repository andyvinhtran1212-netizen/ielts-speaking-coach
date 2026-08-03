/**
 * parity-core.test.mjs — bộ so parity phải tự chứng minh, không được tự khen.
 *
 * Luận điểm khiến công cụ này ra đời: cả BA lỗi của PR #897 đều bắt được bằng
 * cách so hai bản render, không cần một người dùng nào. Nhóm test cuối dựng lại
 * đúng ba ca đó. Nếu bộ so không bắt được thì test đỏ — tức là luận điểm sai và
 * công cụ không đáng tin. Đó là điểm khác giữa "công cụ có test" và "công cụ
 * chứng minh được điều nó tuyên bố".
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalHref, normalizeText, comparePages, formatReport,
  buildFacts, linkFact, hrefFromInlineHandler, sameDocumentUrl,
} from '../tooling/parity-core.mjs';

const RUNNER = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tooling', 'parity-diff.mjs'),
  'utf8');

/** Trang tham chiếu tối thiểu — các test lệch đi từ đây. */
const base = () => ({
  url: 'https://x/grammar.html',
  finalUrl: 'https://x/grammar.html',
  status: 200,
  title: 'Grammar Wiki — Aver Learning',
  headings: ['H1:Học ngữ pháp như một hệ thống liên kết', 'H3:Tenses'],
  links: ['/grammar/tenses/present-perfect', '/pages/home.html', '/profile'],
  lines: ['Bài nổi bật', 'Present Perfect', 'Khám phá theo nhóm chủ đề',
          'Duyệt theo thư mục bài', 'Roadmap học tập', 'Tenses'],
  components: ['aver-chrome', 'main'],
  apiPaths: ['/api/grammar/groups', '/api/grammar/home'],
  consoleErrors: [],
});

/**
 * Phía Next — URL RIÊNG. Trước vòng review 2, các test lấy `{...base()}` cho cả
 * hai vế, tức hai vế cùng một URL; chốt `same-final-url` (vá phát hiện #1) làm
 * lộ ra rằng có test khi đó xanh VÌ LÝ DO SAI. Fixture phải giống thực tế.
 */
const nextSide = (over = {}) => ({
  ...base(), url: 'https://x/grammar', finalUrl: 'https://x/grammar', ...over,
});

describe('canonicalHref — hợp đồng URL giữa hai stack', () => {
  test('đưa link legacy về dạng canonical', () => {
    assert.equal(canonicalHref('/grammar.html'), '/grammar');
    assert.equal(canonicalHref('/index.html'), '/');
    assert.equal(canonicalHref('/pages/profile.html'), '/profile');
    assert.equal(
      canonicalHref('/pages/grammar-article.html?category=tenses&slug=present-perfect'),
      '/grammar/tenses/present-perfect');
  });

  test('giữ tham số truy vấn nhưng sắp xếp ổn định', () => {
    assert.equal(canonicalHref('/grammar.html?category=tenses'), '/grammar?category=tenses');
    assert.equal(canonicalHref('/x?b=2&a=1'), canonicalHref('/x?a=1&b=2'));
  });

  test('bỏ origin cùng site, giữ nguyên link ra ngoài', () => {
    assert.equal(canonicalHref('https://s/grammar.html', { base: 'https://s/' }), '/grammar');
    assert.equal(canonicalHref('https://khac/x', { base: 'https://s/' }), 'https://khac/x');
  });

  test('bỏ qua neo và giao thức không điều hướng', () => {
    for (const h of ['mailto:a@b.c', 'javascript:void(0)', '', null]) {
      assert.equal(canonicalHref(h), null, `phải bỏ qua: ${h}`);
    }
    // Neo trong trang thì GIỮ — `grammar.html` dùng `href="#groups-section"`
    // cho nút chính của hero, bỏ qua nghĩa là neo trỏ sai id cũng không lộ.
    assert.equal(canonicalHref('#groups-section', { base: 'https://x/grammar' }),
      '/grammar#groups-section');
  });

  test('bỏ dấu / cuối nhưng không nuốt mất gốc', () => {
    assert.equal(canonicalHref('/grammar/'), '/grammar');
    assert.equal(canonicalHref('/'), '/');
  });
});

describe('comparePages — nền tảng', () => {
  test('hai trang giống hệt ⇒ không phát hiện gì', () => {
    const r = comparePages(base(), nextSide());
    assert.deepEqual(r.findings, []);
    assert.equal(r.pass, true);
  });

  test('THIẾU ở bản mới là mức cao, THỪA là mức thấp', () => {
    const legacy = base();
    const next = nextSide({ lines: [...base().lines, 'Mục mới'] });
    next.lines = next.lines.filter((l) => l !== 'Present Perfect');
    const r = comparePages(legacy, next);
    const missing = r.findings.find((f) => f.kind === 'line-missing');
    const extra = r.findings.find((f) => f.kind === 'line-extra');
    assert.equal(missing.value, 'Present Perfect');
    assert.equal(missing.severity, 'high');
    assert.equal(extra.value, 'Mục mới');
    assert.equal(extra.severity, 'low');
    assert.equal(r.pass, false, 'mất nội dung phải chặn');
  });

  test('đếm theo đa-tập: mất 1 trong 3 thẻ giống nhau vẫn bị bắt', () => {
    const legacy = { ...base(), lines: ['Thẻ', 'Thẻ', 'Thẻ'] };
    const next = nextSide({ lines: ['Thẻ', 'Thẻ'] });
    const r = comparePages(legacy, next);
    assert.equal(r.findings.filter((f) => f.kind === 'line-missing').length, 1);
  });

  test('lỗi console và lệch status đều chặn', () => {
    assert.equal(comparePages(base(), nextSide({ consoleErrors: ['boom'] })).pass, false);
    assert.equal(comparePages(base(), nextSide({ status: 500 })).pass, false);
  });

  test('chỉ mức cao mới chặn — mức thấp không làm người ta bỏ qua cả bảng', () => {
    const r = comparePages(base(), nextSide({ lines: [...base().lines, 'thêm'] }));
    assert.equal(r.counts.low, 1);
    assert.equal(r.pass, true);
  });

  test('ngoại lệ KHÔNG có lý do bị từ chối thẳng', () => {
    assert.throws(
      () => comparePages(base(), base(), { allow: [{ kind: 'line-extra', value: 'x' }] }),
      /reason/,
      'ngoại lệ không lý do là tự cấp phép — phải ném lỗi');
  });

  test('ngoại lệ có lý do thì miễn trừ, kể cả dạng tiền tố', () => {
    const next = nextSide({ lines: [...base().lines, 'Cập nhật 03/08'] });
    const r = comparePages(base(), next, {
      allow: [{ kind: 'line-extra', value: 'Cập nhật *', reason: 'dấu thời gian, đổi mỗi lần chạy' }],
    });
    assert.deepEqual(r.findings, []);
  });
});

// ── Negative control: ba lỗi CÓ THẬT của PR #897 ────────────────────────────
// Ba ca này không phải giả định. Chúng là ba lỗi đã lọt qua build xanh, tsc
// sạch, 5810 test và một lần tự đọc lại, chỉ bị bắt khi Codex đọc diff.
describe('bắt lại ba lỗi thật của PR #897', () => {
  test('#1 đọc sai key backend ⇒ mục "Bài nổi bật" rỗng', () => {
    // Backend trả `featured_articles`; bản Next đọc `featured` ⇒ danh sách rỗng
    // và rơi vào nhánh "Chưa có bài nào." Build xanh, không lỗi runtime.
    const legacy = {
      ...base(),
      lines: ['Bài nổi bật', 'Subject-Verb Agreement', 'Articles — A, An, The', 'Conditionals'],
      finalUrl: 'https://x/grammar.html',
      links: ['/grammar/error-clinic/subject-verb-agreement',
              '/grammar/error-clinic/articles', '/grammar/conditionals/conditionals'],
    };
    const next = { ...legacy, finalUrl: 'https://x/grammar',
                   lines: ['Bài nổi bật', 'Chưa có bài nào.'], links: [] };
    const r = comparePages(legacy, next, { minBaselineLines: 0 });
    assert.equal(r.pass, false);
    const missingLines = r.findings.filter((f) => f.kind === 'line-missing').map((f) => f.value);
    assert.ok(missingLines.includes('Subject-Verb Agreement'));
    assert.equal(r.findings.filter((f) => f.kind === 'link-missing').length, 3,
      'mất cả ba link bài viết');
    assert.ok(r.findings.some((f) => f.kind === 'line-extra' && f.value === 'Chưa có bài nào.'),
      'trạng thái rỗng xuất hiện thêm — chính là dấu hiệu của lỗi này');
  });

  test('#2 thiếu <aver-chrome> ⇒ mất điều hướng, build vẫn xanh', () => {
    const legacy = base();
    const next = nextSide({
      components: ['main'],                       // không còn aver-chrome
      links: ['/grammar/tenses/present-perfect'], // mất link điều hướng chung
    });
    const r = comparePages(legacy, next);
    assert.equal(r.pass, false);
    assert.ok(r.findings.some((f) => f.kind === 'component-missing' && f.value === 'aver-chrome'),
      'phải chỉ đích danh component bị thiếu, không chỉ nói "khác nhau"');
    assert.equal(r.findings.filter((f) => f.kind === 'link-missing').length, 2);
  });

  test('#3 slug thư mục không tồn tại ⇒ bịa ra tiêu đề thư mục', () => {
    // `getPublicJson` biến 404 thành null; CategoryView lấy slug làm tiêu đề
    // ⇒ link hỏng trông như thư mục hợp lệ đang trống.
    const legacy = {
      ...base(),
      url: 'https://x/grammar.html?category=khong-ton-tai-xyz',
      finalUrl: 'https://x/grammar.html?category=khong-ton-tai-xyz',
      headings: ['H1:Học ngữ pháp như một hệ thống liên kết'],
      lines: ['Không tìm thấy thư mục'],
      links: [],
    };
    const next = {
      ...legacy,
      url: 'https://x/grammar?category=khong-ton-tai-xyz',
      finalUrl: 'https://x/grammar?category=khong-ton-tai-xyz',
      headings: ['H1:Học ngữ pháp như một hệ thống liên kết', 'H2:khong ton tai xyz'],
      lines: ['khong ton tai xyz', 'Chưa có bài nào.'],
    };
    const r = comparePages(legacy, next, { minBaselineLines: 0 });
    assert.equal(r.pass, false);
    assert.ok(r.findings.some((f) => f.kind === 'line-missing' && f.value === 'Không tìm thấy thư mục'),
      'mất trạng thái không-tìm-thấy của legacy');
    assert.ok(r.findings.some((f) => f.kind === 'heading-extra' && /khong ton tai xyz/.test(f.value)),
      'tiêu đề bịa ra phải hiện lên trong báo cáo');
  });

  test('chốt chặn: bản ĐÃ VÁ của cả ba ca đều sạch', () => {
    // Không có test này thì ba test trên có thể xanh nhờ bộ so báo lệch mọi lúc.
    const fixed = nextSide();
    const r = comparePages(base(), fixed);
    assert.deepEqual(r.findings, []);
    assert.equal(r.pass, true);
  });
});

describe('vá 7 phát hiện của vòng review đầu', () => {
  test('#1 hai vế cùng dừng ở một URL sau redirect ⇒ chặn ngay', () => {
    // `/pages/profile.html` nay 307 sang `/profile`. Không có chốt này thì cặp
    // đó tải cùng một trang hai lần, tự so với chính mình và LUÔN xanh — kiểu
    // hỏng tệ nhất vì nó trông y như bằng chứng.
    const l = { ...base(), url: 'https://x/pages/profile.html', finalUrl: 'https://x/profile' };
    // Khác nhau mỗi dấu / cuối và neo — vẫn là cùng một trang.
    const n = { ...base(), url: 'https://x/profile', finalUrl: 'https://x/profile/#top' };
    const r = comparePages(l, n);
    assert.equal(r.pass, false);
    assert.ok(r.findings.some((f) => f.kind === 'same-final-url'));
  });

  test('#1c khác tham số truy vấn KHÔNG phải "cùng trang"', () => {
    // Ranh giới quan trọng: `?category=tenses` với `?category=modifiers` là hai
    // trang khác nhau. Gạt luôn query sẽ làm chốt nổ oan ở mọi cặp thư mục.
    assert.equal(sameDocumentUrl('https://x/g?a=1', 'https://x/g?a=2'), false);
    assert.equal(sameDocumentUrl('https://x/g?b=2&a=1', 'https://x/g/?a=1&b=2#z'), true);
  });

  test('#1d chuẩn hoá tự-so KHÔNG được dùng bảng ánh xạ legacy→canonical', () => {
    // `canonicalHref` cố ý đưa `/grammar.html` về `/grammar`, tức hai vế của
    // MỌI cặp hợp lệ đều hội tụ. Dùng nó cho chốt tự-so sẽ nổ ở mọi cặp —
    // test này giữ hai việc đó tách nhau.
    assert.equal(canonicalHref('/grammar.html'), canonicalHref('/grammar'));
    assert.equal(sameDocumentUrl('https://x/grammar.html', 'https://x/grammar'), false);
  });

  test('#1b hai URL cuối khác nhau thì KHÔNG báo gì', () => {
    const r = comparePages(base(), { ...base(), finalUrl: 'https://x/grammar' });
    assert.ok(!r.findings.some((f) => f.kind === 'same-final-url'));
  });

  test('#2 đổi chỗ href của hai thẻ ⇒ bị bắt (chữ ghép với đích)', () => {
    const raw = (a, b) => ({
      links: [{ text: 'Tenses', href: a }, { text: 'Conditionals', href: b }],
    });
    const metaL = { url: 'https://x/grammar.html', finalUrl: 'https://x/grammar.html', status: 200 };
    const metaN = { url: 'https://x/grammar', finalUrl: 'https://x/grammar', status: 200 };
    const ok = buildFacts(raw('/grammar?category=tenses', '/grammar?category=conditionals'), metaL);
    const okNext = buildFacts(raw('/grammar?category=tenses', '/grammar?category=conditionals'), metaN);
    const swapped = buildFacts(raw('/grammar?category=conditionals', '/grammar?category=tenses'), metaN);
    // Tập chữ y nguyên, tập href y nguyên — chỉ cách ghép là khác.
    assert.equal(comparePages(ok, okNext, { minBaselineLines: 0 }).pass, true);
    const r = comparePages(ok, swapped, { minBaselineLines: 0 });
    assert.equal(r.pass, false, 'đấu dây sai điều hướng phải bị bắt');
    assert.ok(r.findings.some((f) => f.kind === 'link-missing' && /Tenses → \/grammar\?category=tenses/.test(f.value)));
  });

  test('#3 buildFacts KHÔNG khử trùng link ⇒ mất 1 trong 2 nút giống nhau vẫn bị bắt', () => {
    const meta = { url: 'https://x/g', finalUrl: 'https://x/g', status: 200 };
    const two = buildFacts({ links: [
      { text: 'Đăng nhập', href: '/login.html' },
      { text: 'Đăng nhập', href: '/login.html' },
    ] }, meta);
    const one = buildFacts({ links: [{ text: 'Đăng nhập', href: '/login.html' }] }, meta);
    assert.equal(two.links.length, 2, 'giữ số lần lặp, không new Set()');
    const r = comparePages(two, one, { minBaselineLines: 0 });
    assert.equal(r.findings.filter((f) => f.kind === 'link-missing').length, 1);
    // Chốt chặn ở tầng runner: nó không được khử trùng trước khi đưa vào lõi.
    assert.ok(!/new Set\(facts\.links/.test(RUNNER),
      'runner khử trùng link sẽ vô hiệu hoá phép so đa-tập — đúng lỗi vòng 1');
  });

  test('#4 đọc được link giả lập bằng onclick của legacy', () => {
    assert.equal(
      hrefFromInlineHandler("window.location.href='grammar.html?category=tenses'"),
      'grammar.html?category=tenses');
    assert.equal(hrefFromInlineHandler("location.href = \"/x\""), '/x');
    assert.equal(hrefFromInlineHandler('event.stopPropagation()'), null);
    // Và allowlist miễn trừ cả cụm thư mục phải BIẾN MẤT — nó chính là thứ
    // khiến một slug thư mục sai lọt qua.
    assert.ok(!/value: '\/grammar\?category=\*'/.test(RUNNER),
      'miễn trừ cả cụm link thư mục = một slug sai cũng lọt');
  });

  test('#5 phân giải ../ theo URL trang, không nối chuỗi', () => {
    const base2 = 'https://x/pages/grammar-article.html?category=tenses&slug=present-perfect';
    assert.equal(canonicalHref('../grammar.html', { base: base2 }), '/grammar');
    assert.equal(canonicalHref('./grammar-search.html', { base: base2 }), '/pages/grammar-search.html');
    // Chốt chặn: dạng cũ nối chuỗi sẽ ra '/../grammar.html'.
    assert.ok(!String(canonicalHref('../grammar.html', { base: base2 })).includes('..'));
  });

  test('#6 quét thiếu thư mục thì DỪNG, không bỏ im', () => {
    assert.ok(!/if \(!r\.ok\) continue;/.test(RUNNER),
      'bỏ im một thư mục = lần quét thiếu bài mà vẫn báo xanh');
    assert.match(RUNNER, /throw new Error\(`không tải được thư mục/);
  });

  test('#7 dữ kiện API giữ method và query', () => {
    const f = buildFacts({}, {
      url: 'https://x/g', finalUrl: 'https://x/g', status: 200,
      apiCalls: [
        { method: 'GET', pathname: '/api/grammar/search', search: '?q=tenses' },
        { method: 'POST', pathname: '/api/x', search: '' },
      ],
    });
    assert.deepEqual(f.apiPaths, ['GET /api/grammar/search?q=tenses', 'POST /api/x']);
    // Cùng endpoint, khác tham số ⇒ phải thấy lệch.
    const other = buildFacts({}, {
      url: 'https://x/g', finalUrl: 'https://x/g', status: 200,
      apiCalls: [{ method: 'GET', pathname: '/api/grammar/search', search: '?q=conditionals' }],
    });
    assert.ok(comparePages(f, other, { minBaselineLines: 0 })
      .findings.some((x) => x.kind === 'api-missing'));
  });

  test('hai vế CÙNG lỗi vẫn phải chặn (review #906)', () => {
    // `status-mismatch` im lặng khi hai bên bằng nhau, mà trang lỗi hai bên
    // thường dùng chung template ⇒ nội dung khớp ⇒ cặp báo xanh. Một file cặp
    // gõ sai URL hay một sự cố hạ tầng sẽ được "chứng nhận sạch".
    const l = { ...base(), status: 500 };
    const n = nextSide({ status: 500 });
    const r = comparePages(l, n);
    assert.equal(r.pass, false, 'cùng 500 hai bên vẫn phải đỏ');
    assert.equal(r.findings.filter((f) => f.kind === 'unexpected-status').length, 2);
    assert.ok(!r.findings.some((f) => f.kind === 'status-mismatch'),
      'chốt cũ đúng là im lặng ở ca này — nên mới cần chốt mới');
  });

  test('route cố ý lỗi thì phải KHAI expectStatus, không mặc định', () => {
    const l = { ...base(), status: 404 };
    const n = nextSide({ status: 404 });
    assert.equal(comparePages(l, n).pass, false, 'không khai thì chặn');
    assert.equal(comparePages(l, n, { expectStatus: 404 }).pass, true, 'khai rồi thì cho qua');
  });

  test('ngoại lệ không còn khớp gì thì bị nêu tên', () => {
    // Chính bản vá #7 đã làm hai ngoại lệ API im lặng hết khớp. Ngoại lệ mục
    // ruỗng nguy hiểm hơn ngoại lệ sai vì nó vô hình.
    const r = comparePages(base(), nextSide(), {
      allow: [{ kind: 'line-extra', value: 'không bao giờ xuất hiện', reason: 'đã lỗi thời' }],
    });
    assert.equal(r.unusedAllow.length, 1);
    const r2 = comparePages(base(), nextSide({ lines: [...base().lines, 'thêm'] }), {
      allow: [{ kind: 'line-extra', value: 'thêm', reason: 'có thật' }],
    });
    assert.deepEqual(r2.unusedAllow, [], 'ngoại lệ đang dùng thì không bị nêu');
  });

  test('linkFact nêu rõ nhãn nào trỏ đâu, kể cả link không chữ', () => {
    assert.equal(linkFact(' Tenses  ', '/grammar?category=tenses'), 'Tenses → /grammar?category=tenses');
    assert.equal(linkFact('', '/x'), '(không có chữ) → /x');
  });
});

describe('formatReport', () => {
  test('nêu số cặp lệch và không nuốt mất phát hiện', () => {
    const r = comparePages(base(), nextSide({ components: ['main'] }));
    const out = formatReport([{ name: 'x', ...r }]);
    assert.match(out, /component-missing/);
    assert.match(out, /1 cặp lệch nghiêm trọng/);
  });

  test('normalizeText gộp khoảng trắng, giữ dấu tiếng Việt', () => {
    assert.equal(normalizeText('  Ngữ   pháp\n IELTS '), 'Ngữ pháp IELTS');
  });
});

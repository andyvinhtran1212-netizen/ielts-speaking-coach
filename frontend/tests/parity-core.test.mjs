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

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalHref, normalizeText, comparePages, formatReport,
  buildFacts, linkFact, hrefFromInlineHandler, sameDocumentUrl, isTransportError,
  externalPresentationFixture,
} from '../tooling/parity-core.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE = readFileSync(path.join(ROOT, '.github', 'workflows', 'parity-gate.yml'), 'utf8');
const GATE_ACTIVE = GATE.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const BACKEND_MAIN = readFileSync(path.join(ROOT, 'backend', 'main.py'), 'utf8');

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

describe('externalPresentationFixture — font CDN không làm phép đo chớp đỏ', () => {
  test('chỉ fixture đúng stylesheet host Google Fonts', () => {
    assert.deepEqual(
      externalPresentationFixture('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans'),
      { status: 200, contentType: 'text/css', body: '' },
    );
    assert.equal(externalPresentationFixture('https://fonts.gstatic.com/s/font.woff2'), null);
    assert.equal(externalPresentationFixture('https://fonts.googleapis.com.evil.test/css2'), null);
    assert.equal(externalPresentationFixture('https://cdn.jsdelivr.net/npm/x.js'), null);
    assert.equal(externalPresentationFixture('not a url'), null);
  });

  test('runner áp fixture trước khi request ra mạng', () => {
    assert.match(RUNNER, /externalPresentationFixture\(r\.url\(\)\)/);
    assert.match(RUNNER, /if \(externalFixture\) return route\.fulfill\(externalFixture\)/);
    assert.ok(
      RUNNER.indexOf("if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()))")
        < RUNNER.indexOf('externalPresentationFixture(r.url())'),
      'mọi mutation phải bị block/log trước khi áp fixture chỉ-đọc',
    );
  });
});

describe('canonicalHref — hợp đồng URL giữa hai stack', () => {
  test('đưa link legacy về dạng canonical', () => {
    assert.equal(canonicalHref('/grammar.html'), '/grammar');
    assert.equal(canonicalHref('/index.html'), '/');
    assert.equal(canonicalHref('/login.html'), '/login');
    assert.equal(canonicalHref('/onboarding.html'), '/onboarding');
    assert.equal(canonicalHref('/pages/profile.html'), '/profile');
    assert.equal(
      canonicalHref('/pages/quiz.html?bank=bank-1'),
      '/quiz?bank=bank-1');
    assert.equal(
      canonicalHref('/pages/listening-practice-run.html?source=library&id=test-1'),
      '/listening/practice-run?id=test-1&source=library');
    assert.equal(
      canonicalHref('/pages/reading-exam.html?from=mini&test_id=AVR-1'),
      '/reading/exam/session?from=mini&test_id=AVR-1');
    assert.equal(
      canonicalHref('/pages/exam.html?id=exam-1&source=toeic_rc'),
      '/exam?id=exam-1&source=toeic_rc');
    assert.equal(
      canonicalHref('/pages/grammar-compare.html?slug=past-perfect-vs-past-simple'),
      '/grammar/compare?slug=past-perfect-vs-past-simple');
    assert.equal(canonicalHref('/pricing.html'), '/pricing');
    assert.equal(
      canonicalHref('/pages/grammar-roadmap.html?slug=tenses'),
      '/grammar/roadmap?slug=tenses');
    assert.equal(
      canonicalHref('/vocabulary.html?cat=technology&slug=cutting-edge'),
      '/vocabulary?cat=technology&slug=cutting-edge');
    assert.equal(
      canonicalHref('/pages/grammar-article.html?category=tenses&slug=present-perfect'),
      '/grammar/tenses/present-perfect');
  });

  test('giữ tham số truy vấn nhưng sắp xếp ổn định', () => {
    assert.equal(canonicalHref('/grammar.html?category=tenses'), '/grammar?category=tenses');
    assert.equal(canonicalHref('/x?b=2&a=1'), canonicalHref('/x?a=1&b=2'));
  });

  test('chuẩn hoá launcher runtime theo đúng policy admission hiện tại', () => {
    const pairs = [
      [
        '/core-player/launch?surface=speaking&session_id=session+1',
        '/pages/practice.html?session_id=session+1',
      ],
      [
        '/core-player/launch?from=full&class_item=homework-1&surface=reading_exam&test_id=AVR-1',
        '/pages/reading-exam.html?test_id=AVR-1&from=full&class_item=homework-1',
      ],
      [
        '/core-player/launch?surface=listening_test&id=test-1&from=mini',
        '/pages/listening-test.html?id=test-1&from=mini',
      ],
      [
        '/core-player/launch?surface=listening_dictation&test_id=test-1&section=2',
        '/pages/listening-test-dictation.html?test_id=test-1&section=2',
      ],
    ];
    for (const [launcher, admittedPlayer] of pairs) {
      assert.equal(canonicalHref(launcher), canonicalHref(admittedPlayer), launcher);
    }
  });

  test('launcher không hợp lệ vẫn hiện ra để parity báo lệch', () => {
    const cases = [
      ['/core-player/launch?session_id=x', '/core-player/launch?session_id=x'],
      [
        '/core-player/launch?surface=speaking&surface=reading_exam&session_id=x',
        '/core-player/launch?session_id=x&surface=reading_exam&surface=speaking',
      ],
      [
        '/core-player/launch?surface=speaking&session_id=x&session_id=y',
        '/core-player/launch?session_id=x&session_id=y&surface=speaking',
      ],
      [
        '/core-player/launch?surface=speaking&session_id=x&implementation=next',
        '/core-player/launch?implementation=next&session_id=x&surface=speaking',
      ],
    ];
    for (const [href, expected] of cases) {
      assert.equal(canonicalHref(href), expected);
    }
    assert.equal(new Set(cases.map(([href]) => canonicalHref(href))).size, cases.length);
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
    assert.equal(canonicalHref('./grammar-search.html?q=tenses', { base: base2 }), '/grammar/search?q=tenses');
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

  test('khoảng trắng đầu/cuối của heading KHÔNG tạo lệch giả', () => {
    // HTML legacy xuống dòng + thụt lề trong <h1>, JSX thì không. Hai bên hiện
    // y hệt trên màn hình; nếu ghép `tag:text` rồi mới chuẩn hoá thì thành
    // `H1: X` vs `H1:X` và cổng CI đỏ ở mọi PR — nhiễu kiểu đó làm người ta
    // tắt cổng đi.
    const meta = { url: 'https://x/a', finalUrl: 'https://x/a', status: 200 };
    const legacy = buildFacts({ headings: [{ tag: 'H1', text: '\n        Học ngữ pháp\n      ' }] }, meta);
    const next = buildFacts({ headings: [{ tag: 'H1', text: 'Học ngữ pháp' }] },
                            { ...meta, url: 'https://x/b', finalUrl: 'https://x/b' });
    assert.deepEqual(legacy.headings, next.headings);
    assert.deepEqual(legacy.headings, ['H1:Học ngữ pháp']);
  });

  test('normalizeText gộp khoảng trắng, giữ dấu tiếng Việt', () => {
    assert.equal(normalizeText('  Ngữ   pháp\n IELTS '), 'Ngữ pháp IELTS');
  });
});

describe('cổng parity trong CI (review #914)', () => {
  test('PARITY_PORT phải nằm trong allowlist CORS của backend', () => {
    // Bất biến LIÊN TỆP, và là ca đã cắn thật: chạy ở cổng ngoài allowlist thì
    // vế legacy không fetch được, trang hiện "Lỗi: Failed to fetch", và bảng
    // kết quả thành 938 `line-extra` toàn mức thấp ⇒ cổng XANH trên nền rác.
    const port = (/PARITY_PORT:\s*'(\d+)'/.exec(GATE_ACTIVE) || [])[1];
    assert.ok(port, 'workflow phải khai PARITY_PORT');
    const allowed = [...BACKEND_MAIN.matchAll(/"http:\/\/(?:localhost|127\.0\.0\.1):(\d+)"/g)]
      .map((m) => m[1]);
    assert.ok(allowed.length, 'không đọc được allowlist trong backend/main.py');
    assert.ok(allowed.includes(port),
      `PARITY_PORT=${port} không có trong allowlist CORS ${JSON.stringify([...new Set(allowed)])}`);
  });

  test('bộ lọc KHÔNG bắt route mà G1 không so được', () => {
    // `/` và `/profile`: bản legacy đã bị gỡ (đo được `/index.html` → 307 sang
    // `/`), nên không còn gì để so. Bắt `frontend/app/**` nghĩa là PR sửa hai
    // route đó vẫn kích hoạt job rồi BÁO XANH mà chưa mở route đã sửa.
    assert.ok(!/- 'frontend\/app\/\*\*'/.test(GATE_ACTIVE),
      'bộ lọc rộng = cổng tự cấp phép cho route nó không so');
    // CẬP NHẬT 2026-08-05 — LÝ DO đổi, khẳng định thì KHÔNG.
    // Trước: "route cần đăng nhập nằm ngoài tầm G1". Nay authed-G1 đã có (tiêm
    // phiên Supabase vào trình duyệt) và `/home` ĐƯỢC so qua cặp trong
    // `parity-pairs-authed.json`. Nhưng `(authed)` vẫn phải nằm ngoài bộ lọc vì
    // nó chứa `/profile`, mà `/pages/profile.html` đã 307 sang `/profile` khi
    // cutover pilot 3 — không còn vế legacy nào để so.
    // Phân biệt cho đúng: "cần đăng nhập" KHÔNG còn là lý do loại trừ;
    // "bản legacy đã bị gỡ" mới là. (Test này đã bắt tôi thêm nhầm `(authed)`.)
    assert.ok(!/\(authed\)/.test(GATE_ACTIVE),
      '/profile không còn vế legacy để so (đã 307 khi cutover pilot 3)');
    assert.match(GATE_ACTIVE, /- 'frontend\/app\/\(public-content\)\/\*\*'/);
    // Chiều ngược lại: `/home` CÓ so được (legacy `/pages/home.html` vẫn trả
    // 200), nên gỡ dòng này khỏi bộ lọc là bỏ phủ sóng — phải đỏ.
    assert.match(GATE_ACTIVE, /- 'frontend\/app\/\(authed-home\)\/\*\*'/,
      'mất glob (authed-home) = cổng authed không bao giờ tự chạy');
    assert.match(GATE_ACTIVE, /- 'frontend\/public\/pages\/home\.html'/);
  });

  test('PR đụng bộ render BÀI VIẾT phải chạy phạm vi đầy đủ', () => {
    // `--categories-only` không mở trang bài nào; nếu PR sửa bộ render bài mà
    // vẫn chạy phạm vi hẹp thì lần chạy CHẶN-MERGE không phủ chỗ đã sửa, và
    // lịch đêm chỉ báo SAU khi đã merge.
    assert.match(GATE_ACTIVE, /steps\.scope\.outputs\.scope/,
      'phạm vi phải suy từ tệp đã sửa, không phải hằng số');
    assert.match(GATE_ACTIVE, /\[category\]\\\/\\\[slug\\\]|category.*slug/,
      'quy tắc chọn phạm vi phải nhắc tới đường dẫn bài viết');
    assert.match(GATE_ACTIVE, /scope=full/);
  });

  test('cổng phải quét CẢ bề rộng điện thoại', () => {
    // Chứng minh bằng thí nghiệm, không phải suy đoán: gài `hidden sm:block`
    // vào đoạn mô tả hero của bản Next ⇒ lượt 1280px cho 0 phát hiện, lượt
    // 375px bắt được `line-missing`. Bỏ lượt 375 là bỏ cả lớp hồi quy đó.
    assert.match(GATE_ACTIVE, /for VP in 1280x900 375x812/,
      'phải chạy cả hai bề rộng');
    assert.match(GATE_ACTIVE, /--viewport "\$VP"/);

    // Và phải chạy HẾT rồi mới thoát, không dừng ở cái đỏ đầu tiên.
    //
    // Ghim TÍNH CHẤT, không ghim nguyên văn. Bản trước khẳng định
    // `/\|\| FAIL=1[\s\S]*exit \$FAIL/` — tức ghim đúng một cách viết. Khi
    // thân vòng lặp đổi (thêm phân loại mã thoát 3 cho ca hạ tầng), chốt đỏ dù
    // tính chất nó canh vẫn nguyên vẹn. Chốt ghim cách viết thì mỗi lần sửa mã
    // là một lần phải sửa chốt, và người ta học cách nới chốt cho hết đỏ.
    const lines = GATE_ACTIVE.split('\n');
    const i = lines.findIndex((l) => /for VP in 1280x900 375x812/.test(l));
    assert.ok(i > 0, 'không tìm thấy vòng lặp bề rộng');
    // Đếm `for`/`done` để tìm ĐÚNG điểm đóng, không tin thụt lề: bash không coi
    // thụt lề có nghĩa, nên một vòng lặp LỒNG đóng bằng `done` thụt 12 dấu cách
    // sẽ bị chọn nhầm, và phần thân sau đó — kể cả một `exit` nằm trong vòng
    // `VP` — không được quét (codex bắt ở #999).
    let sâu = 1;
    let j = -1;
    for (let k = i + 1; k < lines.length; k += 1) {
      if (/^\s*(for|while|until)\b/.test(lines[k])) sâu += 1;
      else if (/^\s*done\b/.test(lines[k])) {
        sâu -= 1;
        if (sâu === 0) { j = k; break; }
      }
    }
    assert.ok(j > i, 'không tìm thấy điểm kết thúc vòng lặp bề rộng');

    const thân = lines.slice(i + 1, j);
    assert.deepEqual(thân.filter((l) => /^\s*exit\b/.test(l)), [],
      'không được thoát GIỮA vòng lặp — làm thế là bỏ các bề rộng còn lại');

    // Sau vòng lặp phải có đường thoát đỏ, và nó phải phụ thuộc vào cờ tích luỹ
    // chứ không phải mã thoát của lần chạy cuối cùng.
    const sau = lines.slice(j).join('\n');
    assert.match(sau, /exit 1/, 'phải có đường thoát đỏ sau khi chạy hết');
    assert.match(sau, /\$FAIL|\$INFRA/,
      'đường thoát phải đọc cờ tích luỹ, không phải mã của lượt cuối');
  });

  test('có chốt CORS chạy TRƯỚC khi so', () => {
    assert.match(GATE_ACTIVE, /Access-Control-Request-Method/,
      'trang trả 200 không chứng minh nó fetch được — phải kiểm preflight');
  });
});

describe('so trang CẦN ĐĂNG NHẬP (authed-G1)', () => {
  test('khoá localStorage suy đúng từ URL project', async () => {
    const { projectRef, storageKey } = await import('../tooling/supabase-session.mjs');
    assert.equal(projectRef('https://huwsmtubwulikhlmcirx.supabase.co'), 'huwsmtubwulikhlmcirx');
    assert.equal(storageKey('https://huwsmtubwulikhlmcirx.supabase.co'),
      'sb-huwsmtubwulikhlmcirx-auth-token');
    assert.throws(() => projectRef('không-phải-url'), /project ref/);
  });

  test('bản ghi phiên có expires_at TUYỆT ĐỐI', async () => {
    const { sessionEntry } = await import('../tooling/supabase-session.mjs');
    // Thiếu `expires_at` thì supabase-js coi phiên là hỏng và IM LẶNG đăng
    // xuất — trang lại rơi về /login.html và ta quay về đúng chỗ chưa sửa gì.
    const now = 1_785_000_000_000;
    const [, raw] = sessionEntry('https://x.supabase.co',
      { access_token: 'A', refresh_token: 'R', expires_in: 3600 }, now);
    const v = JSON.parse(raw);
    assert.equal(v.expires_at, Math.floor(now / 1000) + 3600);
    assert.equal(v.refresh_token, 'R');
    assert.equal(v.token_type, 'bearer');
  });

  test('không có access_token ⇒ ném lỗi, không tiêm phiên rỗng', async () => {
    const { sessionEntry } = await import('../tooling/supabase-session.mjs');
    assert.throws(() => sessionEntry('https://x.supabase.co', {}, 0), /access_token/);
  });

  test('phiên tiêm TRƯỚC khi điều hướng, không phải sau', () => {
    // Auth gate chạy ngay khi trang tải; đặt localStorage sau đó là đã muộn và
    // trang vẫn nhảy sang /login.html.
    assert.match(RUNNER, /addInitScript/);
    assert.match(RUNNER, /const mk = async \(\)/, 'tạo context phải là async để tiêm được');
  });

  test('KHÔNG đăng nhập thì không tiêm gì — chế độ ẩn danh giữ nguyên', () => {
    assert.match(RUNNER, /if \(AUTH_ENTRY\)/,
      'chỉ tiêm khi đã bật --auth; mặc định vẫn là ẩn danh');
  });

  test('đăng nhập dùng CHUNG một module với G2', () => {
    // Hai bản đăng nhập riêng là hai chỗ để trôi khỏi nhau.
    const probe = readFileSync(path.join(ROOT, 'frontend', 'tooling', 'authed-probe.mjs'), 'utf8');
    assert.match(probe, /from '\.\/supabase-session\.mjs'/);
    assert.match(RUNNER, /from '\.\/supabase-session\.mjs'/);
  });
});

test('`href="#"` TRỐNG không được phân giải theo URL trang', () => {
  // Link vô-tác-dụng: không có đích, chỉ để phần tử nhận focus/con trỏ, hành vi
  // do JS lo. Phân giải nó thành "link tới chính trang này" khiến nó KHÔNG BAO
  // GIỜ khớp — hai vế của một cặp parity luôn ở hai URL khác nhau.
  //
  // Đo được (khi Speaking còn dark-launch ở `/speaking-preview`): cặp đó báo 3
  // `link-missing` + 3 `link-extra` chỉ vì ba thẻ `.mode-card` dùng `href="#"`.
  // Hai vế có ĐÚNG cùng ba thẻ đó — không phải lỗi port.
  const a = canonicalHref('#', { base: 'http://x/pages/speaking.html' });
  const b = canonicalHref('#', { base: 'http://x/speaking-preview' });
  assert.equal(a, '#');
  assert.equal(a, b, 'href="#" phải cho cùng một giá trị ở mọi trang');
});

test('neo THẬT vẫn phân giải — và khớp nhờ hợp đồng URL', () => {
  // Neo trỏ sai id là lỗi thật, phải bắt được (phát hiện #3 vòng 2). Nó khớp
  // được giữa hai vế là nhờ bảng ánh xạ legacy → canonical, không phải nhờ bỏ qua.
  assert.equal(
    canonicalHref('#groups-section', { base: 'http://x/grammar.html' }),
    canonicalHref('#groups-section', { base: 'http://x/grammar' }));
  assert.equal(
    canonicalHref('#s', { base: 'http://x/pages/home.html' }),
    canonicalHref('#s', { base: 'http://x/home' }));
  assert.notEqual(
    canonicalHref('#a', { base: 'http://x/grammar' }),
    canonicalHref('#b', { base: 'http://x/grammar' }),
    'hai neo KHÁC id vẫn phải khác nhau');
});

test('hợp đồng URL: /pages/home.html → /home (đã cutover PR #932)', () => {
  assert.equal(canonicalHref('/pages/home.html', { base: 'http://x/a' }), '/home');
  assert.equal(canonicalHref('/home', { base: 'http://x/a' }), '/home');
});

test('route đã cutover mà KHÔNG có cặp parity phải được khai báo', () => {
  // Bot bắt ở #958: bộ lọc + regex từng mở lượt authed cho `/exercises`, nhưng
  // `parity-pairs-authed.json` chưa có cặp đó. Batch lifecycle 2026-08-09 đã
  // xác nhận 4 dòng là trạng thái feature-disabled đầy đủ và đăng ký lại cặp
  // với `minBaselineLines: 4`; không được đưa route đó trở lại danh sách này.
  //
  // Không sửa được bằng cách gỡ glob (thì PR đó lại không chạy cổng nào cả).
  // Cách đúng là làm việc LOẠI TRỪ trở nên tường minh và có người ký tên: mỗi
  // route ở đây phải có lý do ghi trong tài liệu, và danh sách này phải khớp
  // CHÍNH XÁC thực tế — thừa hay thiếu đều đỏ.
  const KNOWN_NO_PAIR = ['/pricing', '/writing/dashboard'];

  const pairs = JSON.parse(
    readFileSync(path.join(ROOT, 'frontend/tooling/parity-pairs-authed.json'), 'utf8'));
  const paired = new Set(pairs.map((p) => p.next));

  // CẶP CÔNG KHAI khai ở chỗ KHÁC: `DEFAULT_PAIRS` trong `parity-diff.mjs`.
  // Chốt này ban đầu chỉ đọc tệp authed, nên một trang công khai vừa port sẽ bị
  // báo "cutover mà không có cặp" DÙ nó có cặp — và thông báo lỗi lại đẩy người
  // đọc đi thêm một tên vào `KNOWN_NO_PAIR`, tức tự tay tạo ra đúng lỗ mà chốt
  // sinh ra để chặn. Mô hình của chốt phải phủ CẢ HAI nơi khai cặp.
  const diffSrc = readFileSync(path.join(ROOT, 'frontend/tooling/parity-diff.mjs'), 'utf8');
  const publicPairs = [...diffSrc.matchAll(/next:\s*'([^']+)'/g)].map((m) => {
    // Một cặp có thể cần query fixture để chạm đúng state hữu ích (ví dụ
    // Grammar Search). Quyền sở hữu route vẫn là pathname; so cả `?q=` ở đây
    // sẽ báo giả rằng route đã cutover nhưng chưa có cặp.
    return new URL(m[1], 'https://parity.local').pathname;
  });
  assert.ok(publicPairs.length >= 1, 'không đọc được cặp công khai nào — bộ dò hỏng?');
  for (const r of publicPairs) paired.add(r);

  // Route Next "đã cutover" = có hàng CUTOVER trong sổ route.
  const ledger = readFileSync(path.join(ROOT, 'docs/ROUTE_LEDGER.md'), 'utf8');
  const cutover = [...ledger.matchAll(/^\| `(\/[^`]*)` \|.*CUTOVER/gm)]
    .map((m) => m[1])
    // `/` và `/grammar` thuộc khu công khai, không nằm trong bộ authed.
    .filter((r) => r !== '/' && r !== '/grammar' && r !== '/profile');

  const missing = cutover.filter((r) => !paired.has(r)).sort();
  assert.deepEqual(missing, [...KNOWN_NO_PAIR].sort(),
    'route đã cutover mà thiếu cặp parity phải nằm trong KNOWN_NO_PAIR và có lý do '
    + 'ghi ở docs/PARITY_WRITING_PAIR_2026-08-05.md — nếu không, G1 xanh mà không so gì');

  const doc = readFileSync(path.join(ROOT, 'docs/PARITY_WRITING_PAIR_2026-08-05.md'), 'utf8');
  for (const r of KNOWN_NO_PAIR) {
    assert.ok(doc.includes(r.split('/').pop()),
      `${r} nằm ngoài parity mà tài liệu không giải thích vì sao`);
  }
});

test('mã DÙNG CHUNG luôn leo lên phạm vi full', () => {
  // Codex bắt ở PR #946 vòng 5, và đó là hệ quả của chính việc nới glob ở PR
  // đó: `paths` có `frontend/lib/**` nên job KHỞI ĐỘNG khi đổi
  // `lib/when-global-ready.mjs`, nhưng bộ chọn phạm vi lúc ấy chỉ leo lên
  // `full` cho hai tệp lib cụ thể ⇒ job chạy `--categories-only`, mà chế độ đó
  // bỏ hẳn các cặp trang BÀI VIẾT. Cổng xanh trong khi thứ vừa đổi không hề
  // được so.
  //
  // Cùng họ với #937 (glob có, regex không bắt) và #930 (thiếu glob). Ba lần
  // cùng một hình dạng nên chốt bằng máy, đừng chốt bằng trí nhớ.
  const rxs = [...GATE.matchAll(/grep -qE '([^']+)'/g)].map((m) => m[1]);
  assert.equal(rxs.length, 2, 'kỳ vọng đúng 2 regex: full và authed');
  const fullRe = new RegExp(rxs[0]);

  // Mã dùng chung có thể nuôi BẤT KỲ trang nào đang so, kể cả trang bài viết.
  for (const shared of ['frontend/lib/when-global-ready.mjs',
                        'frontend/lib/backend.ts',
                        'frontend/components/authed-shell.tsx']) {
    assert.ok(fullRe.test(shared),
      `«${shared}» là mã dùng chung mà không leo lên full ⇒ cặp bài viết bị bỏ qua`);
  }

  // Chiều ngược: đổi một trang riêng lẻ KHÔNG được kéo cả bộ full lên vô cớ —
  // nếu không thì việc khoanh phạm vi mất hết ý nghĩa và mọi PR đều chạy full.
  assert.ok(!fullRe.test('frontend/app/(authed-speaking)/speaking/page.tsx'),
    'trang riêng lẻ không được tự leo lên full');
});

test('regex authed KHÔNG mở lượt cho trang không có cặp parity', () => {
  // CHIỀU NGƯỢC của chốt ngay dưới. Chốt kia hỏi "glob có trong paths mà regex
  // bỏ sót không"; chốt này hỏi "regex có bắt trang mà KHÔNG cặp nào so không".
  //
  // Bot bắt ở #962: tôi đưa `listening-mcq` (và 4 tệp nó nạp) vào regex authed,
  // trong khi `parity-pairs-authed.json` không có cặp MCQ nào. Hệ quả: một PR
  // chỉ sửa MCQ vẫn mở lượt authed — lượt cần secret PROBE_*, đăng nhập thật,
  // rồi so đúng con số KHÔNG cặp. Không đỏ, chỉ tốn và gây ảo giác đã phủ.
  //
  // Trang bị loại có chủ ý (`writing-dashboard`) phải được nêu
  // TRONG tài liệu loại trừ, nếu không thì "chưa có cặp" và "quên mất cặp"
  // trông giống hệt nhau.
  const rxs = [...GATE.matchAll(/grep -qE '([^']+)'/g)].map((m) => m[1]);
  assert.equal(rxs.length, 2, 'kỳ vọng đúng 2 regex: full và authed');

  // Rút danh sách tên trang từ nhánh `pages/(a|b|c)\.html` của regex authed.
  const group = /public\/pages\/\(([^)]+)\)\\\.html/.exec(rxs[1]);
  assert.ok(group, 'không đọc được nhánh pages/(…).html trong regex authed');
  const names = group[1].split('|');
  assert.ok(names.length >= 5, `chỉ thấy ${names.length} trang — bộ dò hỏng?`);

  const pairs = JSON.parse(
    readFileSync(path.join(ROOT, 'frontend/tooling/parity-pairs-authed.json'), 'utf8'));
  const paired = new Set(pairs.map((x) => path.basename(
    new URL(x.legacy, 'https://parity.invalid').pathname, '.html')));
  const documented = readFileSync(
    path.join(ROOT, 'docs/PARITY_WRITING_PAIR_2026-08-05.md'), 'utf8');

  const orphan = names.filter((n) => !paired.has(n) && !documented.includes(`${n}.html`));
  assert.deepEqual(orphan, [],
    'regex authed mở lượt cần secret cho trang KHÔNG có cặp nào để so — hoặc thêm cặp, '
    + 'hoặc bỏ trang khỏi regex, hoặc ghi lý do loại trừ vào tài liệu');
});

test('MỌI glob authed trong `paths` đều được regex chọn phạm vi bắt', () => {
  // Codex bắt ở PR #937: tôi thêm `cue-card-detector.js` vào `paths` mà quên
  // regex. Hệ quả tinh vi — một PR CHỈ sửa tệp đó vẫn khởi động job, nhưng
  // `AUTHED` là false nên nó chạy mỗi lượt `categories` và **không bao giờ mở
  // cặp authed**. Cổng chạy mà không so đúng thứ vừa đổi còn tệ hơn cổng đỏ.
  //
  // Đây là cùng một họ với phát hiện trên PR #930 (thiếu glob) — nên chốt luôn
  // cả hai chiều bằng máy thay vì đọc bằng mắt.
  const yml = GATE;
  const rxs = [...yml.matchAll(/grep -qE '([^']+)'/g)].map((m) => m[1]);
  assert.equal(rxs.length, 2, 'kỳ vọng đúng 2 regex: full và authed');
  const authedRe = new RegExp(rxs[1]);

  const block = yml.slice(
    yml.indexOf("      - 'frontend/app/(authed-home)/**'"),
    yml.indexOf("      - 'frontend/lib/backend.ts'"));
  const globs = [...block.matchAll(/- '([^']+)'/g)].map((m) => m[1]);
  assert.ok(globs.length >= 10, `kỳ vọng nhiều glob authed, thấy ${globs.length}`);

  const missed = globs.filter((g) => !authedRe.test(g.replace('/**', '/x.tsx')));
  assert.deepEqual(missed, [],
    'glob nằm trong paths mà regex không bắt ⇒ job chạy nhưng KHÔNG mở cặp authed');

  // Phép cắt ở trên CHỈ phủ khối glob theo-trang. Mã DÙNG CHUNG (api.js, chrome
  // và các tệp chrome import) nằm ngoài khối đó, nên `missed` không bao giờ thấy
  // chúng — và đúng chỗ mù ấy đã để lọt: cả hai có trong `paths` nhưng regex
  // authed KHÔNG bắt, tức PR sửa chúng chạy job mà không mở CẶP NÀO (review cục
  // bộ bắt ở #955). Chúng có mặt trên MỌI trang được so nên phải mở lượt authed.
  for (const shared of ['frontend/public/js/api.js',
                        'frontend/public/js/components/aver-chrome.js',
                        'frontend/public/js/theme-toggle.js',
                        'frontend/public/js/user-pill.js',
                        'frontend/public/js/components/perf-hints.js']) {
    assert.ok(authedRe.test(shared),
      `«${shared}» là mã dùng chung của mọi trang authed — phải mở lượt authed`);
    assert.ok(yml.includes(`- '${shared}'`),
      `«${shared}» phải có trong \`paths\`, nếu không job không khởi động`);
  }

  // Khối glob theo-trang bên trên không thể thấy các dependency khai
  // tường minh ở những khối write-flow phía sau. Đã từng lọt liên tiếp
  // `speaking-debt.js`, `runtime-config.js` và `analytics-beacon.js`: workflow
  // khởi động nhưng selector cho `authed=false`, nên không mở trang nào
  // thực sự nạp tệp vừa đổi. Dựng dependency từ chính các legacy page
  // trong inventory để file mới cùng họ tự động bị chặn, không phải
  // chờ thêm một hand-pinned sentinel.
  const pullRequestPaths = yml.slice(
    yml.indexOf('  pull_request:'),
    yml.indexOf('\n  push:'),
  );
  const configuredPaths = [...pullRequestPaths.matchAll(/^\s+- '([^']+)'/gm)]
    .map((match) => match[1]);
  const missingPathPrefixes = configuredPaths.filter((configuredPath) => {
    const prefix = configuredPath.split(/[*?[]/, 1)[0].replace(/\/$/, '');
    return !prefix || !existsSync(path.join(ROOT, prefix));
  });
  assert.deepEqual(missingPathPrefixes, [],
    'path filter trỏ vào prefix không tồn tại ⇒ GitHub không bao giờ khởi động gate');

  const exactTrackedPaths = new Set(
    configuredPaths.filter((configuredPath) => !/[*?[]/.test(configuredPath)),
  );
  const pairs = JSON.parse(
    readFileSync(path.join(ROOT, 'frontend/tooling/parity-pairs-authed.json'), 'utf8'));
  const loadedLocalDependencies = new Set();
  for (const pair of pairs) {
    const legacyPathname = new URL(pair.legacy, 'https://parity.invalid').pathname;
    const legacyPage = readFileSync(
      path.join(ROOT, 'frontend/public', legacyPathname.replace(/^\//, '')),
      'utf8',
    );
    const assetUrls = [];
    for (const match of legacyPage.matchAll(/<script\b[^>]*>/gi)) {
      const src = /\bsrc=["']([^"']+)["']/i.exec(match[0]);
      if (src) assetUrls.push(src[1]);
    }
    for (const match of legacyPage.matchAll(/<link\b[^>]*>/gi)) {
      const rel = /\brel=["']([^"']+)["']/i.exec(match[0]);
      const href = /\bhref=["']([^"']+)["']/i.exec(match[0]);
      if (href && rel?.[1].split(/\s+/).includes('stylesheet')) assetUrls.push(href[1]);
    }
    for (const raw of assetUrls) {
      if (/^(?:https?:)?\/\//.test(raw) || /^(?:data|blob|mailto):/.test(raw)) continue;
      const pathname = new URL(raw, `https://parity.invalid${legacyPathname}`).pathname;
      const dependency = `frontend/public${pathname}`;
      if (existsSync(path.join(ROOT, dependency))) loadedLocalDependencies.add(dependency);
    }
  }
  const untrackedDependencies = [...loadedLocalDependencies]
    .filter((dependency) => !exactTrackedPaths.has(dependency))
    .sort();
  assert.deepEqual(untrackedDependencies, [],
    'script/stylesheet local được authed pair nạp nhưng không có trong paths '
    + '⇒ PR chỉ sửa dependency đó không khởi động parity gate');

  const uncoveredDependencies = [...loadedLocalDependencies]
    .filter((dependency) => !authedRe.test(dependency))
    .sort();
  assert.deepEqual(uncoveredDependencies, [],
    'dependency khai tường minh trong paths và được authed pair nạp, nhưng '
    + 'selector không bật authed=true ⇒ job xanh mà không so trang chịu ảnh hưởng');

  // Chiều ngược: đường dẫn của khu công khai KHÔNG được kích hoạt lượt authed.
  for (const neg of ['frontend/app/(public-content)/grammar/page.tsx',
                     'frontend/public/js/grammar.js']) {
    assert.ok(!authedRe.test(neg), `«${neg}» không được kích hoạt lượt authed`);
  }
});

// ── Phân biệt "trang hỏng" với "dụng cụ đo mất kết nối" ──────────────────────
//
// Ngày 2026-08-07, lượt `full` của cổng G1 báo 87/150 cặp lệch và 610 phát hiện
// mức cao. Không phát hiện nào là thật: backend production từ chối kết nối giữa
// chừng, và bản chụp HỎNG bị đem so với vế kia vốn gọi được.
//
// Kiểm-ổn-định sẵn có KHÔNG bắt được ca này, và lý do đáng nhớ: khi backend từ
// chối RẢI RÁC thì hai lần chụp khác nhau ⇒ báo `unstable-extraction`; nhưng khi
// nó từ chối ỔN ĐỊNH trong một quãng thì hai lần chụp GIỐNG HỆT NHAU (cùng
// hỏng) ⇒ harness kết luận "ổn định". Một bộ kiểm tính lặp lại sẽ coi hỏng-ổn
// -định là đạt. Nên phép kiểm mạng phải đứng TRƯỚC phép kiểm ổn định.
describe('isTransportError — lỗi hạ tầng không phải khuyết tật trang', () => {
  test('nhận đúng các mã tầng vận chuyển', () => {
    for (const mã of ['net::ERR_CONNECTION_REFUSED', 'net::ERR_CONNECTION_RESET',
                      'net::ERR_NAME_NOT_RESOLVED', 'net::ERR_TIMED_OUT',
                      'net::ERR_INTERNET_DISCONNECTED', 'net::ERR_CONNECTION_ABORTED']) {
      assert.equal(isTransportError(mã), true, `«${mã}» phải được nhận là lỗi vận chuyển`);
    }
  });

  // ĐỐI CHỨNG ÂM QUAN TRỌNG NHẤT. `ERR_ABORTED` xảy ra bình thường (điều hướng
  // bị huỷ, tải media bị dừng). Gộp nó vào sẽ khiến gần như MỌI lượt chạy tự
  // tuyên bố "hạ tầng hỏng" ⇒ cổng không bao giờ kết luận được gì nữa. Đó là
  // cách một bản vá chống-đỏ-giả tự biến thành cách tắt cổng.
  test('KHÔNG nhận ERR_ABORTED — nó xảy ra trong lượt chạy bình thường', () => {
    assert.equal(isTransportError('net::ERR_ABORTED'), false);
  });

  // `net::ERR_FAILED` nghe RẤT giống "mất kết nối", và bản đầu của tôi đã xếp
  // nó vào nhóm hạ tầng. Chromium dùng chính mã này cho LỖI CORS — nên xếp vào
  // đó là để một hồi quy CORS của bản Next, tức đúng loại khuyết tật cổng này
  // sinh ra để bắt, bị dán nhãn "hạ tầng" rồi biến mất khỏi báo cáo.
  test('KHÔNG nhận ERR_FAILED — Chromium dùng nó cho lỗi CORS', () => {
    assert.equal(isTransportError('net::ERR_FAILED'), false);
  });

  test('KHÔNG nhận lỗi tầng ứng dụng hay đầu vào rác', () => {
    // Đây là lỗi THẬT của trang, phải để cổng bắt chứ không được dán nhãn hạ tầng.
    assert.equal(isTransportError('net::ERR_BLOCKED_BY_CLIENT'), false);
    assert.equal(isTransportError('net::ERR_CERT_AUTHORITY_INVALID'), false);
    for (const rác of ['', null, undefined, 0, {}, [], 'ERR_CONNECTION_REFUSED']) {
      assert.equal(isTransportError(rác), false, `«${String(rác)}» không được tính là lỗi vận chuyển`);
    }
  });

  test('so BẰNG chứ không so CHỨA', () => {
    // Nếu cài bằng `includes`, chuỗi dưới sẽ khớp và một lỗi lạ bị giấu dưới
    // nhãn hạ tầng.
    assert.equal(isTransportError('net::ERR_FAILED_SOMETHING_ELSE'), false);
    // Nhưng hậu tố mô tả sau DẤU CÁCH là hình dạng Playwright thật sự phát ra.
    assert.equal(isTransportError('net::ERR_CONNECTION_REFUSED at http://x/y'), true);
  });
});

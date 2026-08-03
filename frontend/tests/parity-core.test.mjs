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

import { canonicalHref, normalizeText, comparePages, formatReport } from '../tooling/parity-core.mjs';

/** Trang tham chiếu tối thiểu — các test lệch đi từ đây. */
const base = () => ({
  url: 'https://x/grammar.html',
  status: 200,
  title: 'Grammar Wiki — Aver Learning',
  headings: ['H1:Học ngữ pháp như một hệ thống liên kết', 'H3:Tenses'],
  links: ['/grammar/tenses/present-perfect', '/pages/home.html', '/profile'],
  lines: ['Bài nổi bật', 'Present Perfect', 'Khám phá theo nhóm chủ đề'],
  components: ['aver-chrome', 'main'],
  apiPaths: ['/api/grammar/groups', '/api/grammar/home'],
  consoleErrors: [],
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
    assert.equal(canonicalHref('https://s/grammar.html', { origin: 'https://s' }), '/grammar');
    assert.equal(canonicalHref('https://khac/x'), 'https://khac/x');
  });

  test('bỏ qua neo và giao thức không điều hướng', () => {
    for (const h of ['#groups', 'mailto:a@b.c', 'javascript:void(0)', '', null]) {
      assert.equal(canonicalHref(h), null, `phải bỏ qua: ${h}`);
    }
  });

  test('bỏ dấu / cuối nhưng không nuốt mất gốc', () => {
    assert.equal(canonicalHref('/grammar/'), '/grammar');
    assert.equal(canonicalHref('/'), '/');
  });
});

describe('comparePages — nền tảng', () => {
  test('hai trang giống hệt ⇒ không phát hiện gì', () => {
    const r = comparePages(base(), { ...base(), url: 'https://x/grammar' });
    assert.deepEqual(r.findings, []);
    assert.equal(r.pass, true);
  });

  test('THIẾU ở bản mới là mức cao, THỪA là mức thấp', () => {
    const legacy = base();
    const next = { ...base(), lines: [...base().lines, 'Mục mới'] };
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
    const next = { ...base(), lines: ['Thẻ', 'Thẻ'] };
    const r = comparePages(legacy, next);
    assert.equal(r.findings.filter((f) => f.kind === 'line-missing').length, 1);
  });

  test('lỗi console và lệch status đều chặn', () => {
    assert.equal(comparePages(base(), { ...base(), consoleErrors: ['boom'] }).pass, false);
    assert.equal(comparePages(base(), { ...base(), status: 500 }).pass, false);
  });

  test('chỉ mức cao mới chặn — mức thấp không làm người ta bỏ qua cả bảng', () => {
    const r = comparePages(base(), { ...base(), lines: [...base().lines, 'thêm'] });
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
    const next = { ...base(), lines: [...base().lines, 'Cập nhật 03/08'] };
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
      links: ['/grammar/error-clinic/subject-verb-agreement',
              '/grammar/error-clinic/articles', '/grammar/conditionals/conditionals'],
    };
    const next = { ...legacy, lines: ['Bài nổi bật', 'Chưa có bài nào.'], links: [] };
    const r = comparePages(legacy, next);
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
    const next = {
      ...base(),
      components: ['main'],                       // không còn aver-chrome
      links: ['/grammar/tenses/present-perfect'], // mất link điều hướng chung
    };
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
      headings: ['H1:Học ngữ pháp như một hệ thống liên kết'],
      lines: ['Không tìm thấy thư mục'],
      links: [],
    };
    const next = {
      ...legacy,
      url: 'https://x/grammar?category=khong-ton-tai-xyz',
      headings: ['H1:Học ngữ pháp như một hệ thống liên kết', 'H2:khong ton tai xyz'],
      lines: ['khong ton tai xyz', 'Chưa có bài nào.'],
    };
    const r = comparePages(legacy, next);
    assert.equal(r.pass, false);
    assert.ok(r.findings.some((f) => f.kind === 'line-missing' && f.value === 'Không tìm thấy thư mục'),
      'mất trạng thái không-tìm-thấy của legacy');
    assert.ok(r.findings.some((f) => f.kind === 'heading-extra' && /khong ton tai xyz/.test(f.value)),
      'tiêu đề bịa ra phải hiện lên trong báo cáo');
  });

  test('chốt chặn: bản ĐÃ VÁ của cả ba ca đều sạch', () => {
    // Không có test này thì ba test trên có thể xanh nhờ bộ so báo lệch mọi lúc.
    const fixed = { ...base(), url: 'https://x/grammar' };
    const r = comparePages(base(), fixed);
    assert.deepEqual(r.findings, []);
    assert.equal(r.pass, true);
  });
});

describe('formatReport', () => {
  test('nêu số cặp lệch và không nuốt mất phát hiện', () => {
    const r = comparePages(base(), { ...base(), components: ['main'] });
    const out = formatReport([{ name: 'x', ...r }]);
    assert.match(out, /component-missing/);
    assert.match(out, /1 cặp lệch nghiêm trọng/);
  });

  test('normalizeText gộp khoảng trắng, giữ dấu tiếng Việt', () => {
    assert.equal(normalizeText('  Ngữ   pháp\n IELTS '), 'Ngữ pháp IELTS');
  });
});

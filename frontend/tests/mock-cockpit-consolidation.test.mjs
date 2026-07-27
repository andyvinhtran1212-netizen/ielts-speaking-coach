/**
 * mock-cockpit-consolidation.test.mjs — một lối vào, nút chuyển đề, tab cấp khoá.
 *
 * The admin met two different layouts depending on how they arrived: the hub
 * linked three mock pages directly, while /pages/admin/mock-tests/ already
 * existed as the cockpit that EMBEDS those same pages. These pin the single
 * door, the de-duplicated chrome, and the two-way convert buttons.
 *
 * Source-sentinels: admin pages behind auth, driven by IIFEs.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = (...p) => readFileSync(join(__dirname, '..', 'public', ...p), 'utf8');

const HUB = pub('pages', 'admin', 'index.html');
const COCKPIT_JS = pub('js', 'admin-mock-tests.js');
const COCKPIT_HTML = pub('pages', 'admin', 'mock-tests', 'index.html');
const EMBED = pub('js', 'admin-embed.js');
const EXAM_CONTENT = pub('js', 'admin-exam-content.js');

const MOCK_PAGES = ['mock-exams', 'mock-live', 'mock-reviews'];

describe('một lối vào duy nhất', () => {
  test('hub chỉ còn MỘT thẻ, trỏ vào cockpit', () => {
    assert.match(HUB, /href="\/pages\/admin\/mock-tests\/index\.html"/);
    for (const p of MOCK_PAGES) {
      assert.doesNotMatch(HUB, new RegExp(`href="/pages/admin/${p}/index\\.html"`),
        `hub still advertises ${p} as its own door`);
    }
  });

  test('cockpit có đủ 4 tab', () => {
    for (const t of ['manage', 'live', 'review', 'writing']) {
      assert.match(COCKPIT_HTML, new RegExp(`data-tab="${t}"`), t);
      assert.match(COCKPIT_JS, new RegExp(`\\b${t}:\\s*function`), t);
    }
  });

  test('tab cần chọn đề thì nói ĐÚNG tab đang hỏi', () => {
    // "để duyệt bài thi" on the live-console tab sends the admin looking for
    // the wrong thing.
    assert.match(COCKPIT_JS, /state\.tab === 'live' \? 'mở phòng thi trực tiếp\.'/);
  });

  test('phòng thi trực tiếp được nhúng KÈM exam_id', () => {
    // A console that opens on somebody else's classroom is worse than one that
    // asks which class you mean.
    assert.match(COCKPIT_JS, /mock-live\/index\.html\?exam_id='/);
  });
});

describe('chrome nhúng — không lộ tiêu đề lần hai', () => {
  test('helper dùng chung, không ba bản sao', () => {
    assert.match(EMBED, /classList\.add\('is-embedded'\)/);
    for (const p of MOCK_PAGES) {
      assert.match(pub('pages', 'admin', p, 'index.html'), /\/js\/admin-embed\.js/, p);
    }
  });

  test('helper nạp KHÔNG defer và TRƯỚC script trang', () => {
    // The class has to be on <body> before first paint, or the heading flashes
    // in and then vanishes.
    for (const p of MOCK_PAGES) {
      const html = pub('pages', 'admin', p, 'index.html');
      const at = html.indexOf('/js/admin-embed.js');
      const tag = html.slice(html.lastIndexOf('<script', at), html.indexOf('>', at) + 1);
      assert.doesNotMatch(tag, /defer|type="module"/, p);
      assert.ok(at < html.indexOf('/js/runtime-config.js'), `${p}: loads after page scripts`);
    }
  });

  test('ẩn theo dấu opt-in, không ẩn mọi h1', () => {
    // These pages use headings inside panels too; a blanket rule would gut the
    // page instead of de-duplicating its chrome.
    const css = pub('css', 'aver-design', 'admin-components.css');
    assert.match(css, /body\.is-embedded \[data-embed-hide\]/);
    assert.doesNotMatch(css, /body\.is-embedded h1\s*\{/);
    for (const p of MOCK_PAGES) {
      assert.match(pub('pages', 'admin', p, 'index.html'), /data-embed-hide/, p);
    }
  });

  test('mở trực tiếp thì KHÔNG ẩn gì', () => {
    // Every page must still work standalone — the class is only added when the
    // query param says so.
    assert.match(EMBED, /get\('embed'\) !== '1'\) return;/);
  });
});

describe('nút chuyển đề 2 chiều', () => {
  const LIBRARIES = [
    ['js/admin-reading.js', 'toggle-exam-only'],
    ['js/admin-listening-tests-list.js', 'data-exam-only'],
    ['pages/admin/writing/prompts.html', "data-action=\"exam-only\""],
  ];

  test('cả ba thư viện đều có nút', () => {
    for (const [rel, marker] of LIBRARIES) {
      const src = pub(...rel.split('/'));
      assert.ok(src.includes(marker), rel);
      assert.match(src, /Chuyển sang đề kỳ thi/, rel);
      assert.match(src, /Trả về thư viện/, rel);
    }
  });

  test('nhãn phản ánh trạng thái hiện tại, không cố định', () => {
    // A button that cannot see exam_only renders the wrong label — and the
    // admin then clicks the opposite of what they wanted.
    for (const [rel] of LIBRARIES) {
      const src = pub(...rel.split('/'));
      assert.match(src, /exam_only \?/, rel);
    }
  });

  test('chiều TRẢ VỀ có xác nhận nói rõ hậu quả', () => {
    for (const [rel] of LIBRARIES) {
      const src = pub(...rel.split('/'));
      assert.match(src, /ĐÃ LƯU TRỮ/, `${rel}: must warn about the archived-exam case`);
    }
    assert.match(EXAM_CONTENT, /ĐÃ LƯU TRỮ/);
  });

  test('KHÔNG chép luật chặn sang trình duyệt', () => {
    // The server refuses a release while a live exam binds the paper. A second
    // copy of that rule here is the copy that goes stale.
    for (const [rel] of LIBRARIES) {
      const src = pub(...rel.split('/'));
      assert.doesNotMatch(src, /status\s*!==\s*'archived'/, rel);
    }
  });

  test('bảng Đề kỳ thi có nút trả về, định tuyến đúng theo loại', () => {
    assert.match(EXAM_CONTENT, /ec-release/);
    // Reading is keyed by its human test_id across its admin surface; the other
    // two take the UUID.
    assert.match(EXAM_CONTENT, /k\.kind === 'reading' && row && row\.code/);
  });
});

describe('tab theo cấp khoá', () => {
  test('tab SINH TỪ dữ liệu, không liệt kê cứng', () => {
    // course_level is free text on purpose (a CHECK would need a migration per
    // new course), so a hardcoded strip goes stale the first time one is added.
    assert.match(EXAM_CONTENT, /function renderTabs\(\)/);
    assert.doesNotMatch(EXAM_CONTENT, /\['C1',\s*'C2'/);
  });

  test('có tab "Chưa đặt cấp khoá" và nó xếp cuối', () => {
    assert.match(EXAM_CONTENT, /Chưa đặt cấp khoá/);
    assert.match(EXAM_CONTENT, /if \(a === ''\) return 1;/);
  });

  test('bảng render theo tab đang chọn, không render toàn bộ', () => {
    assert.match(EXAM_CONTENT, /function visibleRows\(\)/);
    assert.match(EXAM_CONTENT, /\+ rows\.map\(function \(r\)/);
  });
});

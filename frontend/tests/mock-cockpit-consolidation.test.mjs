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

describe('vỏ cockpit — thiết kế lại (Giai đoạn 4)', () => {
  const HTML = COCKPIT_HTML;

  test('panel nói ĐANG thao tác trên đề nào', () => {
    // Two tabs act on ONE class, and the only place that said which was the
    // rail — an admin scrolled back to check before doing something
    // irreversible (thu bài, mở phần sau).
    assert.match(HTML, /id="mt-context"/);
    assert.match(COCKPIT_JS, /function renderContext\(\)/);
    // …and it is refreshed on every path that can change the answer
    for (const call of ['setTab', 'selectExam', 'the exam list resolves']) void call;
    assert.ok((COCKPIT_JS.match(/renderContext\(\)/g) || []).length >= 4,
      'renderContext must run on tab change, selection AND first load');
  });

  test('thanh ngữ cảnh dựng bằng DOM, không nối chuỗi HTML', () => {
    // Exam codes and titles are admin-authored; innerHTML here would be an
    // injection surface for a value nobody thinks of as untrusted.
    const fn = COCKPIT_JS.slice(COCKPIT_JS.indexOf('function renderContext()'));
    const body = fn.slice(0, fn.indexOf('\n  function ', 1));
    assert.doesNotMatch(body, /innerHTML/);
    assert.match(body, /createElement\('span'\)/);
  });

  test('tab cần chọn đề nói ra ĐIỀU ĐÓ, không chỉ bằng chấm tròn', () => {
    // A glyph is not an explanation. title= is announced and shows on hover.
    // EVERY such tab, not "at least one" — a bare `assert.match` here passed
    // while one of the two tabs had already lost its title.
    const tabs = HTML.match(/<button[^>]*data-needs-exam[^>]*>/g) || [];
    assert.ok(tabs.length >= 2, 'expected the live and review tabs to be marked');
    for (const t of tabs) assert.match(t, /title="Cần chọn một đề/, t);
    // …and the dot is decoration, so screen readers must not read "bullet".
    assert.match(HTML, /content: "⦁" \/ ""/);
  });

  test('một biến duy nhất cho chiều cao khung', () => {
    // It was written three times and drifted the moment the panel grew a
    // context bar — frame and empty state then disagreed and the panel jumped.
    assert.match(HTML, /--mt-chrome:/);
    assert.doesNotMatch(HTML, /calc\(100vh - 110px\)/);
  });

  test('focus thấy được trên MỌI control, không riêng tab', () => {
    const block = HTML.slice(HTML.indexOf('.mt-tab:focus-visible'));
    const rule = block.slice(0, block.indexOf('}'));
    for (const sel of ['.mt-chip:focus-visible', '.mt-exam:focus-visible']) {
      assert.ok(rule.includes(sel), `${sel} has no visible focus`);
    }
  });

  test('chip lọc đủ lớn để bấm', () => {
    // 3px of vertical padding made these ~18px tall — a filter you have to aim at.
    assert.match(HTML, /\.mt-chip \{[\s\S]{0,400}min-height: 32px/);
  });

  test('tablist khai báo đủ: selected, controls, và một tabpanel thật', () => {
    assert.match(HTML, /role="tabpanel"/);
    assert.match(HTML, /aria-controls="mt-panel-body"/);
    assert.doesNotMatch(HTML, /aria-controls="mt-frame"/);
    assert.match(COCKPIT_JS, /setAttribute\('aria-selected'/);
  });

  test('bàn phím đi được giữa các tab', () => {
    // role="tablist" promises arrow-key navigation; it did not keep that.
    assert.match(COCKPIT_JS, /function onTabKey/);
    assert.match(COCKPIT_JS, /ArrowRight/);
    assert.match(COCKPIT_JS, /setAttribute\('tabindex', on \? '0' : '-1'\)/);
  });

  test('chip lọc báo trạng thái cho trình đọc màn hình', () => {
    assert.match(COCKPIT_JS, /setAttribute\('aria-pressed'/);
  });

  test('CHỈ data-needs-exam biết tab nào cần đề — JS không kể lại tên tab', () => {
    // The rule was written three times: the CSS marker, the reload-on-select
    // branch and the guard in renderFrame(). The dot could then say "pick an
    // exam" while the guard had stopped asking for one.
    assert.match(COCKPIT_JS, /function tabNeedsExam\(tab\)/);
    assert.match(COCKPIT_JS, /hasAttribute\('data-needs-exam'\)/);
    assert.doesNotMatch(COCKPIT_JS, /=== 'review' \|\| state\.tab === 'live'/);
  });

  test('panel mang tên của tab đang chọn', () => {
    // role="tabpanel" with no accessible name drops a screen reader into an
    // unnamed region that it has to guess the purpose of.
    assert.match(COCKPIT_JS, /setAttribute\('aria-labelledby', t\.id\)/);
    for (const t of ['manage', 'live', 'review', 'writing']) {
      assert.match(HTML, new RegExp(`id="mt-tab-${t}"`), t);
    }
  });

  test('mũi tên chỉ dời tiêu điểm, KHÔNG tự mở tab', () => {
    // Each panel is a whole admin page loading in an iframe. Activating on arrow
    // would fire three page loads just to walk across the strip.
    const fn = COCKPIT_JS.slice(COCKPIT_JS.indexOf('function onTabKey'));
    const body = fn.slice(0, fn.indexOf('\n  function ', 1));
    assert.doesNotMatch(body, /setTab\(/);
    assert.match(body, /\.focus\(\)/);
  });

  test('đề biến khỏi danh sách thì bỏ chọn, không để khung trỏ ID mồ côi', () => {
    assert.match(COCKPIT_JS, /state\.selectedId = null;/);
  });

  test('nhúng thì CHỈ thanh bên trái chọn kỳ thi, không có bộ chọn thứ hai', () => {
    // The live console carries its own picker. Two pickers over ONE console means
    // the rail can name exam A while thu bài / mở phần sau act on exam B — and
    // those do not undo.
    const live = pub('pages', 'admin', 'mock-live', 'index.html');
    assert.match(live, /id="exam-picker"[^>]*data-embed-hide/);
    // …and the handler refuses to move the console even if something changes the
    // hidden control programmatically.
    const js = pub('js', 'admin-mock-live.js');
    const at = js.indexOf("el('exam-picker').addEventListener('change'");
    assert.ok(at > 0);
    assert.match(js.slice(at, at + 400), /if \(window\.AVER_EMBEDDED\) return;/);
  });

  test('tab "Tất cả" dùng sentinel qua được bộ phân tích HTML', () => {
    // A literal U+0000 in innerHTML is rewritten to U+FFFD by the parser, so
    // getAttribute() could never match it and the tab rendered an empty table.
    assert.doesNotMatch(EXAM_CONTENT, /\\u0000/);
    assert.match(EXAM_CONTENT, /var ALL_TABS = '__all__';/);
  });

  test('nhãn nút theo exam_only THẬT của hàng, không cố định', () => {
    // Unchecking the filter loads library rows too; labelling those "Trả về thư
    // viện" says they are reserved when they are not.
    assert.match(EXAM_CONTENT, /r\.exam_only\s*\n?\s*\?\s*'<button[^']*ec-release/);
    assert.match(EXAM_CONTENT, /Đang ở thư viện/);
  });

  test('không còn số ma nào cho chiều cao', () => {
    assert.doesNotMatch(HTML, /calc\(100vh - \d+px\)/);
    assert.match(HTML, /--mt-rail-chrome:/);
  });
});

describe('nhúng phòng thi trực tiếp — không để lại ngõ cụt', () => {
  test('báo lỗi chỉ tới bộ chọn CÓ THẬT trong ngữ cảnh đang mở', () => {
    // The rail lists every exam; this page only opens published ones. Clicking a
    // draft therefore lands on the error branch — which pointed at the picker
    // above, the one now hidden inside the cockpit. Nowhere to go.
    const js = pub('js', 'admin-mock-live.js');
    assert.match(js, /window\.AVER_EMBEDDED\s*\n?\s*\?\s*'Chọn một kỳ thi đã publish ở danh sách bên trái\.'/);
  });
});

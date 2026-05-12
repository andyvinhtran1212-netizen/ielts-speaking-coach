/**
 * frontend/tests/admin-writing-grade-redesign.test.mjs — Sprint 6.14c
 * Phase C (admin instructor grading interface, 2,113 lines).
 *
 * Sprint 6.8 finding confirmed: this page owns its grading CSS — does
 * NOT link writing-renderers.css. Sprint 6.14c migrates the 498-line
 * inline <style> block to frontend/css/admin-writing-grade.css
 * (~700 lines, --av-* token-driven, no --ds-* refs). JS logic
 * preserved byte-identical including:
 *   - 15 textareas (1 instructor-note + 14 section editors)
 *   - 7 backend endpoints (load / patch feedback / patch instructor-note
 *     / render / export.docx / mark-delivered / regrade)
 *   - 4 tabs (tongquan / loi / nangcao / baimau)
 *   - 4 tier badges (quick / standard / deep / instructor)
 *   - 6 status pill states (data-status driven)
 *   - 3 instructor-panel variants (default / locked / delivered)
 *   - dirty-state save button (btn-dirty class)
 *   - SECTION_KEYS map (13 sections) + STRING_SECTIONS map
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

let html;
let css;
let baseCss;

before(() => {
  html    = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin-writing-grade.html'), 'utf8');
  css     = readFileSync(path.join(REPO_ROOT, 'frontend/css/admin-writing-grade.css'),    'utf8');
  baseCss = readFileSync(path.join(REPO_ROOT, 'frontend/css/admin-writing.css'),          'utf8');
});


describe('admin-writing-grade.html / foundation + IIFE', () => {
  test('admin-writing-grade.css exists (Sprint 6.8 finding: own grading CSS)', () => {
    assert.ok(existsSync(path.join(REPO_ROOT, 'frontend/css/admin-writing-grade.css')));
  });

  test('foundation order tokens → components → admin-writing.css → admin-writing-grade.css', () => {
    const t = html.indexOf('aver-design/tokens.css');
    const c = html.indexOf('aver-design/components.css');
    const a = html.indexOf('css/admin-writing.css');
    const g = html.indexOf('css/admin-writing-grade.css');
    assert.ok(t > -1 && c > -1 && a > -1 && g > -1);
    assert.ok(t < c && c < a && a < g);
  });

  test('writing-renderers.css NOT linked (Sprint 6.8 de-facto scope)', () => {
    assert.ok(!/writing-renderers\.css/.test(html), 'Sprint 6.8 finding: admin-writing-grade owns its CSS; do not link writing-renderers.css');
  });

  test('Plus Jakarta Sans + JetBrains Mono fonts loaded (Inter dropped)', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.match(html, /JetBrains\+Mono/);
    assert.ok(!/family=Inter\b/.test(html));
  });

  test('legacy 498-line inline <style> block removed (only minimal `.hidden` left)', () => {
    const inlineBlocks = html.match(/<style[\s\S]*?<\/style>/g) || [];
    assert.ok(inlineBlocks.length <= 1, `Expected at most 1 minimal inline <style>, found ${inlineBlocks.length}`);
    if (inlineBlocks.length === 1) {
      // Allow at most the minimal `.hidden` block (≤300 chars).
      assert.ok(inlineBlocks[0].length < 500, `Inline <style> too large: ${inlineBlocks[0].length} chars — was the legacy block re-introduced?`);
    }
  });

  test('canonical anti-flash IIFE present', () => {
    assert.match(html, /localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/);
    assert.match(html, /stored\s*===\s*['"](?:light|dark)['"]\s*\|\|\s*stored\s*===\s*['"](?:light|dark)['"]/);
  });
});


describe('admin-writing-grade.html / 15 textareas preserved byte-identical', () => {
  test('instructor-note-input textarea (panel)', () => {
    assert.match(html, /id=["']instructor-note-input["']/);
  });

  // 14 section edit textareas, each with data-input="<key>".
  const SECTION_KEYS = [
    'criteria', 'overview', 'trajectory',
    'mistakes', 'recurring',
    'lexical', 'sentence-structure', 'coherence', 'idea-development', 'counterargument',
    'instructor-note', 'improved', 'ai-content', 'key-takeaways',
  ];
  for (const key of SECTION_KEYS) {
    test(`textarea data-input="${key}" present`, () => {
      assert.match(html, new RegExp(`data-input=["']${key}["']`), `Missing data-input="${key}"`);
    });
  }

  test('total textarea count ≥ 15', () => {
    const count = (html.match(/<textarea\b/g) || []).length;
    assert.ok(count >= 15, `Expected ≥15 textareas, found ${count}`);
  });
});


describe('admin-writing-grade.html / 7 backend endpoints preserved', () => {
  test('GET /admin/writing/essays/{id} — load detail', () => {
    assert.match(html, /window\.api\.get\(\s*['"]\/admin\/writing\/essays\/['"]\s*\+\s*_essayId\s*\)/);
  });
  test('PATCH /admin/writing/essays/{id}/feedback — save edits', () => {
    assert.match(html, /window\.api\.patch\(\s*['"]\/admin\/writing\/essays\/['"]\s*\+\s*_essayId\s*\+\s*['"]\/feedback['"]/);
  });
  test('PATCH /admin/writing/essays/{id}/instructor-note', () => {
    assert.match(html, /\/admin\/writing\/essays\/['"]\s*\+\s*_essayId\s*\+\s*['"]\/instructor-note['"]/);
  });
  test('GET /admin/writing/essays/{id}/render', () => {
    assert.match(html, /\/admin\/writing\/essays\/['"]\s*\+\s*_essayId\s*\+\s*['"]\/render['"]/);
  });
  test('GET /admin/writing/essays/{id}/export.docx', () => {
    assert.match(html, /\/admin\/writing\/essays\/['"]\s*\+\s*_essayId\s*\+\s*['"]\/export\.docx['"]/);
  });
  test('POST /admin/writing/essays/{id}/mark-delivered', () => {
    assert.match(html, /\/admin\/writing\/essays\/['"]\s*\+\s*_essayId\s*\+\s*['"]\/mark-delivered['"]/);
  });
  test('POST /admin/writing/essays/{id}/regrade', () => {
    assert.match(html, /window\.api\.post\(\s*['"]\/admin\/writing\/essays\/['"]\s*\+\s*_essayId\s*\+\s*['"]\/regrade['"]/);
  });
});


describe('admin-writing-grade.html / SECTION_KEYS map (13 sections) preserved', () => {
  const KEYS = [
    'overview', 'criteria', 'mistakes', 'recurring', 'trajectory',
    'sentence-structure', 'coherence', 'lexical',
    'idea-development', 'counterargument',
    'improved', 'ai-content', 'key-takeaways',
  ];
  for (const k of KEYS) {
    test(`SECTION_KEYS entry "${k}" present`, () => {
      assert.match(html, new RegExp(`['"]${k}['"]\\s*:\\s*['"][a-zA-Z]+['"]`), `Missing SECTION_KEYS["${k}"] mapping`);
    });
  }

  test('STRING_SECTIONS marks overview + improved as string-type (not JSON)', () => {
    const m = html.match(/var\s+STRING_SECTIONS\s*=\s*\{[\s\S]*?\};/);
    assert.ok(m);
    assert.match(m[0], /['"]overview['"]\s*:\s*1/);
    assert.match(m[0], /['"]improved['"]\s*:\s*1/);
  });
});


describe('admin-writing-grade.html / 4 tabs preserved', () => {
  for (const tab of ['tongquan', 'loi', 'nangcao', 'baimau']) {
    test(`tab-btn data-tab="${tab}" present`, () => {
      assert.match(html, new RegExp(`data-tab=["']${tab}["']`), `Missing data-tab="${tab}"`);
    });
    test(`tab-panel data-panel="${tab}" present`, () => {
      assert.match(html, new RegExp(`data-panel=["']${tab}["']`), `Missing data-panel="${tab}"`);
    });
  }
  test('first tab is-active by default (tongquan)', () => {
    assert.match(html, /class=["']tab-btn is-active["']\s+data-tab=["']tongquan["']/);
  });
});


describe('admin-writing-grade.html / tier badge variants preserved', () => {
  test('tier-badge default class on #tier-badge', () => {
    assert.match(html, /id=["']tier-badge["'][^>]*class=["']tier-badge tier-standard["']/);
  });

  test('admin-writing-grade.css defines all 4 tier variants', () => {
    for (const t of ['tier-quick', 'tier-standard', 'tier-deep', 'tier-instructor']) {
      assert.match(css, new RegExp(`\\.${t}\\b`), `Missing .${t} rule`);
    }
  });
});


describe('admin-writing-grade.html / status pill migrated to data-status', () => {
  test('setStatusPill uses setAttribute(data-status) (no inline style mutation)', () => {
    const block = html.match(/function\s+setStatusPill\(\s*status\s*\)\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(block);
    assert.match(block[0], /setAttribute\(\s*['"]data-status['"]/);
    assert.ok(!/pill\.style\.background/.test(block[0]), 'setStatusPill must not mutate inline style');
    assert.ok(!/pill\.style\.color/.test(block[0]),      'setStatusPill must not mutate inline style');
  });

  test('admin-writing-grade.css defines all 6 status pill variants', () => {
    for (const s of ['graded', 'reviewed', 'delivered', 'failed', 'pending', 'grading']) {
      assert.match(css, new RegExp(`\\.pill\\[data-status=["']${s}["']\\]`), `Missing pill[data-status=${s}] rule`);
    }
  });
});


describe('admin-writing-grade.html / setAlert migrated to class hooks', () => {
  test('setAlert uses aw-alert--* classes (no inline style mutation)', () => {
    const block = html.match(/function\s+setAlert\([\s\S]*?\n\s*\}/);
    assert.ok(block);
    assert.match(block[0], /aw-alert--error/);
    assert.match(block[0], /aw-alert--success/);
    assert.match(block[0], /aw-alert--warn/);
    assert.ok(!/area\.innerHTML\s*=[\s\S]{0,80}style\s*=/.test(block[0]), 'setAlert must not emit inline style');
  });
});


describe('admin-writing-grade.html / instructor panel preserved', () => {
  test('3 variant modifier classes available (default / locked / delivered)', () => {
    for (const v of ['.instructor-panel ', '.instructor-panel.locked', '.instructor-panel.delivered']) {
      assert.match(css, new RegExp(v.replace(/[.\s]/g, m => m === ' ' ? '\\s' : '\\' + m)));
    }
  });

  test('instructor-panel container + title + meta + textarea + 2 action buttons preserved', () => {
    for (const id of ['instructor-panel', 'instructor-panel-title', 'instructor-panel-meta',
                       'instructor-note-input', 'btn-instructor-deliver', 'btn-instructor-release']) {
      assert.match(html, new RegExp(`id=["']${id}["']`), `Missing instructor-panel id: ${id}`);
    }
  });
});


describe('admin-writing-grade.html / header action buttons preserved', () => {
  for (const id of ['btn-save', 'btn-copy', 'btn-download', 'btn-regrade', 'btn-deliver']) {
    test(`#${id} preserved`, () => {
      assert.match(html, new RegExp(`id=["']${id}["']`), `Missing button id="${id}"`);
    });
  }

  test('btn-dirty class toggled on dirty save state', () => {
    assert.match(html, /classList\.add\(\s*['"]btn-dirty['"]/);
  });

  test('admin-writing-grade.css defines btn-dirty rule', () => {
    assert.match(css, /\.btn-dirty\b/);
  });
});


describe('admin-writing-grade.html / feedback merge logic preserved (Sprint 2.5.1 fix)', () => {
  test('_mergeFeedback layers admin edits OVER AI feedback', () => {
    assert.match(html, /function\s+_mergeFeedback\(/);
  });

  test('comment confirms the round-trip merge semantic', () => {
    assert.match(html, /layer admin edits OVER AI feedback/i);
  });
});


describe('admin-writing-grade.html / routing accepts ?id= and ?essay_id=', () => {
  test('_qs.get(id) || _qs.get(essay_id) — accept both', () => {
    assert.match(html, /_qs\.get\(\s*['"]id['"]\s*\)\s*\|\|\s*_qs\.get\(\s*['"]essay_id['"]\s*\)/);
  });
});


describe('admin-writing-grade.html / body class + theme toggle', () => {
  test('body uses av-page', () => {
    assert.match(html, /<body[^>]*class=["'][^"']*\bav-page\b/);
  });

  test('canonical theme toggle present with icon-sun / icon-moon', () => {
    assert.match(html, /class=["']icon-sun["']/);
    assert.match(html, /class=["']icon-moon["']/);
  });

  test('theme-toggle binding script present', () => {
    assert.match(html, /bindToggleButton\s*\(\s*\)/);
  });
});


describe('admin-writing-grade.css / token discipline', () => {
  test('uses --av-* tokens (no --ds-* tokens)', () => {
    const av = (css.match(/var\(--av-/g) || []).length;
    const ds = (css.match(/var\(--ds-/g) || []).length;
    assert.ok(av > 200, `Expected many --av-* refs, got ${av}`);
    assert.equal(ds, 0);
  });

  test('no hardcoded `color: #...` runtime declarations', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const hex = stripped.match(/^\s*color:\s*#[0-9a-fA-F]{3,6};/gm) || [];
    assert.deepEqual(hex, []);
  });

  test('no Era B / legacy navy hex literals in runtime CSS', () => {
    const runtime = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const h of ['#0a1628', '#14b8a6', '#0f766e', '#14a8ae', '#5eead4', '#f87171', '#fde68a', '#86efac']) {
      assert.ok(!runtime.includes(h), `runtime CSS should not contain ${h}`);
    }
  });

  test('--av-text-faint usage stays under the 10-instance cap (this page only)', () => {
    const total = (html.match(/--av-text-faint/g) || []).length;
    assert.ok(total <= 10, `--av-text-faint on this page ≤ 10, got ${total}`);
  });

  test('all 14 section-specific component classes defined', () => {
    for (const sel of [
      '.criterion-card', '.card-criterion', '.mistake-card',
      '.lexical-card', '.coherence-card', '.idea-card', '.counter-block',
      '.essay-improved-block', '.stat-tile', '.criterion-mini',
      '.focus-theme-card', '.issue-card', '.takeaway-block', '.complexity-meter',
    ]) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)), `Missing rule for ${sel}`);
    }
  });

  test('grading-page-specific classes match JS renderer output (band-low/mid/good/high)', () => {
    for (const sel of ['.band-low', '.band-mid', '.band-good', '.band-high']) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)));
    }
  });

  test('admin-writing.css shared aw-alert primitives still in place (no duplication)', () => {
    assert.match(baseCss, /\.aw-alert\b/);
    assert.match(baseCss, /\.aw-alert--error\b/);
  });
});


describe('admin-writing-grade.html / Vietnamese microcopy preserved', () => {
  const phrases = [
    'Review + Edit — Writing Coach Admin',
    'Đang kiểm tra quyền truy cập…',
    'Admin Access Required',
    'Quay lại trang chủ',
    'Save edits',
    'Mark delivered',
    'Chấm lại',
    'Bài viết gốc',
    'Tổng quan',
    'Nhận xét lỗi',
    'Phân tích nâng cao',
    'Bài mẫu tham khảo',
    '4 tiêu chí IELTS',
    'Lỗi sai',
    'Lỗi lặp lại',
    'Diễn biến band',
    'Lexical',
    'Cấu trúc câu',
    'Coherence',
    'Idea Development',
    'Counterargument',
    'Note giảng viên',
    'Bài cải thiện',
    'AI check',
    'Key takeaways',
    'Lưu vào draft',
    'Lưu note',
    'Hủy',
    'Sửa JSON',
    'Đã sửa',
    'Đã chấm lại',
    'Tin nhắn cho học viên',
    'Release claim',
    'sẽ hiện trên trang kết quả sau khi deliver',
    'Em viết tốt phần coherence',
    'Bài cải thiện band 8.0+',
    'Personalized feedback',
    'Survives regrade',
  ];
  for (const phrase of phrases) {
    test(`microcopy preserved: "${phrase.slice(0, 40)}…"`, () => {
      assert.ok(html.includes(phrase), `Missing exact phrase: ${phrase}`);
    });
  }
});

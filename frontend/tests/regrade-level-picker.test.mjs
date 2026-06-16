/**
 * regrade-level-picker.test.mjs — regrade-level T2·2 (FE).
 *
 * grade.html handleRegrade() now opens a small modal with an L1–L5 picker
 * (labels mirror the #493 assign-time picker verbatim) and sends the chosen
 * analysis_level in the regrade POST body (BE T2·1 accepts it). Pins: the
 * picker labels, the default seeded from the essay's current level, the
 * level sent in the body, cancel/Esc → no regrade, the a11y pattern, and
 * that the old empty-body POST is gone — without touching the .aw-* island.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...r) => readFileSync(join(__dirname, '..', ...r), 'utf8');
const H = read('pages', 'admin', 'writing', 'grade.html');
const C = read('css', 'admin-writing-grade.css');


describe('regrade-level picker — labels match the #493 assign-time picker', () => {
  test('all five L1–L5 labels present verbatim', () => {
    assert.match(H, /L1 — Ngữ pháp cơ bản \(~B4–5\.5\)/);
    assert.match(H, /L2 — Liên kết \/ mạch lạc \(~B5\.5–6\.5\)/);
    assert.match(H, /L3 — Ý tưởng \/ lập luận \(~B6\.5–7\.5\)/);
    assert.match(H, /L4 — Từ vựng \/ cấu trúc câu \(~B7\.5–8\.5\)/);
    assert.match(H, /L5 — Khắt khe, tinh tế \(~B9\)/);
  });
  test('hints L4–L5 = chấm gắt (the rigor lever)', () => {
    assert.match(H, /L4–L5 chấm gắt hơn/);
  });
});


describe('regrade-level picker — default seeded from current essay level', () => {
  test('populate() captures detail.analysis_level into _currentLevel', () => {
    assert.match(H, /_currentLevel = \(lvl >= 1 && lvl <= 5\) \? lvl : 3/);
  });
  test('modal opens with the current level as default', () => {
    assert.match(H, /_openRegradeLevelModal\(_currentLevel\)/);
    assert.match(H, /if \(L\.v === cur\) opt\.selected = true/);
  });
});


describe('regrade-level picker — sends the chosen level', () => {
  test('regrade POST body carries analysis_level (not empty {})', () => {
    assert.match(
      H,
      /window\.api\.post\('\/admin\/writing\/essays\/'\s*\+\s*_essayId\s*\+\s*'\/regrade',\s*\{\s*analysis_level: level\s*\}\)/
    );
  });
  test('the old empty-body regrade POST is gone', () => {
    assert.doesNotMatch(H, /'\/regrade',\s*\{\}\)/);
  });
});


describe('regrade-level picker — cancel is a hard no-op', () => {
  test('cancel/Esc resolve null → handleRegrade returns without posting', () => {
    assert.match(H, /var level = await _openRegradeLevelModal\(_currentLevel\);\s*\n\s*if \(level == null\) return;/);
    assert.match(H, /function doCancel\(\)\s*\{ close\(\); resolve\(null\); \}/);
  });
});


describe('regrade-level picker — a11y (mirrors confirmDanger pattern)', () => {
  test('dialog semantics + Esc-cancel + return-focus + focus-trap', () => {
    assert.match(H, /setAttribute\('role', 'dialog'\)/);
    assert.match(H, /setAttribute\('aria-modal', 'true'\)/);
    assert.match(H, /e\.key === 'Escape'/);
    assert.match(H, /prevFocus\.focus\(\)/);            // return focus on close
    assert.match(H, /e\.key === 'Tab'/);                // focus-trap
    assert.match(H, /select\.focus\(\)/);               // initial focus on the picker
  });
});


describe('regrade-level picker — grade-logic + island untouched', () => {
  test('still the .aw-* island (no admin-components migration)', () => {
    assert.match(H, /admin-writing-grade\.css/);
    assert.doesNotMatch(H, /aver-design\/admin-components\.css/);
  });
  test('modal styled in admin-writing-grade.css via --av-* tokens', () => {
    assert.match(C, /\.regrade-modal\b/);
    assert.match(C, /\.regrade-modal__select/);
    assert.match(C, /var\(--av-surface-card\)/);
  });
});

/**
 * frontend/tests/av2-tokens.test.mjs — token contract of the new UI tree
 * (UIBASE-0056 FR-001, G03-T02).
 *
 * Reads styles/av2/tokens.css (never re-typed numbers) and checks:
 *   1. every token group of plan 5.2 is declared;
 *   2. WCAG contrast of the text/background pairs the components rely on
 *      (normal text ≥ 4.5, control borders ≥ 3);
 *   3. base.css keeps every rule under .av2-root.
 * Dark values and their pairs are added by G03-T18 (FR-D4).
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');

function block(src, selector) {
  const i = src.indexOf(`${selector} {`);
  assert.ok(i >= 0, `${selector} block missing`);
  const end = src.indexOf('}', i);
  const out = new Map();
  for (const m of src.slice(i, end).matchAll(/--(av2-[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

function hexOf(tokens, name, seen = new Set()) {
  const v = tokens.get(name);
  assert.ok(v, `--${name} not declared`);
  const ref = /^var\(--(av2-[a-z0-9-]+)\)$/.exec(v);
  if (ref) {
    assert.ok(!seen.has(ref[1]), `cycle at --${name}`);
    seen.add(ref[1]);
    return hexOf(tokens, ref[1], seen);
  }
  assert.match(v, /^#[0-9a-fA-F]{6}$/, `--${name} must be a 6-digit hex, got ${v}`);
  return v;
}

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

let root;
before(() => {
  root = block(strip(readFileSync(path.join(FRONTEND, 'styles/av2/tokens.css'), 'utf8')), ':root');
});

describe('av2 tokens — groups of plan 5.2 (FR-001)', () => {
  test('14 colour roles plus the control border', () => {
    for (const t of ['paper', 'surface', 'ink', 'muted', 'rule', 'accent', 'accent-hover', 'link',
      'mark', 'danger', 'ok', 'tint', 'off', 'on-accent', 'control-border']) {
      hexOf(root, `av2-${t}`);
    }
  });

  test('type, spacing, shape, focus, controls, shell and z groups', () => {
    const need = [
      ...[12, 13, 14, 15, 16, 18, 20, 24, 40].map((n) => `fs-${n}`),
      'fs-band-row', 'fs-band-md', 'fs-band-lg', 'fs-band-phone',
      'fw-regular', 'fw-strong', 'lh-body', 'lh-tight',
      ...Array.from({ length: 12 }, (_, i) => `space-${i + 1}`),
      'radius', 'rule-w', 'rule-strong-w', 'focus', 'focus-offset',
      'control-lg', 'control-md', 'control-sm', 'row', 'row-dense',
      'topbar-h', 'bottombar-h', 'account-menu-w', 'sidebar-row',
      'z-sticky', 'z-overlay', 'z-toast',
    ];
    const missing = need.filter((t) => !root.has(`av2-${t}`));
    assert.deepEqual(missing, []);
  });

  test('no shadow token (the sheets forbid drop shadows)', () => {
    assert.deepEqual([...root.keys()].filter((k) => /shadow/.test(k)), []);
  });

  test('font-family tokens live on .av2-root, not :root (plan 5.2)', () => {
    const src = strip(readFileSync(path.join(FRONTEND, 'styles/av2/tokens.css'), 'utf8'));
    assert.ok(!root.has('av2-font-sans') && !root.has('av2-font-serif'));
    const scoped = block(src, '.av2-root');
    assert.match(scoped.get('av2-font-sans'), /^var\(--av2-ff-sans\),/);
    assert.match(scoped.get('av2-font-serif'), /^var\(--av2-ff-serif\),/);
  });
});

describe('av2 tokens — WCAG contrast, light (FR-001, FR-005)', () => {
  const TEXT = [ // [foreground, background] — normal text ≥ 4.5
    ['ink', 'paper'], ['ink', 'surface'], ['ink', 'tint'], ['ink', 'off'],
    ['muted', 'paper'], ['muted', 'surface'], ['muted', 'off'],
    ['link', 'paper'], ['accent', 'paper'], ['mark', 'paper'],
    ['danger', 'surface'], ['danger', 'paper'], ['ok', 'surface'], ['ok', 'paper'],
    ['on-accent', 'accent'], ['on-accent', 'accent-hover'], ['on-accent', 'mark'], ['on-accent', 'danger'],
  ];
  for (const [fg, bg] of TEXT) {
    test(`${fg} on ${bg} ≥ 4.5`, () => {
      const r = contrast(hexOf(root, `av2-${fg}`), hexOf(root, `av2-${bg}`));
      assert.ok(r >= 4.5, `${fg}/${bg} = ${r.toFixed(2)}`);
    });
  }
  for (const bg of ['paper', 'surface']) {
    test(`control-border on ${bg} ≥ 3 (WCAG 1.4.11)`, () => {
      const r = contrast(hexOf(root, 'av2-control-border'), hexOf(root, `av2-${bg}`));
      assert.ok(r >= 3, `control-border/${bg} = ${r.toFixed(2)}`);
    });
  }
});

describe('av2 base.css stays scoped', () => {
  test('every selector starts with .av2-root', () => {
    const src = strip(readFileSync(path.join(FRONTEND, 'styles/av2/base.css'), 'utf8'));
    const selectors = [...src.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()));
    const leaking = selectors.filter((s) => s && !s.startsWith('.av2-root'));
    assert.deepEqual(leaking, []);
  });
});

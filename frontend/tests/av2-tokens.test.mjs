/**
 * frontend/tests/av2-tokens.test.mjs — token contract of the new UI tree
 * (UIBASE-0056 FR-001, FR-019, FR-022, FR-023, FR-024; G03-T02 + G03-T18).
 *
 * Reads styles/av2/tokens.css (never re-typed numbers) and checks:
 *   1. every token group of plan 5.2 is declared;
 *   2. colour tokens have light, dark and OS-dark values with the same set of
 *      names, always-light wrappers and print reuse the light set;
 *   3. WCAG contrast of the text/background pairs components rely on, in both
 *      modes (normal text ≥ 4.5, control borders ≥ 3);
 *   4. no v2 CSS fakes a colour with opacity or an alpha colour function;
 *   5. base.css keeps every rule under .av2-root.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');

/** Flat list of rules: { media, selectors[], decls: Map } (one @media level). */
function parseRules(css) {
  const rules = [];
  const walk = (src, media) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const prelude = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth) { if (src[j] === '{') depth += 1; else if (src[j] === '}') depth -= 1; j += 1; }
      const body = src.slice(open + 1, j - 1);
      if (prelude.startsWith('@media')) walk(body, prelude.replace(/^@media\s*/, ''));
      else {
        const decls = new Map();
        for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) decls.set(m[1].slice(2), m[2].trim());
        rules.push({ media, selectors: prelude.split(',').map((s) => s.trim()), decls });
      }
      i = j;
    }
  };
  walk(css, null);
  return rules;
}

const TOKENS_SRC = strip(readFileSync(path.join(FRONTEND, 'styles/av2/tokens.css'), 'utf8'));
const RULES = parseRules(TOKENS_SRC);

/** Declarations that apply to an element matched by `selector` under `media`. */
function scope(selector, media = null) {
  const out = new Map();
  for (const r of RULES) if (r.media === media && r.selectors.includes(selector)) for (const [k, v] of r.decls) out.set(k, v);
  return out;
}

const BASE = scope(':root');
const MODES = {
  light: new Map([...BASE, ...scope(':root[data-theme="light"]')]),
  dark: new Map([...BASE, ...scope(':root[data-theme="dark"]')]),
  osDark: new Map([...BASE, ...scope(':root:not([data-theme])', '(prefers-color-scheme: dark)')]),
};

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
  return v.toUpperCase();
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

const COLOURS = ['paper', 'surface', 'ink', 'muted', 'rule', 'accent', 'accent-hover', 'link', 'mark', 'danger',
  'ok', 'tint', 'off', 'on-accent', 'highlight', 'warn-bg', 'error-bg', 'ok-bg', 'logo-mark'].map((c) => `av2-${c}`);

describe('av2 tokens — groups of plan 5.2 (FR-001)', () => {
  test('colour roles, control border, QR pair', () => {
    for (const t of [...COLOURS, 'av2-control-border', 'av2-qr-bg', 'av2-qr-ink']) hexOf(MODES.light, t);
  });

  test('/ui-library "Màu" shows a swatch for every colour token (FR-013)', () => {
    const page = readFileSync(path.join(FRONTEND, 'app', '(ui-library)', 'ui-library', 'page.tsx'), 'utf8');
    const missing = [...COLOURS, 'av2-control-border', 'av2-qr-bg', 'av2-qr-ink']
      .filter((t) => !page.includes(`['${t.slice('av2-'.length)}', styles.sw`));
    assert.deepEqual(missing, []);
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
    assert.deepEqual(need.filter((t) => !MODES.light.has(`av2-${t}`)), []);
  });

  test('no shadow token (the sheets forbid drop shadows)', () => {
    assert.deepEqual(RULES.flatMap((r) => [...r.decls.keys()]).filter((k) => /shadow/.test(k)), []);
  });

  test('font-family tokens live on .av2-root, not :root (plan 5.2)', () => {
    assert.ok(!BASE.has('av2-font-sans') && !BASE.has('av2-font-serif'));
    const scoped = scope('.av2-root');
    assert.match(scoped.get('av2-font-sans'), /^var\(--av2-ff-sans\),/);
    assert.match(scoped.get('av2-font-serif'), /^var\(--av2-ff-serif\),/);
  });
});

describe('av2 tokens — light, dark and OS-dark (FR-019, FR-024)', () => {
  test('dark and OS-dark declare every colour token with identical values', () => {
    for (const t of COLOURS) {
      assert.ok(scope(':root[data-theme="dark"]').has(t), `--${t} missing in :root[data-theme="dark"]`);
      assert.equal(MODES.osDark.get(t), MODES.dark.get(t), `--${t}: OS-dark differs from dark`);
    }
  });

  test('explicit light declares every colour token', () => {
    for (const t of COLOURS) assert.ok(scope(':root[data-theme="light"]').has(t), `--${t} missing in light`);
  });

  test('dark actually differs from light for every surface/text role', () => {
    for (const t of COLOURS.filter((c) => c !== 'av2-logo-mark')) {
      assert.notEqual(hexOf(MODES.dark, t), hexOf(MODES.light, t), `--${t} has no dark value`);
    }
  });

  test('always-light wrapper re-declares the light colours and the colour-derived tokens', () => {
    const wrapper = scope('.av2-always-light');
    for (const t of [...COLOURS, 'av2-control-border', 'av2-focus']) {
      assert.equal(wrapper.get(t), MODES.light.get(t), `.av2-always-light --${t}`);
    }
  });

  test('print is light even when the site or the OS is dark', () => {
    const printDark = scope(':root[data-theme="dark"]', 'print');
    const printOs = scope(':root:not([data-theme])', 'print');
    for (const t of COLOURS) {
      assert.equal(printDark.get(t), MODES.light.get(t), `print (dark site) --${t}`);
      assert.equal(printOs.get(t), MODES.light.get(t), `print (OS dark) --${t}`);
    }
    assert.ok(TOKENS_SRC.lastIndexOf('@media print') > TOKENS_SRC.lastIndexOf('@media (prefers-color-scheme: dark)'),
      'the print block must come after the OS-dark block to win at equal specificity');
  });

  test('QR stays black on white and is not redefined by a mode', () => {
    assert.equal(hexOf(MODES.light, 'av2-qr-bg'), '#FFFFFF');
    for (const r of RULES) if (r.selectors.some((s) => s !== ':root')) assert.ok(!r.decls.has('av2-qr-bg') && !r.decls.has('av2-qr-ink'));
  });
});

describe('av2 tokens — WCAG contrast (FR-022)', () => {
  const TEXT = [ // [foreground, background] — normal text ≥ 4.5
    ['ink', 'paper'], ['ink', 'surface'], ['ink', 'tint'], ['ink', 'off'], ['ink', 'highlight'],
    ['muted', 'paper'], ['muted', 'surface'], ['muted', 'off'],
    ['link', 'paper'], ['link', 'surface'], ['accent', 'paper'], ['mark', 'paper'], ['mark', 'warn-bg'],
    ['danger', 'surface'], ['danger', 'paper'], ['danger', 'error-bg'], ['ok', 'surface'], ['ok', 'paper'], ['ok', 'ok-bg'],
    ['on-accent', 'accent'], ['on-accent', 'accent-hover'], ['on-accent', 'mark'], ['on-accent', 'danger'],
    ['qr-ink', 'qr-bg'],
  ];
  for (const mode of ['light', 'dark']) {
    for (const [fg, bg] of TEXT) {
      test(`${mode}: ${fg} on ${bg} ≥ 4.5`, () => {
        const r = contrast(hexOf(MODES[mode], `av2-${fg}`), hexOf(MODES[mode], `av2-${bg}`));
        assert.ok(r >= 4.5, `${mode} ${fg}/${bg} = ${r.toFixed(2)}`);
      });
    }
    for (const bg of ['paper', 'surface']) {
      test(`${mode}: control-border and logo-mark on ${bg} ≥ 3 (WCAG 1.4.11)`, () => {
        for (const fg of ['control-border', 'logo-mark']) {
          const r = contrast(hexOf(MODES[mode], `av2-${fg}`), hexOf(MODES[mode], `av2-${bg}`));
          assert.ok(r >= 3, `${mode} ${fg}/${bg} = ${r.toFixed(2)}`);
        }
      });
    }
  }
});

describe('av2 CSS — no faked colours (FR-023)', () => {
  test('no fractional opacity or alpha colour function in v2 CSS', () => {
    const files = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.css')) files.push(full);
      }
    };
    for (const root of ['styles', 'components/ui']) if (existsSync(path.join(FRONTEND, root))) walk(path.join(FRONTEND, root));
    for (const e of readdirSync(path.join(FRONTEND, 'app'), { withFileTypes: true })) {
      if (e.isDirectory() && (/^\(authed-v2-/.test(e.name) || e.name === '(public-v2)' || e.name === '(ui-library)')) walk(path.join(FRONTEND, 'app', e.name));
    }
    const bad = [];
    for (const f of files) {
      const src = strip(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/opacity\s*:\s*([0-9.]+)/g)) if (Number(m[1]) > 0 && Number(m[1]) < 1) bad.push(`${path.relative(FRONTEND, f)}: opacity ${m[1]}`);
      for (const m of src.matchAll(/\b(rgba?|hsla?|color-mix)\(/g)) bad.push(`${path.relative(FRONTEND, f)}: ${m[1]}()`);
    }
    assert.ok(files.length >= 2, 'sanity: v2 CSS files found');
    assert.deepEqual(bad, [], 'use a colour token instead of opacity / alpha colours');
  });
});

describe('av2 base.css stays scoped', () => {
  test('every selector starts with .av2-root', () => {
    const src = strip(readFileSync(path.join(FRONTEND, 'styles/av2/base.css'), 'utf8'));
    const selectors = [...src.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()));
    assert.deepEqual(selectors.filter((s) => s && !s.startsWith('.av2-root')), []);
  });
});

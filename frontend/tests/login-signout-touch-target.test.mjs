import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// PC-J25 (UIA-OBS-LOGOUT-44): the activation dialog's "Đăng xuất" button was
// 32px tall. It stays a text-style secondary button but needs a 44×44 touch
// target (WCAG 2.5.5) at every viewport, so no media query may shrink it.
const CSS = readFileSync(join(import.meta.dirname, '..', 'public', 'css', 'login-next.css'), 'utf8');
const rules = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selector: selector.trim(), body }));
const px = (body, prop) => {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`));
  return m ? Number(m[1]) : null;
};

test('Đăng xuất in the activation dialog has a ≥44×44px touch target', () => {
  const base = rules.find((r) => r.selector === '.lx-dialog-signout');
  assert.ok(base, '.lx-dialog-signout rule exists');
  assert.ok(px(base.body, 'min-height') >= 44, `min-height ≥ 44px: ${base.body}`);
  assert.ok(px(base.body, 'min-width') >= 44, `min-width ≥ 44px: ${base.body}`);
  assert.doesNotMatch(base.body, /(?:^|;)\s*(?:max-height|height)\s*:/, 'no fixed/max height caps the target');
});

test('Đăng xuất stays a text-style secondary action', () => {
  const base = rules.find((r) => r.selector === '.lx-dialog-signout');
  assert.match(base.body, /background:\s*none/);
  assert.match(base.body, /border:\s*0/);
  assert.match(base.body, /text-decoration:\s*underline/);
});

test('no other rule overrides the sign-out target size', () => {
  const overrides = rules.filter((r) => r.selector !== '.lx-dialog-signout'
    && r.selector.includes('lx-dialog-signout')
    && /(?:^|;)\s*(?:min-|max-)?(?:height|width)\s*:/.test(r.body));
  assert.deepEqual(overrides.map((r) => r.selector), []);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// ADMINAAL2-0032 FR-018 (T011): the /login suspended branch. Rendered
// behaviour lives in tests/react/login-suspended-account.test.tsx.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BEHAVIOR = readFileSync(join(ROOT, 'app', '(public-auth)', 'login', 'login-behavior.tsx'), 'utf8');
const BACKEND = readFileSync(join(ROOT, '..', 'backend', 'services', 'staff_security.py'), 'utf8');

test('the /login copy is the backend account_suspended message', () => {
  const message = BACKEND.match(/ACCOUNT_SUSPENDED_MESSAGE = "([^"]+)"/)[1];
  assert.equal(message, 'Tài khoản đang bị tạm khóa — liên hệ admin');
  assert.ok(BEHAVIOR.includes(`const SUSPENDED_MESSAGE = '${message}';`));
});

test('the suspended state comes from /auth/me suspended:true or a 403 account_suspended only', () => {
  assert.match(BEHAVIOR, /suspended: \(payload as AuthMeWire\)\.suspended === true/);
  assert.match(BEHAVIOR, /status === 403[\s\S]{0,160}\.code === 'account_suspended'/);
  assert.match(BEHAVIOR, /role="alert" data-testid="login-suspended"/);
  // Only the fixed message is rendered: no reason, actor or backend detail.
  const block = BEHAVIOR.slice(BEHAVIOR.indexOf('data-testid="login-suspended"'), BEHAVIOR.indexOf('{!busyMessage && !suspended'));
  const expressions = block.match(/\{[^}]*\}/g) || [];
  assert.deepEqual(expressions.filter((e) => /payload|detail|reason|activateError|\berror\b/.test(e)), []);
  assert.ok(expressions.includes('{SUSPENDED_MESSAGE}'));
});

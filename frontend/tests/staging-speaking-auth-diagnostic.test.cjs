const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { safePath } = require('../tooling/staging-speaking-auth-diagnostic.cjs');

test('Speaking diagnostic strips queries and arbitrary paths', () => {
  assert.equal(safePath('https://ielts-speaking-coach-staging.up.railway.app/auth/me?token=secret'), '/auth/me');
  assert.equal(safePath('https://ielts-speaking-coach-staging.up.railway.app/private-user-id'), 'other-staging-api');
  assert.equal(safePath('https://foreign.example/auth/me'), 'other');
});

test('Speaking diagnostic remains bounded, read-only and secret-safe', () => {
  const source = readFileSync(require.resolve('../tooling/staging-speaking-auth-diagnostic.cjs'), 'utf8');
  assert.match(source, /trial < 8/);
  assert.match(source, /trial >= 4 \? 750 : 0/);
  assert.match(source, /headers\.has\('authorization'\)/);
  assert.match(source, /\['GET', 'HEAD', 'OPTIONS'\]/);
  assert.match(source, /gateEvidence: false/);
  assert.doesNotMatch(source, /tracing\.start|postData\(|\.headers\(\)|login\.text\(|page\.screenshot|headers\.get\(/);
});

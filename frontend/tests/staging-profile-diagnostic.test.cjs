const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { category, PRODUCTION } = require('../tooling/staging-profile-diagnostic.cjs');

test('diagnostic categories do not include query secrets or arbitrary paths', () => {
  assert.equal(category('https://ielts-speaking-coach-staging.up.railway.app/auth/profile?token=secret'), '/auth/profile');
  assert.equal(category('https://zjphffoujxkpltixsbzj.supabase.co/auth/v1/token?key=secret'), 'staging-auth');
  assert.equal(category('https://foreign.test/private-user-name?token=secret'), 'other-resource');
  assert.equal(category('https://staging.averlearning.com/_next/static/private-name.js'), 'next-resource');
});

test('diagnostic is bounded and cannot emit live-auth trace or mutate app API', () => {
  const source = readFileSync(require.resolve('../tooling/staging-profile-diagnostic.cjs'), 'utf8');
  assert.match(source, /trial < 8/);
  assert.match(source, /gateEvidence: false/);
  assert.match(source, /\['GET', 'HEAD', 'OPTIONS'\]/);
  assert.doesNotMatch(source, /tracing\.start|postData\(|\.headers\(\)|login\.text\(|page\.screenshot/);
  assert.ok(PRODUCTION.has('huwsmtubwulikhlmcirx.supabase.co'));
  assert.ok(PRODUCTION.has('ielts-speaking-coach-production.up.railway.app'));
});

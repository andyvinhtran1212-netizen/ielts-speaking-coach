import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stubAdminMfaStatus } from '../tooling/admin-mfa-stub.mjs';

test('every shared admin fixture setup includes the exact availability read', async () => {
  const routes = [];
  await stubAdminMfaStatus({ route: async (match, handler) => routes.push({ match, handler }) });
  const url = new URL('http://fixture.local/api/admin/vocabulary/curated-availability');
  const availability = routes.find(({ match }) => match(url));
  assert.ok(availability);
  assert.ok(!availability.match(new URL(`${url}/unexpected`)));
  let response;
  let fallbacks = 0;
  const route = method => ({
    request: () => ({ method: () => method, headers: () => ({ origin: 'http://localhost:3000' }) }),
    fulfill: value => { response = value; },
    fallback: () => { fallbacks++; },
  });
  await availability.handler(route('GET'));
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { available: true });
  assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:3000');
  for (const method of ['POST', 'PATCH', 'DELETE']) await availability.handler(route(method));
  assert.equal(fallbacks, 3, 'unsupported requests still reach the strict catch-all');
});

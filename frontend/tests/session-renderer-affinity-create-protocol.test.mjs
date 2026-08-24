import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, test } from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const PUBLIC_API = readFileSync(join(ROOT, 'public', 'js', 'api.js'), 'utf8');
const LEGACY_API = readFileSync(join(ROOT, 'js', 'api.js'), 'utf8');

function loadApi() {
  const requests = [];
  const window = {
    location: { hostname: 'localhost', pathname: '/speaking', href: '' },
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    supabase: {
      createClient: () => ({
        auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
      }),
    },
  };
  const sandbox = {
    window,
    fetch: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 200, text: async () => '{"ok":true}' };
    },
    JSON,
    Date,
    Math,
    Error,
    console,
  };
  vm.runInNewContext(PUBLIC_API, sandbox);
  window.initSupabase('https://supabase.test', 'anon');
  return { api: window.api, requests };
}

describe('POST /sessions renderer-affinity create protocol', () => {
  test('the two shipped api.js copies stay identical', () => {
    assert.equal(PUBLIC_API, LEGACY_API);
  });

  test('current clients explicitly request an unclaimed row without mutating input', async () => {
    const { api, requests } = loadApi();
    const input = { mode: 'practice', part: 1, topic: 'Home' };

    await api.post('/sessions', input);

    assert.deepEqual(input, { mode: 'practice', part: 1, topic: 'Home' });
    assert.deepEqual(JSON.parse(requests[0].init.body), {
      mode: 'practice',
      part: 1,
      topic: 'Home',
      renderer_affinity_protocol: 'claim-v1',
    });
  });

  test('unrelated POST bodies are not versioned', async () => {
    const { api, requests } = loadApi();
    await api.post('/sessions/example/complete', { ok: true });
    assert.deepEqual(JSON.parse(requests[0].init.body), { ok: true });
  });
});

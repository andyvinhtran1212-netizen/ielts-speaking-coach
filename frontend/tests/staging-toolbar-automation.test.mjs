/** Vercel Toolbar must never mutate the DOM before Gate E hydration. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  TOOLBAR_HEADER,
  installToolbarSkip,
  primeBypassCookie,
} = require('./staging-e2e/helpers.js');

function fakeContext() {
  const routes = [];
  return {
    routes,
    request: {
      get() {
        throw new Error('protection bypass must remain optional in this unit test');
      },
    },
    async route(pattern, handler) {
      routes.push({ pattern, handler });
    },
  };
}

describe('Vercel Toolbar automation isolation', () => {
  test('installs the documented skip header only on the staging frontend origin', async () => {
    const context = fakeContext();
    await installToolbarSkip(context, 'https://staging.averlearning.com/path?ignored=1');

    assert.equal(context.routes.length, 1);
    assert.equal(context.routes[0].pattern, 'https://staging.averlearning.com/**');

    let continuedHeaders = null;
    await context.routes[0].handler({
      request: () => ({ headers: () => ({ accept: 'text/html' }) }),
      continue: async ({ headers }) => { continuedHeaders = headers; },
    });
    assert.deepEqual(continuedHeaders, {
      accept: 'text/html',
      'x-vercel-skip-toolbar': '1',
    });
    assert.deepEqual(TOOLBAR_HEADER, { 'x-vercel-skip-toolbar': '1' });
  });

  test('is idempotent and is installed even when protection bypass is absent', async () => {
    const context = fakeContext();
    await primeBypassCookie(context, 'https://staging.averlearning.com');
    await primeBypassCookie(context, 'https://staging.averlearning.com');
    assert.equal(context.routes.length, 1);
  });
});

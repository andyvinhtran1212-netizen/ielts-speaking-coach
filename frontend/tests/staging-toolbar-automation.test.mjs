/** Vercel Toolbar must never mutate the DOM before Gate E hydration. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  TOOLBAR_HEADER,
  TOOLBAR_SCRIPT_PATTERN,
  TOOLBAR_TAG,
  installToolbarSkip,
  primeBypassCookie,
} = require('./staging-e2e/helpers.js');

function fakeContext() {
  const routes = [];
  const initScripts = [];
  return {
    routes,
    initScripts,
    request: {
      get() {
        throw new Error('protection bypass must remain optional in this unit test');
      },
    },
    async route(pattern, handler) {
      routes.push({ pattern, handler });
    },
    async addInitScript(script, arg) {
      initScripts.push({ script, arg });
    },
  };
}

describe('Vercel Toolbar automation isolation', () => {
  test('keeps the skip header origin-scoped and neutralizes only the injected toolbar script', async () => {
    const context = fakeContext();
    await installToolbarSkip(context, 'https://staging.averlearning.com/path?ignored=1');

    assert.equal(context.routes.length, 2);
    assert.equal(context.routes[0].pattern, TOOLBAR_SCRIPT_PATTERN);
    assert.equal(context.routes[1].pattern, 'https://staging.averlearning.com/**');
    assert.equal(context.initScripts.length, 1);
    assert.equal(context.initScripts[0].arg, TOOLBAR_TAG);

    let fulfilledResponse = null;
    await context.routes[0].handler({
      fulfill: async (response) => { fulfilledResponse = response; },
    });
    assert.deepEqual(fulfilledResponse, {
      status: 200,
      contentType: 'application/javascript',
      body: '',
    });

    let continuedHeaders = null;
    await context.routes[1].handler({
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
    assert.equal(context.routes.length, 2);
    assert.equal(context.initScripts.length, 1);
  });

  test('removes existing and subsequently parsed toolbar nodes before hydration', async () => {
    const context = fakeContext();
    await installToolbarSkip(context, 'https://staging.averlearning.com');

    const existing = { removed: false, remove() { this.removed = true; } };
    const definitions = new Map();
    const previousDocument = globalThis.document;
    const PreviousCustomElements = globalThis.customElements;
    const PreviousHTMLElement = globalThis.HTMLElement;

    globalThis.document = {
      querySelectorAll(selector) {
        assert.equal(selector, TOOLBAR_TAG);
        return existing.removed ? [] : [existing];
      },
    };
    globalThis.HTMLElement = class {
      remove() { this.removed = true; }
    };
    globalThis.customElements = {
      get(name) { return definitions.get(name); },
      define(name, constructor) { definitions.set(name, constructor); },
    };

    try {
      const [{ script, arg }] = context.initScripts;
      script(arg);
      assert.equal(existing.removed, true);
      const ToolbarElement = definitions.get(TOOLBAR_TAG);
      const injected = new ToolbarElement();
      injected.connectedCallback();
      assert.equal(injected.removed, true);

      const applicationElement = class extends globalThis.HTMLElement {};
      globalThis.customElements.define('aver-application-element', applicationElement);
      assert.equal(definitions.get('aver-application-element'), applicationElement);

      const platformReplacement = class extends globalThis.HTMLElement {};
      globalThis.customElements.define(TOOLBAR_TAG, platformReplacement);
      assert.equal(definitions.get(TOOLBAR_TAG), ToolbarElement);
    } finally {
      globalThis.document = previousDocument;
      globalThis.customElements = PreviousCustomElements;
      globalThis.HTMLElement = PreviousHTMLElement;
    }
  });
});

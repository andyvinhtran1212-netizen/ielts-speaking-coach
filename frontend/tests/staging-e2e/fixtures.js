// PC-J437 — `test`/`expect` for the live staging suite with request-error
// redaction. A failed APIRequestContext call puts every request header into
// its error message ("Call log:"), including `Authorization: Bearer <JWT>`
// and `x-vercel-protection-bypass`; that message then lands in the reporters
// and the error-context file. `request`, `context.request` and
// `page.request` (and contexts from `playwright.request.newContext()`) share
// one prototype, so it is patched once per worker: every failing call is
// rethrown with its message and stack redacted. Specs keep their logic.
// @ts-check
const base = require('@playwright/test');
const { redactError } = require('../../tooling/redact-secrets.cjs');

const PATCHED = Symbol.for('aver.pcj437.redactedRequestErrors');

// Playwright names an API call ("apiRequestContext.get") after the last
// library frame before the first user frame, and under the test runner's
// source maps that frame takes its name from the identifier at the CALLER'S
// call site. So each original is invoked from a call site that spells the
// method name, with the original briefly shadowed on the instance (the
// shadow lives only for the synchronous part of the call, before Playwright's
// first await). `fetch` is shadowed too because get/post/... call
// `this.fetch(...)` synchronously.
const CALL_AS = {
  fetch: (self, args) => self.fetch(...args),
  get: (self, args) => self.get(...args),
  post: (self, args) => self.post(...args),
  put: (self, args) => self.put(...args),
  patch: (self, args) => self.patch(...args),
  delete: (self, args) => self.delete(...args),
  head: (self, args) => self.head(...args),
};

// The report's error snippet points at the first non-Playwright stack frame;
// drop this file's frames so it stays the spec line.
function dropOwnFrames(error) {
  if (error && typeof error.stack === 'string') {
    error.stack = error.stack.split('\n').filter((line) => !line.includes(__filename)).join('\n');
  }
  return error;
}

function callOriginal(self, name, originals, args) {
  const shadowed = [...new Set([name, 'fetch'])]
    .filter((key) => originals[key] && !Object.prototype.hasOwnProperty.call(self, key));
  for (const key of shadowed) Object.defineProperty(self, key, { configurable: true, value: originals[key] });
  try {
    return CALL_AS[name](self, args);
  } finally {
    for (const key of shadowed) delete self[key];
  }
}

function installRequestErrorRedaction(prototype) {
  if (!prototype || prototype[PATCHED]) return;
  const originals = {};
  for (const name of Object.keys(CALL_AS)) {
    if (typeof prototype[name] === 'function') originals[name] = prototype[name];
  }
  for (const name of Object.keys(originals)) {
    Object.defineProperty(prototype, name, {
      configurable: true,
      writable: true,
      value: async function redactedRequestCall(...args) {
        try {
          return await callOriginal(this, name, originals, args);
        } catch (error) {
          throw dropOwnFrames(redactError(error));
        }
      },
    });
  }
  Object.defineProperty(prototype, PATCHED, { value: true });
}

const test = base.test.extend({
  redactRequestErrors: [async ({ playwright }, use) => {
    const probe = await playwright.request.newContext();
    installRequestErrorRedaction(Object.getPrototypeOf(probe));
    await probe.dispose();
    await use(true);
  }, { scope: 'worker', auto: true }],
});

module.exports = { ...base, test, expect: base.expect, installRequestErrorRedaction };

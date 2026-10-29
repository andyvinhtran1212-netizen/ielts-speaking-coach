// PC-J253 — fail-fast guard for fixture-backed browser journeys.
//
// A journey that awaits a fixture signal which never arrives used to sit until
// the CI job was cancelled at minute 30, with nothing in the log. This guard
// bounds every such wait and the whole script, and on any failure prints what
// the page was doing before it exits 1:
//   • the last check that passed and the label being waited on;
//   • the page URL, recent API requests (path, X-Request-ID present or not,
//     token class — never the token itself), unhandled fixture requests,
//     page errors / console errors and a 2 kB slice of document.body.innerText.

const DEFAULT_WAIT_MS = 15_000;
const MAX_REQUESTS = 30;
const BODY_LIMIT = 2_000;
const PAGE_READ_MS = 5_000;

/** Token class for logs: fixture tokens by their prefix, anything else redacted. */
export function tokenClass(authorization) {
  if (!authorization) return 'none';
  const token = String(authorization).replace(/^Bearer\s+/i, '');
  const known = token.match(/^(fixture|refreshed|foreign)(?:-|$)/);
  return known ? known[1] : 'other';
}

function bounded(promise, ms, fallback) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).catch((error) => `${fallback}: ${String(error?.message || error).split('\n')[0]}`),
    new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * @param {{ name: string, totalMs: number, waitMs?: number }} options
 */
export function createFlowWatchdog({ name, totalMs, waitMs = DEFAULT_WAIT_MS }) {
  const startedAt = Date.now();
  const requests = [];
  const unhandled = [];
  const pageErrors = [];
  let page = null;
  let lastCheck = '(none)';
  let waitingFor = '(none)';
  let failing = false;

  const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;

  async function fail(reason) {
    if (failing) return new Promise(() => {});
    failing = true;
    const lines = [
      `✗ ${name}: ${reason}`,
      `  elapsed: ${elapsed()}`,
      `  last passed check: ${lastCheck}`,
      `  waiting for: ${waitingFor}`,
    ];
    if (page) {
      lines.push(`  url: ${await bounded(Promise.resolve().then(() => page.url()), PAGE_READ_MS, '(url unavailable)')}`);
    }
    lines.push(`  last ${MAX_REQUESTS} API requests (method path · x-request-id · token):`);
    for (const entry of requests.slice(-MAX_REQUESTS)) lines.push(`    ${entry}`);
    lines.push(`  unhandled fixture requests: ${unhandled.length ? unhandled.join(', ') : '(none)'}`);
    lines.push(`  page errors / console errors: ${pageErrors.length ? '' : '(none)'}`);
    for (const entry of pageErrors.slice(-20)) lines.push(`    ${entry}`);
    if (page) {
      const text = await bounded(
        page.evaluate(() => document.body?.innerText ?? '(no body)'),
        PAGE_READ_MS,
        '(body unavailable)',
      );
      lines.push(`  document.body.innerText (first ${BODY_LIMIT} chars):`);
      lines.push(String(text).slice(0, BODY_LIMIT).split('\n').map((line) => `    | ${line}`).join('\n'));
    }
    console.log(lines.join('\n'));
    process.exit(1);
    return new Promise(() => {});
  }

  const watchdog = setTimeout(() => {
    void fail(`watchdog: script exceeded ${Math.round(totalMs / 1000)}s`);
  }, totalMs);
  watchdog.unref();

  // Playwright timeouts and assertion errors surface as a rejected top-level
  // await; report them with the same diagnostics instead of a bare stack.
  const onCrash = (error) => {
    void fail(`uncaught error: ${error?.stack || error}`);
  };
  process.on('uncaughtException', onCrash);
  process.on('unhandledRejection', onCrash);

  return {
    /** Attach the page whose URL, errors and body are reported. */
    watchPage(target) {
      page = target;
      target.on('pageerror', (error) => pageErrors.push(`pageerror: ${String(error).split('\n')[0]}`));
      target.on('console', (message) => {
        if (message.type() === 'error') pageErrors.push(`console.error: ${message.text().slice(0, 300)}`);
      });
    },
    /** Record one fixture API request; the token is reduced to its class. */
    recordRequest(request) {
      const url = new URL(request.url());
      const headers = request.headers();
      requests.push(`${request.method()} ${url.pathname} · ${headers['x-request-id'] ? 'xrid' : 'no-xrid'} · ${tokenClass(headers.authorization)}`);
      if (requests.length > MAX_REQUESTS * 4) requests.splice(0, requests.length - MAX_REQUESTS);
    },
    recordUnhandled(entry) { unhandled.push(entry); },
    passed(checkName) { lastCheck = checkName; },
    /** Await a fixture/deferred signal for at most `ms`; on timeout print diagnostics and exit 1. */
    async within(promise, label, ms = waitMs) {
      waitingFor = label;
      let timer;
      try {
        return await Promise.race([
          promise,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
          }),
        ]);
      } catch (error) {
        return fail(`${label}: ${error?.message || error}`);
      } finally {
        clearTimeout(timer);
        if (waitingFor === label) waitingFor = '(none)';
      }
    },
    fail,
    stop() {
      clearTimeout(watchdog);
      process.off('uncaughtException', onCrash);
      process.off('unhandledRejection', onCrash);
    },
  };
}

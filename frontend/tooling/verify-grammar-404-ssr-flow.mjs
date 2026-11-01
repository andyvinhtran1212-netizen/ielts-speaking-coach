// Build-level regression for PC-J230 (GRAMMAR-404-SSR, PC-J77 F1/F2).
//
// An unknown Grammar article (`/grammar/:category/:slug`, key missing from
// `/api/grammar/categories`) used to be rewritten by proxy.ts to a static
// notFound() page inside the Grammar layout. That page prerendered as a bare
// `<html id="__next_error__">` shell: empty body, no stylesheet, no <title>.
// The 404 card only appeared after JS ran (blank with JS off, a long blank
// screen on a slow network), and after hydration tokens.css was linked twice.
//
// The source tests cannot see any of that, so this runs against a real
// `next build`. It starts its own `next start` on free ports with a fixture
// API that knows exactly one article (the proxy needs a successful list to
// call a miss; the shared next-native fixture has none, so the proxy fails
// open there), then checks the served HTML and a JS-off / JS-on browser.
//
// Usage (from frontend/, after `npm run build`):
//   node tooling/verify-grammar-404-ssr-flow.mjs
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (!existsSync(path.join(FRONTEND, '.next', 'BUILD_ID'))) {
  throw new Error('No production build in frontend/.next — run `npm run build` first');
}
const NEXT_BIN = createRequire(import.meta.url).resolve('next/dist/bin/next');

// A real article: backend/content/tenses/present-simple.md.
const ARTICLE = { category: 'tenses', slug: 'present-simple', title: 'Present Simple' };
const NOT_FOUND = [
  '/grammar/tenses/khong-ton-tai', // unknown slug in a real category
  '/grammar/xyz/abc', // unknown category
  '/writing/khong-co', // the root 404 the Grammar 404 must now match
];
const TOKENS = '/css/aver-design/tokens.css';
const WIDTHS = [390, 1280];

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failures.push(label);
};

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function freePort() {
  const probe = createServer();
  const port = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const fixture = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  response.setHeader('content-type', 'application/json; charset=utf-8');
  if (url.pathname === '/api/grammar/categories') {
    response.end(JSON.stringify([{ slug: ARTICLE.category, articles: [{ category: ARTICLE.category, slug: ARTICLE.slug }] }]));
    return;
  }
  if (url.pathname === `/api/grammar/article/${ARTICLE.category}/${ARTICLE.slug}`) {
    response.end(JSON.stringify({
      ...ARTICLE,
      summary: 'Fixture article for the Grammar 404 build check.',
      level: 'A2',
      difficulty: 'beginner',
      band_relevance: ['5.0+'],
      speaking_relevance: 'Use it for habits and facts.',
      writing_relevance: 'Use it for general statements.',
      pathways: ['foundation'],
      common_error_tags: [],
      tags: ['tenses'],
      order: 1,
      reading_time: 4,
      last_updated: '2026-09-14',
      status: 'complete',
      html: '<h2 id="overview">Overview</h2><p>The present simple describes habits and facts.</p>',
      word_count: 12,
      toc: [{ id: 'overview', name: 'Overview', depth: 2 }],
      anchors: [{ id: 'overview', location: 'Overview', type: 'heading' }],
      learning_blocks: [],
      prerequisites: [],
      compare_with: [],
      related_pages: [],
      next_articles: [],
      prev_article: null,
      next_article: null,
    }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ detail: 'No fixture for this endpoint' }));
});

const fixturePort = await listen(fixture);
const nextPort = await freePort();
const BASE = `http://127.0.0.1:${nextPort}`;
let nextLog = '';
const next = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(nextPort), '-H', '127.0.0.1'], {
  cwd: FRONTEND,
  env: { ...process.env, AVER_API_BASE: `http://127.0.0.1:${fixturePort}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
next.stdout.on('data', (chunk) => { nextLog += chunk; });
next.stderr.on('data', (chunk) => { nextLog += chunk; });

let browser;
try {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i += 1) {
    if (next.exitCode !== null) break;
    ready = await fetch(`${BASE}/favicon.svg`).then((r) => r.ok, () => false);
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error(`next start did not come up:\n${nextLog.slice(-2000)}`);

  for (const route of NOT_FOUND) {
    const res = await fetch(BASE + route, { redirect: 'manual' });
    const html = await res.text();
    const stylesheets = html.match(/<link rel="stylesheet"[^>]*>/g) || [];
    const tokenSheets = stylesheets.filter((tag) => tag.includes(`href="${TOKENS}"`));
    check(res.status === 404, `${route}: HTTP 404 (got ${res.status})`);
    check(!html.includes('__next_error__'), `${route}: served HTML is not the __next_error__ shell`);
    check(/<title>[^<]+<\/title>/.test(html), `${route}: served HTML has a <title>`);
    check(stylesheets.length >= 1, `${route}: served HTML links a stylesheet (${stylesheets.length})`);
    check(tokenSheets.length === 1, `${route}: tokens.css linked exactly once (${tokenSheets.length})`);
    check(/<meta name="robots" content="noindex/.test(html), `${route}: noindex`);
    check(/<h1[^>]*id="not-found-title"[^>]*>Trang này không còn ở đây<\/h1>/.test(html),
      `${route}: the Vietnamese 404 card is in the server HTML`);
  }

  const articleRoute = `/grammar/${ARTICLE.category}/${ARTICLE.slug}`;
  const article = await fetch(BASE + articleRoute, { redirect: 'manual' });
  const articleHtml = await article.text();
  check(article.status === 200, `${articleRoute}: a real article still answers 200 (got ${article.status})`);
  check(articleHtml.includes(ARTICLE.title) && !articleHtml.includes('__next_error__'),
    `${articleRoute}: the article renders`);

  browser = await chromium.launch();
  for (const javaScriptEnabled of [false, true]) {
    for (const width of WIDTHS) {
      const context = await browser.newContext({ javaScriptEnabled, viewport: { width, height: 844 } });
      // Never leave the local server (fonts, telemetry, Supabase).
      await context.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
      const mode = `JS ${javaScriptEnabled ? 'on' : 'off'} @${width}`;
      for (const route of NOT_FOUND) {
        const page = await context.newPage();
        let tokenRequests = 0;
        page.on('request', (req) => { if (new URL(req.url()).pathname === TOKENS) tokenRequests += 1; });
        const response = await page.goto(BASE + route, { waitUntil: 'load' });
        if (javaScriptEnabled) await page.waitForLoadState('networkidle');
        const card = page.locator('#not-found-title');
        check(response?.status() === 404, `${mode} ${route}: status 404`);
        check(await card.isVisible(), `${mode} ${route}: 404 card visible`);
        // The card's padding is var(--av-space-12): non-zero only when both the
        // CSS module and tokens.css applied.
        const padding = await page.evaluate(() => {
          const el = document.querySelector('section[aria-labelledby="not-found-title"]');
          return el ? parseFloat(getComputedStyle(el).paddingTop) : 0;
        });
        check(padding > 0, `${mode} ${route}: card styled by tokens (padding-top ${padding}px)`);
        const linked = await page.evaluate((href) => document.querySelectorAll(`link[rel="stylesheet"][href="${href}"]`).length, TOKENS);
        check(linked === 1, `${mode} ${route}: one tokens.css stylesheet in the DOM (${linked})`);
        check(tokenRequests === 1, `${mode} ${route}: tokens.css requested once (${tokenRequests})`);
        await page.close();
      }
      await context.close();
    }
  }
} finally {
  await browser?.close();
  next.kill('SIGTERM');
  fixture.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nGrammar 404 renders server-side with CSS, like the root 404');

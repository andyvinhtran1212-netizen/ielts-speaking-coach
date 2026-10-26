/**
 * frontend/tests/writing-tip-markdown.test.mjs
 *
 * Run with:
 *   node --test frontend/tests/writing-tip-markdown.test.mjs
 *
 * Regression (PR #1698 review): `writing-submit-receipt.js` now loads in its
 * own script chain, so on a hard load (esp. a deep link `?tab=tips&tip=...`
 * with `/vendor/marked.min.js` delayed) the tip modal could open before
 * `window.renderMarkdown` existed. `renderTipModal()` substituted '' and the
 * dialog marked the modal ready with an EMPTY body that never re-rendered.
 *
 * The real helper is driven with a fake clock: renderer delayed → Markdown,
 * renderer never → escaped plaintext (non-empty), renderer present →
 * immediate render, and the late-arrival upgrade only while the same tip is
 * still showing.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  TIP_RENDERER_WAIT_MS,
  plaintextTipBody,
  renderTipBody,
  upgradeTipWhenRendererArrives,
  waitForTipRenderer,
} from '../lib/writing-tip-markdown.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MD = '## Mẹo\n\nDùng **linking words** <script>alert(1)</script>';
const fakeMarkdown = (md) => '<div class="md">' + String(md).replace(/[<>]/g, '') + '</div>';

/** Fake clock; `onTick(t)` lets a test install the renderer at a given time. */
function clock(onTick = () => {}) {
  let t = 0;
  let sleeps = 0;
  return {
    now: () => t,
    sleep: async (ms) => { sleeps += 1; t += ms; onTick(t); },
    get sleeps() { return sleeps; },
    get t() { return t; },
  };
}

/** Same composition as `prepare` + `renderTipModal` in writing-behavior.tsx. */
async function openTipBody(win, c, reports = []) {
  await waitForTipRenderer(() => win.renderMarkdown, {
    now: c.now, sleep: c.sleep, report: (m) => reports.push(m),
  });
  return renderTipBody(MD, win.renderMarkdown);
}

describe('tip body waits for window.renderMarkdown (bounded)', () => {
  test('renderer delayed then available → Markdown body', async () => {
    const win = {};
    const c = clock((t) => { if (t >= 1200) win.renderMarkdown = fakeMarkdown; });
    const reports = [];
    const body = await openTipBody(win, c, reports);
    assert.equal(body.markdown, true);
    assert.equal(body.html, fakeMarkdown(MD));
    assert.ok(c.t >= 1200 && c.t < TIP_RENDERER_WAIT_MS, `waited ${c.t}ms`);
    assert.deepEqual(reports, []);
  });

  test('renderer never available → escaped, non-empty plaintext body', async () => {
    const win = {};
    const c = clock();
    const reports = [];
    const body = await openTipBody(win, c, reports);
    assert.equal(body.markdown, false);
    assert.ok(body.html.length > 0, 'body must never be empty');
    assert.match(body.html, /linking words/);
    assert.match(body.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(body.html, /<script/i, 'no raw HTML from the tip');
    assert.ok(c.t >= TIP_RENDERER_WAIT_MS, 'wait is bounded, then gives up');
    assert.equal(reports.length, 1, 'timeout is reported, not swallowed');
    assert.match(reports[0], /window\.renderMarkdown/);
  });

  test('renderer already present → immediate render, no waiting', async () => {
    const win = { renderMarkdown: fakeMarkdown };
    const c = clock();
    const body = await openTipBody(win, c);
    assert.equal(c.sleeps, 0);
    assert.deepEqual(body, { html: fakeMarkdown(MD), markdown: true });
  });

  test('renderer that throws falls back to escaped plaintext', () => {
    const body = renderTipBody(MD, () => { throw new Error('marked broke'); });
    assert.equal(body.markdown, false);
    assert.match(body.html, /&lt;script&gt;/);
  });

  test('plaintext fallback escapes every HTML metacharacter and keeps newlines', () => {
    const html = plaintextTipBody('a & b\n"c" \'d\' <e>');
    assert.match(html, /a &amp; b\n&quot;c&quot; &#39;d&#39; &lt;e&gt;/);
    assert.match(html, /white-space: pre-wrap/);
    assert.equal(plaintextTipBody('   '), '');
    assert.equal(plaintextTipBody(null), '');
  });
});

describe('late renderer upgrades the fallback body', () => {
  test('renderer arrives while the same tip is open → apply() re-renders', async () => {
    const win = {};
    const c = clock((t) => { if (t >= 9000) win.renderMarkdown = fakeMarkdown; });
    let applied = 0;
    const ok = await upgradeTipWhenRendererArrives(() => win.renderMarkdown, () => true,
      () => { applied += 1; }, { now: c.now, sleep: c.sleep });
    assert.equal(ok, true);
    assert.equal(applied, 1);
  });

  test('modal closed or switched to another tip → no re-render', async () => {
    const win = {};
    const c = clock((t) => { if (t >= 500) win.renderMarkdown = fakeMarkdown; });
    let applied = 0;
    const ok = await upgradeTipWhenRendererArrives(() => win.renderMarkdown, () => false,
      () => { applied += 1; }, { now: c.now, sleep: c.sleep });
    assert.equal(ok, false);
    assert.equal(applied, 0);
  });

  test('renderer never arrives → upgrade gives up silently (bounded)', async () => {
    const c = clock();
    let applied = 0;
    const ok = await upgradeTipWhenRendererArrives(() => undefined, () => true,
      () => { applied += 1; }, { now: c.now, sleep: c.sleep });
    assert.equal(ok, false);
    assert.equal(applied, 0);
  });
});

describe('writing dashboard wiring', () => {
  const behavior = readFileSync(path.join(__dirname,
    '../app/(authed-writing)/writing/dashboard/writing-behavior.tsx'), 'utf8');
  const layout = readFileSync(path.join(__dirname, '../app/(authed-writing)/layout.tsx'), 'utf8');

  test('tip dialog waits for the renderer and never substitutes an empty body', () => {
    assert.match(behavior, /prepare:\s*kind\s*=>\s*kind === 'tip' \? waitForTipRenderer\(getTipRenderer\)/);
    assert.match(behavior, /renderTipBody\(tip\.body_markdown, getTipRenderer\(\)\)/);
    assert.doesNotMatch(behavior, /renderMarkdown\(tip\.body_markdown\)\s*:\s*''/);
  });

  test('receipt script stays independent of the Markdown chain', () => {
    const chains = [...layout.matchAll(/<RouteScriptChain scripts=\{\[([\s\S]*?)\]\}/g)].map((m) => m[1]);
    const receipt = chains.find((c) => c.includes('writing-submit-receipt.js'));
    assert.ok(receipt, 'receipt chain exists');
    assert.doesNotMatch(receipt, /marked|purify|markdown\.js/);
  });
});

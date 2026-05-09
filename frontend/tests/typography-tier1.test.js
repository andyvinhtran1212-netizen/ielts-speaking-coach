/**
 * frontend/tests/typography-tier1.test.js — Sprint 6.2.
 *
 * Run with: node --test frontend/tests/typography-tier1.test.js
 *
 * Pins the Sprint 6.2 typography migration: every Tier 1 learner-facing
 * page (speaking, writing-dashboard, practice, result, full-test-result,
 * profile, onboarding) ships Manrope + Fraunces (the `frontend-design`
 * skill direction) — never Inter (the "generic AI sans-serif" the skill
 * explicitly avoids).
 *
 * What these tests catch:
 *   - A future PR that re-introduces Inter on a Tier 1 page
 *   - A page that drops the canonical body.ds-canvas atmosphere hook
 *   - A page that ships a Tailwind config still pointing fontFamily.sans
 *     at Inter (visual breakage even if the <link> is right)
 *
 * Why string-match the page source instead of running a headless browser?
 * Tailwind CDN config is static text in <head>; the Google Fonts URL is
 * static text in <head>. A regex is the cheapest pin that still catches
 * a regression. If a future page swaps CDN Tailwind for compiled Tailwind
 * (config moved to a build step), this test will need a new strategy —
 * but that day isn't today.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');


// ── Tier 1 page set per Sprint 6.2 spec ────────────────────────────


const TIER_1_PAGES = [
  'pages/speaking.html',
  'pages/writing-dashboard.html',
  'pages/practice.html',
  'pages/result.html',
  'pages/full-test-result.html',
  'pages/profile.html',
  'onboarding.html',
];


function _read(rel) {
  return fs.readFileSync(
    path.join(__dirname, '..', rel),
    'utf8',
  );
}


// ── Tests ───────────────────────────────────────────────────────────


test('Tier 1 pages do NOT import Inter from Google Fonts', () => {
  for (const rel of TIER_1_PAGES) {
    const html = _read(rel);
    assert.ok(
      !/family=Inter[:&]/.test(html),
      `${rel} still imports Inter from Google Fonts — Sprint 6.2 ` +
      `migrated all Tier 1 pages to Fraunces + Manrope. If you need ` +
      `to add a page back to Inter, document the deviation explicitly.`,
    );
  }
});


test('Tier 1 pages import the Fraunces + Manrope font pair', () => {
  for (const rel of TIER_1_PAGES) {
    const html = _read(rel);
    assert.ok(
      /family=Fraunces/.test(html),
      `${rel} is missing the Fraunces import — Sprint 6.2 expects all ` +
      `Tier 1 pages to ship Fraunces (display) + Manrope (body).`,
    );
    assert.ok(
      /family=Manrope|family=.*&family=Manrope|Manrope:/.test(html),
      `${rel} is missing the Manrope import — see above.`,
    );
  }
});


test('Tier 1 pages do NOT reference \'Inter\' in inline CSS or Tailwind config', () => {
  for (const rel of TIER_1_PAGES) {
    const html = _read(rel);
    assert.ok(
      !/'Inter'/.test(html),
      `${rel} still contains a literal 'Inter' reference (likely in a ` +
      `Tailwind config or inline style). Sprint 6.2 migrated this — ` +
      `swap to 'Manrope' to keep the page on the canonical font system.`,
    );
  }
});


test('Tier 1 pages opt into the canonical body.ds-canvas atmosphere', () => {
  // The atmosphere overlay (film-grain noise + radial gradient mesh)
  // lives in ds.css scoped under `body.ds-canvas`. Pages opt in with
  // class="ds-canvas" on <body>; if a Tier 1 page drops it, the page
  // visually regresses to a flat navy ground (the pre-Sprint-6.2 look).
  for (const rel of TIER_1_PAGES) {
    const html = _read(rel);
    const m = html.match(/<body\b[^>]*class="([^"]*)"/);
    assert.ok(
      m,
      `${rel} <body> has no class attribute — Sprint 6.2 expects ` +
      `class="...ds-canvas..." so the canonical atmosphere applies.`,
    );
    assert.ok(
      /\bds-canvas\b/.test(m[1]),
      `${rel} <body class="${m[1]}"> is missing the ds-canvas class — ` +
      `the atmosphere overlay (defined in ds.css under body.ds-canvas) ` +
      `won't apply without it.`,
    );
  }
});


test('Tier 1 pages link ds.css (token + atmosphere source)', () => {
  // ds.css is the source of truth for --ds-* tokens AND the
  // body.ds-canvas atmosphere overlay. A page can't render correctly
  // without it once Sprint 6.2 has migrated the inline atmosphere out.
  for (const rel of TIER_1_PAGES) {
    const html = _read(rel);
    assert.ok(
      /href="[^"]*css\/ds\.css"/.test(html),
      `${rel} does not link css/ds.css — Sprint 6.2 needs the canonical ` +
      `tokens + body.ds-canvas atmosphere from that stylesheet.`,
    );
  }
});

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


// Pages still on the Sprint 6.2 typography era (Manrope + Fraunces +
// body.ds-canvas atmosphere). As each page migrates to the Aver Design
// System foundation in a per-page redesign sprint, it leaves this list:
//
//   • home.html              — migrated Sprint 6.3 (PR #121, --av-* tokens, Plus Jakarta Sans)
//   • speaking.html          — migrated Sprint 6.4 (PR #123, full theme support post-6.4.1)
//   • practice.html          — migrated Sprint 6.5 (PR #127, full light + dark from day 1)
//   • result.html            — migrated Sprint 6.6 (PR #130, surgical migration on inline-JS rendering)
//   • writing-dashboard.html — migrated Sprint 6.7 (PR #132, surgical on 1060-line teacher-assignment workflow)
//   • writing-result.html    — migrated Sprint 6.8 (surgical on 671-line graded-essay view)
//   • full-test-result.html  — migrated Sprint 6.9 (PR #136, Phase 2 closure; A.2 Chart.js theme-aware pattern)
//   • vocabulary.html        — migrated Sprint 6.10 (this PR, Phase 3 page 1; iframe contract preserved, DEBT-2026-05-09-B still deferred)
//   • my-vocabulary.html     — migrated Sprint 6.11a (PR #140, surgical on the 1.3k-line card list view)
//   • flashcards.html        — migrated Sprint 6.11b (PR #141, Phase 3 page 3)
//   • exercises.html         — migrated Sprint 6.11b (PR #141, Phase 3 page 4)
//   • profile.html           — migrated Sprint 6.12a (Phase 3 final cluster, page 1 of 2; standalone profile route)
//
// Pin tests for the migrated pages live in their own *-redesign.test.mjs
// suites. This list keeps shrinking; eventually it goes empty and the
// file gets deleted in the cleanup sprint.
const TIER_1_PAGES = [
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


// ── Sprint 6.2.1 — ds.css must wire fonts into the cascade ─────────


test('ds.css body.ds-canvas declares font-family: Manrope', () => {
  // Why this test exists: Sprint 6.2 added Tailwind config + the
  // <link> imports for Manrope to all 7 Tier 1 pages, but pages were
  // still rendering Inter (browser fallback) because Tailwind CDN's
  // runtime compile of `font-sans` is timing-sensitive. The fix was
  // to declare font-family directly on body.ds-canvas in ds.css, so
  // every page that opts in gets Manrope without depending on the CDN
  // compiling at the right moment. Pin the rule.
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'css', 'ds.css'),
    'utf8',
  );
  // Match the body.ds-canvas opening brace through to its closing
  // brace (no nested braces, so a non-greedy match on `[^}]*` suffices).
  const m = css.match(/body\.ds-canvas\s*\{([^}]+)\}/);
  assert.ok(
    m,
    'body.ds-canvas rule not found in ds.css — did Sprint 6.0.1 / 6.2 ' +
    'restructure the file? Update the regex above.',
  );
  assert.match(
    m[1],
    /font-family\s*:\s*['"]Manrope['"]/,
    'body.ds-canvas is missing the Manrope font-family declaration. ' +
    'Without it, Tier 1 pages fall back to the browser default (Inter ' +
    'on most systems). See Sprint 6.2.1.',
  );
});


test('ds.css .display utility declares font-family: Fraunces', () => {
  // .display is the hand-applied Fraunces utility — only attached to
  // hero headings and page titles. Without the declaration here, the
  // utility class becomes a no-op and pages lose their display serif.
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'css', 'ds.css'),
    'utf8',
  );
  // Match `.display { ... font-family: 'Fraunces' ... }` allowing the
  // optional `.ds-display,` companion selector that lives next to it.
  assert.match(
    css,
    /\.display\s*\{[^}]*font-family\s*:\s*['"]Fraunces['"]/,
    '.display utility is missing the Fraunces font-family declaration. ' +
    'See Sprint 6.2 (the utility was added) and 6.2.1 (this test was ' +
    'added to pin it).',
  );
});

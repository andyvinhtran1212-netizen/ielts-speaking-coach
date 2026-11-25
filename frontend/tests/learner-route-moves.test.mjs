// LEARNERNAV-0062 (G07): learner pages moved under their section keep every
// old link working. Each later batch only adds rows to MOVES.
//   FR-010  old path (with any query) → new path, which is a real page
//   FR-011  /pages/*.html of a moved page goes straight to the new path
//   FR-015  temporary (307) until G07-T24
//   FR-018  one literal rule per pair; the old path is no longer a page
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import { appPageRoute } from '../tooling/app-route-inventory.mjs';
import { canonicalNextRouteForLegacy } from '../tooling/legacy-url-mapping.mjs';
import { ROUTES, routeFor } from '../lib/route-registry.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(path.join(FRONTEND, ...parts), 'utf8');

/** One row per moved page (plan.md "Bảng dời đường dẫn"). */
const MOVES = [
  // Batch 1 (G07-T06)
  { from: '/flashcards', to: '/vocabulary/flashcards', legacy: '/pages/flashcards.html' },
  { from: '/flashcard-study', to: '/vocabulary/flashcards/study', legacy: '/pages/flashcard-study.html' },
  // Batch 2 (G07-T07)
  { from: '/d1-exercise', to: '/vocabulary/fill-in', legacy: '/pages/d1-exercise.html' },
];

function appRoutes(root, prefix = '') {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return appRoutes(path.join(root, entry.name), relative);
    const route = appPageRoute(relative);
    return route ? [route] : [];
  });
}

async function configRedirects() {
  const compiled = ts.transpileModule(read('next.config.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  runInNewContext(compiled, {
    module: mod, exports: mod.exports,
    require: createRequire(path.join(FRONTEND, 'next.config.ts')),
    __dirname: path.join(FRONTEND, 'nonexistent-config-fixture'),
    process: { env: { NODE_ENV: 'production', VERCEL: '1' } },
  });
  return mod.exports.default.redirects();
}

// Same matching Next does for a literal source with no params: the query
// string is carried over untouched (no `has`/`missing`, FR-016).
function follow(redirects, url) {
  const parsed = new URL(url, 'https://x.test');
  const rule = redirects.find((r) => r.source === parsed.pathname && !r.has && !r.missing);
  return rule ? { status: rule.permanent ? 308 : 307, location: `${rule.destination}${parsed.search}` } : null;
}

describe('learner route moves (LEARNERNAV-0062)', async () => {
  const redirects = await configRedirects();
  const pages = new Set(appRoutes(path.join(FRONTEND, 'app')));

  for (const move of MOVES) {
    test(`${move.from} → ${move.to}`, () => {
      const rules = redirects.filter((r) => r.source === move.from);
      assert.equal(rules.length, 1, 'exactly one rule for the old path');
      assert.equal(rules[0].destination, move.to);
      assert.equal(rules[0].permanent, false, 'temporary until G07-T24');
      assert.equal(rules[0].has, undefined);
      assert.equal(rules[0].missing, undefined);
      assert.ok(pages.has(move.to), 'the new path is a page');
      assert.ok(!pages.has(move.from), 'the old path is no longer a page');
      // Literal in next.config.ts, where tooling/route-ownership-check.mjs reads it.
      assert.match(read('next.config.ts'), new RegExp(`\\{ source: '${move.from}', destination: '${move.to}', permanent: false \\}`));
    });

    test(`${move.from} keeps its query in one step`, () => {
      assert.deepEqual(follow(redirects, `${move.from}?stack=wiki:food&x=1`),
        { status: 307, location: `${move.to}?stack=wiki:food&x=1` });
      assert.equal(follow(redirects, move.to), null, 'the new path is not redirected again');
    });

    test(`${move.legacy} goes straight to ${move.to}`, () => {
      assert.equal(canonicalNextRouteForLegacy(move.legacy), move.to);
    });

    test(`${move.from} is a redirect row in the route registry`, () => {
      assert.equal(routeFor(move.from)?.status, 'redirect');
      const row = ROUTES.find((r) => r.route === move.to);
      assert.equal(row?.status, 'live');
      assert.ok(pages.has(row.route));
      assert.ok(!ROUTES.some((r) => r.parent === move.from), 'no page still names the old path as its parent');
    });
  }

  // Batch 2: the fill-in resume pointer is per-account session ids under a key
  // that never named the path, and a saved ?session= link survives the 307.
  test('/d1-exercise resume pointer still resumes at /vocabulary/fill-in', () => {
    const player = read('app', '(authed-d1-exercise)', 'vocabulary', 'fill-in', 'd1-exercise-player.tsx');
    assert.match(player, /const LEGACY_STORAGE_KEY = 'aver:d1:active-session';/);
    assert.match(player, /searchParams\.get\('session'\)/);
    assert.doesNotMatch(player, /d1-exercise['"`?]/, 'the player never builds the old path');
    assert.deepEqual(follow(redirects, '/d1-exercise?session=abc-123'),
      { status: 307, location: '/vocabulary/fill-in?session=abc-123' });
  });
});

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
  // Batch 3 (G07-T08): no /pages/*.html existed for these three.
  { from: '/course-exercises', to: '/course/exercises', legacy: null },
  { from: '/advanced-vocabulary', to: '/course/vocabulary', legacy: null },
  { from: '/grammar-lessons/assigned', to: '/course/grammar-lesson', legacy: null },
  // Batch 4 (G07-T09); the review/[routeId] child has its own param rule below.
  { from: '/grammar-checkup', to: '/course/grammar-checkup', legacy: null },
  // Batch 5 (G07-T10)
  { from: '/full-test-result', to: '/speaking/full-test/result', legacy: '/pages/full-test-result.html' },
  // Batch 7a (G07-T12a): /tests starts as the existing exam chooser, and the
  // retired /exam player goes there too (decided 18/11, 00 section 2 point 22).
  { from: '/full-test', to: '/tests', legacy: '/pages/full-test.html' },
  { from: '/exam', to: '/tests', legacy: '/pages/exam.html' },
  // Batch 6 (G07-T11)
  { from: '/speaking/result', to: '/tests/mock/speaking-report', legacy: '/pages/speaking-result.html' },
  { from: '/mock/result', to: '/tests/mock/result', legacy: '/pages/mock-result.html' },
  // Batch 8 (G07-T15u)
  { from: '/my-class', to: '/course/assigned', legacy: '/pages/my-class.html' },
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

    if (move.legacy) test(`${move.legacy} goes straight to ${move.to}`, () => {
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

  // Batch 7a: Thi thử needs no stand-in (/tests is live), the exam room's
  // back link (English, FR-014) and every in-app link use /tests, and the /exam
  // player is gone with no import left outside its old folder (CR-2460-R1).
  test('/full-test and /exam: Thi thử has no stand-in and links use /tests', () => {
    assert.match(read('components', 'ui', 'shell', 'learner-sections.ts'),
      /\{ id: 'tests', label: 'Thi thử', href: '\/tests', today: null, icon: 'timer' \}/);
    assert.match(read('app', '(authed-mock-exam)', 'mock-exam', 'mock-exam-runner.tsx'),
      /back=\{\{ href: '\/tests', label: 'Back to Mock Tests' \}\}/);
    assert.ok(!pages.has('/exam'));
    const sources = (root) => readdirSync(root, { withFileTypes: true, recursive: true })
      .filter((e) => e.isFile() && /\.(tsx?|mjs)$/.test(e.name))
      .map((e) => readFileSync(path.join(e.parentPath, e.name), 'utf8'));
    for (const source of [...sources(path.join(FRONTEND, 'app')), ...sources(path.join(FRONTEND, 'components')), ...sources(path.join(FRONTEND, 'lib'))]) {
      assert.doesNotMatch(source, /\(authed-exam\)|from ['"][^'"]*exam-player['"]/);
      assert.doesNotMatch(source, /(?:href=|href:\s*|leaveForParent\()['"]\/(?:full-test|exam)['"?]/);
    }
    for (const prefix of ['/full-test', '/exam']) {
      assert.ok(!read('app', 'robots.ts').includes(`'${prefix}',`), `robots no longer lists ${prefix}`);
    }
    assert.match(read('app', 'robots.ts'), /^  '\/tests',$/m);
  });

  // Batch 8: the class page sits under Lộ trình. The nav item no longer needs
  // a stand-in (/course is live), flag-off /course lands on the new path, and
  // a `from=my-class` review link keeps its value but returns to the new path.
  test('/my-class: Lộ trình has no stand-in and every back link uses /course/assigned', async () => {
    assert.match(read('components', 'ui', 'shell', 'learner-sections.ts'),
      /\{ id: 'course', label: 'Lộ trình', href: '\/course', today: null, icon: 'route' \}/);
    assert.match(read('app', '(authed-v2-course)', 'course', 'page.tsx'), /const COURSE_STAND_IN = '\/course\/assigned';/);
    for (const route of ['/exercises', '/listening/exercise-book', '/course/exercises', '/course/grammar-lesson', '/course/vocabulary', '/course/grammar-checkup']) {
      assert.equal(routeFor(route)?.parent, '/course/assigned', `${route} parent`);
    }
    assert.equal(routeFor('/course/assigned')?.parent, '/course');
    const { listeningReviewBackTarget, listeningReviewParams } = await import('../lib/listening-review-model.mjs');
    const { readingReviewBackTarget, readingReviewParams } = await import('../lib/reading-review-model.mjs');
    assert.equal(listeningReviewBackTarget(listeningReviewParams('?attempt_id=a&from=my-class')).href, '/course/assigned');
    assert.equal(readingReviewBackTarget(readingReviewParams('?from=my-class')).href, '/course/assigned');
    assert.deepEqual(follow(redirects, '/my-class?notice=assignment-missing'),
      { status: 307, location: '/course/assigned?notice=assignment-missing' });
  });

  // Batch 4: the review child keeps its routeId and query in one step, and
  // the bare review prefix goes straight to the new checkup (no second hop).
  test('/grammar-checkup/review/:routeId → /course/grammar-checkup/review/:routeId', () => {
    const rules = redirects.filter((r) => r.source === '/grammar-checkup/review/:routeId');
    assert.equal(rules.length, 1);
    assert.equal(rules[0].destination, '/course/grammar-checkup/review/:routeId');
    assert.equal(rules[0].permanent, false);
    assert.ok(pages.has('/course/grammar-checkup/review/[routeId]'));
    assert.ok(!pages.has('/grammar-checkup/review/[routeId]'));
    assert.equal(routeFor('/grammar-checkup/review/[routeId]')?.status, 'redirect');
    assert.equal(routeFor('/course/grammar-checkup/review/[routeId]')?.parent, '/course/grammar-checkup');
    for (const source of ['/grammar-checkup/review', '/course/grammar-checkup/review']) {
      assert.equal(redirects.find((r) => r.source === source)?.destination, '/course/grammar-checkup');
    }
  });

  // Batch 3: a page opened without its query goes back to the parent the
  // registry names for that case, not to its pre-move parent.
  test('/course/vocabulary without bank/item leaves for /course/assigned', () => {
    assert.equal(routeFor('/course/vocabulary')?.parentOnMissing, '/course/assigned');
    assert.match(read('app', '(authed-advanced-vocab)', 'course', 'vocabulary', 'advanced-vocabulary-lesson.tsx'),
      /if \(!bank \|\| !item\) \{ leaveForParent\('\/course\/assigned'\); return; \}/);
  });

  test('robots hides /course/ pages without hiding the public /courses catalogue', () => {
    const robots = read('app', 'robots.ts');
    assert.match(robots, /^  '\/course\/',$/m);
    assert.doesNotMatch(robots, /^  '\/course',$/m);
    assert.doesNotMatch(robots, /'\/my-class'/);
  });
});

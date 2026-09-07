import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..');

const ROUTE_SCRIPTS = [
  ['app/(authed-home)/layout.tsx', ['/js/speaking-debt.js']],
  ['app/(authed-instructor-compare)/layout.tsx', ['/js/writing-renderers.js']],
  ['app/(authed-listening-dictation)/layout.tsx', ['/js/components/audio-player.js']],
  ['app/(authed-listening-player)/layout.tsx', ['/js/mock-exam-hook.js']],
  ['app/(authed-listening-practice-run)/layout.tsx', ['/js/components/audio-player.js']],
  ['app/(authed-mock-exam)/layout.tsx', ['/js/speaking-debt.js']],
  ['app/(authed-session-result)/layout.tsx', ['/js/pronunciation-drilldown.js']],
  [
    'app/(authed-speaking)/layout.tsx',
    [
      'https://cdn.jsdelivr.net/npm/chart.js@4.5.1',
      '/js/format.js',
      '/js/cue-card-detector.js',
      '/js/retention-warning.js',
    ],
  ],
];

const ORDERED_ROUTE_SCRIPTS = [
  ['app/(authed-admin-reading-preview)/layout.tsx', 3],
  ['app/(authed-admin-writing-grade)/layout.tsx', 3],
  ['app/(authed-admin-writing-tips)/layout.tsx', 3],
  ['app/(authed-instructor-grade)/layout.tsx', 2],
  ['app/(authed-listening)/listening/(standalone-exercises)/layout.tsx', 2],
  ['app/(authed-listening-review)/layout.tsx', 2],
  ['app/(authed-my-class)/layout.tsx', 4],
  ['app/(authed-reading-player)/layout.tsx', 4],
  ['app/(authed-writing)/layout.tsx', 4],
  ['app/(authed-writing-result)/layout.tsx', 6],
  ['app/(reading-review)/layout.tsx', 4],
];

describe('route-scoped independent scripts survive App Router navigation', () => {
  for (const [relativePath, sources] of ROUTE_SCRIPTS) {
    test(relativePath, () => {
      const source = readFileSync(join(frontend, relativePath), 'utf8');
      assert.match(source, /import Script from ['"]next\/script['"]/);
      for (const src of sources) {
        assert.ok(source.includes(`src="${src}"`), `${relativePath} must load ${src}`);
      }
      assert.equal(
        (source.match(/strategy="afterInteractive"/g) || []).length,
        sources.length,
        `${relativePath} must use Next Script for every route dependency`,
      );
      assert.doesNotMatch(
        source,
        /<script\s+(?:type="module"\s+)?src=/,
        `${relativePath} must not rely on a plain React script node`,
      );
    });
  }
});

describe('ordered route dependencies use the sequential client loader', () => {
  const chainSource = readFileSync(join(frontend, 'components/route-script-chain.tsx'), 'utf8');

  test('loader advances only from Next Script onReady and reports load errors', () => {
    assert.match(chainSource, /^['"]use client['"];?/);
    assert.match(chainSource, /import Script from ['"]next\/script['"]/);
    assert.match(chainSource, /strategy="afterInteractive"/);
    assert.match(chainSource, /onReady=\{\(\) => setReady\(true\)\}/);
    assert.match(chainSource, /ready && index \+ 1 < scripts\.length/);
    assert.match(chainSource, /type: 'route_script_load_failed'/);
  });

  for (const [relativePath, expectedCount] of ORDERED_ROUTE_SCRIPTS) {
    test(relativePath, () => {
      const source = readFileSync(join(frontend, relativePath), 'utf8');
      assert.match(source, /RouteScriptChain/);
      assert.equal(
        (source.match(/\{ src:/g) || []).length,
        expectedCount,
        `${relativePath} must keep its complete ordered dependency list`,
      );
      assert.doesNotMatch(
        source,
        /<script\s+(?:type="module"\s+)?src=/,
        `${relativePath} must not fall back to plain React script nodes`,
      );
    });
  }
});

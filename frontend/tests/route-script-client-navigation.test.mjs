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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GRAMMAR = path.join(FRONTEND, 'app', '(public-content)', 'grammar');
const read = (...parts) => readFileSync(path.join(GRAMMAR, ...parts), 'utf8');

test('search, roadmap, and exercises are first-class Next routes', () => {
  for (const route of ['search', 'roadmap', 'exercises']) {
    assert.ok(existsSync(path.join(GRAMMAR, route, 'page.tsx')), `missing /grammar/${route}`);
  }
  assert.match(read('search-box.tsx'), /\/grammar\/search\?q=/);
  assert.ok(!read('page.tsx').includes('/pages/grammar-search.html'));
});

test('home exposes explicit reference and learning modes using canonical learner APIs', () => {
  const mode = read('grammar-home-mode.tsx');
  assert.match(mode, /role="tablist"/);
  assert.match(mode, /aria-controls="grammar-panel-reference"/);
  assert.match(mode, /onKeyDown={handleKeyDown}/);
  assert.match(mode, />Tra cứu</);
  assert.match(mode, />Học &amp; luyện</);
  assert.match(mode, /\/api\/grammar\/dashboard-data/);
  assert.match(mode, /\/api\/me\/roadmap/);
});

test('search facets are shareable through the canonical URL', () => {
  const search = read('search', 'search-behavior.tsx');
  assert.match(search, /new URLSearchParams/);
  assert.match(search, /params\.set\('level'/);
  assert.match(search, /params\.set\('use'/);
  assert.match(search, /window\.history\.replaceState/);
});

test('article behavior records Grammar Lab checks through KP evidence API', () => {
  const behavior = read('[category]', '[slug]', 'article-behavior.tsx');
  assert.match(behavior, /\.gw-check/);
  assert.match(behavior, /\/api\/kp\/microcheck-answers/);
  assert.match(behavior, /session\?\.data\?\.session/,
    'guest checks work locally but must not make unauthenticated evidence calls');
});

test('exercise directory filters enriched canonical article metadata', () => {
  const exercises = read('exercises', 'grammar-exercises-behavior.tsx');
  assert.match(exercises, /bank\.category/);
  assert.match(exercises, /bank\.level/);
  assert.match(exercises, /\/api\/me\/kp-mastery\?kp_type=grammar/);
  assert.ok(!exercises.includes('const CATEGORIES'), 'categories must come from backend truth');
});

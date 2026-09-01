import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRAMMAR = path.join(FRONTEND, 'app', '(public-content)', 'grammar');
const PAGE_PATH = path.join(GRAMMAR, 'roadmap', 'page.tsx');
const PAGE = readFileSync(PAGE_PATH, 'utf8');
const PERSONAL = readFileSync(path.join(GRAMMAR, 'roadmap', 'personal-roadmap.tsx'), 'utf8');
const API = readFileSync(path.join(FRONTEND, 'lib', 'grammar-api.ts'), 'utf8');
const LEDGER = readFileSync(path.join(FRONTEND, '../docs/ROUTE_LEDGER.md'), 'utf8');
const PARITY = readFileSync(path.join(FRONTEND, 'tooling', 'parity-diff.mjs'), 'utf8');
const CORE = readFileSync(path.join(FRONTEND, 'tooling', 'parity-core.mjs'), 'utf8');
const WORKFLOW = readFileSync(path.join(FRONTEND, '../.github/workflows/parity-gate.yml'), 'utf8');

describe('/grammar/roadmap mixed ownership', () => {
  test('route Next tồn tại, ledger nói đúng hai mode và legacy vẫn rollback', () => {
    assert.ok(existsSync(PAGE_PATH));
    assert.ok(existsSync(path.join(FRONTEND, 'public', 'pages', 'grammar-roadmap.html')));
    assert.match(LEDGER, /`\/grammar\/roadmap`[^\n]+CUTOVER[^\n]+Mixed: public khi có `slug`, Student khi không có/);
  });

  test('public slug mode dùng PPR + shared server loader và 404 thật', () => {
    assert.match(PAGE, /<Suspense fallback=\{<RoadmapSkeleton \/>\}>/);
    assert.match(PAGE, /async function RoadmapBody[\s\S]*await searchParams/);
    assert.match(PAGE, /await getRoadmap\(slug\)/);
    assert.match(PAGE, /if \(!data\) notFound\(\)/);
    assert.equal((PAGE.match(/normalizePublicRoadmap\(data\)/g) || []).length, 2);
    assert.match(API, /getPublicJson\(`\/api\/grammar\/roadmap\/\$\{encodeURIComponent\(slug\)\}`\)/);
    assert.match(API, /export const getRoadmap = cache\(fetchRoadmap\)/);
  });

  test('personal mode có auth, account-keyed state, abort và lỗi riêng với empty', () => {
    assert.match(PAGE, /if \(!slug\) return <PersonalRoadmap \/>/);
    assert.match(PERSONAL, /<AuthProvider><PersonalRoadmapBody \/><\/AuthProvider>/);
    assert.match(PERSONAL, /state\?\.key === requestKey/);
    assert.match(PERSONAL, /new AbortController\(\)/);
    assert.match(PERSONAL, /controller\.abort\(\)/);
    assert.match(PERSONAL, /normalizePersonalRoadmap\(payload\)/);
    assert.match(PERSONAL, /Không tải được lộ trình/);
    assert.match(PERSONAL, /Chưa có lộ trình cá nhân/);
    assert.match(WORKFLOW, /verify-grammar-roadmap-personal-flow\.mjs/);
  });

  test('entry points và parity dùng URL canonical sạch', () => {
    for (const file of [
      path.join(GRAMMAR, 'page.tsx'),
      path.join(FRONTEND, 'public', 'grammar.html'),
      path.join(FRONTEND, 'public', 'pages', 'exam.html'),
      path.join(FRONTEND, 'public', 'js', 'kp-result-widget.js'),
      path.join(FRONTEND, 'app', '(authed-session-result)', 'result', 'session-result-behavior.tsx'),
    ]) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /pages\/grammar-roadmap\.html/);
    }
    assert.match(PARITY, /name: 'grammar-roadmap'[\s\S]*legacy: '\/pages\/grammar-roadmap\.html\?slug=tenses'[\s\S]*next: '\/grammar\/roadmap\?slug=tenses'/);
    assert.match(CORE, /path === '\/pages\/grammar-roadmap\.html'\) path = '\/grammar\/roadmap'/);
  });
});

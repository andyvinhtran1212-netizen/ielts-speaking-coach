/** Gate F: canonical product links must not bypass native route ownership. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(FRONTEND, '..');
const readFrontend = (...parts) => readFileSync(join(FRONTEND, ...parts), 'utf8');
const readRepo = (...parts) => readFileSync(join(REPO, ...parts), 'utf8');

describe('Gate F canonical inbound links', () => {
  test('backend-owned activity and Home CTAs target native owners', () => {
    const overview = readRepo('backend', 'routers', 'admin_overview.py');
    const home = readRepo('backend', 'services', 'student_home_aggregator.py');
    assert.match(overview, /f"\/result\?session_id=/);
    assert.match(overview, /f"\/admin\/writing\/grade\?essay_id=/);
    assert.doesNotMatch(overview, /\/pages\/(?:result|admin\/writing\/grade)\.html/);
    assert.match(home, /"\/vocabulary\/hub#flashcards"/);
    assert.match(home, /"\/vocabulary\/hub#vocab-topics"/);
    assert.doesNotMatch(home, /"\/pages\/vocabulary\.html#/);
  });

  test('My Class starts Reading and Listening through runtime admission', () => {
    const classRouter = readRepo('backend', 'routers', 'class_student.py');
    const classModel = readFrontend('lib', 'my-class-model.mjs');
    assert.match(classRouter, /f"\/core-player\/launch\?surface=\{player_surface\}"/);
    assert.match(classRouter, /"player_surface": player_surface/);
    assert.match(classRouter, /"player_query":\s+player_query/);
    assert.doesNotMatch(
      classRouter,
      /url\s*=\s*\(f"\/pages\/(?:reading-exam|listening-test)\.html/,
    );
    assert.match(classModel, /url: admitCorePlayer\(surface,/);
    assert.match(classModel, /N-1 backend compatibility/);
  });

  test('native product and admin surfaces do not link back into migrated HTML', () => {
    const checks = [
      [
        readFrontend('app', '(authed-mock-result)', 'mock', 'result', 'mock-result-behavior.tsx'),
        /\/pages\/writing-result\.html/,
      ],
      [
        readFrontend('app', '(authed-admin-students)', 'admin', 'students', 'admin-students-directory.tsx'),
        /\/pages\/admin\/writing\/grade\.html/,
      ],
      [
        readFrontend('app', '(authed-admin-vocab)', 'admin', 'vocab', 'topics', 'admin-vocab-topics.tsx'),
        /\/pages\/admin\/vocab\/content\.html/,
      ],
      [
        readFrontend('app', '(authed-admin-reading-content)', 'admin', 'reading', 'content', 'admin-reading-content.tsx'),
        /\/pages\/(?:reading-vocab-passage|reading-skill-exercise)\.html/,
      ],
      [
        readFrontend('lib', 'admin-reading-content-model.mjs'),
        /\/pages\/reading-exam\.html/,
      ],
      [
        readFrontend('lib', 'admin-feedback-model.mjs'),
        /\/pages\/admin\/listening\/tests\.html/,
      ],
    ];
    for (const [source, staleRoute] of checks) assert.doesNotMatch(source, staleRoute);
  });

  test('native Writing error recovery returns to the native Home route', () => {
    const shell = readFrontend('app', '(authed-writing)', 'writing', 'dashboard', 'page-shell.tsx');
    assert.match(shell, /id="error-cta"[\s\S]{0,120}?href="\/home"/);
    assert.doesNotMatch(shell, /href="\.\.\/index\.html"/);
  });
});

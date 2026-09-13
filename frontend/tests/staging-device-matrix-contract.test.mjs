import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const manifest = require('../tooling/staging-device-matrix.json');
const lock = require('../package-lock.json');
const config = require('../playwright.staging.config.js');
const spec = readFileSync(new URL('./staging-e2e/device-matrix.spec.js', import.meta.url), 'utf8');

describe('permanent staging device matrix', () => {
  test('is pinned to the installed Playwright version and every configured project', () => {
    assert.equal(manifest.matrix_id, 'staging-device-matrix-v1');
    assert.equal(manifest.playwright_version, lock.packages['node_modules/@playwright/test'].version);
    assert.deepEqual(
      config.projects.map(({ name }) => name).sort(),
      manifest.automated_projects.map(({ project }) => project).sort(),
    );
  });

  test('runs the shared-state suite once and the bounded seam on three targets', () => {
    const projects = new Map(config.projects.map((project) => [project.name, project]));
    assert.equal(config.workers, 1);
    assert.equal(config.retries, 0);
    assert.equal(projects.get('staging-core-chromium')?.testIgnore, '**/device-matrix.spec.js');
    for (const entry of manifest.automated_projects.filter(({ scope }) => scope === 'device-matrix-spec')) {
      assert.equal(projects.get(entry.project)?.testMatch, '**/device-matrix.spec.js');
    }
    assert.match(spec, /staging-device-matrix\.json/);
    assert.doesNotMatch(JSON.stringify(manifest), /real_device_requirements|gate-e/i);
  });
});

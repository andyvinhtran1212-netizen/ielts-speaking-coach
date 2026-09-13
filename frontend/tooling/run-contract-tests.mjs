#!/usr/bin/env node
// Canonical local runner for source-contract tests after Legacy HTML retirement.
// It uses the current Node executable so local and CI callers preload the same
// narrow archived-HTML adapter while remaining contracts are migrated.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TESTS = path.join(FRONTEND, 'tests');
const LOADER = path.join(TESTS, 'fixtures', 'legacy-html-retired', 'loader.mjs');
const requested = process.argv.slice(2).map((entry) => path.resolve(process.cwd(), entry));
const files = requested.length
  ? requested
  : readdirSync(TESTS)
    .filter((name) => /\.test\.(?:mjs|js)$/.test(name))
    .sort()
    .map((name) => path.join(TESTS, name));

const result = spawnSync(process.execPath, ['--import', LOADER, '--test', ...files], {
  cwd: FRONTEND,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

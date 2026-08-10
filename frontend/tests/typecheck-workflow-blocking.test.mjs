/** Gate D regression contract for fail-closed TypeScript/OpenAPI checks. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'typecheck.yml'), 'utf8');
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'frontend', 'package.json'), 'utf8'));
const REQUIREMENTS = readFileSync(join(ROOT, 'backend', 'requirements.txt'), 'utf8');

describe('Gate D — TypeScript/OpenAPI workflow fails closed', () => {
  test('does not retain pilot/non-blocking escape hatches', () => {
    assert.doesNotMatch(WORKFLOW, /continue-on-error\s*:\s*true/);
    assert.doesNotMatch(WORKFLOW, /pilot, non-blocking|\(non-blocking\)/i);
  });

  test('installs the pinned frontend tree before checking both TS surfaces', () => {
    assert.match(WORKFLOW, /node-version:\s*['"]24['"]/);
    assert.match(WORKFLOW, /cache-dependency-path:\s*frontend\/package-lock\.json/);
    assert.match(WORKFLOW, /run:\s*npm ci/);
    assert.match(WORKFLOW, /run:\s*npx tsc --noEmit\s*$/m);
    assert.match(WORKFLOW, /run:\s*npx tsc --noEmit -p tsconfig\.legacy\.json/);
  });

  test('regenerates OpenAPI types with a pinned generator and preserves diff failure', () => {
    assert.equal(PACKAGE.devDependencies['openapi-typescript'], '7.13.0');
    assert.match(REQUIREMENTS, /^pydantic==2\.12\.5$/m);
    assert.match(WORKFLOW, /Install pinned OpenAPI generator tree[\s\S]*?run:\s*npm ci/);
    assert.match(WORKFLOW, /\.\/node_modules\/\.bin\/openapi-typescript \/tmp\/openapi\.json/);
    assert.doesNotMatch(WORKFLOW, /npx\s+--yes\s+openapi-typescript/);
    assert.match(WORKFLOW, /git diff --exit-code types\/api\.d\.ts/);
    assert.doesNotMatch(WORKFLOW, /git diff[\s\S]{0,160}\|\||::warning::frontend\/types\/api\.d\.ts/);
  });

  test('runs on pull requests and the merged main branch', () => {
    assert.match(WORKFLOW, /^\s{2}pull_request:\s*$/m);
    assert.match(WORKFLOW, /^\s{2}push:\s*\n\s{4}branches:\s*\[main\]/m);
  });
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..');

test('generated Reading focus types accept omitted keys but reject explicit null', () => {
  const result = spawnSync(process.execPath, [
    join(frontend, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022',
    '--module', 'esnext', '--moduleResolution', 'bundler',
    join(frontend, 'tests/type-contracts/reading-grammar-focus.ts'),
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, [result.error?.message, result.stdout, result.stderr]
    .filter(Boolean).join('\n'));
});

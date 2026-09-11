/** Keep first-party GitHub Actions off the retired Node.js 20 runtime. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');

// These are the first Node 24 majors already exercised elsewhere in this repo.
// Their action.yml manifests declare `runs.using: node24`.
const MINIMUM_NODE24_MAJOR = new Map([
  ['actions/cache', 5],
  ['actions/cache/restore', 5],
  ['actions/cache/save', 5],
  ['actions/checkout', 5],
  ['actions/download-artifact', 7],
  ['actions/setup-node', 5],
  ['actions/setup-python', 6],
  ['actions/upload-artifact', 6],
]);

describe('first-party workflow actions use Node 24 majors', () => {
  for (const filename of readdirSync(WORKFLOW_DIR).filter((name) => /\.ya?ml$/.test(name)).sort()) {
    test(filename, () => {
      const source = readFileSync(path.join(WORKFLOW_DIR, filename), 'utf8');
      const uses = source.matchAll(/uses:\s+(actions\/[\w/-]+)@v(\d+)/g);

      for (const [, action, rawMajor] of uses) {
        const minimum = MINIMUM_NODE24_MAJOR.get(action);
        if (minimum === undefined) continue;
        const major = Number(rawMajor);
        assert.ok(
          major >= minimum,
          `${filename}: ${action}@v${major} still targets the retired Node 20 runtime; expected v${minimum}+`,
        );
      }
    });
  }
});

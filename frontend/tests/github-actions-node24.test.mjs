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

const FIRST_PARTY_USES_RE = /^\s*(?:-\s*)?uses:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/gm;

function assertFirstPartyActionsUseNode24(source, filename) {
  for (const match of source.matchAll(FIRST_PARTY_USES_RE)) {
    const reference = match[1] ?? match[2] ?? match[3];
    if (!reference.startsWith('actions/')) continue;

    const version = /^(actions\/[\w/-]+)@v(\d+)$/.exec(reference);
    assert.ok(version, `${filename}: unsupported first-party action reference ${reference}`);

    const [, action, rawMajor] = version;
    const minimum = MINIMUM_NODE24_MAJOR.get(action);
    assert.notEqual(
      minimum,
      undefined,
      `${filename}: ${action} has no audited Node 24 minimum; add it to MINIMUM_NODE24_MAJOR`,
    );

    const major = Number(rawMajor);
    assert.ok(
      major >= minimum,
      `${filename}: ${action}@v${major} still targets the retired Node 20 runtime; expected v${minimum}+`,
    );
  }
}

describe('first-party workflow actions use Node 24 majors', () => {
  for (const filename of readdirSync(WORKFLOW_DIR).filter((name) => /\.ya?ml$/.test(name)).sort()) {
    test(filename, () => {
      const source = readFileSync(path.join(WORKFLOW_DIR, filename), 'utf8');
      assertFirstPartyActionsUseNode24(source, filename);
    });
  }

  test('quoted legacy references fail closed', () => {
    assert.throws(
      () => assertFirstPartyActionsUseNode24('steps:\n  - uses: "actions/checkout@v4"\n', 'quoted.yml'),
      /retired Node 20 runtime/,
    );
  });

  test('unmapped first-party actions fail closed', () => {
    assert.throws(
      () => assertFirstPartyActionsUseNode24('steps:\n  - uses: actions/github-script@v7\n', 'new-action.yml'),
      /has no audited Node 24 minimum/,
    );
  });
});

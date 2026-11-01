// Negative controls for the Grammar 404 SSR verifier (PC-J235). The verifier
// (tooling/verify-grammar-404-ssr-flow.mjs) runs in the Next-native browser
// workflow against a real build; these fixtures prove its served-HTML
// criteria fail on the PC-J77 F1/F2 shapes it exists to catch.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import { assessNotFoundHtml } from '../tooling/grammar-404-ssr-checks.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'grammar-404');
const fixture = (name) => readFileSync(path.join(FIXTURES, name), 'utf8');
const ROUTE = '/grammar/tenses/khong-ton-tai';

describe('Grammar 404 served-HTML checks', () => {
  test('a complete server-rendered 404 passes every check', () => {
    assert.deepEqual(assessNotFoundHtml(ROUTE, 404, fixture('ssr-404.html')), []);
  });

  test('F1: the bare __next_error__ shell fails on shell, title, stylesheet and tokens', () => {
    const failures = assessNotFoundHtml(ROUTE, 404, fixture('error-shell.html'));
    for (const expected of [
      /served HTML is not the __next_error__ shell$/,
      /served HTML has a <title>$/,
      /served HTML links a stylesheet \(0\)$/,
      /tokens\.css linked exactly once \(0\)$/,
      /the Vietnamese 404 card is in the server HTML$/,
    ]) {
      assert.ok(failures.some((label) => expected.test(label)), `missing failure ${expected} in ${JSON.stringify(failures)}`);
    }
    assert.ok(failures.every((label) => label.startsWith(`${ROUTE}: `)));
  });

  test('F2: tokens.css linked twice fails only the exactly-once check', () => {
    assert.deepEqual(assessNotFoundHtml(ROUTE, 404, fixture('double-tokens.html')),
      [`${ROUTE}: tokens.css linked exactly once (2)`]);
  });

  test('a soft 404 (HTTP 200) fails the status check', () => {
    assert.deepEqual(assessNotFoundHtml(ROUTE, 200, fixture('ssr-404.html')), [`${ROUTE}: HTTP 404 (got 200)`]);
  });
});

describe('Grammar 404 verifier wiring', () => {
  const REPO = path.resolve(FIXTURES, '..', '..', '..', '..');
  const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

  test('the verifier judges served HTML with these same checks', () => {
    const verifier = read('frontend/tooling/verify-grammar-404-ssr-flow.mjs');
    assert.match(verifier, /import \{ notFoundHtmlChecks, TOKENS \} from '\.\/grammar-404-ssr-checks\.mjs';/);
    assert.match(verifier, /notFoundHtmlChecks\(route, res\.status, html\)\) check\(ok, label\)/);
  });

  test('the Next-native browser job runs the verifier after Next starts, and edits to the checks trigger it', () => {
    const workflow = read('.github/workflows/next-native-browser.yml');
    assert.match(workflow, /\n {6}- name: Khởi động Next\n[\s\S]*?\n {6}- name: Kiểm 404 Grammar render phía server có CSS\n {8}run: node tooling\/verify-grammar-404-ssr-flow\.mjs\n/);
    const step = workflow.slice(workflow.indexOf('- name: Kiểm 404 Grammar render phía server có CSS'));
    assert.doesNotMatch(step.slice(0, step.indexOf('\n\n')), /continue-on-error/);
    assert.match(workflow, /\n {6}- 'frontend\/tooling\/grammar-404-ssr-checks\.mjs'\n/);
  });
});

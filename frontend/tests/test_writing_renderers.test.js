/* Sprint 2.5.6 regression — counterargument renderer must accept BOTH
 * the canonical object shape (`{insertionPoint, reasoning}` for context,
 * `{instruction, example}` for suggestion) and the older string shape.
 *
 * Vanilla Node (no Jest). Run with:
 *   node frontend/tests/test_writing_renderers.test.js
 *
 * Loads frontend/js/writing-renderers.js via vm in a sandbox that stubs
 * the browser globals the IIFE expects (`window`).
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.resolve(__dirname, '..', 'js', 'writing-renderers.js');
const code = fs.readFileSync(SRC, 'utf8');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'writing-renderers.js' });

const WR = sandbox.window.WritingRenderers;
assert.ok(WR, 'WritingRenderers global not exposed');
const renderCounterargument = WR.SECTION_RENDERERS['counterargument'];
assert.strictEqual(typeof renderCounterargument, 'function', 'counterargument renderer missing');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ✓ ' + name);
  } catch (e) {
    fail++;
    console.error('  ✗ ' + name);
    console.error('    ' + (e.stack || e.message || e));
  }
}

console.log('renderCounterargument — Sprint 2.5.6 hotfix');

test('object-shape context + suggestion render their fields, no [object Object]', () => {
  const input = {
    isPresent: false,
    feedback: 'Bài viết chưa có counterargument.',
    context: {
      insertionPoint: 'Sau câu chủ đề đoạn 2',
      reasoning: 'Đây là vị trí lập luận đối lập tự nhiên nhất.',
    },
    suggestion: {
      instruction: 'Thêm một câu thừa nhận quan điểm đối lập.',
      example: 'While some argue that ..., the evidence suggests otherwise.',
    },
  };
  const html = renderCounterargument(input);
  assert.ok(typeof html === 'string' && html.length > 0, 'expected non-empty html');
  assert.ok(!html.includes('[object Object]'), 'should not contain literal [object Object]');
  assert.ok(html.includes('Sau câu chủ đề đoạn 2'),    'expected insertionPoint to render');
  assert.ok(html.includes('Đây là vị trí lập luận'),   'expected reasoning to render');
  assert.ok(html.includes('Thêm một câu thừa nhận'),   'expected suggestion.instruction to render');
  assert.ok(html.includes('the evidence suggests'),    'expected suggestion.example to render');
  assert.ok(html.includes('counter-pill'),             'expected counter-pill markup');
});

test('string-shape context + suggestion still render (backward compat)', () => {
  const input = {
    isPresent: true,
    feedback: 'Counterargument đã được trình bày tốt.',
    context: 'Vị trí trong đoạn 3.',
    suggestion: 'Tăng cường evidence cụ thể hơn.',
  };
  const html = renderCounterargument(input);
  assert.ok(typeof html === 'string' && html.length > 0);
  assert.ok(!html.includes('[object Object]'));
  assert.ok(html.includes('Vị trí trong đoạn 3'),       'expected string context to render');
  assert.ok(html.includes('Tăng cường evidence'),        'expected string suggestion to render');
  assert.ok(html.includes('counter-pill present'),       'expected present pill class');
});

test('empty / null input renders empty shape, not crash', () => {
  const empty = renderCounterargument(null);
  assert.ok(typeof empty === 'string', 'expected string for null');
  const empty2 = renderCounterargument({});
  assert.ok(typeof empty2 === 'string', 'expected string for {}');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);

// FR-014: the Reading and Listening papers answer `mock-flush` only to the
// same-origin exam room that embeds them, and address the answer to that origin.
// The listener is lifted out of each script and run against stub windows.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const ORIGIN = 'https://www.averlearning.com';

/** The source of the one listener that handles `mock-flush` in a script. */
function messageListener(js) {
  const marker = "window.addEventListener('message', ";
  let at = js.indexOf(marker);
  while (at !== -1) {
    const start = at + marker.length;
    const open = js.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < js.length; i += 1) {
      if (js[i] === '{') depth += 1;
      else if (js[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          const source = js.slice(start, i + 1);
          if (source.includes("'mock-flush'")) return source;
          break;
        }
      }
    }
    at = js.indexOf(marker, start);
  }
  throw new Error('no mock-flush listener');
}

const PAPERS = {
  reading: {
    js: read('public', 'js', 'reading-exam.js'),
    deps: '_postMockAnswers, _flushPendingSavesForMock, SESSION',
    args: () => [() => {}, () => Promise.resolve(true), { unsaved: new Set() }],
  },
  listening: {
    js: read('public', 'js', 'listening-test-player.js'),
    deps: 'postMockAnswers, flushAllPendingSaves, failedAnswerNumbers',
    args: () => [() => {}, async () => true, () => []],
  },
};

function harness(name) {
  const paper = PAPERS[name];
  const parent = { sent: [], postMessage(data, target) { this.sent.push({ data, target }); } };
  const window = { parent };
  const location = { origin: ORIGIN };
  // eslint-disable-next-line no-new-func
  const listener = new Function('window', 'location', ...paper.deps.split(', '),
    `return (${messageListener(paper.js)});`)(window, location, ...paper.args());
  return { listener, parent };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

for (const name of Object.keys(PAPERS)) {
  describe(`${name} paper mock-flush`, () => {
    test('answers the same-origin parent, addressed to its origin', async () => {
      const { listener, parent } = harness(name);
      await listener({ data: { type: 'mock-flush' }, source: parent, origin: ORIGIN });
      await settle();
      assert.equal(parent.sent.length, 1);
      assert.deepEqual(parent.sent[0].data, { type: 'mock-flushed', section: name, unsaved: 0 });
      assert.equal(parent.sent[0].target, ORIGIN);
    });

    test('ignores a flush from another origin', async () => {
      const { listener, parent } = harness(name);
      await listener({ data: { type: 'mock-flush' }, source: parent, origin: 'https://evil.example' });
      await settle();
      assert.equal(parent.sent.length, 0);
    });

    test('ignores a flush from a window that is not its parent', async () => {
      const { listener, parent } = harness(name);
      const other = { sent: [], postMessage(data, target) { this.sent.push({ data, target }); } };
      await listener({ data: { type: 'mock-flush' }, source: other, origin: ORIGIN });
      await settle();
      assert.equal(parent.sent.length + other.sent.length, 0);
    });

    test('never answers with a wildcard target', () => {
      const source = messageListener(PAPERS[name].js);
      assert.doesNotMatch(source, /'\*'\)/);
    });
  });
}

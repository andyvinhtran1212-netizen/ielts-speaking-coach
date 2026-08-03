/**
 * Hai trang làm đề phải chuyển tiếp `?class_item=` khi tạo lượt.
 *
 * The class page puts it on the link; the attempt row is where it has to end
 * up. Drop it here and the attempt is indistinguishable from free practice —
 * the student has done the work, the class page still says they owe it, and
 * nothing downstream can tell, because the link is the only thing the ledger
 * follows.
 *
 * Read from source rather than executed: both call sites sit deep inside page
 * boot (password gates, share mode, mock-exam hooks). What matters is a single
 * property — the item id reaches the POST — and a bounded span keeps the two
 * halves of one statement together so an unrelated mention cannot satisfy it.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(HERE, '..', 'public', 'js', f), 'utf8');

// Comments explain the param at length in both files; a scan that counts them
// would pass on prose alone.
const codeOnly = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

const READING = codeOnly(read('reading-exam.js'));
const LISTENING = codeOnly(read('listening-test-player.js'));

describe('reading-exam.js forwards the class item', () => {
  test('it reads class_item off the URL', () => {
    assert.match(READING, /get\('class_item'\)/);
  });

  test('the attempt POST carries it', () => {
    assert.match(
      READING,
      /postWith\(\s*'\/api\/reading\/test\/'[\s\S]{0,300}?class_item=/,
      'the id must reach the request that CREATES the attempt, not some other call',
    );
  });

  test('it is URL-encoded', () => {
    assert.match(READING, /class_item=' \+ encodeURIComponent\(/);
  });

  test('free practice sends no empty parameter', () => {
    // `?class_item=` with nothing after it is not "no homework" — the backend
    // would have to guess what an empty string means.
    assert.match(READING, /classItemFromUrl\(\)\s*\?[\s\S]{0,120}?:\s*''/);
  });
});

describe('listening-test-player.js forwards the class item', () => {
  test('it reads class_item off the URL', () => {
    assert.match(LISTENING, /get\('class_item'\)/);
  });

  test('the attempt POST carries it', () => {
    assert.match(
      LISTENING,
      /\/attempts`[\s\S]{0,160}?class_item=\$\{encodeURIComponent\(/,
    );
  });

  test('free practice sends no empty parameter', () => {
    assert.match(LISTENING, /classItem\s*\?[\s\S]{0,120}?:\s*''/);
  });
});

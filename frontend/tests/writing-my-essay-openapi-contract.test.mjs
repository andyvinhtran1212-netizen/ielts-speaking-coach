import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const FRONTEND = join(import.meta.dirname, '..');
const OPENAPI = readFileSync(join(FRONTEND, 'types', 'api.d.ts'), 'utf8');

function block(name) {
  const start = OPENAPI.indexOf(`        ${name}: {`);
  assert.notEqual(start, -1, `${name} is missing from api.d.ts`);
  const end = OPENAPI.indexOf('\n        };\n', start);
  return OPENAPI.slice(start, end);
}

describe('student Writing essay detail read contract (PC-J403)', () => {
  test('GET /api/writing/my-essays/{essay_id} is typed by MyEssayDetailOut', () => {
    const op = OPENAPI.indexOf('    get_my_essay_api_writing_my_essays__essay_id__get: {');
    assert.notEqual(op, -1);
    const next = OPENAPI.indexOf('\n    };\n', op);
    assert.match(OPENAPI.slice(op, next), /"application\/json": components\["schemas"\]\["MyEssayDetailOut"\]/);
  });

  test('feedback is always present and nullable until delivery', () => {
    assert.match(block('MyEssayDetailOut'), /\n {12}feedback: components\["schemas"\]\["MyEssayFeedbackOut"\] \| null;/);
  });

  test('feedback carries the band source flag, not provenance', () => {
    const fb = block('MyEssayFeedbackOut');
    assert.match(fb, /\n {12}band_source: "ai" \| "teacher" \| "unknown";/);
    assert.doesNotMatch(fb, /provenance|edited_by|mixed_by/);
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const FRONTEND = join(import.meta.dirname, '..');
const read = (...parts) => readFileSync(join(FRONTEND, ...parts), 'utf8');
const API = read('lib', 'admin-writing-queue-api.ts');
const OPENAPI = read('types', 'api.d.ts');
const QUEUE = read('app', '(authed-admin-writing-queue)', 'admin', 'writing', 'queue', 'admin-writing-queue.tsx');
const MODEL = read('lib', 'admin-writing-queue-model.mjs');

describe('admin Writing queue read contract', () => {
  test('derives the list wire shape from generated OpenAPI', () => {
    assert.match(API, /ApiGetJson<'\/admin\/writing\/essay-queue'>/);
    assert.match(API, /getBrowserJson\('\/admin\/writing\/essay-queue', query\)/);
    assert.match(OPENAPI, /"application\/json": components\["schemas"\]\["AdminWritingQueueRowOut"\]\[\]/);
    assert.match(OPENAPI, /components\["schemas"\]\["AdminWritingQueuePageOut"\]/);
    assert.match(OPENAPI, /total_complete: boolean/);
    assert.match(OPENAPI, /task1_image_missing: boolean/);
  });

  test('the queue uses the adapter while mutations stay on the bridge', () => {
    assert.match(QUEUE, /getAdminWritingQueuePage\(writingQueueApiQuery\(target,/);
    assert.doesNotMatch(QUEUE, /window\.api\.get<unknown>\(writingQueueApiPath\(target\)\)/);
    assert.match(QUEUE, /window\.api\.post<unknown>/);
  });

  test('one canonical query builder still owns queue filtering', () => {
    assert.match(MODEL, /export function writingQueueApiQuery/);
    assert.match(MODEL, /mock: normalized\.lane === 'mock' \? 'true' : 'false'/);
    assert.match(MODEL, /params\.set\('cohort_id', normalized\.cohortId\)/);
    assert.match(MODEL, /writingQueueApiPath\(filters\)[\s\S]*writingQueueApiQuery\(filters\)/);
  });
});

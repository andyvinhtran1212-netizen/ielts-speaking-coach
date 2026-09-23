import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const FRONTEND = join(import.meta.dirname, '..');
const read = (...parts) => readFileSync(join(FRONTEND, ...parts), 'utf8');
const API = read('lib', 'admin-exam-content-api.ts');
const OPENAPI = read('types', 'api.d.ts');
const CATALOG = read('app', '(authed-admin-mock-exams)', 'admin', 'mock-exams', 'exam-content-library.tsx');

describe('admin exam content read contract', () => {
  test('derives the paginated catalog envelope from generated OpenAPI', () => {
    assert.match(API, /ApiGetJson<'\/admin\/exam-content'>/);
    assert.match(API, /ApiGetJson<'\/admin\/exam-content\/page'>/);
    assert.match(API, /getBrowserJson\('\/admin\/exam-content', query\)/);
    assert.match(OPENAPI, /"application\/json": components\["schemas"\]\["ExamContentListResponse"\]/);
    assert.match(OPENAPI, /"application\/json": components\["schemas"\]\["ExamContentPageResponse"\]/);
    assert.match(OPENAPI, /total_complete: boolean/);
    assert.match(OPENAPI, /ExamContentItem: \{/);
    assert.match(OPENAPI, /status: "draft" \| "published" \| "archived"/);
    assert.match(OPENAPI, /total: number/);
    assert.match(OPENAPI, /failed_kinds: \("reading" \| "listening" \| "writing"\)\[\]/);
    assert.match(OPENAPI, /levels: string\[\]/);
    assert.match(OPENAPI, /levels_complete: boolean/);
    assert.match(OPENAPI, /failed_level_kinds: \("reading" \| "listening" \| "writing"\)\[\]/);
  });

  test('the catalog consumes the shared typed adapter', () => {
    assert.match(CATALOG, /getAdminExamContentPage\(query\)/);
    assert.match(CATALOG, /Danh sách cấp khóa có thể chưa đầy đủ/);
    assert.doesNotMatch(CATALOG, /window\.api\.get<unknown>\(`?\/admin\/exam-content/);
  });
});

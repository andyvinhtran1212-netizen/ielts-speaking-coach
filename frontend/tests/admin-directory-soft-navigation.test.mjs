import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const FRONTEND = join(import.meta.dirname, '..');
const read = (...parts) => readFileSync(join(FRONTEND, ...parts), 'utf8');
const CLASSES = read('app', '(authed-admin-classes)', 'admin', 'classes', 'admin-classes-directory.tsx');
const CLASS_DETAIL = read('app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-detail.tsx');
const STUDENTS = read('app', '(authed-admin-students)', 'admin', 'students', 'admin-students-directory.tsx');
const WRITING_QUEUE = read('app', '(authed-admin-writing-queue)', 'admin', 'writing', 'queue', 'admin-writing-queue.tsx');

describe('admin directory navigation stays inside the App Router', () => {
  test('Classes and Students tabs/details use Next Link', () => {
    for (const source of [CLASSES, CLASS_DETAIL, STUDENTS]) {
      assert.match(source, /import Link from 'next\/link'/);
    }
    assert.match(CLASSES, /<Link[^>]+href="\/admin\/students"/);
    assert.match(CLASSES, /<Link[^>]+href=\{`\/admin\/classes\/\$\{/);
    assert.match(CLASS_DETAIL, /<Link className="acx-back" href="\/admin\/classes"/);
    assert.match(STUDENTS, /<Link[^>]+href="\/admin\/classes"/);
  });

  test('student Writing handoffs and queue hub use Next Link', () => {
    assert.match(STUDENTS, /<Link[^>]+href=\{assignmentHref/);
    assert.match(STUDENTS, /<Link[^>]+href=\{`\/admin\/writing\/new\?student_id=/);
    assert.match(STUDENTS, /<Link href=\{`\/admin\/writing\/grade\?essay_id=/);
    assert.match(WRITING_QUEUE, /import Link from 'next\/link'/);
    assert.match(WRITING_QUEUE, /<Link className="awq-hub-link" href="\/admin\/writing"/);
  });

  test('download-like lesson attachments remain real browser anchors', () => {
    assert.match(CLASS_DETAIL, /<a[^>]+href=\{file\.url\} target="_blank" rel="noopener noreferrer"/);
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatCourseExplanation }
  from '../public/js/course-explanation-format.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(HERE, '..', ...parts), 'utf8');

describe('safe explanation block formatter', () => {
  test('escapes hostile HTML before applying the supported bold label', () => {
    const html = formatCourseExplanation('**Quy tắc:** <img src=x onerror=alert(1)> & safe');
    assert.match(html, /course-explain__emphasis/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; safe/);
    assert.ok(!/<img/.test(html));
    assert.ok(!/<mark>/.test(html));
  });

  test('preserves authored paragraphs and semantic list types', () => {
    const html = formatCourseExplanation(
      '**Đáp án mẫu:** She is taller.\n\n- dùng comparative\n- giữ động từ be\n\n1. Đọc lại\n2. Shadow theo',
    );
    assert.equal((html.match(/course-explain__paragraph/g) || []).length, 1);
    assert.match(html, /<ul class="course-explain__list">/);
    assert.match(html, /<ol class="course-explain__list">/);
    assert.equal((html.match(/<li>/g) || []).length, 4);
  });

  test('structures only long legacy prose with at least three complete sentences', () => {
    const long = 'Quy tắc so sánh hơn cần đúng cấu trúc và đúng đối tượng được đặt cạnh nhau trong câu. '
      + 'Phương án này dùng đúng hình thức của tính từ và giữ đủ động từ cần thiết cho mệnh đề. '
      + 'Hãy đọc lại cả câu để kiểm tra nghĩa trước khi chọn đáp án cuối cùng.';
    const html = formatCourseExplanation(long);
    assert.match(html, /course-explain__lead/);
    assert.match(html, /course-explain__list--legacy/);
    assert.equal((html.match(/<li>/g) || []).length, 2);

    const short = formatCourseExplanation('Đây là một lời giải ngắn. Câu sau vẫn là văn xuôi.');
    assert.ok(!/<ul/.test(short));
  });

  test('does not invent list boundaries at semicolons', () => {
    const clause = 'Quy tắc này có một vế chính; ngoại lệ vẫn đi cùng vế đó; không được tách thành ba ý.';
    assert.ok(!/<ul/.test(formatCourseExplanation(clause)));
  });

  test('returns no decorative wrapper for empty content', () => {
    assert.equal(formatCourseExplanation('  \n '), '');
  });
});

describe('one explanation contract across learner and admin surfaces', () => {
  const sources = [
    read('public', 'js', 'course-writing.js'),
    read('public', 'js', 'course-report.js'),
    read('public', 'js', 'quiz-progress.js'),
    read('public', 'js', 'admin-classes.js'),
    read('app', '(authed)', 'course-exercises', 'course-behavior.tsx'),
  ];

  test('every explanation renderer uses the shared safe formatter', () => {
    sources.forEach((source) => assert.match(source, /formatCourseExplanation\(/));
  });

  test('immediate feedback announces only the new result region', () => {
    const behavior = sources[4];
    const shell = read('app', '(authed)', 'course-exercises', 'page-shell.tsx');
    assert.match(behavior, /id="cx-why" role="status" aria-live="polite" aria-atomic="true"/);
    assert.match(behavior, /<h2 class="cx-why__label">Giải thích<\/h2>/);
    assert.doesNotMatch(shell, /id="cx-q"[^>]*aria-live/);
  });

  test('all route stylesheets support paragraphs, bullets and emphasis', () => {
    [
      read('public', 'css', 'course-exercises.css'),
      read('public', 'css', 'course-report.css'),
      read('public', 'css', 'quiz-progress.css'),
    ].forEach((css) => {
      assert.match(css, /\.course-explain__list/);
      assert.match(css, /\.course-explain__emphasis/);
      assert.match(css, /overflow-wrap:\s*anywhere/);
    });
  });
});

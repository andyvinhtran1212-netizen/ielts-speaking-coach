import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// PC-J148 (UIA B-1029-02/-03) — learner-facing copy on these surfaces is
// Vietnamese: the class workspace is "Lớp học" and a Speaking practice run is a
// "buổi". Internal whenGlobalReady labels (error reports only) are not UI copy.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const ui = (path) => read(path).replace(/whenGlobalReady\([^;]*?'[^']*\(My Class\)'/gs, '');

const FILES = {
  'app/(authed-my-class)/my-class/my-class-workspace.tsx': [/MY CLASS/, /My Class/],
  'app/(authed)/grammar-checkup/grammar-checkup.tsx': [/My Class/],
  'app/(authed)/course-exercises/page-shell.tsx': [/My Class/],
  'lib/home-metrics.mjs': [/session đã luyện/, /session nào/],
  'public/js/home.js': [/session đã luyện/, /session nào/],
};

for (const [path, banned] of Object.entries(FILES)) {
  test(`${path} has no English class/session copy`, () => {
    const source = ui(path);
    for (const pattern of banned) assert.doesNotMatch(source, pattern);
  });
}

test('the Vietnamese replacements are in place', () => {
  assert.equal(read('app/(authed-my-class)/my-class/my-class-workspace.tsx').match(/<p className="mc-eyebrow">LỚP HỌC<\/p>/g)?.length, 2);
  const checkup = read('app/(authed)/grammar-checkup/grammar-checkup.tsx');
  assert.match(checkup, /giáo viên đã giao trong Lớp học\./);
  assert.match(checkup, />Mở Lớp học<\/a>/);
  assert.equal(checkup.match(/Quay lại Lớp học/g)?.length, 3);
  assert.match(read('app/(authed)/course-exercises/page-shell.tsx'), />← Quay lại Lớp học<\/a>/);
});

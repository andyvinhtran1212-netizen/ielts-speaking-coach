// `metadata.title` của mỗi route Next phải TRÙNG `<title>` của trang legacy nó thay.
//
// VÌ SAO: nhãn tab, mục lịch sử và tên bookmark đều lấy từ đây. Lệch thì người
// dùng cutover xong thấy tab đổi tên — thay đổi nhìn thấy được mà không ai chủ ý.
//
// Chốt này so trực tiếp với archive không deploy để nhãn tab/bookmark ổn định.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalNextRouteForLegacy } from '../tooling/legacy-url-mapping.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'frontend/app');
const ARCHIVE = path.join(ROOT, 'frontend/tests/fixtures/legacy-html-retired');

/** Mọi `page.tsx` dưới `app/`, kèm URL route (bỏ các đoạn route-group). */
function routeIndex(dir = APP, out = new Map()) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { routeIndex(full, out); continue; }
    if (e.name !== 'page.tsx') continue;
    const segs = path.relative(APP, full)
      .replace(/\/page\.tsx$/, '')
      .split('/')
      .filter((s) => s && !(s.startsWith('(') && s.endsWith(')')));
    out.set('/' + segs.join('/'), full);
  }
  return out;
}

const ROUTES = routeIndex();
const TITLE_BASELINE_PATHS = Object.freeze([
  '/pages/home.html',
  '/pages/speaking.html',
  '/pages/practice.html',
  '/pages/reading-vocab.html',
  '/pages/reading-vocab-passage.html',
  '/pages/reading-skill.html',
  '/pages/reading-skill-exercise.html',
  '/pages/reading-test.html',
  '/pages/reading-mini-test.html',
  '/pages/listening-tests.html',
  '/pages/listening-mini-test.html',
  '/pages/listening-skills.html',
  '/pages/listening-practice.html',
  '/pages/listening-practice-run.html',
  '/pages/listening.html',
  '/pages/listening-browse.html',
  '/pages/listening-analytics.html',
  '/pages/flashcards.html',
  '/pages/exercises.html',
  '/pages/vocab-exam.html',
  '/pages/exam.html',
  '/pages/full-test.html',
  '/pages/mock-exam.html',
  '/pages/vocab-practice.html',
  '/pages/speaking-result.html',
  '/pages/quiz-progress.html',
  '/pages/quiz.html',
  '/pages/mock-result.html',
  '/pages/vocabulary.html',
  '/pages/writing-result.html',
  '/pages/admin/writing/grade.html',
]);
const pairs = TITLE_BASELINE_PATHS
  .map((legacy) => ({ legacy, next: canonicalNextRouteForLegacy(legacy) }))
  .filter(({ legacy, next }) => next && existsSync(path.join(ARCHIVE, legacy.slice(1))));

function pathnameOf(url) {
  return new URL(url, 'https://routes.invalid').pathname;
}

function routeFile(url) {
  const pathname = pathnameOf(url);
  const exact = ROUTES.get(pathname);
  if (exact) return exact;

  const pathSegments = pathname.split('/');
  for (const [route, file] of ROUTES) {
    const routeSegments = route.split('/');
    if (routeSegments.length !== pathSegments.length) continue;
    if (routeSegments.every((segment, index) => (
      /^\[[^/]+\]$/.test(segment) || segment === pathSegments[index]
    ))) return file;
  }
  return null;
}

describe('metadata.title khớp <title> của archived predecessor', () => {
  test('đọc được URL manifest, archive và cây route', () => {
    // Một trong hai rỗng ⇒ khẳng định dưới thành xanh-rỗng.
    assert.equal(pairs.length, TITLE_BASELINE_PATHS.length);
    assert.ok(ROUTES.size >= 10, `chỉ thấy ${ROUTES.size} route`);
  });

  test('không cặp nào lệch title', () => {
    const bad = [];
    for (const p of pairs) {
      const file = routeFile(p.next);
      if (!file) { bad.push(`${p.next}: không tìm thấy page.tsx`); continue; }

      const m = /title:\s*'([^']+)'/.exec(readFileSync(file, 'utf8'));
      if (!m) { bad.push(`${p.next}: page.tsx không khai metadata.title`); continue; }

      const html = readFileSync(
        path.join(ARCHIVE, pathnameOf(p.legacy).slice(1)),
        'utf8',
      );
      const t = /<title>([^<]*)<\/title>/.exec(html);
      if (!t) { bad.push(`${p.legacy}: không có <title>`); continue; }

      if (t[1].trim() !== m[1].trim()) {
        bad.push(`${p.next}: next=${JSON.stringify(m[1])} vs legacy=${JSON.stringify(t[1])}`);
      }
    }
    assert.deepEqual(bad.sort(), [],
      'nhãn tab/lịch sử/bookmark đã lệch khỏi predecessor được lưu trong archive');
  });
});

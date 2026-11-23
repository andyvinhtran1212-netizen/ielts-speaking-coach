// LEARNERCORE-0063 amendment 6 (G07-T30c): pure rules of /course/class.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classMeta,
  defaultLessonId,
  homeworkFor,
  isYouTubeUrl,
  learnedCount,
  lessonDateLabel,
  lessonHeading,
  lessonLinks,
  lessonStatus,
  lessonsOfClass,
  materialRows,
  pickClassId,
  scheduleLine,
  selectionSearch,
  vnDay,
} from '../lib/class-sessions-model.mjs';

const lesson = (id, lessonDate, extra = {}) => ({ id, lessonDate, lessonNo: null, cohortId: 'c1', ...extra });

test('today in Vietnam time flips at midnight +07, not UTC', () => {
  assert.equal(vnDay(new Date('2026-11-23T16:59:00Z')), '2026-11-23'); // 23:59 +07
  assert.equal(vnDay(new Date('2026-11-23T17:00:00Z')), '2026-11-24'); // 00:00 +07
});

test('Đã học / Hôm nay / Sắp tới around Vietnam midnight', () => {
  const at2359 = vnDay(new Date('2026-11-23T16:59:00Z'));
  const at0000 = vnDay(new Date('2026-11-23T17:00:00Z'));
  const l = lesson('l', '2026-11-23');
  assert.equal(lessonStatus(l, at2359), 'today');
  assert.equal(lessonStatus(l, at0000), 'past');
  assert.equal(lessonStatus(lesson('u', '2026-11-24'), at2359), 'upcoming');
  assert.equal(lessonStatus(lesson('n', null), at2359), null);
  // A timestamp is read in Vietnam time: 17:30Z on the 23rd is the 24th.
  assert.equal(lessonStatus(lesson('t', '2026-11-23T17:30:00Z'), at0000), 'today');
});

test('learned count: sessions dated before today only', () => {
  const list = [lesson('a', '2026-11-20'), lesson('b', '2026-11-23'), lesson('c', '2026-11-25'), lesson('d', null)];
  assert.equal(learnedCount(list, '2026-11-23'), 1);
});

test('default session covers all four FR-121 branches', () => {
  const today = '2026-11-23';
  const list = [lesson('p', '2026-11-16'), lesson('t', today), lesson('u2', '2026-11-30'), lesson('u1', '2026-11-25')];
  assert.equal(defaultLessonId(list, 'u2', today), 'u2', '?session= of this class');
  assert.equal(defaultLessonId(list, 'other-class-lesson', today), 't', 'unknown ?session= → today');
  assert.equal(defaultLessonId(list.filter((l) => l.id !== 't'), null, today), 'u1', 'nearest upcoming');
  assert.equal(defaultLessonId([lesson('x', '2026-11-01'), lesson('y', null)], null, today), 'y', 'last of the list');
  assert.equal(defaultLessonId([], 'x', today), null);
});

test('?class= unknown falls back to the first class (primary first)', () => {
  const classes = [{ id: 'c1' }, { id: 'c2' }];
  assert.equal(pickClassId(classes, 'c2'), 'c2');
  assert.equal(pickClassId(classes, 'c9'), 'c1');
  assert.equal(pickClassId(classes, null), 'c1');
  assert.equal(pickClassId([], 'c1'), null);
});

test('sessions of the selected class keep the API order', () => {
  const list = [lesson('a', null, { cohortId: 'c2' }), lesson('b', null), lesson('c', null, { cohortId: 'c2' })];
  assert.deepEqual(lessonsOfClass(list, 'c2', 2).map((l) => l.id), ['a', 'c']);
  assert.deepEqual(lessonsOfClass(list, 'c1', 2).map((l) => l.id), ['b']);
});

test('heading is "Buổi n", or only the date without lesson_no', () => {
  assert.equal(lessonHeading(lesson('a', '2026-11-18', { lessonNo: 8 })), 'Buổi 8');
  assert.equal(lessonHeading(lesson('a', '2026-11-18')), 'Thứ Tư 18/11/2026');
  assert.equal(lessonDateLabel('2026-11-22'), 'Chủ Nhật 22/11/2026');
});

test('YouTube: the four hosts only', () => {
  for (const url of ['https://youtube.com/watch?v=1', 'https://www.youtube.com/watch?v=1',
    'https://m.youtube.com/watch?v=1', 'https://youtu.be/1']) assert.equal(isYouTubeUrl(url), true, url);
  for (const url of ['https://youtube.com.evil.example/watch', 'https://evil.example/youtube.com',
    'https://notyoutube.com/x', 'not a url']) assert.equal(isYouTubeUrl(url), false, url);
});

test('material rows: video, document, and an unopenable row without its path', () => {
  const rows = materialRows([
    { label: 'Paraphrase Task 2', url: 'https://youtu.be/abc' },
    { label: 'Slide buổi 7', url: 'https://drive.google.com/x' },
    { label: 'Tệp nội bộ', url: null },
  ]);
  assert.deepEqual(rows.map((r) => [r.kind, r.type, r.action]), [
    ['youtube', 'Video · YouTube', 'Xem trên YouTube'],
    ['document', 'Tài liệu', 'Mở tài liệu'],
    ['broken', undefined, undefined],
  ]);
  assert.equal('url' in rows[2], false);
});

test('schedule line: same time (2 and 3 days), different times, sorted by weekday', () => {
  assert.equal(scheduleLine([{ dow: 3, start: '18:30' }, { dow: 1, start: '18:30' }]), 'Thứ Hai và Thứ Tư, 18:30');
  assert.equal(scheduleLine([{ dow: 5, start: '18:30' }, { dow: 1, start: '18:30' }, { dow: 3, start: '18:30' }]),
    'Thứ Hai, Thứ Tư và Thứ Sáu, 18:30');
  assert.equal(scheduleLine([{ dow: 3, start: '19:00' }, { dow: 1, start: '18:30' }]), 'Thứ Hai 18:30, Thứ Tư 19:00');
  assert.equal(scheduleLine([{ dow: 7, start: '08:00' }]), 'Chủ Nhật, 08:00');
  assert.equal(scheduleLine([]), null);
  assert.equal(scheduleLine(null), null);
  assert.equal(scheduleLine([{ dow: 9, start: '18:30' }]), null);
});

test('class meta: teacher and schedule, hidden entirely on class_meta', () => {
  const raw = [{ id: 'c1', instructor: { name: 'Trần Thu Hà' }, weekly_schedule: [{ dow: 1, start: '18:30' }] },
    { id: 'c2', instructor: null, weekly_schedule: [] }];
  const meta = classMeta(raw, []);
  assert.deepEqual(meta.get('c1'), { teacher: 'Trần Thu Hà', schedule: 'Thứ Hai, 18:30' });
  assert.deepEqual(meta.get('c2'), { teacher: null, schedule: null });
  assert.equal(classMeta(raw, ['class_meta']).size, 0);
});

test('homework by lesson_id; null lesson_id joins no session; none linked hides the block', () => {
  const entries = [{ row: { itemId: 'i1' } }, { row: { itemId: 'i2' } }, { row: { itemId: 'i3' } }];
  const links = lessonLinks([
    { item_id: 'i1', lesson_id: 'L1' }, { item_id: 'i2', lesson_id: null }, { item_id: 'i3', lesson_id: 'L2' },
    { lesson_id: 'L1' },
  ]);
  assert.deepEqual(homeworkFor(entries, links, 'L1').rows.map((e) => e.row.itemId), ['i1']);
  assert.deepEqual(homeworkFor(entries, links, 'L3'), { show: true, rows: [] });
  assert.equal(homeworkFor(entries, links, 'L1').rows.some((e) => e.row.itemId === 'i2'), false);
  assert.deepEqual(homeworkFor(entries, lessonLinks([{ item_id: 'i1', lesson_id: null }]), 'L1'),
    { show: false, rows: [] });
});

test('selection query keeps other params', () => {
  assert.equal(selectionSearch('?x=1', { classId: 'c2', lessonId: 'L1' }), '?x=1&class=c2&session=L1');
  assert.equal(selectionSearch('?class=c2&session=L1', { classId: null, lessonId: null }), '');
});

// UIBASE-0056 G03-T08: date and time parsing of the "Bản in" date fields.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DATE_FORMAT_ERROR, TIME_FORMAT_ERROR, addDays, addMonths, daysBetweenInclusive, formatDate, formatLongDate,
  monthGrid, monthTitle, parseDate, parseTime, timeSteps, weekdayName,
} from '../lib/av2-date.mjs';

test('parseDate reads dd/mm/yyyy with /, - or . and single digits', () => {
  assert.deepEqual(parseDate('17/11/2026'), { value: '2026-11-17' });
  assert.deepEqual(parseDate('5-1-2027'), { value: '2027-01-05' });
  assert.deepEqual(parseDate(' 05.12.2026 '), { value: '2026-12-05' });
  assert.deepEqual(parseDate(''), { value: '' });
});

test('two-digit years are 20yy', () => {
  assert.deepEqual(parseDate('17/11/26'), { value: '2026-11-17' });
  assert.deepEqual(parseDate('01/01/00'), { value: '2000-01-01' });
});

test('29/02 only in leap years; 31/04 and 31/11 say how many days the month has', () => {
  assert.deepEqual(parseDate('29/02/2028'), { value: '2028-02-29' });
  assert.deepEqual(parseDate('29/02/2027'), { error: 'Năm 2027 không có ngày 29/02. Bạn kiểm tra lại ngày.' });
  assert.deepEqual(parseDate('29/02/2100'), { error: 'Năm 2100 không có ngày 29/02. Bạn kiểm tra lại ngày.' });
  assert.deepEqual(parseDate('31/04/2026'), { error: 'Tháng 4 chỉ có 30 ngày. Bạn kiểm tra lại ngày.' });
  assert.deepEqual(parseDate('31/11/2026'), { error: 'Tháng 11 chỉ có 30 ngày. Bạn kiểm tra lại ngày.' });
  assert.deepEqual(parseDate('30/02/2028'), { error: 'Tháng 2 chỉ có 29 ngày. Bạn kiểm tra lại ngày.' });
});

test('wrong shapes and months are refused in words', () => {
  for (const text of ['2026-11-17', '17/11', 'mai', '00/11/2026', '17/11/202']) {
    assert.deepEqual(parseDate(text), { error: DATE_FORMAT_ERROR }, text);
  }
  assert.deepEqual(parseDate('17/13/2026'), { error: 'Tháng chỉ từ 01 đến 12. Bạn kiểm tra lại ngày.' });
});

test('min and max bounds', () => {
  assert.deepEqual(parseDate('16/11/2026', { min: '2026-11-17' }), { error: 'Chọn từ ngày 17/11/2026 trở đi.' });
  assert.deepEqual(parseDate('17/11/2026', { min: '2026-11-17' }), { value: '2026-11-17' });
  assert.deepEqual(parseDate('01/01/2028', { max: '2027-12-31' }), { error: 'Chọn đến ngày 31/12/2027 là muộn nhất.' });
});

test('formatting and weekdays (week from Monday)', () => {
  assert.equal(formatDate('2026-11-17'), '17/11/2026');
  assert.equal(formatDate('2026-02-30'), '');
  assert.equal(weekdayName('2026-11-17'), 'Thứ Ba');
  assert.equal(weekdayName('2026-11-22'), 'Chủ Nhật');
  assert.equal(formatLongDate('2026-11-23'), 'Thứ Hai, 23/11/2026');
});

test('parseTime: 24-hour hh:mm', () => {
  assert.deepEqual(parseTime('19:30'), { value: '19:30' });
  assert.deepEqual(parseTime('7:05'), { value: '07:05' });
  assert.deepEqual(parseTime('1930'), { value: '19:30' });
  assert.deepEqual(parseTime('19h30'), { value: '19:30' });
  assert.deepEqual(parseTime('7'), { value: '07:00' });
  assert.deepEqual(parseTime(''), { value: '' });
  for (const text of ['24:00', '19:60', '7pm', '19:3']) assert.deepEqual(parseTime(text), { error: TIME_FORMAT_ERROR }, text);
});

test('timeSteps every 15 minutes', () => {
  assert.deepEqual(timeSteps('19:30', '20:15', 15), ['19:30', '19:45', '20:00', '20:15']);
});

test('monthGrid starts weeks on Monday and pads with null', () => {
  const weeks = monthGrid('2026-11');
  // 1/11/2026 is a Sunday: six empty cells before it.
  assert.deepEqual(weeks[0], [null, null, null, null, null, null, '2026-11-01']);
  assert.equal(weeks.length, 6);
  assert.deepEqual(weeks[5], ['2026-11-30', null, null, null, null, null, null]);
  assert.equal(monthGrid('2027-02').length, 4);
});

test('month and day arithmetic', () => {
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(monthTitle('2026-11'), 'Tháng 11, 2026');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetweenInclusive('2026-11-17', '2026-11-20'), 4);
});

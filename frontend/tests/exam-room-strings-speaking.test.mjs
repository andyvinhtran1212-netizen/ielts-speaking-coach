// EXAMSPEAK-0072 FR-003, FR-005, FR-011: Speaking room words. Both sets have the
// same keys, English has no Vietnamese, no string leaks an error name or code,
// and the too-short reason is built from the numbers the caller passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SPEAKING_ROOM_STRINGS_EN as EN,
  SPEAKING_ROOM_STRINGS_VI as VI,
  speakingRoomMode,
  speakingRoomStrings,
  speakingTooShortReason,
} from '../lib/exam-room/strings-speaking.mjs';

const flat = (set) => Object.values(set).flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => typeof v === 'string');

test('same keys in both modes', () => {
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(VI).sort());
  assert.equal(EN.micDeniedSteps.length, VI.micDeniedSteps.length);
});

test('English has no Vietnamese letters', () => {
  for (const s of flat(EN)) assert.doesNotMatch(s, /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i, s);
});

test('no error names, HTTP codes or ids', () => {
  for (const s of [...flat(EN), ...flat(VI)]) {
    assert.doesNotMatch(s, /Error\b|\b[45]\d\d\b|session_id|getUserMedia|NotAllowed/, s);
  }
});

test('FR-003 words', () => {
  assert.equal(VI.micPrompt, 'Cần micro để ghi âm câu trả lời.');
  assert.equal(VI.micAllow, 'Cho phép micro');
  assert.equal(VI.micPending, 'Hãy chọn Cho phép trong hộp của trình duyệt.');
  assert.equal(VI.micNotFound, 'Không tìm thấy micro. Hãy cắm micro rồi bấm Thử lại.');
  assert.equal(VI.micDeniedSteps.length, 3);
});

test('mode: only test_full is English', () => {
  assert.equal(speakingRoomMode('test_full'), 'test');
  for (const m of ['practice', 'test_part', '', null, undefined]) assert.equal(speakingRoomMode(m), 'practice');
  assert.equal(speakingRoomStrings('test'), EN);
  assert.equal(speakingRoomStrings('practice'), VI);
});

test('too-short reason uses the numbers it is given (FR-005)', () => {
  assert.equal(
    speakingTooShortReason(12, 1, 15),
    'Bản ghi 12 giây, Part 1 cần ít nhất 15 giây. Hãy ghi lại với câu trả lời dài hơn.',
  );
  // Rounded down: 79.9 s never reads as reaching 80.
  assert.match(speakingTooShortReason(79.9, 2, 80), /^Bản ghi 79 giây, Part 2 cần ít nhất 80 giây\./);
  // The server's detail.min_seconds wins over the client table.
  assert.match(speakingTooShortReason(20, 3, 30), /Part 3 cần ít nhất 30 giây/);
  assert.equal(
    speakingTooShortReason(1, 1, 15, 'test'),
    'Your recording is 1 second; Part 1 needs at least 15 seconds. Record again with a longer answer.',
  );
  assert.match(speakingTooShortReason(Number.NaN, 1, 15), /^Bản ghi 0 giây/);
});

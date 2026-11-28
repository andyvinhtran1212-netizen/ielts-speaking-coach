// EXAMSPEAK-0072 FR-009 (R152 review): unsent takes live only in page memory,
// as today (LEARNERDRAFT-0010). No audio goes to localStorage, sessionStorage,
// IndexedDB or the Cache API, and no room text promises a recording is kept
// after a reload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPEAKING_ROOM_STRINGS_EN as EN, SPEAKING_ROOM_STRINGS_VI as VI } from '../lib/exam-room/strings-speaking.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const PRACTICE = read('public/js/practice.js');
const SESSION = 'app/(authed-practice)/practice/session/';
const ROOM_SOURCES = {
  'public/js/practice.js': PRACTICE,
  ...Object.fromEntries([
    'practice-exam-room.tsx',
    'practice-exam-room-frame.tsx',
    'speaking-tab-guard.tsx',
    'mic-status.tsx',
    'recording-status.tsx',
    'practice-recorder-bridge.tsx',
  ].map((f) => [SESSION + f, read(SESSION + f)])),
};

// The only keys practice.js writes, and what goes in them: the question mode,
// the Full Test session-id chain and the grammar-lesson view history.
const ALLOWED_SET_ITEM = [
  /sessionStorage\.setItem\('ielts_qmode', (mode|'listening'|'visual')\)/,
  /sessionStorage\.setItem\(FT_CHAIN_KEY, JSON\.stringify\((_ftAllSessionIds|nextIds|nextChain)\)\)/,
  /sessionStorage\.setItem\(this\._key, JSON\.stringify\(hist\)\)/,
];

test('practice.js writes no audio to Web Storage: every setItem is a known key with ids or a mode', () => {
  const calls = PRACTICE.match(/(?:local|session)Storage\.setItem\([^;]*\)/g) || [];
  assert.ok(calls.length > 0, 'the scan finds the known writes');
  for (const call of calls) {
    assert.ok(ALLOWED_SET_ITEM.some((re) => re.test(call)), `unexpected storage write: ${call}`);
  }
});

test('no Speaking room source keeps audio outside page memory', () => {
  for (const [file, src] of Object.entries(ROOM_SOURCES)) {
    assert.doesNotMatch(src, /\bindexedDB\b|\bIDBFactory\b/, `${file}: IndexedDB`);
    assert.doesNotMatch(src, /\bcaches\.open\b|\bCacheStorage\b/, `${file}: Cache API`);
    assert.doesNotMatch(src, /readAsDataURL|\bbtoa\(/, `${file}: audio turned into a storable string`);
    if (file !== 'public/js/practice.js') {
      assert.doesNotMatch(src, /(?:local|session)Storage\.setItem/, `${file}: Web Storage write`);
    }
  }
});

test('no room text promises a recording survives a reload (VI and EN)', () => {
  const reloadWord = /tải lại|reload|làm mới|refresh/i;
  const keepWord = /giữ|lưu|khôi phục|kept|keep|saved|restore/i;
  for (const [lang, strings] of [['vi', VI], ['en', EN]]) {
    const all = Object.entries(strings).flatMap(([key, v]) => (Array.isArray(v) ? v.map((s) => [key, s]) : [[key, v]]))
      .filter(([, v]) => typeof v === 'string');
    assert.ok(all.length > 20, `${lang}: strings found`);
    for (const [key, text] of all) {
      assert.ok(!(reloadWord.test(text) && keepWord.test(text)), `${lang}.${key} ties a reload to keeping something: "${text}"`);
      assert.doesNotMatch(text, /(bản ghi|recording)[^.]*(vẫn được giữ|được lưu|is kept|are kept|saved)/i, `${lang}.${key} promises a recording is kept: "${text}"`);
    }
    // Leaving with unsent takes says they will be lost.
    assert.match(strings.leaveBody, lang === 'vi' ? /bản ghi chưa gửi sẽ mất/ : /unsent recordings will be lost/);
  }
});

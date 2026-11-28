// EXAMSPEAK-0072 FR-002: the exam room helpers of practice.js with the flag
// OFF, for tests that run slices of practice.js in a sandbox. Every helper
// returns before touching the view or the recorder, so a slice that now calls
// them behaves exactly as it did before the room existed. Not a test file.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const JS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js', 'practice.js'), 'utf8');
const start = JS.indexOf('  // ── Exam room (EXAMSPEAK-0072)');
const end = JS.indexOf('  function _hasUnsentWork() {');
if (start === -1 || end <= start) throw new Error('practice.js: exam room helper block not found');

export const PRACTICE_ROOM_OFF = `
  var _examRoomMode = false;
  var _roomMicState = 'unknown';
  var _ROOM_LEVEL_MS = 200;
  var _roomLevelTimer = null;
  var _roomMicLostDone = false;
  var _roomMicLostShown = false;
  var _roomWriteRight = true;
  var _roomDialogKind = null;
  var _roomLeaveHref = '';
  var _roomLeaving = false;
  var _roomConfirmed = false;
  var _ROOM_LEAVE_RESET_MS = 4000;
${JS.slice(start, end)}`;

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(path.join(FRONTEND, ...parts), 'utf8');
const TYPES = read('types', 'api.d.ts');
const API = read('lib', 'session-api.ts');
const STATS = read('app', '(authed-speaking)', 'speaking', 'speaking-stats.tsx');
const RESULT = read('app', '(authed-session-result)', 'result', 'session-result-behavior.tsx');

test('learner session reads expose concrete generated response schemas', () => {
  const expected = [
    ['get_session_stats_sessions_stats_get', 'SessionStatsResponse'],
    ['get_session_sessions__session_id__get', 'SessionDetailResponse'],
  ];
  for (const [operation, schema] of expected) {
    const start = TYPES.indexOf(`${operation}: {`);
    const next = TYPES.indexOf('\n    };', start);
    const source = TYPES.slice(start, next);
    assert.ok(start >= 0, operation);
    assert.match(source, new RegExp(`"application/json": components\\["schemas"\\]\\["${schema}"\\]`));
    assert.doesNotMatch(source, /"application\/json": unknown/);
  }
  assert.match(TYPES, /list_sessions_sessions_get:[\s\S]*?"application\/json": components\["schemas"\]\["SessionRow"\]\[\] \| components\["schemas"\]\["SessionPageResponse"\]/);
  assert.match(TYPES, /get_session_audio_urls_sessions__session_id__audio_urls_get:[\s\S]*?"application\/json": components\["schemas"\]\["SessionAudioUrl"\]\[\]/);
});

test('Next history and result surfaces use the generated, validated adapter', () => {
  for (const route of ['/sessions', '/sessions/stats', '/sessions/{session_id}', '/sessions/{session_id}/audio-urls']) {
    assert.match(API, new RegExp(`ApiGetJson<'${route.replace(/[{}]/g, '\\$&')}'>`));
  }
  assert.match(API, /normalizeSessionHistory/);
  assert.match(API, /normalizeSessionDetail/);
  assert.match(API, /normalizeSessionAudioUrls/);
  assert.match(STATS, /getSessionHistory\(params\)/);
  assert.doesNotMatch(STATS, /api\.get\('\/sessions\?/);
  assert.match(RESULT, /getSessionDetail\(sessionId, controller\.signal\)/);
  assert.match(RESULT, /getSessionAudioUrls\(sessionId, controller\.signal\)/);
  assert.doesNotMatch(RESULT, /getWith<any[^>]*>\(`\/sessions\/\$\{encodedId\}/);
});

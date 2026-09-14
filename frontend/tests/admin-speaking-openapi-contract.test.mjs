import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(path.join(FRONTEND, ...parts), 'utf8');
const TYPES = read('types', 'api.d.ts');
const API = read('lib', 'admin-speaking-sessions-api.ts');
const COMPONENT = read('app', '(authed-admin-speaking-sessions)', 'admin', 'speaking', 'sessions', 'admin-speaking-sessions.tsx');

const operations = [
  ['admin_list_sessions_admin_sessions_get', 'AdminSpeakingSessionRow'],
  ['admin_get_session_admin_sessions__session_id__get', 'AdminSpeakingSessionDetail'],
  ['admin_regrade_response_admin_responses__response_id__regrade_post', 'AdminResponseRegradeResponse'],
  ['admin_regrade_session_admin_sessions__session_id__regrade_post', 'AdminSessionRegradeResponse'],
  ['admin_rebuild_summary_admin_sessions__session_id__rebuild_summary_post', 'AdminSummaryRebuildResponse'],
];

test('admin Speaking reads and repair acknowledgements have generated schemas', () => {
  for (const [operation, schema] of operations) {
    const start = TYPES.indexOf(`${operation}: {`);
    const next = TYPES.indexOf('\n    };', start);
    const source = TYPES.slice(start, next);
    assert.ok(start >= 0, operation);
    assert.match(source, new RegExp(`"application/json": components\\["schemas"\\]\\["${schema}"\\]${operation.includes('list_sessions') ? '\\[\\]' : ''}`));
    assert.doesNotMatch(source, /"application\/json": unknown/);
  }
});

test('native admin screen consumes one generated domain adapter', () => {
  for (const route of [
    '/admin/sessions', '/admin/sessions/{session_id}',
    '/admin/responses/{response_id}/regrade', '/admin/sessions/{session_id}/regrade',
    '/admin/sessions/{session_id}/rebuild-summary',
  ]) assert.match(API, new RegExp(`Api(?:Get|Post)Json<'${route.replace(/[{}]/g, '\\$&')}'>`));
  for (const fn of [
    'getAdminSpeakingSessions', 'getAdminSpeakingSessionDetail',
    'regradeAdminSpeakingResponse', 'regradeAdminSpeakingSession',
    'rebuildAdminSpeakingSummary',
  ]) assert.match(COMPONENT, new RegExp(`${fn}\\(`));
  assert.doesNotMatch(COMPONENT, /window\.api\.(?:get|post)<unknown>\(`?\/admin\/(?:sessions|responses)/);
  assert.match(API, /searchParamsSuffix\(query\)/);
  assert.doesNotMatch(API, /query\.size/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeSessionAudioUrls,
  normalizeSessionDetail,
  normalizeSessionHistory,
} from '../lib/session-wire-model.mjs';

const retention = {
  days_until_audio_purge: 12,
  days_until_content_purge: 57,
  is_audio_purged: false,
  is_content_purged: false,
  is_hidden: false,
};
const row = {
  id: 's1', mode: 'practice', part: 1, topic: 'Home', status: 'completed',
  started_at: '2026-09-14T00:00:00Z', overall_band: 6.5, retention,
};

test('history accepts both canonical response shapes', () => {
  assert.deepEqual(normalizeSessionHistory([row])?.[0].retention, retention);
  const page = normalizeSessionHistory({
    sessions: [row], total: 1, page: 1, page_size: 20, total_pages: 1,
  });
  assert.equal(page.total, 1);
  assert.equal(page.sessions[0].id, 's1');
});

test('history rejects malformed pagination and safety metadata', () => {
  assert.equal(normalizeSessionHistory({ sessions: [row], total: '1', page: 1, page_size: 20, total_pages: 1 }), null);
  assert.equal(normalizeSessionHistory([{ ...row, retention: { ...retention, is_hidden: 'false' } }]), null);
  assert.equal(normalizeSessionHistory([{ ...row, overall_band: '6.5' }]), null);
});

test('detail preserves explicit lookup and seal decisions', () => {
  const detail = normalizeSessionDetail({
    ...row, session_id: 's1',
    questions: [{ id: 'q1', question_text: '' }],
    responses: [{ id: 'r1', question_id: 'q1', audio_available: false, audio_lookup_failed: false }],
    response_receipts: [{ id: 'r1', question_id: 'q1', persisted_at: null }],
    question_lookup_failed: false,
    response_lookup_failed: false,
    results_sealed: true,
  });
  assert.equal(detail.results_sealed, true);
  assert.equal(detail.questions[0].question_text, '');
});

test('detail fails closed when a backend safety flag or nested identity is malformed', () => {
  const base = {
    ...row, session_id: 's1', questions: [], responses: [], response_receipts: [],
    question_lookup_failed: false, response_lookup_failed: false, results_sealed: false,
  };
  assert.equal(normalizeSessionDetail({ ...base, results_sealed: 'false' }), null);
  assert.equal(normalizeSessionDetail({ ...base, responses: [{ id: 'r1' }] }), null);
});

test('audio list only accepts expiring signed-url records', () => {
  const valid = [{ response_id: 'r1', question_id: 'q1', url: 'https://signed.test/a', expires_in: 3600 }];
  assert.deepEqual(normalizeSessionAudioUrls(valid), valid);
  assert.equal(normalizeSessionAudioUrls([{ ...valid[0], expires_in: '3600' }]), null);
});

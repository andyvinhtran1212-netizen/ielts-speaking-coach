import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  listeningBandLabel,
  listeningReviewBackTarget,
  listeningReviewParams,
  listeningReviewSection,
  listeningSkillsToPractise,
  listeningTranscriptParagraphs,
  normalizeListeningReview,
} from '../lib/listening-review-model.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const CLIENT = read('app', '(authed-listening-review)', 'listening', 'review', 'listening-review-workspace.tsx');
const LAYOUT = read('app', '(authed-listening-review)', 'layout.tsx');
const PAGE = read('app', '(authed-listening-review)', 'listening', 'review', 'page.tsx');
const NEXT_CSS = read('public', 'css', 'listening-review-next.css');
const LEGACY_HTML = read('public', 'pages', 'listening-review.html');
const LEGACY_JS = read('public', 'js', 'listening-review.js');
const PLAYER = read('public', 'js', 'listening-test-player.js');
const MOCK = read('app', '(authed-mock-result)', 'mock', 'result', 'mock-result-behavior.tsx');

const fixture = (overrides = {}) => ({
  attempt_id: 'attempt-1',
  test_id: 'LISTENING-1',
  title: 'Listening test',
  status: 'submitted',
  score: 1,
  max_score: 2,
  band_estimate: 4.5,
  band_conversion: [{ band: 4 }, { band: 5 }],
  audio_url: 'https://cdn.test/audio.mp3',
  audio_duration: 120,
  sections: [
    { section_num: 1, theme: 'Booking', transcript: '**Daniel:** Hello there.\n\n**Helen:** Welcome.' },
  ],
  review: [
    { q_num: 1, correct: false, user_answer: 'A', expected: 'B', transcript_anchor: 1,
      audio_window: { start: 10, end: 14, section: 'Section 1' }, solution: { skills: 'K2, K4' } },
    { q_num: 2, correct: true, user_answer: 'C', expected: 'C', solution: {} },
  ],
  ...overrides,
});

describe('Listening review native model', () => {
  test('parses only allowlisted origins and requires a sitting to return to mock', () => {
    assert.deepEqual(listeningReviewParams('?attempt_id=a&from=practice'), {
      attemptId: 'a', adminTestId: null, from: 'practice', sittingId: null,
    });
    const hostile = listeningReviewParams('?attempt_id=a&from=https://evil.test&sitting=x');
    assert.equal(hostile.from, 'full');
    assert.deepEqual(listeningReviewBackTarget(hostile), { href: '/listening/tests', label: '← Listening tests' });
    assert.equal(listeningReviewBackTarget(listeningReviewParams('?attempt_id=a&from=mock&sitting=s%2F1')).href, '/mock/result?sitting=s%2F1');
  });

  test('fails closed on unsubmitted, duplicate, malformed or dishonest scored payloads', () => {
    assert.throws(() => normalizeListeningReview(fixture({ status: 'in_progress' })), /status/);
    assert.throws(() => normalizeListeningReview(fixture({ review: [
      { q_num: 1, correct: true }, { q_num: 1, correct: false },
    ] })), /item/);
    assert.throws(() => normalizeListeningReview(fixture({ score: 3 })), /score/);
    assert.throws(() => normalizeListeningReview(fixture({ sections: [{ section_num: 0 }] })), /section/);
  });

  test('keeps preview scoreless and rejects invalid audio windows without inventing seconds', () => {
    const data = normalizeListeningReview(fixture({
      preview: true, attempt_id: null, score: null, band_estimate: null,
      review: [{ q_num: 1, correct: false, audio_window: { start: 20, end: 10, section: 'Section 1' } }],
    }));
    assert.equal(data.preview, true);
    assert.equal(data.score, null);
    assert.equal(data.review[0].audio_window, null);
  });

  test('keeps a missing transcript anchor absent instead of coercing null to paragraph zero', () => {
    const data = normalizeListeningReview(fixture({
      review: [{ q_num: 1, correct: false, transcript_anchor: null }],
    }));
    assert.equal(data.review[0].transcript_anchor, null);
  });

  test('derives band floor, transcript labels, weak skills and section anchors deterministically', () => {
    const data = normalizeListeningReview(fixture({ band_estimate: null }));
    assert.equal(listeningBandLabel(data), 'Dưới band 4.0');
    assert.deepEqual(listeningTranscriptParagraphs(data.sections[0].transcript), [
      { speaker: 'Daniel', text: 'Hello there.' }, { speaker: 'Helen', text: 'Welcome.' },
    ]);
    assert.deepEqual(listeningSkillsToPractise(data.review, { K2: 'Paraphrase', K4: 'Correction' }), [
      { code: 'K2', count: 1, label: 'Paraphrase' }, { code: 'K4', count: 1, label: 'Correction' },
    ]);
    assert.equal(listeningReviewSection(data.review[0]), 1);
  });
});

describe('Listening review native controller contract', () => {
  test('loads owner/admin submitted review through abortable no-redirect reads', () => {
    assert.match(CLIENT, /\/api\/listening\/tests\/attempts\/\$\{encodeURIComponent\(params\.attemptId!\)\}\/review/);
    assert.match(CLIENT, /\/admin\/listening\/tests\/\$\{encodeURIComponent\(params\.adminTestId\)\}\/preview/);
    assert.match(CLIENT, /noRedirect:\s*true,\s*signal:\s*controller\.signal/);
    assert.match(CLIENT, /requestRef\.current !== requestId \|\| controller\.signal\.aborted/);
    assert.match(CLIENT, /normalized\.attemptId !== params\.attemptId/);
  });

  test('binds snapshots to account identity and clears before auth redirects/reloads', () => {
    assert.match(CLIENT, /:user:\$\{user\?\.id \|\| 'none'\}/);
    assert.match(CLIENT, /snapshot\.ownerKey === ownerKey/);
    assert.match(CLIENT, /setSnapshot\(null\)[\s\S]{0,120}window\.location\.replace\('\/login'\)/);
  });

  test('preserves neutral preview and friendly 403/409/404 states', () => {
    assert.match(CLIENT, /normalized\.preview \? 'all'/);
    assert.match(CLIENT, /!data\.preview \? <div className="lr-summary"/);
    assert.match(CLIENT, /code === 409[\s\S]{0,100}chưa nộp/);
    assert.match(CLIENT, /code === 403[\s\S]{0,140}chờ duyệt/);
    assert.match(CLIENT, /code === 404/);
    assert.match(CLIENT, /Không tải được chữa bài\. Vui lòng thử lại\./);
    assert.doesNotMatch(CLIENT, /Không tải được chữa bài\. \$\{messageOf/);
  });

  test('defaults to wrong answers, but palette jumps reveal filtered cards', () => {
    assert.match(CLIENT, /setFilter\(normalized\.preview \? 'all' : \(wrong \? 'wrong' : 'all'\)\)/);
    assert.match(CLIENT, /if \(filter !== 'all'[\s\S]{0,100}setFilter\('all'\)/);
    assert.match(CLIENT, /filter === 'wrong' \? !item\.correct/);
  });

  test('real audio window drives full-track seek and transcript anchor highlight', () => {
    assert.match(CLIENT, /removeAttribute\('segment-start'\)/);
    assert.match(CLIENT, /removeAttribute\('segment-end'\)/);
    assert.match(CLIENT, /seekTo\?\.\(win\.start\)/);
    assert.match(CLIENT, /setActiveAnchor\(item\.transcript_anchor\)/);
    assert.match(CLIENT, /data-para=\{index\}/);
  });

  test('uses React text rendering for authored prose and keeps feedback wiring', () => {
    assert.doesNotMatch(CLIENT, /dangerouslySetInnerHTML/);
    assert.match(CLIENT, /AverFeedback\?\.attachCardFlag/);
    assert.match(CLIENT, /AverFeedback\?\.mountSurvey/);
    assert.match(CLIENT, /hasAudio:\s*true/);
  });
});

describe('Listening review route ownership and rollback', () => {
  test('ships native route metadata, exact stylesheet cascade and shared audio player', () => {
    assert.match(PAGE, /Chữa bài Listening/);
    assert.match(LAYOUT, /listening-review\.css/);
    assert.match(LAYOUT, /listening-review-next\.css/);
    assert.match(LAYOUT, /audio-player\.js/);
    assert.match(LAYOUT, /feedback-widgets\.js/);
    assert.match(LAYOUT, /utilityLayer=\{false\}/);
    assert.match(LAYOUT, /chrome="none"/);
    assert.doesNotMatch(NEXT_CSS, /#[0-9a-fA-F]{3,8}\b/);
  });

  test('all completion/result entry points now use the clean native URL', () => {
    assert.match(PLAYER, /\/listening\/review\?attempt_id=/);
    assert.match(MOCK, /`\/listening\/review\?attempt_id=/);
    assert.doesNotMatch(PLAYER, /\/pages\/listening-review\.html\?attempt_id=/);
    assert.doesNotMatch(MOCK, /\/pages\/listening-review\.html\?attempt_id=/);
  });

  test('legacy HTML/JS remain intact as explicit rollback and parity targets', () => {
    assert.match(LEGACY_HTML, /id="lr-transcript-pane"/);
    assert.match(LEGACY_HTML, /src="\/js\/listening-review\.js"/);
    assert.match(LEGACY_JS, /\/api\/listening\/tests\/attempts\//);
  });
});

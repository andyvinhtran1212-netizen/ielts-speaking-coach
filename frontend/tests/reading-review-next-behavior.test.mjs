import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  grammarKnowledgeHref,
  normalizeReadingReview,
  readingEvidenceMatchesTarget,
  readingReviewBackTarget,
  readingReviewParams,
  readingReviewPrompt,
  readingReviewSkillRows,
} from '../lib/reading-review-model.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const CLIENT = read('frontend/app/(reading-review)/reading/review/reading-review-workspace.tsx');
const LISTENING_CLIENT = read('frontend/app/(authed-listening-review)/listening/review/listening-review-workspace.tsx');
const LAYOUT = read('frontend/app/(reading-review)/layout.tsx');
const WEB_PANEL = read('frontend/components/web-explanation-panel.tsx');
const WRITE_FLOW = read('frontend/tooling/write-flows/reading-review-microcheck.mjs');

function payload(overrides = {}) {
  return {
    attempt_id: 'attempt-1',
    status: 'submitted',
    test_id: 'RD-1',
    title: 'Reading 1',
    score: 1,
    max_score: 2,
    band_estimate: 5,
    skill_breakdown: { inference: { correct: 0, total: 1 }, detail: { correct: 1, total: 1 } },
    passages: [
      { passage_order: 2, title: 'Two', body_markdown: 'Second' },
      { passage_order: 1, title: 'One', body_markdown: 'First', translation_vi: 'Một' },
    ],
    review: [
      { q_num: 2, passage_order: 2, correct: false, user_answer: 'B', expected: 'C' },
      { q_num: 1, passage_order: 1, correct: true, user_answer: 'A', expected: 'A' },
    ],
    ...overrides,
  };
}

describe('native Reading review model', () => {
  test('parses attempt/admin identities and allowlists the back origin', () => {
    assert.deepEqual(readingReviewParams('?attempt_id=a%2F1&anon=cap&from=mini'), {
      attemptId: 'a/1', adminTestId: null, anonId: 'cap', from: 'mini', sittingId: null,
    });
    assert.deepEqual(readingReviewParams('?admin_test_id=RD-1&anon=must-not-win&from=mock&sitting=s%2F1'), {
      attemptId: null, adminTestId: 'RD-1', anonId: null, from: 'mock', sittingId: 's/1',
    });
    assert.deepEqual(readingReviewBackTarget(readingReviewParams('?from=https://evil.test')), {
      href: '/reading/test', label: '← Thư viện',
    });
    assert.equal(readingReviewBackTarget(readingReviewParams('?from=mock&sitting=s%2F1')).href, '/mock/result?sitting=s%2F1');
    assert.deepEqual(readingReviewBackTarget(readingReviewParams('?from=my-class')), {
      href: '/my-class', label: '← Lớp học của tôi',
    });
    assert.deepEqual(readingReviewBackTarget(readingReviewParams('?from=admin')), {
      href: '/admin/classes', label: '← Quản lý lớp',
    });
  });

  test('normalizes canonical answer-key truth and sorts it deterministically', () => {
    const out = normalizeReadingReview(payload());
    assert.deepEqual(out.passages.map((row) => row.passage_order), [1, 2]);
    assert.deepEqual(out.review.map((row) => row.q_num), [1, 2]);
    assert.equal(out.score, 1);
    assert.deepEqual(readingReviewSkillRows(out.skillBreakdown, { inference: 'Suy luận', detail: 'Chi tiết' }).map((row) => row.label), ['Suy luận', 'Chi tiết']);
  });

  test('fails closed on malformed or contradictory answer-key payloads', () => {
    assert.throws(() => normalizeReadingReview(null), /invalid-reading-review/);
    assert.throws(() => normalizeReadingReview(payload({ score: 3 })), /invalid-reading-review-score/);
    assert.throws(() => normalizeReadingReview(payload({ status: 'in_progress' })), /invalid-reading-review-status/);
    assert.throws(() => normalizeReadingReview(payload({ review: [
      { q_num: 1, passage_order: 1, correct: true },
      { q_num: 1, passage_order: 2, correct: false },
    ] })), /invalid-reading-review-item/);
  });

  test('preserves historical orphan grading rows in one truthful fallback passage', () => {
    const out = normalizeReadingReview(payload({ review: [
      { q_num: 1, passage_order: 99, correct: true },
      { q_num: 2, passage_order: null, correct: false },
    ] }));
    const orphan = out.passages.find((row) => row.orphaned === true);
    assert.ok(orphan);
    assert.equal(orphan.title, 'Câu chưa gắn Passage');
    assert.deepEqual(out.review.map((row) => row.passage_order), [orphan.passage_order, orphan.passage_order]);
  });

  test('admin preview permits honest null score but keeps the real key', () => {
    const out = normalizeReadingReview(payload({ preview: true, attempt_id: null, score: null, band_estimate: null }));
    assert.equal(out.preview, true);
    assert.equal(out.score, null);
    assert.equal(out.review[0].expected, 'A');
  });

  test('restores completion prompts and grammar deep links safely', () => {
    assert.equal(readingReviewPrompt({ prompt: '(see summary above)', solution: { question_text: '“gravity”' } }), 'gravity');
    assert.equal(grammarKnowledgeHref({ type: 'grammar', category: 'articles', slug: 'a-an', anchor: 'rules' }), '/grammar/articles/a-an#rules');
    assert.equal(grammarKnowledgeHref({ type: 'skill', slug: 'scan' }), null);
  });

  test('rejects evidence when the learner navigates away from its originating passage', () => {
    const target = { questionNumber: 7, passageOrder: 1 };
    const selection = {
      kind: 'reading_text',
      locator: { kind: 'reading_text', passage_order: 1, selected_text: 'source evidence' },
    };
    assert.equal(readingEvidenceMatchesTarget(target, 1, selection), true);
    assert.equal(readingEvidenceMatchesTarget(target, 2, {
      ...selection,
      locator: { ...selection.locator, passage_order: 2 },
    }), false);
    assert.equal(readingEvidenceMatchesTarget(target, 1, {
      ...selection,
      locator: { ...selection.locator, passage_order: 2 },
    }), false);
  });
});

describe('native Reading review route contract', () => {
  test('owns the canonical route without requiring auth for capability links', () => {
    assert.match(LAYOUT, /authGated=\{false\}/);
    assert.match(LAYOUT, /chrome="none"/);
    assert.match(CLIENT, /X-Reading-Anon/);
    assert.match(CLIENT, /noRedirect: true/);
  });

  test('keeps answer-key gates server-owned and renders both canonical endpoints', () => {
    assert.match(CLIENT, /\/api\/reading\/test\/attempts\/\$\{encodeURIComponent\(params\.attemptId!\)\}\/review/);
    assert.match(CLIENT, /\/admin\/reading\/content\/tests\/\$\{encodeURIComponent\(params\.adminTestId\)\}\/preview/);
    assert.match(CLIENT, /code === 409/);
    assert.match(CLIENT, /code === 401 \|\| code === 403/);
  });

  test('aborts stale loads and clears private state before each owner-bound request', () => {
    assert.match(CLIENT, /const controller = new AbortController\(\)/);
    assert.match(CLIENT, /setSnapshot\(null\);[\s\S]{0,260}setPhase\('loading'\)/);
    assert.match(CLIENT, /requestRef\.current !== requestId \|\| controller\.signal\.aborted/);
    assert.match(CLIENT, /return \(\) => controller\.abort\(\)/);
    assert.match(CLIENT, /snapshot && snapshot\.ownerKey === ownerKey \? snapshot\.data : null/);
    assert.match(CLIENT, /\[ownerKey, params, status, user\?\.id\]/);
    assert.match(CLIENT, /normalized\.attemptId !== params\.attemptId/);
  });

  test('preserves review affordances rather than shipping a score-only port', () => {
    for (const signal of [
      'Bài dịch', 'Locate trong bài đọc', 'Phân tích đáp án nhiễu',
      'microcheck-answers', 'AverFeedback.mountSurvey', 'AverFeedback.attachCardFlag',
      'adminTestId', 'XEM TRƯỚC',
    ]) assert.ok(CLIENT.includes(signal), signal);
    assert.match(CLIENT, /microcheckEnabled=\{!preview && !anonId\}/);
    assert.match(CLIENT, /document\.body\.dataset\.textSize = 'medium'/);
    assert.match(CLIENT, /Micro-check không ghi tiến độ trong chế độ xem trước/);
    assert.match(CLIENT, /function LegacySteps/);
    assert.match(CLIENT, /ref\.title[\s\S]{0,100}String\(ref\.title\)/);
    assert.match(CLIENT, /Câu \$\{item\.q_num\}.*xem trước/);
    assert.match(CLIENT, /!webExplanation \? <>[\s\S]{0,240}<SolutionSection label="Các bước ra đáp án"/);
    assert.match(CLIENT, /webExplanation && expanded \? <WebExplanationPanel/);
    assert.match(WEB_PANEL, /Tìm bằng chứng, thử lại, rồi mới mở lời giải/);
    assert.match(WEB_PANEL, /Bôi chọn trong bài đọc/);
    assert.match(WEB_PANEL, /evidence_selection/);
    assert.match(CLIENT, /onMouseUp=\{captureSelection\}/);
    assert.match(CLIENT, /selected_text: selectedText/);
    assert.match(CLIENT, /setEvidenceTarget\(null\);[\s\S]{0,100}setCurrentPart\(item\.passage_order\)/);
    assert.match(CLIENT, /readingEvidenceMatchesTarget\(target, currentPart, selection\)/);
    assert.match(WEB_PANEL, /Mở lời giải đầy đủ/);
    assert.match(WEB_PANEL, /correctionRequired \? <>/);
    assert.match(WEB_PANEL, /ĐỐI CHIẾU NHANH/);
    assert.doesNotMatch(WEB_PANEL, /candidate_skill_codes/);
    assert.match(WEB_PANEL, /Mốc nghe lại/);
    assert.match(WEB_PANEL, /readableTimestamp/);
    assert.match(LISTENING_CLIENT, /getCurrentTime\?\(\)/);
    assert.match(LISTENING_CLIENT, /onReplayAudio=\{onLocate\}/);
    assert.match(LAYOUT, /web-explanation-panel\.css/);
  });

  test('starts with incorrect answers and reveals a filtered card from the palette', () => {
    assert.match(CLIENT, /setFilter\(normalized\.preview \? 'all' : \(firstWrong \? 'wrong' : 'all'\)\)/);
    assert.match(CLIENT, /filter === 'wrong' \? !item\.correct/);
    assert.match(CLIENT, /if \(filter !== 'all'[\s\S]{0,100}setFilter\('all'\)/);
    assert.match(CLIENT, /Tự tìm bằng chứng/);
    assert.match(CLIENT, /Phân tích bẫy/);
  });

  test('activates both native micro-check parity flows on an identified attempt', () => {
    assert.match(WRITE_FLOW, /route: `\/reading\/review\?attempt_id=\$\{ATTEMPT\}`/);
    assert.doesNotMatch(WRITE_FLOW, /nextPending/);
    assert.match(WRITE_FLOW, /attempt_id: ATTEMPT[\s\S]{0,120}status: 'submitted'/);
    assert.match(CLIENT, /data-mc/);
    assert.match(CLIENT, /data-letter=\{letter\}/);
    assert.match(CLIENT, /if \(answer \|\| !enabled\) return/);
  });
});

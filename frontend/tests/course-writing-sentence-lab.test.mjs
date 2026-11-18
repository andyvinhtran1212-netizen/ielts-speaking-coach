/**
 * Kho viết câu Course 5 (sentence lab) trên phần tự luận — lớp logic.
 *
 * Ba điều phải giữ: đề hiện đủ source/instruction/required; phản hồi coach
 * không có đáp án tham khảo trước lượt viết lại; lượt viết lại tối đa 6 câu,
 * gửi đúng một lần rồi đọc lại trạng thái từ máy chủ.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWriting } from '../public/js/course-writing.js';

const ITEM = (qid) => ({
  qid,
  prompt: 'fallback',
  subtype: 'Sửa lỗi · Task 2',
  sentence_lab_item: {
    id: qid, instruction: 'Bổ sung động từ be.', source: 'Transport <affordable>.',
    required: ['Giữ affordable.'],
  },
});

const FB = (qid, over = {}) => ({
  item_id: qid, mode: 'coach', status: 'revise',
  scores: { meaning: 3, grammar: 2, task: 2, lexis: 1, mechanics: 1 }, total: 9,
  strength_vi: 'Giữ đúng ý.',
  errors: [{ code: 'SENT', dimension: 'grammar', offending_text: 'affordable',
             reason_vi: 'Thiếu be.', hint_vi: 'Thêm is.' }],
  has_more_issues: false, minimal_correction: null, optional_alternative: null,
  next_action_vi: 'Viết lại.', needs_review_reason_vi: null, ...over,
});

function api(states) {
  const calls = { get: [], post: [] };
  let n = 0;
  return {
    calls,
    async get(path) { calls.get.push(path); return states[Math.min(n++, states.length - 1)]; },
    async post(path, body) { calls.post.push({ path, body }); return {}; },
  };
}

const LAB = (over = {}) => ({
  kind: 'sentence_lab_v1', session_id: 'S01', title: 'Chẩn đoán',
  guide: null, guide_locked: true, revision_done: false, max_revision_items: 6, ...over,
});

test('form shows source, instruction and required, escaped', async () => {
  const w = createWriting({ api: api([{ questions: [ITEM('S01-Q01')], submitted: false,
    sentence_lab: LAB() }]), storage: null, userId: 'u' });
  await w.load('b1');
  const html = w.renderForm();
  assert.match(html, /Bổ sung động từ be\./);
  assert.match(html, /Transport &lt;affordable&gt;\./);
  assert.match(html, /Giữ affordable\./);
  assert.match(html, /ghi nhớ và ví dụ làm mẫu mở sau khi bạn nộp/);
  assert.ok(!html.includes('<affordable>'));
});

test('coach result lists errors and a revise box, no reference answer', async () => {
  const sub = { total: 1, clean: 0, items: [{ qid: 'S01-Q01', answer: 'Transport affordable.',
    ok: false, score: 9, feedback: FB('S01-Q01') }] };
  const w = createWriting({ api: api([{ questions: [ITEM('S01-Q01')], submitted: true,
    submission: sub, sentence_lab: LAB({ guide_locked: false }) }]), storage: null, userId: 'u' });
  await w.load('b1');
  const html = w.renderResult();
  assert.match(html, /Câu thiếu thành phần/);
  assert.match(html, /9\/10/);
  assert.match(html, /cw-revise/);
  assert.match(html, /Chốt và xem đáp án/);
  assert.ok(!html.includes('Đáp án tham khảo'));
});

test('revision caps at six and posts once, then reloads state', async () => {
  const qids = Array.from({ length: 7 }, (_, i) => `S01-Q0${i + 1}`);
  const items = qids.map((q) => ({ qid: q, answer: 'a', ok: false, score: 8, feedback: FB(q) }));
  const before = { questions: qids.map(ITEM), submitted: true,
    submission: { total: 7, clean: 0, items }, sentence_lab: LAB() };
  const after = { ...before,
    questions: qids.map((q) => ({ ...ITEM(q), explain: '**Đáp án tham khảo:** A.' })),
    submission: { total: 7, clean: 0, items: items.map((i) => ({ ...i, explain: '**Đáp án tham khảo:** A.',
      revision: i.qid === 'S01-Q01' ? { answer: 'b', feedback: FB(i.qid, { mode: 'review',
        minimal_correction: 'c' }) } : null })) },
    sentence_lab: LAB({ revision_done: true }) };
  const a = api([before, after]);
  const w = createWriting({ api: a, storage: null, userId: 'u' });
  await w.load('b1');
  qids.forEach((q) => w.writeRevision(q, 'x'));
  assert.match(w.renderReviseBar(), /disabled/);
  assert.deepEqual(await w.submitRevision(), { tooMany: true });
  w.writeRevision('S01-Q07', '');
  assert.deepEqual(await w.submitRevision(), { revised: true });
  const posts = a.calls.post.filter((c) => c.path.endsWith('/writing/revise'));
  assert.equal(posts.length, 1);
  assert.equal(Object.keys(posts[0].body.answers).length, 6);
  const html = w.renderResult();
  assert.match(html, /Đáp án tham khảo/);
  assert.match(html, /Bản sửa tối thiểu/);
  assert.ok(!html.includes('cw-revise"'));
  assert.deepEqual(await w.submitRevision(), { already: true });
});

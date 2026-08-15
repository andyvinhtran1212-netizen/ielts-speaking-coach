import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  correctAnswerText,
  normalizeQuizBank,
  normalizeQuizQuery,
  quizAreaModel,
  quizEndPayload,
  quizResultModel,
  resolveQuizBank,
  safeQuizLink,
  shuffledAnswerIndices,
  stripAudioToken,
} from '../lib/quiz-player-model.mjs';
import { QuizProgressOutbox } from '../lib/quiz-progress-outbox.mjs';

describe('native Quiz player model', () => {
  test('query identity is scalar and duplicate values fail closed', () => {
    assert.deepEqual(normalizeQuizQuery('bank=b1&skill_area=vocab'), {
      bank: 'b1', skillArea: 'vocab', topicId: null,
    });
    assert.throws(() => normalizeQuizQuery('bank=a&bank=b'), /duplicate-query:bank/);
  });

  test('bank resolution preserves explicit, one-bank, picker and empty contracts', () => {
    assert.deepEqual(resolveQuizBank({ bank: 'b1' }, null), { kind: 'bank', bankId: 'b1' });
    assert.deepEqual(resolveQuizBank({ skillArea: 'vocab' }, [{ id: 'b2' }]), { kind: 'bank', bankId: 'b2' });
    assert.equal(resolveQuizBank({ skillArea: 'vocab' }, [{ id: 'a' }, { id: 'b' }]).kind, 'redirect');
    assert.equal(resolveQuizBank({ skillArea: 'vocab', topicId: 'missing' }, []).kind, 'redirect');
    assert.equal(resolveQuizBank({ skillArea: 'vocab' }, []).kind, 'error');
  });

  test('bank and link normalization fail closed', () => {
    assert.equal(normalizeQuizBank({ bank: {}, questions: [] }), null);
    assert.equal(normalizeQuizBank({ bank: {}, questions: [{ qid: 'q1' }] }), null);
    assert.equal(normalizeQuizBank({ bank: {}, questions: [{ qid: 'q1', item_key: 'word', input: 'choice' }] }).questions.length, 1);
    assert.equal(normalizeQuizBank({ bank: {}, questions: [{ qid: 'q1', item_key: 'word', input: 'match' }] }), null);
    assert.equal(safeQuizLink('javascript:alert(1)'), null);
    assert.equal(safeQuizLink('/\\evil.example/path'), null);
    assert.equal(safeQuizLink('/grammar/articles'), '/grammar/articles');
    assert.equal(safeQuizLink('https://example.com/a'), 'https://example.com/a');
  });

  test('copy, answer and result models preserve grammar and canonical totals', () => {
    assert.equal(quizAreaModel({ bank: { skill_area: 'grammar' } }).backHref, '/grammar');
    assert.equal(stripAudioToken('Choose **{{audio}}** now'), 'Choose now');
    assert.equal(correctAnswerText({ input: 'boolean', answer: 1 }), 'Đúng');
    assert.deepEqual(quizResultModel({ total_questions: 3, total_correct: 2, total_wrong: 1 }, 61.4, false), {
      durationSeconds: 61,
      totalQuestions: 3,
      totalCorrect: 2,
      totalWrong: 1,
      mastered: 0,
      total: 0,
      accuracy: 67,
      carriedKeys: [],
      hardest: null,
      saved: false,
    });
    assert.equal(quizEndPayload({ total_questions: 1 }, 5, false).ended_by, 'paused');
  });

  test('answer permutation is deterministic without changing original indices', () => {
    const first = shuffledAnswerIndices(6, 'session:q1');
    assert.deepEqual(first, shuffledAnswerIndices(6, 'session:q1'));
    assert.deepEqual([...first].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
  });
});

describe('Quiz progress outbox', () => {
  test('serializes writes, retains failed chunks and removes only acknowledged rows', async () => {
    const batches = [
      { attempts: [{ client_id: 'a1' }], word_stats: [{ item_key: 'one', status: 'testing' }] },
      { attempts: [{ client_id: 'a2' }], word_stats: [{ item_key: 'one', status: 'mastered' }] },
      { attempts: [], word_stats: [] },
      { attempts: [], word_stats: [] },
    ];
    const payloads = [];
    let calls = 0;
    const outbox = new QuizProgressOutbox({
      sessionId: 'session-1',
      engine: { drainBatch: () => batches.shift() || { attempts: [], word_stats: [] } },
      api: { post: async (_path, body) => { payloads.push(body); calls += 1; if (calls === 1) throw new Error('offline'); } },
    });
    assert.equal(await outbox.flush(true), false);
    assert.equal(await outbox.flush(true), true);
    assert.deepEqual(payloads[1].attempts.map((row) => row.client_id), ['a1', 'a2']);
    assert.equal(payloads[1].word_stats[0].status, 'mastered');
    assert.equal(outbox.keepalivePayload(), null);
  });

  test('review mode drains engine but never persists or emits keepalive data', async () => {
    let posts = 0;
    let drains = 0;
    const outbox = new QuizProgressOutbox({
      sessionId: 'session-1', review: true,
      engine: { drainBatch: () => { drains += 1; return { attempts: [{ client_id: 'x' }], word_stats: [] }; } },
      api: { post: async () => { posts += 1; } },
    });
    assert.equal(await outbox.flush(true), true);
    assert.equal(outbox.keepalivePayload(), null);
    assert.ok(drains >= 1);
    assert.equal(posts, 0);
  });
});

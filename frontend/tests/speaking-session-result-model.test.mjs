import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSessionResult,
  grammarResources,
  parseFeedback,
  reliabilityNote,
  safeMediaUrl,
  topFixes,
  transcriptSegments,
} from '../lib/speaking-session-result-model.mjs';

const question = (id, text = `Question ${id}`) => ({ id, question_text: text });
const response = (questionId, feedback, extra = {}) => ({
  id: `r-${questionId}`,
  question_id: questionId,
  grading_status: 'completed',
  feedback,
  ...extra,
});

describe('native session-result view model — canonical truth', () => {
  test('session aggregate columns win over stale response feedback', () => {
    const view = buildSessionResult({
      id: 's1',
      status: 'completed',
      overall_band: 7,
      band_fc: 7.5,
      band_lr: 7,
      band_gra: 6.5,
      band_p: 7,
      questions: [question('q1')],
      responses: [response('q1', {
        band_fc: 4, band_lr: 4, band_gra: 4, band_p: 4,
      })],
    });
    assert.equal(view.overall, 7);
    assert.deepEqual(view.bands, { fc: 7.5, lr: 7, gra: 6.5, p: 7 });
  });

  test('a deliberate canonical null is not filled from raw response feedback', () => {
    const view = buildSessionResult({
      id: 's1', status: 'completed', overall_band: 6.5,
      band_fc: 7, band_lr: 6.5, band_gra: 6, band_p: null,
      questions: [question('q1')],
      responses: [response('q1', { band_fc: 5, band_lr: 5, band_gra: 5, band_p: 8 })],
    });
    assert.deepEqual(view.bands, { fc: 7, lr: 6.5, gra: 6, p: null });
  });

  test('does not fabricate overall score for an unfinished session', () => {
    const view = buildSessionResult({
      id: 's1',
      status: 'in_progress',
      overall_band: null,
      questions: [question('q1')],
      responses: [response('q1', { band_fc: 8, band_lr: 8, band_gra: 8, band_p: 8 })],
    });
    assert.equal(view.isCompleted, false);
    assert.equal(view.overall, null);
    assert.deepEqual(view.bands, { fc: null, lr: null, gra: null, p: null });
  });

  test('class-assignment results return to canonical My Class context', () => {
    const classView = buildSessionResult({
      id: 'class-session', status: 'completed', class_assignment_item_id: 'item-1',
      class_task: { item_id: 'item-1', title: 'Course 3 · Buổi 3 · Part 1' },
      questions: [], responses: [],
    });
    assert.equal(classView.returnHref, '/my-class');
    assert.equal(classView.returnLabel, 'Về lớp học');
    assert.equal(classView.contextLabel, 'Bài tập theo buổi');

    const freeView = buildSessionResult({
      id: 'free-session', status: 'completed', questions: [], responses: [],
    });
    assert.equal(freeView.returnHref, '/speaking');
    assert.equal(freeView.contextLabel, 'Speaking');
  });

  test('completed legacy rows can fall back per criterion without replacing canonical overall', () => {
    const view = buildSessionResult({
      id: 'legacy',
      status: 'completed',
      overall_band: 6,
      questions: [question('q1')],
      responses: [response('q1', { band_fc: 6.2, band_lr: 5.8, band_gra: 5.4 })],
    });
    assert.equal(view.overall, 6);
    assert.deepEqual(view.bands, { fc: 6, lr: 6, gra: 5.5, p: null });
  });

  test('legacy aggregate and per-question pill prefer persisted final pronunciation band', () => {
    const view = buildSessionResult({
      id: 'legacy-p', status: 'completed', overall_band: 6.5,
      questions: [question('q1')],
      responses: [response('q1', {
        band_fc: 6, band_lr: 6, band_gra: 6, band_p: 4,
      }, { final_band_p: 7 })],
    });
    assert.equal(view.bands.p, 7);
    assert.deepEqual(
      view.cards[0].bandPills.find((pill) => pill.key === 'p'),
      { key: 'p', label: 'P', value: 7 },
    );
  });

  test('legacy fallback requires every persisted response to be graded successfully', () => {
    const view = buildSessionResult({
      id: 'legacy-partial', status: 'completed', overall_band: null,
      questions: [question('q1'), question('q2')],
      responses: [
        response('q1', { band_fc: 8, band_lr: 8, band_gra: 8, band_p: 8 }),
        response('q2', { _failed: true }, { grading_status: 'failed' }),
      ],
    });
    assert.deepEqual(view.bands, { fc: null, lr: null, gra: null, p: null });
  });

  test('sealed mock receipts are not rendered as unanswered questions', () => {
    const view = buildSessionResult({
      id: 'sealed',
      sitting_id: 'sit-1',
      status: 'submitted',
      questions: [question('q1')],
      responses: [],
      response_receipts: [{ id: 'r1', question_id: 'q1' }],
    });
    assert.equal(view.isSealed, true);
    assert.deepEqual(view.cards, []);
  });

  test('explicit backend seal truth works without receipt-shape inference', () => {
    const view = buildSessionResult({
      id: 'sealed', sitting_id: 'sit-1', results_sealed: true,
      status: 'submitted', questions: [question('q1')], responses: [],
    });
    assert.equal(view.isSealed, true);
    assert.deepEqual(view.cards, []);
  });

  test('dedicated audio lookup wins over authenticated session playback links', () => {
    const view = buildSessionResult({
      id: 's1', status: 'completed', questions: [question('q1'), question('q2')],
      responses: [
        response('q1', { strengths: [] }, { audio_url: 'https://old/q1' }),
        response('q2', { strengths: [] }, { audio_url: 'https://old/q2' }),
      ],
    }, null, [{ question_id: 'q1', url: 'https://signed/q1' }]);
    assert.equal(view.cards[0].audioUrl, 'https://signed/q1');
    assert.equal(view.cards[1].audioUrl, 'https://old/q2');
  });

  test('audio lookup failure is distinct from an answer without a recording', () => {
    const session = {
      id: 's1', status: 'completed', questions: [question('q1'), question('q2')],
      responses: [
        response('q1', {}, { audio_url: null, audio_lookup_failed: true }),
        response('q2', {}, { audio_url: null, audio_lookup_failed: false }),
      ],
    };
    const unavailable = buildSessionResult(session);
    assert.equal(unavailable.cards[0].audioLookupFailed, true);
    assert.equal(unavailable.cards[1].audioLookupFailed, false);
    const recovered = buildSessionResult(session, null, [{ question_id: 'q1', url: 'https://signed/q1' }]);
    assert.equal(recovered.cards[0].audioLookupFailed, false);
    assert.equal(recovered.cards[0].audioUrl, 'https://signed/q1');
  });

  test('Part 2 review keeps the complete cue card beside score and feedback', () => {
    const view = buildSessionResult({
      id: 'p2', status: 'completed', questions: [{
        id: 'q1', question_text: 'Describe a journey.',
        cue_card_bullets: ['when you went', 'who you went with'],
        cue_card_reflection: 'and explain why you remember it.',
      }],
      responses: [response('q1', { strengths: ['Clear story'] })],
    });
    assert.deepEqual(view.cards[0].cueBullets, ['when you went', 'who you went with']);
    assert.equal(view.cards[0].cueReflection, 'and explain why you remember it.');
  });

  test('media URL allowlist blocks executable schemes', () => {
    assert.equal(safeMediaUrl('javascript:alert(1)'), '');
    assert.equal(safeMediaUrl('data:text/html,boom'), '');
    assert.equal(safeMediaUrl('https://cdn.example/audio.webm'), 'https://cdn.example/audio.webm');
    assert.equal(safeMediaUrl('/audio/local.webm'), '/audio/local.webm');
  });
});

describe('native session-result view model — persisted feedback', () => {
  test('parses object/string feedback and rejects malformed/non-object shapes', () => {
    assert.deepEqual(parseFeedback({ strengths: ['x'] }), { strengths: ['x'] });
    assert.deepEqual(parseFeedback('{"strengths":["x"]}'), { strengths: ['x'] });
    assert.equal(parseFeedback('{broken'), null);
    assert.equal(parseFeedback('[1,2]'), null);
  });

  test('preserves positional highlights and skips overlapping or invalid spans', () => {
    const segments = transcriptSegments('I go school.', {
      errors: [
        { transcript_offset_start: 2, transcript_offset_end: 4, suggestion: 'went' },
        { transcript_offset_start: 3, transcript_offset_end: 8, suggestion: 'overlap' },
        { transcript_offset_start: -1, transcript_offset_end: 99, suggestion: 'invalid' },
      ],
    });
    assert.deepEqual(segments.map(({ kind, text }) => ({ kind, text })), [
      { kind: 'text', text: 'I ' },
      { kind: 'error', text: 'go' },
      { kind: 'text', text: ' school.' },
    ]);
  });

  test('failed persisted row remains a grading failure even when diagnostic feedback exists', () => {
    const view = buildSessionResult({
      id: 's1', status: 'completed', questions: [question('q1')],
      responses: [response('q1', { _failed: true, _reason: 'provider' }, {
        grading_status: 'failed', transcript: 'saved transcript',
      })],
    });
    assert.equal(view.cards[0].gradingFailed, true);
    assert.match(view.cards[0].statusMessage, /gặp lỗi/);
    assert.equal(view.cards[0].transcript[0].text, 'saved transcript');
  });

  test('practice card uses pronunciation-adjusted per-response band and coaching fields', () => {
    const view = buildSessionResult({
      id: 's1', status: 'completed', overall_band: 6,
      questions: [question('q1')],
      responses: [response('q1', {
        overall_band: 5.5,
        strengths: ['Clear idea'],
        grammar_issues: ['Missing article'],
        vocabulary_issues: ['Use a precise noun'],
        sample_answer: 'Sample',
      }, { final_overall_band: 6 })],
    });
    assert.equal(view.isPractice, true);
    assert.equal(view.cards[0].bandPills[0].value, 6);
    assert.deepEqual(view.improvements, ['Missing article', 'Use a precise noun']);
    assert.match(view.takeaway, /ngữ pháp/);
  });

  test('unfinished practice session does not synthesize a whole-session takeaway', () => {
    const view = buildSessionResult({
      id: 's1', status: 'in_progress', questions: [question('q1')],
      responses: [response('q1', { grammar_issues: ['Missing article'] })],
    });
    assert.equal(view.isPractice, true);
    assert.equal(view.takeaway, '');
  });
});

describe('native session-result grammar resources', () => {
  test('canonical persisted recommendation wins and is deduped', () => {
    const rec = {
      issue: 'Missing article', slug: 'articles', category: 'foundations',
      title: 'Articles', anchor: 'rules', rec_id: 'rec-1',
    };
    const responses = [
      response('q1', { grammar_recommendations: [rec], grammar_issues: ['present simple'] }),
      response('q2', { grammar_recommendations: [rec] }),
    ];
    const resources = grammarResources(responses, null);
    assert.equal(resources.length, 1);
    assert.equal(resources[0].source, 'canonical');
    assert.equal(resources[0].recId, 'rec-1');
    assert.equal(resources[0].anchor, 'rules');
  });

  test('keyword matching remains an explicit fallback only when backend recs are absent', () => {
    const resources = grammarResources([
      response('q1', { grammar_issues: ['Present perfect usage is incorrect'] }),
    ], null);
    assert.equal(resources[0].slug, 'present-perfect');
    assert.equal(resources[0].source, 'fallback');
  });

  test('malformed canonical recommendations suppress client keyword guessing', () => {
    const resources = grammarResources([
      response('q1', {
        grammar_issues: ['Present perfect usage is incorrect'],
        grammar_recommendations: [{ issue: 'x', slug: 'unknown-without-category' }],
      }),
    ], null);
    assert.deepEqual(resources, []);
  });
});

describe('native session-result view model — R3 top fixes', () => {
  const practice = (extra = {}) => ({ grammar_issues: [], vocabulary_issues: [], ...extra });
  const completed = (responses, extra = {}) => buildSessionResult({
    id: 's1',
    status: 'completed',
    overall_band: 6,
    questions: responses.map((_, index) => question(`q${index + 1}`)),
    responses,
    ...extra,
  });

  test('a correction repeated in two practice answers ranks first and keeps its explanation', () => {
    const fixes = topFixes([
      response('q1', practice({
        grammar_issues: ['Thiếu mạo từ'],
        corrections: [{ original: 'I go there yesterday', corrected: 'I went there yesterday', explanation: 'Quá khứ đơn' }],
      })),
      response('q2', practice({
        vocabulary_issues: ['Lặp từ "good"'],
        corrections: [{ original: 'i go  there yesterday', corrected: 'I went there yesterday ', explanation: '' }],
      })),
    ]);
    assert.deepEqual(fixes[0], {
      text: 'I go there yesterday → I went there yesterday',
      detail: 'Quá khứ đơn',
      count: 2,
    });
    assert.deepEqual(fixes.slice(1).map((fix) => fix.text), ['Thiếu mạo từ', 'Lặp từ "good"']);
  });

  test('equal answer counts tie-break correction > grammar > vocabulary > improvements', () => {
    const fixes = topFixes([
      response('q1', practice({
        improvements: ['Nói dài hơn'],
        vocabulary_issues: ['Từ vựng đơn giản'],
        grammar_issues: ['Sai thì'],
        corrections: [{ original: 'a', corrected: 'b' }],
      })),
    ]);
    assert.deepEqual(fixes.map((fix) => fix.text), ['a → b', 'Sai thì', 'Từ vựng đơn giản']);
    assert.ok(fixes.every((fix) => fix.count === 1 && !('detail' in fix)));
  });

  test('same source and count tie-break by first position in question then array order', () => {
    const fixes = topFixes([
      response('q1', practice({ grammar_issues: ['B', 'A'] })),
      response('q2', practice({ grammar_issues: ['C', 'D'] })),
    ]);
    assert.deepEqual(fixes.map((fix) => fix.text), ['B', 'A', 'C']);
  });

  test('a repeat inside one answer counts once; text shared across sources takes the best priority', () => {
    const fixes = topFixes([
      response('q1', practice({ grammar_issues: ['X', 'x'], improvements: ['Y'] })),
      response('q2', { improvements: ['Y', 'Z'] }),
      response('q3', practice({ vocabulary_issues: ['Z'], grammar_issues: ['Z '] })),
    ]);
    // Z appears as a grammar issue in q3, so it outranks Y (improvements only).
    assert.deepEqual(fixes, [
      { text: 'Z', count: 2 },
      { text: 'Y', count: 2 },
      { text: 'X', count: 1 },
    ]);
  });

  test('test mode with only improvements still yields fixes', () => {
    const view = completed([
      response('q1', { band_fc: 6, improvements: ['Mở rộng ý', 'Dùng từ nối'] }),
      response('q2', { band_fc: 6, improvements: ['Dùng từ nối'] }),
    ], { mode: 'test_part' });
    assert.equal(view.isPractice, false);
    assert.deepEqual(view.topFixes, [
      { text: 'Dùng từ nối', count: 2 },
      { text: 'Mở rộng ý', count: 1 },
    ]);
  });

  test('fewer than three items shows what exists; no items yields []', () => {
    assert.deepEqual(topFixes([response('q1', practice({ grammar_issues: ['Only'] }))]), [
      { text: 'Only', count: 1 },
    ]);
    assert.deepEqual(completed([response('q1', practice({ strengths: ['Tốt'] }))]).topFixes, []);
    assert.deepEqual(topFixes([]), []);
  });

  test('never more than three', () => {
    const fixes = topFixes([response('q1', practice({ grammar_issues: ['1', '2', '3', '4', '5'] }))]);
    assert.deepEqual(fixes.map((fix) => fix.text), ['1', '2', '3']);
  });

  test('unfinished or sealed sessions yield no fixes', () => {
    const responses = [response('q1', practice({ grammar_issues: ['Sai thì'] }))];
    assert.deepEqual(completed(responses, { status: 'in_progress' }).topFixes, []);
    assert.deepEqual(completed(responses, { results_sealed: true }).topFixes, []);
    assert.equal(completed(responses).topFixes.length, 1);
  });

  test('failed and unparseable responses are skipped', () => {
    const fixes = topFixes([
      response('q1', { _failed: true, improvements: ['Từ phản hồi lỗi'] }),
      response('q2', '{not json'),
      response('q3', { improvements: ['Từ status failed'] }, { grading_status: 'failed' }),
      response('q4', JSON.stringify({ improvements: ['Hợp lệ'] })),
    ]);
    assert.deepEqual(fixes, [{ text: 'Hợp lệ', count: 1 }]);
  });

  test('NFD and NFC spellings of the same Vietnamese text merge', () => {
    const nfc = 'Phát âm đuôi -ed';
    const nfd = nfc.normalize('NFD');
    assert.notEqual(nfc, nfd);
    const fixes = topFixes([
      response('q1', { improvements: [nfd] }),
      response('q2', { improvements: [`  ${nfc.toUpperCase()}`] }),
    ]);
    assert.deepEqual(fixes, [{ text: nfc, count: 2 }]);
  });

  test('corrections missing original or corrected are ignored', () => {
    assert.deepEqual(topFixes([response('q1', practice({
      corrections: [{ original: 'a', corrected: '' }, { corrected: 'b' }, null],
    }))]), []);
  });
});

describe('native session-result view model — reliability note', () => {
  const LOW = 'Âm thanh ghi âm có chất lượng hạn chế — điểm số và nhận xét lần này chỉ mang tính tham khảo. '
    + 'Hãy thử ghi âm lại ở nơi yên tĩnh hơn hoặc nói to và rõ hơn để nhận được đánh giá chính xác hơn.';
  const MEDIUM = 'Một số phần nhận xét có thể cần xem như gợi ý tham khảo — chất lượng âm thanh hoặc tốc độ nói '
    + 'có thể ảnh hưởng nhẹ đến độ chính xác của đánh giá.';
  const r = (extra) => response('q', {}, extra);

  test('low beats medium and high', () => {
    assert.deepEqual(
      reliabilityNote([r({ score_confidence: 'high' }), r({ score_confidence: 'low' }), r({ score_confidence: 'medium' })]),
      { level: 'low', message: LOW },
    );
  });

  test('medium beats high', () => {
    assert.deepEqual(
      reliabilityNote([r({ score_confidence: 'high' }), r({ score_confidence: 'medium' })]),
      { level: 'medium', message: MEDIUM },
    );
  });

  test('all high, missing or unknown values give null', () => {
    assert.equal(reliabilityNote([r({ score_confidence: 'high' })]), null);
    assert.equal(reliabilityNote([r({})]), null);
    assert.equal(reliabilityNote([r({ score_confidence: 'constructor' })]), null);
    assert.equal(reliabilityNote([]), null);
  });

  test('assessment_confidence is the fallback when score_confidence is empty', () => {
    assert.equal(reliabilityNote([r({ score_confidence: null, assessment_confidence: 'low' })]).level, 'low');
    assert.equal(reliabilityNote([r({ score_confidence: '', assessment_confidence: 'medium' })]).level, 'medium');
    assert.equal(reliabilityNote([r({ score_confidence: 'high', assessment_confidence: 'low' })]), null);
  });

  test('wording matches the practice.js reliability copy verbatim', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../public/js/practice.js', import.meta.url), 'utf8');
    const start = source.indexOf('function _nativeReliabilityView');
    const body = source.slice(start, source.indexOf('\n  }\n', start));
    const joined = [...body.matchAll(/'([^']*)'/g)].map((m) => m[1]).join('');
    assert.ok(joined.includes(LOW), 'low copy drifted from practice.js');
    assert.ok(joined.includes(MEDIUM), 'medium copy drifted from practice.js');
  });

  test('buildSessionResult exposes the note and drops it for sealed sessions', () => {
    const session = {
      id: 's1', status: 'completed', questions: [question('q1')],
      responses: [response('q1', {}, { score_confidence: 'medium' })],
    };
    assert.equal(buildSessionResult(session).reliabilityNote.level, 'medium');
    assert.equal(buildSessionResult({ ...session, results_sealed: true }).reliabilityNote, null);
  });
});

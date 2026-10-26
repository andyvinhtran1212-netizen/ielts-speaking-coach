/** Actual parser wire + actual complete bank engine; no scorer or credit doubles. */
import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createEngine} from '../public/js/quiz-engine.js';
import {validateQuizTextMatchPolicy} from '../public/js/quiz-text-match-policy.js';

const wireBytes = readFileSync(new URL('./fixtures/grammar-exact-form-banks.json', import.meta.url));
const fixture = JSON.parse(wireBytes);
const controls = JSON.parse(readFileSync(new URL('./fixtures/grammar-exact-form-controls.json', import.meta.url)));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const banks = new Map(fixture.banks.map((bank) => [bank.code, bank]));

test('wire is the byte-exact real parser export, bound to all18 approved sources', () => {
  assert.equal(hash(wireBytes), '934530a72aeeb9c0a0e94cc656051bd88801db695e3a8ec14c5fa8624f03b735');
  assert.equal(fixture.provenance.approved_source_manifest_sha256, '004ce84fab271f98d2ae9c5d89c2e958b1038890cc2a931129cd529d50125b3e');
  assert.equal(controls.provenance.approved_source_manifest_sha256, fixture.provenance.approved_source_manifest_sha256);
  assert.equal(controls.provenance.academic_frame_sha256, 'd4505ca8685299454778126ab26cd4ca75a445b36c840d35ac1a6c66a62c7cf5');
  assert.equal(fixture.provenance.source_files.length, 18);
  for (const source of fixture.provenance.source_files) {
    const approved = JSON.parse(readFileSync(new URL('../../specs/0019-grammar-audit-remediation/source-scope.json', import.meta.url),'utf8')).source_files.find((f) => f.path === source.path);
    if (approved) assert.equal(approved.before_sha256, source.sha256, source.path);
    assert.equal(hash(readFileSync(new URL('../../' + source.path, import.meta.url))), approved?.after_sha256 ?? source.sha256, source.path);
  }
  for (const bank of fixture.banks) {
    assert.equal(hash(bank.raw_source), bank.raw_source_sha256);
    assert.deepEqual(bank.meta, bank.metadata.meta);
  }
});

test('actual bank-local selection is49 exact/9 legacy among264 questions', () => {
  assert.equal(banks.size, 12);
  let questions = 0, exact = 0, legacy = 0, accepts = 0;
  const covered = new Set(controls.controls.map((row) => `${row.code}/${row.qid}`));
  assert.equal(covered.size, 58);
  for (const bank of fixture.banks) {
    const policy = validateQuizTextMatchPolicy(bank.meta, bank.questions);
    questions += bank.questions.length;
    for (const question of bank.questions.filter((q) => q.input === 'text')) {
      accepts += question.accept.length;
      const selected = Object.hasOwn(policy.byQid, question.qid);
      if (selected) { assert.equal(policy.byQid[question.qid], 'exact'); exact++; } else legacy++;
      assert.ok(covered.has(`${bank.code}/${question.qid}`));
    }
  }
  assert.deepEqual({questions, exact, legacy, accepts}, {questions: 264, exact: 49, legacy: 9, accepts: 85});
});

function incorrectAnswer(question) {
  if (question.input === 'boolean') return !(question.answer === 1 || question.answer === true);
  if (question.input === 'choice' || question.input === 'syllable') return -1;
  return '';
}

// Keep the WHOLE authored map, META and question order. Wrong preceding items
// prevent earlier mastery from suppressing the specific question under test.
function answerNamedQuestion(bank, qid, answer) {
  const engine = createEngine({meta: bank.meta, questions: bank.questions});
  for (let step = 0; step < bank.questions.length * 2; step++) {
    const next = engine.next();
    assert.ok(next, `${bank.code}/${qid} must be reachable under actual mastery/cooldown`);
    if (next.question.qid === qid) {
      const result = engine.submit(answer);
      const batch = engine.drainBatch();
      const attempt = batch.attempts.at(-1);
      const stats = batch.word_stats.find((word) => word.item_key === next.question.item_key);
      assert.equal(attempt.qid, qid);
      assert.ok(stats);
      return {result, attempt, stats};
    }
    engine.submit(incorrectAnswer(next.question));
  }
  assert.fail(`${bank.code}/${qid} was not reached`);
}

let positiveCount = 0, exactNegativeCount = 0, legacyCount = 0;
for (const row of controls.controls) {
  const bank = banks.get(row.code);
  const question = bank.questions.find((q) => q.qid === row.qid);
  assert.ok(question);
  assert.equal(question.input, 'text');
  assert.equal(Object.hasOwn(bank.meta.text_match_by_qid || {}, row.qid), row.mode === 'exact');
  describe(`${row.code}/${row.qid}`, () => {
    for (const [index, accepted] of question.accept.entries()) {
      const variants = [accepted, `  ${accepted}  `];
      if (accepted !== ';') variants.push(accepted.toUpperCase(), `"${accepted.replaceAll(' ', '   ')}."`);
      for (const [variant, answer] of variants.entries()) {
        positiveCount++;
        test(`authored alternative${index + 1}/normalization${variant + 1}`, () => {
          const actual = answerNamedQuestion(bank, row.qid, answer);
          assert.equal(actual.result.correct, true);
          assert.equal(actual.result.corrected, null);
          assert.equal(actual.attempt.is_correct, true);
          assert.equal(actual.attempt.answer_given, answer);
          assert.equal(actual.stats.correct_count, 1);
          assert.equal(actual.stats.credit_count, 1);
          assert.equal(actual.stats.production_done, true);
          assert.deepEqual(actual.stats.skills_passed, [question.skill]);
        });
      }
    }
    for (const [index, expected] of row.negative_or_legacy_cases.entries()) {
      if (row.mode === 'exact') exactNegativeCount++; else legacyCount++;
      test(`${row.mode} academic control${index + 1}: ${expected.answer}`, () => {
        const actual = answerNamedQuestion(bank, row.qid, expected.answer);
        assert.equal(actual.result.correct, expected.correct);
        assert.equal(actual.attempt.is_correct, expected.correct);
        assert.equal(actual.attempt.answer_given, expected.answer);
        assert.equal(actual.stats.credit_count, expected.correct ? 1 : 0);
        assert.equal(actual.stats.production_done, expected.correct);
        assert.equal(actual.stats.correct_count, expected.correct ? 1 : 0);
        if (!expected.correct) {
          assert.equal(actual.result.mastered, false);
          assert.equal(actual.stats.provisional_skill, null);
          assert.deepEqual(actual.stats.skills_passed, []);
        }
      });
    }
  });
}

test('all planned academic controls executed without an omitted named qid', () => {
  assert.deepEqual({positiveCount, exactNegativeCount, legacyCount}, {positiveCount: 338, exactNegativeCount: 49, legacyCount: 11});
});

for (const bank of fixture.banks) describe(`${bank.code}: original choice/boolean keys`, () => {
  for (const question of bank.questions.filter((q) => q.input !== 'text')) test(question.qid, () => {
    const answer = question.input === 'boolean' ? (question.answer === 1 || question.answer === true) : question.answer;
    const actual = answerNamedQuestion(bank, question.qid, answer);
    assert.equal(actual.result.correct, true);
    assert.equal(actual.attempt.is_correct, true);
    assert.equal(actual.attempt.answer_given, String(answer));
  });
});

import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {realpathSync} from 'node:fs';
import {createEngine, gradeText, normalizeText} from '../public/js/quiz-engine.js';
import {createEngine as aliasEngine} from '../js/quiz-engine.js';
import {canonicalQuizBankPolicy, validateQuizTextMatchPolicy, quizTextMatchMode} from '../public/js/quiz-text-match-policy.js';

const question = (extra = {}) => ({qid: 'q1', item_key: 'item', input: 'text', type: 'gap_text', skill: 'production', accept: ['environment'], ...extra});
const bank = (mode, q = question()) => ({
  meta: {correct_to_master: 1, require_distinct_skill: false, ...(mode === undefined ? {} : {text_match_by_qid: {[q.qid]: mode}})},
  questions: [q],
});
const submit = (payload, answer) => {
  const engine = createEngine(payload);
  assert.ok(engine.next());
  const result = engine.submit(answer);
  return {result, batch: engine.drainBatch(), summary: engine.summary()};
};
const invalid = (fn) => assert.throws(fn, (error) => error.code === 'quiz_text_match_policy_invalid');

test('alias and deployed owner are one tracked implementation', () => {
  assert.equal(realpathSync(new URL('../js/quiz-engine.js', import.meta.url)), realpathSync(new URL('../public/js/quiz-engine.js', import.meta.url)));
  assert.equal(aliasEngine, createEngine);
});

test('exact mode uses every accepted alternative and current normalization', () => {
  const q = question({accept: ["doesn't work", 'does not work']});
  for (const answer of ["doesn't work", 'does not work', '  DOES NOT   WORK.  ', '"doesn\'t work!"']) {
    const {result, batch} = submit(bank('exact', q), answer);
    assert.equal(result.correct, true);
    assert.equal(result.corrected, null);
    assert.equal(batch.attempts[0].is_correct, true);
    assert.equal(batch.word_stats[0].credit_count, 1);
    assert.equal(batch.word_stats[0].production_done, true);
  }
  assert.equal(normalizeText(" don't "), "don't");
  assert.equal(submit(bank('exact', q), 'doesnt work').result.correct, false);
});

test('exact failure remains an attempt/wrong count without production, credit or mastery', () => {
  const {result, batch, summary} = submit(bank('exact'), 'enviroment');
  assert.equal(result.correct, false);
  assert.equal(result.corrected, null);
  assert.equal(result.mastered, false);
  assert.equal(batch.attempts[0].is_correct, false);
  assert.equal(batch.attempts[0].answer_given, 'enviroment');
  assert.equal(batch.word_stats[0].correct_count, 0);
  assert.equal(batch.word_stats[0].wrong_count, 1);
  assert.equal(batch.word_stats[0].credit_count, 0);
  assert.equal(batch.word_stats[0].production_done, false);
  assert.equal(batch.word_stats[0].provisional_skill, null);
  assert.equal(summary.total_correct, 0);
  assert.equal(summary.total_wrong, 1);
});

test('wrong exact production clears provisional rather than confirming it', () => {
  const payload = bank('exact');
  const engine = createEngine(payload, {resume: [{item_key: 'item', provisional_skill: 'recognition', skills_passed: [], credit_count: 0}]});
  engine.next();
  assert.equal(engine.submit('enviroment').mastered, false);
  const stats = engine.drainBatch().word_stats[0];
  assert.deepEqual(stats.skills_passed, []);
  assert.equal(stats.credit_count, 0);
  assert.equal(stats.production_done, false);
  assert.equal(stats.provisional_skill, null);
});

const legacyCases = [
  ['recall deletion', {}, 'enviroment', true],
  ['recall substitution', {}, 'environmemt', true],
  ['recall insertion', {}, 'environmentt', true],
  ['two edits', {}, 'enviromnt', false],
  ['first character', {}, 'invironment', false],
  ['leading deletion', {}, 'nvironment', false],
  ['short minimal pair', {accept: ['cat']}, 'cut', false],
  ['single spelling', {type: 'spelling'}, 'enviroment', false],
  ['single missing letters', {type: 'missing_letters'}, 'enviroment', false],
  ['long spelling phrase', {type: 'spelling', accept: ['climb the corporate ladder']}, 'climb the corporate laddr', true],
  ['long missing letters phrase', {type: 'missing_letters', accept: ['climb the corporate ladder']}, 'climb the corporate laddr', true],
  ['short spelling phrase', {type: 'spelling', accept: ['in the red']}, 'in the bed', false],
  ['short alternative keeps orthography', {type: 'spelling', accept: ['corporate social responsibility', 'csr']}, 'corporate social responsibilty', false],
  ['case sensitive typo', {case_sensitive: true, accept: ['Environment']}, 'Enviroment', false],
  ['case sensitive exact', {case_sensitive: true, accept: ['Environment']}, 'Environment', true],
  ['case sensitive wrong case', {case_sensitive: true, accept: ['Environment']}, 'environment', false],
  ['punctuation only accepted', {accept: [';']}, ' ; ', true],
  ['punctuation only different', {accept: [';']}, '.', false],
  ['punctuation only empty', {accept: [';']}, '', false],
  ['legacy fuzzy accepts one interior punctuation deletion', {accept: ["don't"]}, 'dont', true],
  ['no Unicode rewrite', {}, 'ｅnvironment', false],
];
describe('absent / empty / explicit typo_tolerant preserve actual legacy outcomes', () => {
  for (const [name, extra, answer, expected] of legacyCases) test(name, () => {
    const q = question(extra);
    const absent = submit(bank(undefined, q), answer);
    const explicit = submit(bank('typo_tolerant', q), answer);
    const empty = bank(undefined, q); empty.meta.text_match_by_qid = {};
    const emptyResult = submit(empty, answer);
    for (const current of [absent, explicit, emptyResult]) {
      assert.equal(current.result.correct, expected);
      assert.equal(current.result.correct, gradeText(q, answer).correct);
      assert.equal(current.batch.word_stats[0].credit_count, expected ? 1 : 0);
    }
    assert.deepEqual(explicit.result, absent.result);
    assert.deepEqual(emptyResult.result, absent.result);
  });
});

for (const type of ['spelling', 'missing_letters']) test(`exact ${type} bypasses the long-phrase fuzzy exception`, () => {
  const q = question({type, accept: ['climb the corporate ladder']});
  assert.equal(submit(bank('exact', q), 'climb the corporate ladder').result.correct, true);
  assert.equal(submit(bank('exact', q), 'climb the corporate laddr').result.correct, false);
  assert.equal(submit(bank('typo_tolerant', q), 'climb the corporate laddr').result.correct, true);
});

test('exact matching preserves interior punctuation rather than expanding contractions', () => {
  const q = question({accept: ["don't"]});
  assert.notEqual(normalizeText("don't"), normalizeText('dont'));
  assert.equal(submit(bank('exact', q), 'dont').result.correct, false);
  assert.equal(submit(bank('typo_tolerant', q), 'dont').result.correct, true);
});

test('policy capture is immutable and bank-local, including identical qids', () => {
  const exact = bank('exact'); const tolerant = bank('typo_tolerant');
  const engine = createEngine(exact); engine.next();
  exact.meta.text_match_by_qid.q1 = 'typo_tolerant';
  assert.equal(engine.submit('enviroment').correct, false);
  assert.equal(submit(tolerant, 'enviroment').result.correct, true);
  const policy = validateQuizTextMatchPolicy(tolerant.meta, tolerant.questions);
  assert.equal(Object.getPrototypeOf(policy.byQid), null);
  assert.equal(Object.isFrozen(policy.byQid), true);
  assert.equal(policy.requiresAck, true); // Typo-only nonempty map is still opt-in.
  assert.equal(quizTextMatchMode(policy, 'toString'), undefined);
});

describe('direct invalid policy refuses the engine before any submit', () => {
  for (const [name, value] of [['null', null], ['array', []], ['string', 'exact'], ['bool', true], ['number', 1], ['nested', {q1: {mode: 'exact'}}], ['unknown value', {q1: 'strict'}], ['null value', {q1: null}], ['unknown qid', {other: 'exact'}]]) {
    test(name, () => { const payload = bank(undefined); payload.meta.text_match_by_qid = value; invalid(() => createEngine(payload)); });
  }
  for (const key of ['__proto__', 'prototype', 'constructor']) test(`reserved ${key}`, () => {
    const payload = bank(undefined, question({qid: key}));
    payload.meta.text_match_by_qid = JSON.parse(`{"${key}":"exact"}`);
    invalid(() => createEngine(payload));
  });
  for (const [name, extra] of [['choice', {input: 'choice'}], ['unsupported type', {type: 'mcq'}], ['empty accept', {accept: []}], ['blank accept', {accept: [' \u001c ']}], ['nonstring accept', {accept: [1]}]]) {
    test(name, () => invalid(() => createEngine(bank('exact', question(extra)))));
  }
  test('duplicate questions, including empty map', () => {
    for (const value of [{}, {q1: 'exact'}]) {
      const payload = bank(undefined); payload.meta.text_match_by_qid = value; payload.questions.push(question({item_key: 'other'}));
      invalid(() => createEngine(payload));
    }
  });
  test('inherited map entries and getters cannot become silent absence', () => {
    const payload = bank(undefined);
    payload.meta.text_match_by_qid = Object.create({q1: 'exact'});
    invalid(() => createEngine(payload));
    payload.meta.text_match_by_qid = {};
    Object.defineProperty(payload.meta.text_match_by_qid, 'q1', {value: 'exact'});
    invalid(() => createEngine(payload));
    let reads = 0;
    Object.defineProperty(payload.meta, 'text_match_by_qid', {get() { reads++; return {q1: 'exact'}; }});
    invalid(() => createEngine(payload));
    assert.equal(reads, 0);
  });
  test('numeric question identity is not coerced to a map key', () => invalid(() => createEngine(bank('exact', question({qid: 1})))));
  test('malformed Unicode key refuses, while a valid astral qid remains owned', () => {
    invalid(() => createEngine(bank('exact', question({qid: 'q\ud800'}))));
    assert.equal(submit(bank('exact', question({qid: 'q𐐀'})), 'environment').result.correct, true);
  });
});

const malformedAccepts = [
  ['unpaired high surrogate', ['\ud800']],
  ['unpaired low surrogate', ['\udc00']],
  ['high surrogate within a string', ['prefix\ud800suffix']],
  ['low surrogate within a string', ['prefix\udc00suffix']],
  ['malformed alternative beside a valid form', ['environment', '\ud800']],
];
describe('mapped accepted forms must be valid Unicode before engine activation', () => {
  for (const [name, accept] of malformedAccepts) {
    const q = question({accept});
    test(`${name}: direct validator`, () => {
      for (const mode of ['exact', 'typo_tolerant']) {
        const p = bank(mode, q);
        invalid(() => validateQuizTextMatchPolicy(p.meta, p.questions));
      }
    });
    test(`${name}: canonical bank META`, () => {
      for (const mode of ['exact', 'typo_tolerant']) {
        const p = bank(mode, q);
        invalid(() => canonicalQuizBankPolicy({bank: {id: 'bank-A', meta: p.meta}, questions: p.questions}, 'bank-A'));
      }
    });
    test(`${name}: engine refuses before submit`, () => {
      for (const mode of ['exact', 'typo_tolerant']) {
        const p = bank(mode, q);
        invalid(() => createEngine(p));
        invalid(() => createEngine({bank: {id: 'bank-A', meta: p.meta}, questions: p.questions}));
      }
    });
  }
  test('valid astral accepted form works in direct, canonical and engine seams', () => {
    const q = question({accept: ['valid𐐀']});
    for (const mode of ['exact', 'typo_tolerant']) {
      const p = bank(mode, q);
      assert.equal(validateQuizTextMatchPolicy(p.meta, p.questions).requiresAck, true);
      const canonical = {bank: {id: 'bank-A', meta: p.meta}, questions: p.questions};
      assert.equal(canonicalQuizBankPolicy(canonical, 'bank-A').policy.requiresAck, true);
      assert.equal(submit(p, 'valid𐐀').result.correct, true);
      assert.equal(submit(canonical, 'valid𐐀').result.correct, true);
    }
  });
  test('absent/empty unmanaged legacy accepts and two-argument helpers stay unchanged', () => {
    for (const [, accept] of malformedAccepts) {
      const q = question({accept});
      const answer = accept.at(-1);
      const absent = bank(undefined, q);
      const empty = bank(undefined, q); empty.meta.text_match_by_qid = {};
      assert.equal(validateQuizTextMatchPolicy(absent.meta, absent.questions).requiresAck, false);
      assert.equal(validateQuizTextMatchPolicy(empty.meta, empty.questions).requiresAck, false);
      assert.equal(gradeText(q, answer).correct, true);
      assert.equal(submit(absent, answer).result.correct, true);
      assert.equal(submit(empty, answer).result.correct, true);
    }
  });
});

const malformedAcceptShapes = [
  ['all holes', () => ({q: question({accept: new Array(1)}), reads: () => 0})],
  ['dense form followed by a hole', () => {
    const accept = ['runs']; accept.length = 2;
    return {q: question({accept}), reads: () => 0};
  }],
  ['nonstring with shadowed every', () => {
    let reads = 0;
    const accept = [42]; accept.every = () => { reads++; return true; };
    return {q: question({accept}), reads: () => reads};
  }],
  ['inherited array index', () => {
    const accept = new Array(1);
    const prototype = Object.create(Array.prototype); prototype[0] = 'runs';
    Object.setPrototypeOf(accept, prototype);
    return {q: question({accept}), reads: () => 0};
  }],
  ['array index accessor', () => {
    let reads = 0;
    const accept = new Array(1);
    Object.defineProperty(accept, '0', {get() { reads++; return 'runs'; }, enumerable: true});
    return {q: question({accept}), reads: () => reads};
  }],
  ...['accept', 'input', 'type', 'qid'].map((field) => [`question ${field} accessor`, () => {
    let reads = 0;
    const q = question({accept: ['runs']});
    const value = q[field];
    Object.defineProperty(q, field, {get() { reads++; return value; }, enumerable: true});
    return {q, reads: () => reads};
  }]),
];
describe('mapped forms and question identities use owned data without array hooks', () => {
  for (const [name, make] of malformedAcceptShapes) for (const seam of ['direct', 'canonical', 'engine']) {
    test(`${name}: ${seam} refuses before reading accessors or hooks`, () => {
      for (const mode of ['exact', 'typo_tolerant']) {
        const fixture = make();
        const p = {meta: {text_match_by_qid: {q1: mode}}, questions: [fixture.q]};
        const canonical = {bank: {id: 'bank-A', meta: p.meta}, questions: p.questions};
        invalid(() => seam === 'direct' ? validateQuizTextMatchPolicy(p.meta, p.questions)
          : seam === 'canonical' ? canonicalQuizBankPolicy(canonical, 'bank-A')
          : createEngine(p));
        assert.equal(fixture.reads(), 0);
      }
    });
  }
  test('valid dense alternatives remain eligible without calling overridden every', () => {
    let reads = 0;
    const accept = ['environment', 'surroundings'];
    accept.every = () => { reads++; throw new Error('array method must not validate policy'); };
    const q = question({accept});
    for (const mode of ['exact', 'typo_tolerant']) {
      const p = bank(mode, q);
      assert.equal(validateQuizTextMatchPolicy(p.meta, p.questions).requiresAck, true);
      const canonical = {bank: {id: 'bank-A', meta: p.meta}, questions: p.questions};
      assert.equal(canonicalQuizBankPolicy(canonical).policy.requiresAck, true);
      assert.equal(submit(p, 'surroundings').result.correct, true);
      assert.equal(submit(canonical, 'environment').result.correct, true);
    }
    assert.equal(reads, 0);
  });
  test('own data indices need not be writable or enumerable to be dense', () => {
    const accept = new Array(1);
    Object.defineProperty(accept, '0', {value: 'environment'});
    assert.equal(submit(bank('exact', question({accept})), 'environment').result.correct, true);
  });
  test('absent/empty unmanaged accept shapes preserve existing direct grading', () => {
    for (const [name, make] of malformedAcceptShapes.slice(0, 6)) {
      const {q} = make();
      const answer = name === 'nonstring with shadowed every' ? '42'
        : name === 'all holes' || name === 'dense form followed by a hole' ? 'undefined' : 'runs';
      for (const empty of [false, true]) {
        const p = bank(undefined, q);
        if (empty) p.meta.text_match_by_qid = {};
        assert.equal(validateQuizTextMatchPolicy(p.meta, p.questions).requiresAck, false);
        assert.equal(submit(p, answer).result.correct, gradeText(q, answer).correct);
        assert.equal(submit(p, answer).result.correct, true);
      }
    }
  });
});

const malformedQuestionShapes = [
  ['iterator hiding invalid stored forms', () => {
    let reads = 0;
    const questions = [question({accept: [null]})];
    questions[Symbol.iterator] = function* () { reads++; yield question({accept: ['runs']}); };
    return {questions, reads: () => reads};
  }],
  ['changing own slot accessor', () => {
    let reads = 0;
    const questions = new Array(1);
    Object.defineProperty(questions, '0', {get() { reads++; return question({accept: reads === 1 ? ['runs'] : [null]}); }, enumerable: true});
    return {questions, reads: () => reads};
  }],
  ['inherited question slot', () => {
    const questions = new Array(1);
    const prototype = Object.create(Array.prototype); prototype[0] = question();
    Object.setPrototypeOf(questions, prototype);
    return {questions, reads: () => 0};
  }],
  ['missing question slot', () => ({questions: new Array(1), reads: () => 0})],
];
describe('declared policy validates actual owned question slots without iterator hooks', () => {
  for (const [name, make] of malformedQuestionShapes) for (const seam of ['direct', 'canonical', 'engine']) {
    test(`${name}: ${seam} refuses without hook reads`, () => {
      for (const mode of ['exact', 'typo_tolerant']) {
        const fixture = make();
        const p = {meta: {text_match_by_qid: {q1: mode}}, questions: fixture.questions};
        const canonical = {bank: {id: 'bank-A', meta: p.meta}, questions: p.questions};
        invalid(() => seam === 'direct' ? validateQuizTextMatchPolicy(p.meta, p.questions)
          : seam === 'canonical' ? canonicalQuizBankPolicy(canonical, 'bank-A')
          : createEngine(p));
        assert.equal(fixture.reads(), 0);
      }
    });
  }
  test('valid dense question slots ignore an overridden iterator', () => {
    let reads = 0;
    const questions = [question()];
    Object.defineProperty(questions, Symbol.iterator, {get() { reads++; throw new Error('not a policy reader'); }});
    const p = {meta: {text_match_by_qid: {q1: 'exact'}}, questions};
    assert.equal(validateQuizTextMatchPolicy(p.meta, questions).requiresAck, true);
    assert.equal(submit(p, 'environment').result.correct, true);
    assert.equal(reads, 0);
  });
  test('own dense question data slots may be nonenumerable and readonly', () => {
    const questions = new Array(1);
    Object.defineProperty(questions, '0', {value: question()});
    assert.equal(submit({meta: {text_match_by_qid: {q1: 'exact'}}, questions}, 'environment').result.correct, true);
  });
});

const canonicalOwnerAccessors = ['bank', 'bank.id', 'bank.meta', 'questions', 'meta', 'bank_id', 'meta.bank_id'];
function canonicalAccessorPayload(field, mode) {
  let reads = 0;
  const meta = {text_match_by_qid: {q1: mode}};
  const p = {bank: {id: 'bank-A', meta}, questions: [question()]};
  if (field === 'meta' || field === 'meta.bank_id') p.meta = {text_match_by_qid: {q1: mode}, bank_id: 'bank-A'};
  if (field === 'bank_id') p.bank_id = 'bank-A';
  const [parent, key] = field.includes('.') ? [p[field.split('.')[0]], field.split('.')[1]] : [p, field];
  const value = parent[key];
  Object.defineProperty(parent, key, {get() {
    reads++;
    return field === 'bank.meta' && reads >= 3 ? {} : value;
  }, enumerable: true});
  return {p, reads: () => reads};
}
describe('canonical owner fields are stable own data, with no policy drift to legacy', () => {
  for (const field of canonicalOwnerAccessors) {
    test(`${field} accessor refuses canonical validation without reading it`, () => {
      for (const mode of ['exact', 'typo_tolerant']) {
        const fixture = canonicalAccessorPayload(field, mode);
        invalid(() => canonicalQuizBankPolicy(fixture.p, 'bank-A'));
        assert.equal(fixture.reads(), 0);
      }
    });
    test(`${field} accessor cannot activate a raw mapped engine`, () => {
      for (const mode of ['exact', 'typo_tolerant']) {
        const fixture = canonicalAccessorPayload(field, mode);
        invalid(() => createEngine(fixture.p));
        // Legacy-shape classification may capture the opaque owner once;
        // declared policy then requires data descriptors before activation.
        assert.ok(fixture.reads() <= 1);
      }
    });
  }
  for (const field of ['meta', 'questions']) test(`direct mapped ${field} accessor refuses before engine activation`, () => {
    for (const mode of ['exact', 'typo_tolerant']) {
      const p = bank(mode); let reads = 0;
      const value = p[field];
      Object.defineProperty(p, field, {get() { reads++; return value; }});
      invalid(() => createEngine(p));
      assert.equal(reads, field === 'meta' ? 1 : 0);
    }
  });
  test('mapped null canonical owner cannot become a direct local bank', () => {
    const p = bank('exact'); p.bank = null;
    invalid(() => createEngine(p));
  });
  test('canonical references are returned for later native owner while absent legacy priority stays', () => {
    const p = {bank: {id: 'bank-A', meta: {correct_to_master: 99}}, meta: {correct_to_master: 1}, questions: [question()]};
    const validated = canonicalQuizBankPolicy(p, 'bank-A');
    assert.equal(validated.questions, p.questions);
    assert.equal(validated.meta, p.bank.meta);
    assert.equal(submit(p, 'environment').result.mastered, true);
    assert.equal(submit({meta: validated.meta, questions: validated.questions}, 'environment').result.mastered, false);
  });
});

describe('managed consumers use validated data rather than array callbacks', () => {
  for (const shape of ['method', 'getter']) for (const raw of [false, true]) {
    test(`question forEach ${shape} cannot replace owned question in ${raw ? 'canonical' : 'direct'} engine`, () => {
      for (const mode of ['exact', 'typo_tolerant']) {
        let reads = 0;
        const q = question({accept: ['runs']});
        const questions = [q];
        const forged = (callback) => { reads++; callback({...q, accept: [null]}); };
        if (shape === 'method') questions.forEach = forged;
        else Object.defineProperty(questions, 'forEach', {get() { reads++; return forged; }});
        const meta = {correct_to_master: 1, text_match_by_qid: {q1: mode}};
        const payload = raw ? {bank: {id: 'bank-A', meta}, questions} : {meta, questions};
        const engine = createEngine(payload);
        assert.equal(engine.next().question, q);
        const result = engine.submit('null');
        const batch = engine.drainBatch();
        assert.equal(result.correct, false);
        assert.equal(result.mastered, false);
        assert.equal(batch.attempts[0].is_correct, false);
        assert.equal(batch.attempts[0].answer_given, 'null');
        assert.equal(batch.word_stats[0].credit_count, 0);
        assert.equal(batch.word_stats[0].production_done, false);
        assert.equal(reads, 0);
      }
    });
  }
  for (const type of ['spelling', 'missing_letters']) for (const shape of ['method', 'getter']) {
    test(`mapped ${type} long-phrase guard ignores ${shape} every and gives no false credit`, () => {
      let reads = 0;
      const accept = ['environment'];
      if (shape === 'method') accept.every = () => { reads++; return true; };
      else Object.defineProperty(accept, 'every', {get() { reads++; return () => true; }});
      const actual = submit(bank('typo_tolerant', question({type, accept})), 'enviroment');
      assert.equal(actual.result.correct, false);
      assert.equal(actual.result.mastered, false);
      assert.equal(actual.batch.attempts[0].is_correct, false);
      assert.equal(actual.batch.word_stats[0].credit_count, 0);
      assert.equal(actual.batch.word_stats[0].production_done, false);
      assert.equal(reads, 0);
    });
  }
  test('mapped actual long phrases retain the original orthography exception', () => {
    const accept = ['climb the corporate ladder'];
    Object.defineProperty(accept, 'every', {get() { throw new Error('not an authored form'); }});
    const q = question({type: 'spelling', accept});
    assert.equal(submit(bank('typo_tolerant', q), 'climb the corporate laddr').result.correct, true);
    assert.equal(submit(bank('exact', q), 'climb the corporate laddr').result.correct, false);
  });
  test('two-argument, absent and empty-map array hooks keep their existing legacy behavior', () => {
    const accept = ['environment']; accept.every = () => true;
    const q = question({type: 'spelling', accept});
    assert.equal(gradeText(q, 'enviroment').correct, true);
    for (const empty of [false, true]) {
      const p = bank(undefined, q);
      if (empty) p.meta.text_match_by_qid = {};
      assert.equal(submit(p, 'enviroment').result.correct, true);
      const questions = [question({accept: ['runs']})];
      questions.forEach = (callback) => callback(question({accept: [null]}));
      const meta = empty ? {text_match_by_qid: {}} : {};
      assert.equal(submit({meta, questions}, 'null').result.correct, true);
    }
  });
});

test('Python whitespace validation preserves FEFF rather than changing answer normalization', () => {
  const q = question({accept: ['\ufeff']});
  assert.equal(validateQuizTextMatchPolicy(bank('exact', q).meta, [q]).requiresAck, true);
  assert.equal(normalizeText('\ufeff'), ''); // Existing JS behavior is intentionally unchanged.
});

test('entry-count boundary200 is allowed;201 refuses', () => {
  const payload = {meta: {text_match_by_qid: {}}, questions: []};
  for (let i = 0; i < 200; i++) { const q = question({qid: `q${i}`}); payload.questions.push(q); payload.meta.text_match_by_qid[q.qid] = 'exact'; }
  assert.equal(validateQuizTextMatchPolicy(payload.meta, payload.questions).requiresAck, true);
  payload.questions.push(question({qid: 'q200'})); payload.meta.text_match_by_qid.q200 = 'exact';
  invalid(() => createEngine(payload));
});

test('canonical map boundary uses UTF-8 bytes, not JS string length', () => {
  const overhead = new TextEncoder().encode(JSON.stringify({q: 'exact'})).length;
  const remaining = 16384 - overhead;
  const qid = 'q' + 'é'.repeat(Math.floor(remaining / 2)) + 'x'.repeat(remaining % 2);
  const payload = bank('exact', question({qid}));
  assert.equal(new TextEncoder().encode(JSON.stringify(payload.meta.text_match_by_qid)).length, 16384);
  assert.equal(validateQuizTextMatchPolicy(payload.meta, payload.questions).requiresAck, true);
  const over = bank('exact', question({qid: qid + 'x'}));
  invalid(() => createEngine(over));
});

describe('canonical wire META is separate from the direct legacy seam', () => {
  const payload = () => ({bank: {id: 'bank-A', meta: {correct_to_master: 1, text_match_by_qid: {q1: 'exact'}}}, questions: [question()]});
  test('canonical owner is returned even with equivalent alternate policy', () => {
    const p = payload(); p.meta = {correct_to_master: 99, text_match_by_qid: {q1: 'exact'}};
    assert.equal(canonicalQuizBankPolicy(p, 'bank-A').meta, p.bank.meta);
    assert.equal(submit(p, 'environment').result.mastered, true);
    assert.equal(submit(p, 'enviroment').result.correct, false);
  });
  test('conflicting/absent canonical policy cannot be substituted by top-level META', () => {
    const p = payload(); p.meta = {text_match_by_qid: {q1: 'typo_tolerant'}};
    invalid(() => createEngine(p));
    delete p.bank.meta.text_match_by_qid; p.meta.text_match_by_qid.q1 = 'exact';
    invalid(() => createEngine(p));
    delete p.bank.meta;
    invalid(() => canonicalQuizBankPolicy(p));
  });
  test('wrong expected/alternate bank identity refuses', () => {
    const p = payload(); invalid(() => canonicalQuizBankPolicy(p, 'bank-B'));
    p.bank_id = 'bank-B'; invalid(() => canonicalQuizBankPolicy(p));
    delete p.bank_id; p.meta = {bank_id: 'bank-B', text_match_by_qid: {q1: 'exact'}};
    invalid(() => canonicalQuizBankPolicy(p));
  });
  test('old absent-map API META precedence and direct helpers stay unchanged', () => {
    const p = {bank: {meta: {correct_to_master: 99}}, meta: {correct_to_master: 1}, questions: [question()]};
    assert.equal(submit(p, 'enviroment').result.mastered, true);
    assert.equal(gradeText(question(), 'enviroment').correct, true);
  });
});

/** Original audit controls and real complete-bank engine/credit behavior. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createEngine} from '../public/js/quiz-engine.js';

const fixture = JSON.parse(readFileSync(new URL('fixtures/grammar-audit-banks.json', import.meta.url), 'utf8'));
const bindings = JSON.parse(readFileSync(new URL('../../backend/services/grammar_quiz_reviewed_sources.json', import.meta.url),'utf8'));
const banks = new Map(fixture.banks.map(b => [b.code,b]));
const hash = v => createHash('sha256').update(v).digest('hex');
const sorted = v => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k,sorted(v[k])])) : v;

test('all 90 active parser exports remain bound to approved raw bytes and complete manifests', () => {
  assert.equal(banks.size,90);
  assert.deepEqual(new Set(banks.keys()),new Set(Object.keys(bindings)));
  for (const bank of banks.values()) {
    const binding = bindings[bank.code].bindings[bank.source_sha256];
    assert.equal(bank.source_sha256,bindings[bank.code].active_source_sha256);
    assert.equal(hash(readFileSync(new URL(`../../docs/grammar-quiz-banks/${bank.code}.md`, import.meta.url))),bank.source_sha256);
    assert.equal(hash(JSON.stringify(sorted({metadata:bank.metadata,questions:bank.questions}))),binding.manifest_sha256);
    assert.equal(bank.manifest_sha256,binding.manifest_sha256);
  }
});

const wrong = q => q.input === 'boolean' ? !(q.answer===1 || q.answer===true) : q.input==='choice' || q.input==='syllable' ? -1 : '';
function submit(bank,qid,answer) {
  const engine=createEngine({meta:bank.metadata.meta,questions:bank.questions});
  for(let i=0;i<bank.questions.length*2;i++) {
    const next=engine.next();assert.ok(next,`${bank.code}/${qid} is reachable`);
    if(next.question.qid===qid) {
      const result=engine.submit(answer);const batch=engine.drainBatch();
      return {result,attempt:batch.attempts.at(-1),stats:batch.word_stats.find(s=>s.item_key===next.question.item_key)};
    }
    engine.submit(wrong(next.question));
  }
  assert.fail(`Unreachable ${bank.code}/${qid}`);
}
function learnerAnswer(q,answer) {
  if(q.input==='choice') return typeof answer==='number' ? answer : q.options.indexOf(answer);
  if(q.input==='boolean') {
    if(typeof answer==='boolean')return answer;
    const value=String(answer).trim().toLowerCase();
    assert.ok(['đúng','sai','true','false'].includes(value));return value==='đúng'||value==='true';
  }
  return answer;
}
for(const [i,c] of fixture.controls.entries()) test(`${c.id}/${c.qid}: ${c.kind} ${i+1}`,()=>{
  const bank=banks.get(c.code);assert.ok(bank);const q=bank.questions.find(q=>q.qid===c.qid);assert.ok(q);
  const actual=submit(bank,c.qid,learnerAnswer(q,c.answer));
  assert.equal(actual.result.correct,c.expected);
  assert.equal(actual.attempt.is_correct,c.expected);
  assert.equal(actual.stats.credit_count,c.expected && q.input==='text'?1:0);
});
for(const bank of banks.values()) for(const q of bank.questions) {
  const answers=q.input==='text'?q.accept:q.input==='boolean'?[q.answer===1 || q.answer===true]:[q.answer];
  for(const [i,answer] of answers.entries()) test(`${bank.code}/${q.qid} authored answer ${i+1}`,()=>{
    const actual=submit(bank,q.qid,answer);assert.equal(actual.result.correct,true);
    assert.equal(actual.attempt.is_correct,true);assert.equal(actual.stats.credit_count,q.input==='text'?1:0);
  });
}

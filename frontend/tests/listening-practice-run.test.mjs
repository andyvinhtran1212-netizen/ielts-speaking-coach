/**
 * frontend/tests/listening-practice-run.test.mjs
 *
 * The Luyện nhanh runner — a light, check-as-you-go surface, deliberately not
 * the exam shell.
 *
 * What is worth pinning here is the honesty of what the learner is told. The
 * runner lets you retry a question until you hear it, but the score counts the
 * FIRST answer (server-side, mig 174). That gap is where a plausible-looking UI
 * lies: a green tick on a retry next to a score that did not move reads as a
 * bug unless the copy explains it. So the verdict text, the progress dot and
 * the summary must all follow `canonical_correct`, never the retry's verdict.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  flattenQuestions, promptHtml, isChoice, verdictText, REVEAL_AFTER_WRONG,
  firstUnsettledIndex,
} from '../public/js/listening-practice-run.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', 'public', ...p), 'utf8');

const HTML = read('pages', 'listening-practice-run.html');
const JS   = read('js', 'listening-practice-run.js');


describe('question flattening', () => {
  const bundle = {
    sections: [{
      section_num: 1,
      exercises: [
        {
          payload: {
            instruction: 'Complete the notes.',
            questions: [{ q_num: 3, prompt: 'Name: ____' }, { q_num: 1, prompt: 'Age: ____' }],
          },
        },
        {
          payload: {
            instruction: 'Choose the correct letter.',
            questions: [{
              q_num: 2, prompt: 'Why did he leave?',
              options: [{ letter: 'A', text: 'Tired' }, { letter: 'B', text: 'Late' }],
            }],
          },
        },
      ],
    }],
  };

  it('orders by q_num, not by document order', () => {
    // The converter emits the completion block before the MCQs whose evidence
    // sits EARLIER in the audio, so exercise order is not question order.
    assert.deepEqual(flattenQuestions(bundle).map((q) => q.q_num), [1, 2, 3]);
  });

  it('carries each question its own exercise instruction', () => {
    const byNum = Object.fromEntries(flattenQuestions(bundle).map((q) => [q.q_num, q]));
    assert.equal(byNum[1].instruction, 'Complete the notes.');
    assert.equal(byNum[2].instruction, 'Choose the correct letter.');
  });

  it('survives an empty / malformed bundle instead of throwing', () => {
    assert.deepEqual(flattenQuestions(null), []);
    assert.deepEqual(flattenQuestions({ sections: [{ exercises: [{}] }] }), []);
    assert.deepEqual(flattenQuestions({ sections: [{ exercises: [
      { payload: { questions: [{ prompt: 'no q_num' }] } }] }] }), []);
  });

  it('picks the answer widget from the question, not the test type', () => {
    const qs = flattenQuestions(bundle);
    assert.equal(isChoice(qs.find((q) => q.q_num === 2)), true);
    assert.equal(isChoice(qs.find((q) => q.q_num === 1)), false);
  });
});


describe('prompt rendering', () => {
  it('marks the blank so the eye lands on it', () => {
    assert.match(promptHtml('Tên: ____'), /<span class="gap">/);
  });

  it('escapes markup in the prompt', () => {
    const out = promptHtml('<img src=x onerror=alert(1)>');
    assert.doesNotMatch(out, /<img/);
    assert.match(out, /&lt;img/);
  });
});


describe('verdict copy follows the canonical (first) answer', () => {
  it('right on the first try — plain confirmation', () => {
    const v = verdictText({ correct: true, canonical_correct: true });
    assert.equal(v.cls, 'is-correct');
    assert.doesNotMatch(v.html, /chưa bắt được/);
  });

  it('right on a RETRY — says the score still counts the miss', () => {
    // Without this the learner sees a tick and a dot that stays red, and
    // concludes the page is broken rather than that the rule is deliberate.
    const v = verdictText({ correct: true, canonical_correct: false });
    assert.equal(v.cls, 'is-correct');
    assert.match(v.html, /lần trả lời\s+đầu tiên/,
      'a retry-correct verdict must explain why the score did not move');
  });

  it('wrong — points at the looping audio, never at the answer', () => {
    const v = verdictText({ correct: false, canonical_correct: false });
    assert.equal(v.cls, 'is-wrong');
    assert.match(v.html, /phát lặp lại/);
  });

  it('reveal shows the key plus alternatives and the why', () => {
    const v = verdictText({
      revealed: true, expected: 'nineteen', alternatives: ['19'],
      solution: { why: 'Người nói sửa lại số.' },
    });
    assert.match(v.html, /nineteen/);
    assert.match(v.html, /19/);
    assert.match(v.html, /sửa lại số/);
  });

  it('escapes a revealed answer', () => {
    const v = verdictText({ revealed: true, expected: '<b>x</b>', alternatives: [] });
    assert.doesNotMatch(v.html, /<b>/);
  });
});


describe('runner wiring', () => {
  it('checks per question against the practice-only endpoint', () => {
    assert.match(JS, /attempts\/\$\{encodeURIComponent\(STATE\.attempt\)\}\/check/);
  });

  it('the progress dot tracks canonical_correct, not the latest try', () => {
    assert.match(JS, /STATE\.verdicts\.set\(q\.q_num, !!res\.canonical_correct\)/,
      'a dot driven by res.correct would brighten on a retry and contradict the score');
  });

  it('a fresh question clears segment mode before the learner answers', () => {
    // Starting a question already scoped to the answer window would hand over
    // WHERE to listen, which is the entire skill being drilled.
    const block = JS.split('function renderQuestion(')[1].split('function loopWindow(')[0];
    for (const attr of ['segment-start', 'segment-end', 'auto-loop']) {
      assert.match(block, new RegExp(`removeAttribute\\('${attr}'\\)`),
        `renderQuestion must clear ${attr}`);
    }
  });

  it('a miss loops that question window; a settled question stops looping', () => {
    const loop = JS.split('function loopWindow(')[1].split('function applyResult(')[0];
    assert.match(loop, /setAttribute\('auto-loop',\s*'true'\)/);
    const applied = JS.split('function applyResult(')[1].split('async function onCheck(')[0];
    assert.match(applied, /removeAttribute\('auto-loop'\)/,
      'looping must stop once the question is settled, or it nags over the next one');
  });

  it('the reveal button appears only after repeated misses', () => {
    assert.equal(REVEAL_AFTER_WRONG, 2);
    assert.match(JS, /lpr-reveal'\)\.hidden = STATE\.wrongTries < REVEAL_AFTER_WRONG/);
  });

  it('reveal asks the server; the key is never in the page', () => {
    assert.match(JS, /\{\s*q_num: q\.q_num,\s*reveal: true\s*\}/);
    // GET /tests/{id} strips answer keys, so there is nothing local to compare
    // against — any client-side "correct" check would be a reimplementation
    // that could disagree with the score.
    assert.doesNotMatch(JS, /answer_key|expectedAnswer|correctAnswer/i);
  });
});


describe('page shell', () => {
  it('is not the exam chrome', () => {
    assert.doesNotMatch(HTML, /class="exam-chrome"/);
    assert.doesNotMatch(HTML, /reading-exam-mockup\.css/);
  });

  it('loads tokens, the shared audio player and the runner module', () => {
    assert.match(HTML, /href="\/css\/aver-design\/tokens\.css"/);
    assert.match(HTML, /src="\/js\/components\/audio-player\.js"/);
    assert.match(HTML, /src="\/js\/listening-practice-run\.js"/);
    assert.match(HTML, /<audio-player id="lpr-player"/);
  });

  it('every element the runner reaches for exists in the markup', () => {
    // A renamed id would surface as a null-deref at runtime, on a page the
    // learner is mid-question on.
    // Ids the runner itself injects are exempt — but only those it can be seen
    // creating, so a typo in a static id still fails here.
    const injected = new Set(
      [...JS.matchAll(/id="([a-z0-9-]+)"/g)].map((m) => m[1]));
    const ids = [...new Set([...JS.matchAll(/\$\('([a-z0-9-]+)'\)/g)].map((m) => m[1]))]
      .filter((id) => !injected.has(id));
    assert.ok(ids.length >= 8, `expected the runner to address several ids, saw ${ids.length}`);
    for (const id of ids) {
      assert.match(HTML, new RegExp(`id="${id}"`), `markup is missing #${id}`);
    }
    assert.ok(injected.has('lpr-text'), 'the typed-answer input should be runner-injected');
  });

  it('the summary states the first-answer rule in plain Vietnamese', () => {
    assert.match(HTML, /lần trả lời đầu tiên/);
  });

  it('back link returns to the practice library', () => {
    assert.match(HTML, /href="\/listening\/practice"/);
  });

  it('uses only design tokens that exist', () => {
    const tokens = new Set([...HTML.matchAll(/var\((--av-[a-z0-9-]+)\)/g)].map((m) => m[1]));
    const defined = read('css', 'aver-design', 'tokens.css');
    for (const t of tokens) {
      assert.ok(defined.includes(`${t}:`), `undefined design token ${t}`);
    }
  });
});


describe('late / duplicate responses cannot corrupt the current question', () => {
  // Enter fires onCheck() straight from the input, so two presses launch two
  // requests. If the first settles the question and the learner advances, the
  // second arrives against a DIFFERENT question — and would mark it with the
  // previous verdict and loop the previous audio window.
  it('a check in flight blocks a second one', () => {
    assert.match(JS, /if \(STATE\.settled \|\| STATE\.checking\) return;/);
    assert.match(JS, /STATE\.checking = true;/);
    assert.match(JS, /finally \{\s*\n\s*STATE\.checking = false;/,
      'the in-flight flag must clear in finally, or one failed check wedges the page');
  });

  it('a response is discarded unless it names the question on screen', () => {
    const block = JS.split('function applyResult(')[1].split('async function onCheck(')[0];
    assert.match(block, /Number\(res\.q_num\)\s*!==\s*q\.q_num/,
      'applyResult must key off res.q_num, not just STATE.idx');
    assert.match(block, /\breturn;/, 'the mismatch must bail out, not just be noticed');
  });
});


describe('a refresh resumes the attempt instead of destroying it', () => {
  // POST /attempts is destructive by design — it abandons the open attempt and
  // mints an empty one. Calling it on every load means an ordinary refresh
  // throws away the canonical first answers, which ARE the score and cannot be
  // recovered, and leaves an abandoned row in the admin reporting. The
  // in-progress endpoint exists precisely to close this; its own docstring
  // records the bug it was written for.
  it('asks for an open attempt before starting a new one', () => {
    const boot = JS.split('async function boot(')[1];
    const iProg = boot.indexOf('/attempts/in-progress');
    const post  = boot.indexOf("/attempts`, {})");
    assert.ok(iProg !== -1, 'boot never checks for an in-progress attempt');
    assert.ok(post === -1 || iProg < post,
      'the destructive start-over must not run before the resume check');
  });

  it('only starts over when there is nothing to resume', () => {
    assert.match(JS, /if \(prior && prior\.attempt_id\) \{[\s\S]*?\} else \{[\s\S]*?\/attempts`, \{\}\)/,
      'POST /attempts must sit in the else branch');
  });

  it('resumes on the first question not yet got RIGHT', () => {
    // A stored answer is only the canonical FIRST attempt. A wrong one is
    // exactly where the runner keeps the learner — looping the audio until
    // they hear it — so "has an answer" is not "settled". Landing past it
    // skips the questions that needed the drill.
    const qs = [{ q_num: 1 }, { q_num: 2 }, { q_num: 3 }];
    const v = new Map([[1, true], [2, false]]);
    assert.equal(firstUnsettledIndex(qs, v), 1, 'a wrong first answer must be resumed, not skipped');
    assert.equal(firstUnsettledIndex(qs, new Map()), 0);
    assert.equal(firstUnsettledIndex(qs, new Map([[1, true]])), 1);
  });

  it('only a fully-correct attempt has nothing left to resume into', () => {
    const qs = [{ q_num: 1 }, { q_num: 2 }];
    assert.equal(firstUnsettledIndex(qs, new Map([[1, true], [2, true]])), qs.length);
    // …and every-question-answered-but-some-wrong must NOT auto-submit.
    assert.equal(firstUnsettledIndex(qs, new Map([[1, true], [2, false]])), 1);
    assert.match(JS, /if \(STATE\.idx >= STATE\.questions\.length\)[\s\S]{0,140}finish\(\)/,
      'a fully-correct resume lands on the summary');
  });
});


describe('audio is scoped to the question, with the whole clip one click away', () => {
  // Shipped playing the full 30–90s clip for every question, and not even
  // rewinding between them: the audio ran out during question one and from
  // question two on there was nothing to hear. Each question now owns its few
  // seconds, rewound and ready.
  it('a fresh question applies the scope instead of clearing it', () => {
    const block = JS.split('function renderQuestion(')[1].split('function applyAudioScope(')[0];
    assert.match(block, /applyAudioScope\(\)/);
    assert.match(block, /STATE\.wholeClip = false/,
      'each question must start scoped, not inherit the previous toggle');
  });

  it('scoping rewinds — an armed window the learner has already passed is silent', () => {
    const scope = JS.split('function applyAudioScope(')[1].split('function loopWindow(')[0];
    assert.match(scope, /segment-start/);
    assert.match(scope, /reset\(\)/,
      'without a rewind the player sits past the window and plays nothing');
  });

  it('scoping does NOT loop — looping is what a wrong answer earns', () => {
    const scope = JS.split('function applyAudioScope(')[1].split('function loopWindow(')[0];
    assert.match(scope, /removeAttribute\('auto-loop'\)/);
    assert.doesNotMatch(scope, /setAttribute\('auto-loop'/);
  });

  it('the toggle hides itself when the drill has no windows', () => {
    // A toggle with one reachable state is just a confusing button, and older
    // packs may carry no windows at all.
    const scope = JS.split('function applyAudioScope(')[1].split('function loopWindow(')[0];
    assert.match(scope, /btn\.hidden = !win/);
  });

  it('windows come from the practice-only endpoint, and losing them is survivable', () => {
    assert.match(JS, /\/practice-windows/);
    const boot = JS.split('async function boot(')[1];
    const at = boot.indexOf('/practice-windows');
    const guard = boot.lastIndexOf('try {', at);
    assert.ok(guard !== -1 && guard < at,
      'the window fetch must be guarded — it costs scoping, not the drill');
  });
});

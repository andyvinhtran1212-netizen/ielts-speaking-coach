import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(join(HERE, '..', 'public', 'js', 'practice.js'), 'utf8');
const SHELL = readFileSync(
  join(HERE, '..', 'app', '(authed-practice)', 'practice', 'session', 'practice-page-shell.tsx'),
  'utf8',
);

function extractFunction(name) {
  const marker = `  function ${name}(`;
  const start = JS.indexOf(marker);
  assert.notEqual(start, -1, `${name} not found`);
  const brace = JS.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = brace; index < JS.length; index += 1) {
    const char = JS[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return JS.slice(start + 2, index + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

function compileShellComponent(name) {
  const marker = `function ${name}(`;
  const start = SHELL.indexOf(marker);
  assert.notEqual(start, -1, `${name} not found`);
  const brace = SHELL.indexOf(') {', start) + 2;
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = brace; index < SHELL.length; index += 1) {
    const char = SHELL[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const source = SHELL.slice(start, index + 1);
        const compiled = ts.transpileModule(source, {
          compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
        }).outputText;
        return new Function('React', `${compiled}\nreturn ${name};`)(React);
      }
    }
  }
  throw new Error(`unterminated ${name}`);
}

const PURE_NAMES = [
  '_nativeTextList',
  '_nativeFiniteNumber',
  '_nativeBandView',
  '_nativeWarningViews',
  '_nativeReliabilityView',
  '_nativeGrammarGroups',
  '_nativeTranscriptSegments',
  '_nativeGrammarIssueViews',
  '_nativePronunciationView',
  '_nativeFeedbackDetails',
  '_nativeTestResultsView',
];

const pure = new Function('_pillColorMap', '_grammarRecHref', `
  ${PURE_NAMES.map(extractFunction).join('\n')}
  return { ${PURE_NAMES.join(', ')} };
`)(
  { FC: 'fc', LR: 'lr', GRA: 'gra', P: 'p' },
  (rec) => rec?.slug && rec?.category
    ? `/grammar/${encodeURIComponent(rec.category)}/${encodeURIComponent(rec.slug)}`
    : '',
);

describe('Speaking feedback native structured model', () => {
  test('keeps arbitrary AI/transcript text as data and React never injects HTML', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const details = pure._nativeFeedbackDetails({
      grammar_issues: [hostile],
      corrections: [{ original: hostile, corrected: '<b>safe</b>', explanation: 'raw text' }],
    });
    assert.equal(details.grammarIssues[0].text, hostile);
    assert.equal(details.corrections[0].original, hostile);
    assert.doesNotMatch(SHELL, /dangerouslySetInnerHTML/);
    assert.match(SHELL, /<Transcript segments=\{view\.feedback\.transcriptSegments\}/);
  });

  test('builds valid, non-overlapping transcript segments without HTML strings', () => {
    const transcript = 'I has <script>alert(1)</script> today.';
    const segments = pure._nativeTranscriptSegments(transcript, {
      errors: [
        { transcript_offset_start: 2, transcript_offset_end: 5, suggestion: 'have', explanation_vn: 'Chia động từ' },
        { transcript_offset_start: 3, transcript_offset_end: 8, suggestion: 'ignored overlap' },
      ],
    });
    assert.deepEqual(segments.map((segment) => segment.type), ['text', 'error', 'text']);
    assert.equal(segments[1].text, 'has');
    assert.match(segments[2].text, /<script>/);
    assert.equal(segments.some((segment) => Object.hasOwn(segment, 'html')), false);
  });

  test('never fabricates missing IELTS or Azure scores', () => {
    assert.equal(pure._nativeBandView('P', null).display, '—');
    const unavailable = pure._nativePronunciationView({ status: 'failed' }, 'response-1');
    assert.equal(unavailable.status, 'unavailable');
    assert.equal(Object.hasOwn(unavailable, 'scores'), false);

    const completed = pure._nativePronunciationView({
      status: 'completed',
      pronunciation_score: 72.4,
      fluency_score: null,
      words: [],
    }, 'response-1');
    assert.equal(completed.status, 'completed');
    assert.equal(completed.scores[0].value, 72);
    assert.equal(completed.scores[1].value, null);
  });

  test('renders and updates repeated weak-word occurrences independently', () => {
    assert.match(SHELL, /weakWords\.map\(\(entry, occurrenceIndex\) =>/);
    assert.match(SHELL, /data-drilldown-index=\{occurrenceIndex\}/);
    assert.match(SHELL, /key=\{`\$\{entry\.word\}:\$\{occurrenceIndex\}`\}/);

    const previousWindow = globalThis.window;
    globalThis.window = { PronunciationDrilldown: { PHONEME_REF: {} } };
    const errors = [];
    const previousError = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    const Accordion = compileShellComponent('PronunciationAccordion');
    const first = [
      { word: 'the', phonemes: [{ symbol: 'th', score: 38 }] },
      { word: 'the', phonemes: [{ symbol: 'dh', score: 42 }] },
    ];
    const updated = [
      { word: 'the', phonemes: [{ symbol: 'th', score: 58 }] },
      { word: 'the', phonemes: [{ symbol: 'dh', score: 62 }] },
    ];
    try {
      const initialHtml = renderToStaticMarkup(React.createElement(Accordion, { weakWords: first }));
      const updatedHtml = renderToStaticMarkup(React.createElement(Accordion, { weakWords: updated }));
      const sections = (html) => [...html.matchAll(/<details[^>]*data-drilldown-index="(\d+)"[^>]*>([\s\S]*?)<\/details>/g)];
      const initialSections = sections(initialHtml);
      const updatedSections = sections(updatedHtml);
      assert.deepEqual(initialSections.map((match) => match[1]), ['0', '1']);
      assert.match(initialSections[0][2], /38\/100/);
      assert.match(initialSections[1][2], /42\/100/);
      assert.deepEqual(updatedSections.map((match) => match[1]), ['0', '1']);
      assert.match(updatedSections[0][2], /58\/100/);
      assert.match(updatedSections[1][2], /62\/100/);
      assert.equal(errors.some((message) => /same key|unique "key"/i.test(message)), false);
    } finally {
      console.error = previousError;
      globalThis.window = previousWindow;
    }
  });

  test('coerces persisted numeric strings before averaging test results', () => {
    const model = pure._nativeTestResultsView([
      { part: 1, questionText: 'One', sessionId: 's1', response: { overall_band: '6.0', fc_feedback: 'A' } },
      { part: 1, questionText: 'Two', sessionId: 's1', response: { overall_band: '7.0', fc_feedback: 'B' } },
      { part: 1, questionText: 'Ungraded', sessionId: 's1', response: { overall_band: null } },
    ]);
    assert.equal(model.overallBand, '6.5');
    assert.equal(model.cards[2].overallBand, null);
    assert.equal(model.cards[2].kind, 'empty');
  });

  test('namespaces grammar anchors per test card so bidirectional links cannot cross cards', () => {
    const response = {
      transcript: 'I has time.',
      grammar_issues: ['agreement'],
      grammar_check: {
        errors: [{
          category: 'subject_verb_agreement',
          original_text: 'has', suggestion: 'have',
          transcript_offset_start: 2, transcript_offset_end: 5,
        }],
      },
    };
    const model = pure._nativeTestResultsView([
      { part: 1, questionText: 'One', response },
      { part: 1, questionText: 'Two', response },
    ]);
    const first = model.cards[0].grammarGroups[0].errors[0].id;
    const second = model.cards[1].grammarGroups[0].errors[0].id;
    assert.notEqual(first, second);
    assert.equal(model.cards[0].transcriptSegments.find((segment) => segment.type === 'error').id, first);
    assert.equal(model.cards[1].transcriptSegments.find((segment) => segment.type === 'error').id, second);
  });

  test('preserves warning, reliability, formal and practice payload contracts', () => {
    const formal = pure._nativeFeedbackDetails({
      fc_feedback: 'FC', lr_feedback: 'LR', gra_feedback: 'GRA',
      score_confidence: 'low', strengths: ['clear'], improvements: ['pace'],
      off_topic_verdict: { is_on_topic: false, reasoning: 'different topic' },
    });
    assert.equal(formal.kind, 'formal');
    assert.equal(formal.criteria.length, 3);
    assert.equal(formal.reliability.tone, 'low');
    assert.match(formal.warnings[0].message, /band.*giới hạn/);

    const practice = pure._nativeFeedbackDetails({ grammar_issues: [], sample_answer_status: 'unavailable' });
    assert.equal(practice.kind, 'practice');
    assert.equal(practice.sample.unavailable, true);
  });
});

describe('Speaking feedback native ownership and audio truth', () => {
  test('App Router exits through native renderer before touching legacy DOM', () => {
    const start = JS.indexOf('  function _showFeedback(data)');
    const end = JS.indexOf('  // ── Grammar Resources v3', start);
    const body = JS.slice(start, end);
    assert.ok(body.indexOf('if (_showFeedbackNative(data)) return;') < body.indexOf('_showPartialNote('));
    assert.match(JS, /_updateNativeView\('feedback'/);
    assert.match(JS, /_updateNativeView\('testResults'/);
  });

  test('review without its own audio never falls through to the latest recording blob', () => {
    const makeHarness = (recordedBlob) => new Function(`
      var _feedbackAudioUrl = 'blob:old';
      var _feedbackAudioIsBlob = true;
      var _recordedBlob = arguments[0];
      var revoked = [];
      var created = 0;
      function _revokeManagedObjectUrl(key, url) { revoked.push([key, url]); }
      function _createManagedObjectUrl() { created += 1; return 'blob:new'; }
      ${extractFunction('_prepareNativeFeedbackAudio')}
      return {
        run: _prepareNativeFeedbackAudio,
        state: function () { return { _feedbackAudioUrl, _feedbackAudioIsBlob, revoked, created }; },
      };
    `)(recordedBlob);

    const missing = makeHarness({ name: 'latest-question' });
    assert.equal(missing.run({ _review: true }), false);
    assert.equal(missing.state().created, 0);
    assert.deepEqual(missing.state().revoked, [['feedback-audio', 'blob:old']]);

    const signed = makeHarness({ name: 'latest-question' });
    assert.equal(signed.run({ _review: true, _reviewAudioUrl: 'https://signed.example/q1.webm' }), true);
    assert.equal(signed.state()._feedbackAudioUrl, 'https://signed.example/q1.webm');
    assert.equal(signed.state()._feedbackAudioIsBlob, false);
    assert.equal(signed.state().created, 0);
  });
});

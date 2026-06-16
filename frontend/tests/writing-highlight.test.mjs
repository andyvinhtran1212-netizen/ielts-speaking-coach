/**
 * writing-highlight.test.mjs — T4·1 inline error highlight (student view).
 *
 * Pins the HARD GATES: _norm parity with the Python backend, correct
 * matching (single / multi-occurrence / not-found-fallback / overlap),
 * XSS-escaping, byte-identical displayed text, and the wiring into
 * writing-result.html. The matcher is real logic, so these exercise it
 * directly (not just source-grep).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...r) => readFileSync(join(__dirname, '..', ...r), 'utf8');

// Load the browser module with a `window` param so its IIFE attaches there.
// The pure functions never touch `document`; render() only does when there
// are marks (our fake el returns none).
const code = read('js', 'writing-highlight.js');
const loader = new Function('window', 'document', code + '\n;return window.WritingHighlight;');
const WH = loader({}, undefined);

// Helper: a DOM-free element stub. querySelectorAll → [] so _attachPopover
// no-ops without a real document.
function fakeEl() {
  return {
    _h: '', _t: '',
    set innerHTML(v) { this._h = v; },
    get innerHTML() { return this._h; },
    set textContent(v) { this._t = v; this._h = ''; },
    get textContent() { return this._t; },
    querySelectorAll() { return []; },
  };
}

// Strip <mark…>…</mark> wrappers and decode entities → the displayed text.
function displayedText(html) {
  return html
    .replace(/<\/?mark[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

const CURLY = '’';   // ’
const ENDASH = '–';  // –
const EMDASH = '—';  // —


describe('writing-highlight — _norm parity with backend', () => {
  test('folds apostrophe / quote / dash variants', () => {
    assert.equal(WH._norm('don' + CURLY + 't'), "don't");
    assert.equal(WH._norm('well' + ENDASH + 'being'), 'well-being');
    assert.equal(WH._norm('a' + EMDASH + 'b'), 'a-b');
    assert.equal(WH._norm('«x»'), '"x"');         // guillemets → "
  });
  test('collapses whitespace runs and trims', () => {
    assert.equal(WH._norm('the  cat'), 'the cat');           // double space
    assert.equal(WH._norm('  cat  '), 'cat');                // leading/trailing
    assert.equal(WH._norm('a\t\nb'), 'a b');                 // tab/newline run
  });
  test('NFC composes, case is preserved (case-sensitive)', () => {
    assert.equal(WH._norm('é'), 'é');             // e + ́  → é
    assert.equal(WH._norm('The'), 'The');                    // not lowercased
  });
  test('empty / null safe', () => {
    assert.equal(WH._norm(''), '');
    assert.equal(WH._norm(null), '');
  });
});


describe('writing-highlight — matcher', () => {
  test('single match maps to the exact raw span', () => {
    const raw = 'I has a cat';
    const { spans } = WH.computeSpans(raw, [{ original: 'has', suggestion: 'have' }]);
    assert.equal(spans.length, 1);
    assert.equal(raw.slice(spans[0].rawStart, spans[0].rawEnd), 'has');
  });

  test('multi-occurrence consumes sequentially (1st, then 2nd)', () => {
    const raw = 'the the the';
    const { spans } = WH.computeSpans(raw, [
      { original: 'the' }, { original: 'the' },
    ]);
    assert.equal(spans.length, 2);
    assert.deepEqual(spans.map(s => s.rawStart), [0, 4]);    // not the 3rd
  });

  test('not-found → no span (mistake card stays as fallback)', () => {
    const { spans } = WH.computeSpans('hello world', [{ original: 'xyz' }]);
    assert.equal(spans.length, 0);
  });

  test('overlap → earlier array index wins, later skipped', () => {
    const raw = 'the big cat';
    const { spans } = WH.computeSpans(raw, [
      { original: 'big cat' },   // claims chars 4..11
      { original: 'cat' },       // overlaps → skipped
    ]);
    assert.equal(spans.length, 1);
    assert.equal(raw.slice(spans[0].rawStart, spans[0].rawEnd), 'big cat');
  });

  test('whitespace variance: original "the cat" matches raw "the  cat"', () => {
    const raw = 'the  cat';   // two spaces
    const { spans } = WH.computeSpans(raw, [{ original: 'the cat' }]);
    assert.equal(spans.length, 1);
    // span covers the raw run, byte-for-byte (incl. both spaces)
    assert.equal(raw.slice(spans[0].rawStart, spans[0].rawEnd), 'the  cat');
  });

  test('smart-quote variance: original "don\'t" matches raw curly', () => {
    const raw = 'I don' + CURLY + 't care';
    const { spans } = WH.computeSpans(raw, [{ original: "don't" }]);
    assert.equal(spans.length, 1);
    assert.equal(raw.slice(spans[0].rawStart, spans[0].rawEnd), 'don' + CURLY + 't');
  });

  test('empty original → skipped', () => {
    const { spans } = WH.computeSpans('hello', [{ original: '' }]);
    assert.equal(spans.length, 0);
  });
});


describe('writing-highlight — render: XSS + byte-identical (gates #2, #3)', () => {
  test('escapes the essay; never injects raw HTML', () => {
    const el = fakeEl();
    const raw = 'x <script>alert(1)</script> & "q" end';
    WH.render(el, raw, [{ original: 'alert', suggestion: 'a', explanation: 'e' }]);
    assert.ok(!el.innerHTML.includes('<script>'), 'no live <script>');
    assert.ok(el.innerHTML.includes('&lt;script&gt;'), 'escaped <script>');
    assert.ok(el.innerHTML.includes('&amp;'), 'escaped &');
    // the matched "alert" is wrapped
    assert.match(el.innerHTML, /<mark class="wh-mark[^"]*"[^>]*>alert<\/mark>/);
  });

  test('displayed text is byte-identical to the source essay', () => {
    const el = fakeEl();
    const raw = 'The cat <b>sat</b> on the  mat & ran.';
    WH.render(el, raw, [{ original: 'cat' }, { original: 'mat' }]);
    assert.equal(displayedText(el.innerHTML), raw);
  });

  test('attribute values are escaped (suggestion/explanation)', () => {
    const el = fakeEl();
    WH.render(el, 'a bug here', [
      { original: 'bug', suggestion: 'a"b', explanation: '<x>' },
    ]);
    assert.ok(el.innerHTML.includes('data-wh-suggestion="a&quot;b"'));
    assert.ok(el.innerHTML.includes('data-wh-explanation="&lt;x&gt;"'));
  });

  test('marks are keyboard-focusable with an accessible label (a11y)', () => {
    const el = fakeEl();
    WH.render(el, 'a bug here', [{ original: 'bug', suggestion: 's' }]);
    assert.match(el.innerHTML, /tabindex="0"/);
    assert.match(el.innerHTML, /aria-label="[^"]+"/);
    assert.match(el.innerHTML, /role="button"/);
  });

  test('fallback: render error → plain textContent, no throw (gate #1)', () => {
    const broken = {
      set innerHTML(_v) { throw new Error('boom'); },
      set textContent(v) { this._t = v; },
      get textContent() { return this._t; },
      querySelectorAll() { return []; },
    };
    const raw = 'plain essay text';
    const out = WH.render(broken, raw, [{ original: 'plain' }]);
    assert.equal(broken.textContent, raw);   // degraded to text
    assert.equal(out.error, true);
  });
});


describe('writing-highlight — wired into the student view only', () => {
  const R = read('pages', 'writing-result.html');
  const G = read('pages', 'admin', 'writing', 'grade.html');

  test('writing-result.html loads the module + css and calls render', () => {
    assert.match(R, /writing-highlight\.js/);
    assert.match(R, /writing-highlight\.css/);
    assert.match(R, /WritingHighlight\.render\(essayEl, rawEssay, fj\.mistakeAnalysis\)/);
  });
  test('admin grade.html is NOT touched (student-only scope)', () => {
    assert.doesNotMatch(G, /writing-highlight/);
  });
});

/**
 * frontend/tests/reading-l1l2-grammar-toggle.test.mjs
 *
 * reading-l1l2-grammar-toggle — the L1/L2 reading window gets a 3-toggle bar
 * (Văn bản gốc / Bài dịch / Phân tích grammar) above the passage that swaps the
 * pane between the English original, the VI translation (translation_vi), and
 * the grammar analysis (grammar_focus, NEW). Shared module covers BOTH pages.
 *
 * BEHAVIOUR test (Lesson 20): the shared module is evaluated in a node:vm
 * sandbox with a minimal DOM shim and the pane switch is actually exercised —
 * asserting the active pane changes, not merely that buttons exist. Plus static
 * sentinels for wiring, the bold formatter, graceful absence, token-clean CSS,
 * and the backend parser/storage cross-refs.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const PANES_SRC = read('frontend/js/components/reading-passage-panes.js');
const vocabJs = read('frontend/js/reading-vocab-passage.js');
const skillJs = read('frontend/js/reading-skill-exercise.js');
const vocabHtml = read('frontend/pages/reading-vocab-passage.html');
const skillHtml = read('frontend/pages/reading-skill-exercise.html');
const css = read('frontend/css/reading-vocab.css');
const parser = read('backend/services/content_import_service.py');
const studentRouter = read('backend/routers/reading_student.py');


// ── Minimal DOM shim + module loader ──────────────────────────────────

function makeEl(tag) {
  const el = {
    tagName: tag, className: '', _attrs: {}, children: [], parentNode: null,
    hidden: false, textContent: '', innerHTML: '', type: '', tabIndex: 0,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { if (on === undefined) on = !this._s.has(c); on ? this._s.add(c) : this._s.delete(c); return on; },
    },
    setAttribute(k, v) { this._attrs[k] = v; }, getAttribute(k) { return this._attrs[k]; },
    addEventListener(ev, fn) { (this._ev || (this._ev = {}))[ev] = fn; },
    _click() { if (this._ev && this._ev.click) this._ev.click(); },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c, ref) {
      c.parentNode = this;
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    },
    get nextSibling() {
      const p = this.parentNode; if (!p) return null;
      return p.children[p.children.indexOf(this) + 1] || null;
    },
  };
  return el;
}

function loadPanes() {
  const sandbox = { window: {}, document: { createElement: makeEl } };
  vm.createContext(sandbox);
  vm.runInContext(PANES_SRC, sandbox);
  return sandbox.window.ReadingPanes;
}

function mountWith(opts) {
  const ReadingPanes = loadPanes();
  const article = makeEl('article');
  const body = makeEl('div');           // the #rv-body (English original)
  article.appendChild(body);
  const controller = ReadingPanes.mount(Object.assign({ body }, opts));
  return { ReadingPanes, article, body, controller };
}

const GF = [{ point: 'Present continuous', example: 'Light **bends** through drops.',
              analysis: 'describes ongoing action', review: 'be + V-ing', tip: 'scan for -ing' }];


describe('behaviour — 3-toggle pane swap (Lesson 20)', () => {
  test('mounts the bar above the body and defaults to the original pane', () => {
    const { article, body, controller } = mountWith({ translationVi: 'A\n\nB', grammarFocus: GF });
    assert.ok(controller, 'controller returned');
    // bar inserted BEFORE the body inside the article
    assert.equal(article.children[0].className, 'rv-panes');
    assert.ok(article.children.indexOf(article.children[0]) < article.children.indexOf(body));
    assert.equal(controller.active, 'original');
    assert.equal(body.hidden, false);
    assert.equal(controller.panes.translation.hidden, true);
    assert.equal(controller.panes.grammar.hidden, true);
  });

  test('switching to "Bài dịch" hides the original and shows the VI pane', () => {
    const { body, controller } = mountWith({ translationVi: 'Đoạn một\n\nĐoạn hai', grammarFocus: GF });
    controller.showPane('translation');
    assert.equal(controller.active, 'translation');
    assert.equal(body.hidden, true);
    assert.equal(controller.panes.translation.hidden, false);
    assert.equal(controller.panes.grammar.hidden, true);
    assert.ok(controller.buttons.translation.classList.contains('is-active'));
    // VI prose split into paragraphs via textContent (XSS-safe)
    assert.equal(controller.panes.translation.children.length, 2);
    assert.equal(controller.panes.translation.children[0].textContent, 'Đoạn một');
  });

  test('a real button CLICK switches the pane (event wired, not just present)', () => {
    const { body, controller } = mountWith({ translationVi: 'X', grammarFocus: GF });
    controller.buttons.grammar._click();
    assert.equal(controller.active, 'grammar');
    assert.equal(controller.panes.grammar.hidden, false);
    assert.equal(body.hidden, true);
  });

  test('grammar example renders **bold** as <strong> (not literal **)', () => {
    const { controller } = mountWith({ grammarFocus: GF });
    const card = controller.panes.grammar.children[0];
    const example = card.children.find((c) => c.className === 'rv-gpoint__example');
    assert.match(example.innerHTML, /<strong>bends<\/strong>/);
    assert.ok(!example.innerHTML.includes('**'), 'literal ** must be gone');
  });

  test('XSS-safe: a malicious point/analysis is escaped (textContent), example escaped-then-bolded', () => {
    const evil = [{ point: '<img src=x onerror=alert(1)>', example: 'a **<b>** c', analysis: '<script>' }];
    const { controller } = mountWith({ grammarFocus: evil });
    const card = controller.panes.grammar.children[0];
    const title = card.children.find((c) => c.className === 'rv-gpoint__title');
    assert.equal(title.textContent, '<img src=x onerror=alert(1)>');   // inert via textContent
    const example = card.children.find((c) => c.className === 'rv-gpoint__example');
    assert.match(example.innerHTML, /&lt;b&gt;/);                       // escaped before bolding
    assert.ok(!/<b>/.test(example.innerHTML), 'raw tag must be escaped');
  });
});


describe('behaviour — graceful absence (don\'t break older content)', () => {
  test('no translation AND no grammar → no bar mounted (returns null)', () => {
    const { article, controller } = mountWith({ translationVi: '', grammarFocus: [] });
    assert.equal(controller, null);
    assert.ok(!article.children.some((c) => c.className === 'rv-panes'));
  });
  test('translation only → original + Bài dịch buttons, no grammar button', () => {
    const { controller } = mountWith({ translationVi: 'chỉ có dịch' });
    assert.ok(controller.buttons.original && controller.buttons.translation);
    assert.ok(!controller.buttons.grammar);
  });
  test('grammar only → original + grammar buttons, no translation button', () => {
    const { controller } = mountWith({ grammarFocus: GF });
    assert.ok(controller.buttons.original && controller.buttons.grammar);
    assert.ok(!controller.buttons.translation);
  });
  test('grammar_focus entries without a point are filtered out', () => {
    const { controller } = mountWith({ grammarFocus: [{ example: 'no point' }, { point: 'ok' }] });
    assert.equal(controller.panes.grammar.children.length, 1);
  });
});


describe('wiring — both L1 + L2 pages use the shared module', () => {
  for (const [name, js] of [['vocab', vocabJs], ['skill', skillJs]]) {
    test(`${name} JS calls ReadingPanes.mount with translation + grammar`, () => {
      assert.match(js, /window\.ReadingPanes\.mount\(\{/);
      assert.match(js, /translationVi:\s*p\.translation_vi/);
      assert.match(js, /grammarFocus:\s*p\.grammar_focus/);
      // the old standalone renderTranslation is gone (subsumed by the toggle)
      assert.ok(!/function renderTranslation/.test(js), 'renderTranslation removed');
    });
  }
  for (const [name, html] of [['vocab', vocabHtml], ['skill', skillHtml]]) {
    test(`${name} page loads the shared panes module`, () => {
      assert.match(html, /src="\/js\/components\/reading-passage-panes\.js"/);
    });
  }
  test('the three Vietnamese toggle labels are present in the module', () => {
    assert.match(PANES_SRC, /Văn bản gốc/);
    assert.match(PANES_SRC, /Bài dịch/);
    assert.match(PANES_SRC, /Phân tích grammar/);
  });
});


describe('CSS — token-clean, responsive', () => {
  test('toggle bar + panes + grammar cards styled with --av-* tokens', () => {
    assert.match(css, /\.rv-panes\s*\{/);
    assert.match(css, /\.rv-panes__btn\.is-active\s*\{[\s\S]{0,200}var\(--av-/);
    assert.match(css, /\.rv-pane--grammar\s*\{/);
    assert.match(css, /\.rv-gpoint__example\s+strong\s*\{[\s\S]{0,80}var\(--av-/);
  });
  test('responsive: buttons stack on narrow screens', () => {
    assert.match(css, /@media \(max-width: 560px\)[\s\S]{0,120}\.rv-panes__btn/);
  });
  test('no hardcoded hex in the new pane block', () => {
    const block = css.slice(css.indexOf('.rv-panes'), css.indexOf('.rv-questions'));
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(block), 'pane CSS must use tokens, not hex');
  });
});


describe('backend cross-ref — parser ingests + surfaces grammar_focus', () => {
  test('parser coerces grammar_focus + merges it into metadata (Pattern #15)', () => {
    assert.match(parser, /grammar_focus\s*=\s*_as_grammar_focus\(fm\.get\("grammar_focus"\)\)/);
    assert.match(parser, /def _as_grammar_focus/);
    assert.match(parser, /metadata\["grammar_focus"\]\s*=\s*p\.grammar_focus/);
  });
  test('student fetch surfaces grammar_focus as a top-level field', () => {
    assert.match(studentRouter, /row\["grammar_focus"\]\s*=\s*meta\.get\("grammar_focus"\)/);
  });
});

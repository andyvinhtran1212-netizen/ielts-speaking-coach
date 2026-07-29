/**
 * frontend/tests/listening-landing-counts.test.mjs
 *
 * Behaviour of the count-driven Listening landing + the browse card's mode
 * links. Both exist to close the same hole: markup that promised practice
 * material the database did not have.
 *
 * No jsdom in this repo (frontend/tests is zero-dependency), so the DOM is a
 * hand-rolled model covering exactly what the controllers touch: hidden,
 * textContent, querySelectorAll, getElementById, closest, remove.
 */

import { describe, it, before } from 'node:test';
import { strict as assert } from 'node:assert';


/* ── tiny DOM model ──────────────────────────────────────────────────── */

class El {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag;
    this.attrs = attrs;
    this.children = children;
    this.parent = null;
    this.hidden = 'hidden' in attrs;
    this.textContent = '';
    this.removed = false;
    children.forEach((c) => { c.parent = this; });
  }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
  remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  get descendants() { return this.children.flatMap((c) => [c, ...c.descendants]); }
  matches(sel) {
    if (sel.startsWith('#')) return this.attrs.id === sel.slice(1);
    const m = /^\[([\w-]+)(\^?=)?"?([^\]"]*)"?\]$/.exec(sel);
    if (!m) return false;
    const [, name, op, val] = m;
    if (!this.hasAttribute(name)) return false;
    if (!op) return true;
    const cur = String(this.getAttribute(name));
    return op === '^=' ? cur.startsWith(val) : cur === val;
  }
  querySelectorAll(sel) { return this.descendants.filter((d) => d.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) {
    let n = this;
    while (n) { if (n.matches(sel)) return n; n = n.parent; }
    return null;
  }
}

function buildDoc() {
  const card = (mode, key, sectionCard = false) => new El('a', {
    'data-mode': mode, 'data-count-key': key, hidden: '',
  }, [new El('span', { 'data-count-slot': '' })]);

  const full  = card('full-test', 'tests.full');
  const mini  = card('mini-test', 'tests.mini');
  const drill = card('skills-practice', 'tests.drill');
  const browse = card('browse', 'content');
  const lede = new El('p', { id: 'library-lede' });
  const library = new El('section', { id: 'section-library', hidden: '' }, [browse, lede]);
  const examEmpty = new El('p', { id: 'exam-empty', hidden: '' });
  const root = new El('div', {}, [full, mini, drill, library, examEmpty]);

  const byId = {};
  [...root.descendants, root].forEach((d) => { if (d.attrs.id) byId[d.attrs.id] = d; });

  return {
    root, full, mini, drill, browse, library, lede, examEmpty,
    getElementById: (id) => byId[id] || null,
    querySelectorAll: (s) => root.querySelectorAll(s),
    querySelector: (s) => root.querySelector(s),
  };
}


/* ── landing controller ──────────────────────────────────────────────── */

let landing;
before(async () => { landing = await import('../js/listening-landing.js'); });

describe('listening-landing — readCount', () => {
  it('resolves dotted paths and treats missing/zero/negative as 0', () => {
    const ov = { tests: { full: 40, mini: 0 }, content: 4 };
    assert.equal(landing.readCount(ov, 'tests.full'), 40);
    assert.equal(landing.readCount(ov, 'tests.mini'), 0);
    assert.equal(landing.readCount(ov, 'tests.drill'), 0, 'absent key is 0, not NaN');
    assert.equal(landing.readCount(ov, 'content'), 4);
    assert.equal(landing.readCount({}, 'a.b.c'), 0, 'deep miss must not throw');
    assert.equal(landing.readCount({ n: -3 }, 'n'), 0);
  });
});

describe('listening-landing — availableModeLabels', () => {
  it('lists only modes with a published exercise, and ignores unknown keys', () => {
    const labels = landing.availableModeLabels({
      exercise_modes: { dictation: 2, gist: 0, true_false: 0, mcq: 0, wat: 9 },
    });
    assert.deepEqual(labels, ['Chép chính tả']);
  });
  it('is empty when nothing is published', () => {
    assert.deepEqual(landing.availableModeLabels({ exercise_modes: {} }), []);
  });
});

describe('listening-landing — applyOverview', () => {
  it('reveals only the cards with a non-zero count', () => {
    // The production shape as of the reorg: exam surfaces populated, the
    // free-practice library holding 4 content rows.
    const doc = buildDoc();
    landing.applyOverview(doc, {
      tests: { full: 40, mini: 32, drill: 66 },
      content: 4,
      exercise_modes: { dictation: 2, gist: 0, true_false: 0, mcq: 0 },
    });
    assert.equal(doc.full.hidden, false);
    assert.equal(doc.mini.hidden, false);
    assert.equal(doc.drill.hidden, false);
    assert.equal(doc.browse.hidden, false);
    assert.equal(doc.library.hidden, false);
    assert.equal(doc.full.querySelector('[data-count-slot]').textContent, '40 bài');
    assert.match(doc.lede.textContent, /Chép chính tả/);
    assert.doesNotMatch(doc.lede.textContent, /Nghe ý chính/,
      'a mode with 0 published exercises must not be advertised');
    assert.equal(doc.examEmpty.hidden, true);
  });

  it('keeps a zero-count card hidden', () => {
    const doc = buildDoc();
    landing.applyOverview(doc, {
      tests: { full: 40, mini: 0, drill: 66 }, content: 0, exercise_modes: {},
    });
    assert.equal(doc.mini.hidden, true, 'zero mini tests must not render a card');
    assert.equal(doc.browse.hidden, true);
    assert.equal(doc.library.hidden, true, 'library section hides with its only card');
  });

  it('shows the empty note when every exam surface is empty', () => {
    const doc = buildDoc();
    landing.applyOverview(doc, {
      tests: { full: 0, mini: 0, drill: 0 }, content: 0, exercise_modes: {},
    });
    assert.equal(doc.examEmpty.hidden, false);
    assert.equal(doc.full.hidden, true);
  });

  it('the library card alone does not count as an exam surface', () => {
    // Guards the closest('#section-library') discriminator: if the browse
    // card leaked into examShown, the empty note would wrongly stay hidden.
    const doc = buildDoc();
    landing.applyOverview(doc, {
      tests: { full: 0, mini: 0, drill: 0 }, content: 7, exercise_modes: {},
    });
    assert.equal(doc.browse.hidden, false);
    assert.equal(doc.examEmpty.hidden, false,
      'exam note must still show when only the library has content');
  });

  it('an all-zero overview reveals nothing at all', () => {
    const doc = buildDoc();
    landing.applyOverview(doc, {});
    for (const c of [doc.full, doc.mini, doc.drill, doc.browse]) {
      assert.equal(c.hidden, true);
    }
  });
});


/* ── browse card mode links ──────────────────────────────────────────── */

describe('listening-browse — modeLinksHtml', () => {
  let browse;
  before(async () => {
    // listening-browse.js reads the DOM at module scope.
    globalThis.document = {
      getElementById: () => ({ hidden: true }),
      addEventListener() {},
    };
    browse = await import('../js/listening-browse.js');
  });

  it('renders a link only for modes the backend reports as available', () => {
    const html = browse.modeLinksHtml({
      id: 'abc-123', available_modes: ['dictation', 'mcq'],
    });
    assert.match(html, /listening-dictation\.html\?content_id=abc-123/);
    assert.match(html, /listening-mcq\.html\?content_id=abc-123/);
    assert.doesNotMatch(html, /listening-gist\.html/,
      'gist has no published exercise here — linking it dead-ends');
    assert.doesNotMatch(html, /listening-tf\.html/);
  });

  it('shows an honest note instead of four dead links when nothing exists', () => {
    for (const item of [{ id: 'x', available_modes: [] }, { id: 'x' }]) {
      const html = browse.modeLinksHtml(item);
      assert.match(html, /Chưa có dạng luyện nào/);
      assert.doesNotMatch(html, /<a /, 'no link may be rendered');
    }
  });

  it('escapes the content id into the href', () => {
    const html = browse.modeLinksHtml({ id: 'a b&c', available_modes: ['dictation'] });
    assert.match(html, /content_id=a%20b%26c/);
    assert.doesNotMatch(html, /content_id=a b&c/);
  });
});

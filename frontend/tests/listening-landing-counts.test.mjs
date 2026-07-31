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
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');


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

  it('never advertises mini_test — the library has no page for it', () => {
    // /overview reports mini_test because it is a valid listening_exercises
    // type, but there is no ?content_id= page for it. Naming it in the lede
    // would recreate the dead end this whole change removes.
    assert.deepEqual(
      landing.availableModeLabels({ exercise_modes: { mini_test: 5 } }), [],
    );
  });

  it('advertises exactly the modes the browse card can link', () => {
    // The landing's promise and the browse card's links must be the same set.
    // Read both source files rather than the modules, so this holds even for
    // keys that have no fixture in either direction.
    const keysOf = (src, name) => {
      const body = src.split(`const ${name} = {`)[1].split('};')[0];
      return [...body.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]).sort();
    };
    assert.deepEqual(
      keysOf(read('js', 'listening-landing.js'), 'MODE_LABELS'),
      keysOf(read('js', 'listening-browse.js'), 'MODE_LINKS'),
      'MODE_LABELS (landing) and MODE_LINKS (browse) must cover the same modes',
    );
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
      tests: { full: 0, mini: 0, drill: 0 }, content: 7,
      exercise_modes: { dictation: 2 },      // a runnable mode, else the card hides
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


describe('listening-browse — lookup failure must not read as no-data', () => {
  let browse;
  before(async () => {
    globalThis.document = { getElementById: () => ({ hidden: true }), addEventListener() {} };
    browse = await import('../js/listening-browse.js');
  });

  it('null available_modes renders a warning, not "chưa có dạng luyện nào"', () => {
    // The backend sets null when the listening_exercises read threw. An empty
    // list there would be indistinguishable from genuine no-data, dressing a
    // DB fault up as canonical truth — the same trap the access-code endpoints
    // avoid with association_lookup_failed.
    const html = browse.modeLinksHtml({ id: 'x', available_modes: null });
    assert.match(html, /Không đọc được/);
    assert.doesNotMatch(html, /Chưa có dạng luyện nào/);
    assert.doesNotMatch(html, /<a /);
  });

  it('an empty array still means genuine no-data', () => {
    const html = browse.modeLinksHtml({ id: 'x', available_modes: [] });
    assert.match(html, /Chưa có dạng luyện nào/);
    assert.doesNotMatch(html, /Không đọc được/);
  });
});


describe('listening-landing — library needs a way in, not just rows', () => {
  it('hides the library when no mode is runnable', () => {
    // Content rows alone are not something a learner can DO: the library would
    // open onto a list where every card reads "chưa có dạng luyện nào" — the
    // dead end this page was reorganised to remove, one level down.
    const doc = buildDoc();
    landing.applyOverview(doc, {
      tests: { full: 40, mini: 0, drill: 0 }, content: 12,
      exercise_modes: { dictation: 0, gist: 0, true_false: 0, mcq: 0 },
    });
    assert.equal(doc.browse.hidden, true);
    assert.equal(doc.library.hidden, true);
  });

  it('shows the library as soon as one mode is runnable', () => {
    const doc = buildDoc();
    landing.applyOverview(doc, {
      tests: { full: 0, mini: 0, drill: 0 }, content: 12,
      exercise_modes: { dictation: 3, gist: 0, true_false: 0, mcq: 0 },
    });
    assert.equal(doc.browse.hidden, false);
    assert.equal(doc.library.hidden, false);
    assert.match(doc.lede.textContent, /Chép chính tả/);
  });
});


describe('badge count vs what the destination renders', () => {
  it('every count-driven library pages through its endpoint', () => {
    // The landing promises the FULL published count. A single fixed-size
    // request would show 50 of 60 the moment a library outgrows one page,
    // breaking the contract the whole page is built on.
    // skills keeps its own loop (it predates the shared helper); the other
    // three go through listening-list-paging.js.
    const skills = read('js', 'listening-skills.js');
    assert.match(skills, /offset/);
    for (const f of ['listening-tests-list.js', 'listening-mini-test.js',
                     'listening-browse.js']) {
      const src = read('js', f);
      assert.match(src, /from '\.\/listening-list-paging\.js'/,
        `${f} must page via the shared helper`);
      assert.doesNotMatch(src, /limit=50\b/, `${f} still pins a single 50-row page`);
    }
  });

  it('the shared paging helper stops on a short page', () => {
    const src = read('js', 'listening-list-paging.js');
    assert.match(src, /if \(items\.length < PAGE_LIMIT\) return all;/,
      'a loop with no short-page exit would spin to the guard limit');
  });

  it('the paging helper is side-effect free', () => {
    // It used to live in listening-tests-list.js, which reads #lt-grid and
    // registers DOMContentLoaded at import time — and listening-mini-test.html
    // uses the SAME ids, so importing it there would have run the full-test
    // loader and overwritten the mini list with Cambridge full tests.
    const src = read('js', 'listening-list-paging.js');
    assert.doesNotMatch(src, /document\./, 'the shared helper must not touch the DOM');
    assert.doesNotMatch(src, /addEventListener/);
  });
});


describe('shared list pager', () => {
  let paging;
  before(async () => { paging = await import('../js/listening-list-paging.js'); });

  it('stops at the first short page', async () => {
    const pages = [Array(100).fill({}), Array(100).fill({}), Array(7).fill({})];
    let n = 0;
    const items = await paging.fetchAllPages(() => '/x', async () => ({ items: pages[n++] }));
    assert.equal(items.length, 207);
    assert.equal(n, 3, 'must not keep fetching past the short page');
  });

  it('throws rather than silently truncating at the guard', async () => {
    // Returning a partial list here would put the page back where it started:
    // the badge counts the whole set, the list renders a slice, and nothing on
    // screen admits it.
    await assert.rejects(
      paging.fetchAllPages(() => '/x', async () => ({ items: Array(100).fill({}) })),
      /chưa tải hết/,
    );
  });

  it('handles an empty first page', async () => {
    const items = await paging.fetchAllPages(() => '/x', async () => ({ items: [] }));
    assert.deepEqual(items, []);
  });
});


describe('Luyện nhanh — one library, three tabs', () => {
  let practice;
  before(async () => {
    globalThis.document = { getElementById: () => null, addEventListener() {} };
    practice = await import('../js/listening-practice.js');
  });

  it('groups the trap tab by trap so it reads as eleven short courses', () => {
    const items = [
      { id: '1', trap: 'Number Confusion' }, { id: '2', trap: 'Number Confusion' },
      { id: '3', trap: 'Negation Flip' },
    ];
    const groups = practice.groupTests('trap', items);
    assert.deepEqual(groups.map((g) => [g.title, g.items.length]),
      [['Number Confusion', 2], ['Negation Flip', 1]]);
  });

  it('leaves the other tabs as one flat list', () => {
    const items = [{ id: '1', trap: 'X' }, { id: '2', trap: 'Y' }];
    for (const key of ['section', 'curated']) {
      const groups = practice.groupTests(key, items);
      assert.equal(groups.length, 1);
      assert.equal(groups[0].title, null);
    }
  });

  it('a test with no trap still lands in a group', () => {
    const groups = practice.groupTests('trap', [{ id: '1' }]);
    assert.equal(groups[0].title, 'Khác');
  });

  it('escapes titles into the card', () => {
    const html = practice.renderCard({ id: 'x', title: '<img onerror=1>' });
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
  });

  it('the three tabs match the groups the backend reports', () => {
    // /overview keys and the tab keys are the same vocabulary; a mismatch
    // means a tab that never appears or a group with nowhere to render.
    assert.deepEqual(practice.TABS.map((t) => t.key), ['trap', 'section', 'curated']);
    const backend = read('..', 'backend', 'migrations',
                         '173_listening_tests_practice_type.sql');
    for (const k of ['trap', 'section', 'curated']) {
      assert.match(backend, new RegExp(k), `migration must document group '${k}'`);
    }
  });
});


describe('shared player knows the practice library', () => {
  const PLAYER = read('js', 'listening-test-player.js');

  it('practice gets scrub/replay like the other practice modes', () => {
    // A 40-second trap drill whose whole point is hearing the trap again is
    // unusable under exam no-seek rules, and resume-by-started_at would skip
    // past the audio entirely.
    assert.match(PLAYER, /tt === 'mini' \|\| tt === 'drill' \|\| tt === 'practice'/);
  });

  it('back link returns to the library the learner came from', () => {
    const block = PLAYER.split('const BACK_TARGETS = {')[1].split('};')[0];
    for (const [k, page] of [['full', 'listening-tests'], ['mini', 'listening-mini-test'],
                             ['drill', 'listening-skills'], ['practice', 'listening-practice']]) {
      assert.match(block, new RegExp(`${k}:\\s*'/pages/${page}\\.html'`),
        `back target for ${k} missing — the learner lands on the wrong shelf`);
    }
  });

  it('the practice page stamps ?from=practice so the back link resolves', () => {
    assert.match(read('js', 'listening-practice.js'), /from=practice/);
  });
});


describe('analytics covers every persisted test type', () => {
  it('practice appears in the dashboard modes', () => {
    // A type missing here is worse than invisible: its attempts still raise
    // total_attempts and show in recent activity, so its score sits outside
    // the average and completion — the dashboard contradicts itself.
    const js = read('js', 'listening-analytics.js');
    const labels = js.split('const MODE_LABELS = {')[1].split('};')[0];
    for (const m of ['mini', 'drill', 'full', 'practice']) {
      assert.match(labels, new RegExp(`^\\s*${m}:`, 'm'), `mode ${m} has no label`);
    }
  });

  it('the weighted overall figures use exactly the labelled modes', () => {
    const js = read('js', 'listening-analytics.js');
    assert.match(js, /const MODES = Object\.keys\(MODE_LABELS\)/,
      'a hand-written list would drift from the labels');
    assert.doesNotMatch(js, /\['mini', 'drill', 'full'\]/,
      'the old hard-coded three-mode list is back');
  });

  it('backend and frontend enumerate the same modes', () => {
    const be = read('..', 'backend', 'routers', 'listening.py');
    assert.match(be, /types = \("mini", "drill", "full", "practice"\)/);
  });
});

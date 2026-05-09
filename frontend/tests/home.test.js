/**
 * frontend/tests/home.test.js — Sprint 5.1 home page unit tests.
 *
 * Run with: node --test frontend/tests/home.test.js
 *
 * No external test framework — uses Node's built-in `node:test` so the
 * project doesn't take on a new dev dependency. Tests load js/home.js by
 * shimming a minimal `window` + `document`, then exercise the surfaces the
 * page exposes via window.__home (the test seam).
 *
 * What's pinned here:
 *   - formatRelativeTime returns the right Vietnamese phrase for the key
 *     boundaries (today, yesterday, days, weeks, months, null)
 *   - METRIC_FORMATTERS for each active skill produce {primary, sub}
 *     shapes the renderer expects (no thrown errors on edge inputs)
 *   - renderSkillCard wires a click handler that navigates to
 *     primary_cta_url, and skips the handler when the URL is missing
 *   - coming_soon cards render the lock affordance + don't get a click
 *     handler
 *
 * What's NOT covered (intentional):
 *   - Visual layout / CSS (visual regression is out of scope here; the
 *     Acceptance section's manual smoke covers this)
 *   - Auth flow / Supabase init (mocked away via window.api stub)
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

// ── DOM shim ──────────────────────────────────────────────────────────
//
// home.js touches: document.getElementById, document.querySelector,
// element.classList, element.innerHTML, element.addEventListener,
// window.location.href. The shim implements just enough to exercise the
// rendering branches deterministically.

function makeElement(tagName = 'div', attrs = {}) {
  const el = {
    tagName,
    children: [],
    attributes: { ...attrs },
    innerHTML: '',
    textContent: '',
    dataset: {},     // Sprint 5.2 — home.js sets `card.dataset.locked` on the lock branch.
    tabIndex: -1,
    classList: {
      _set: new Set(),
      add(...cs) { cs.forEach(c => this._set.add(c)); },
      remove(...cs) { cs.forEach(c => this._set.delete(c)); },
      contains(c) { return this._set.has(c); },
    },
    _listeners: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    addEventListener(ev, fn) {
      (this._listeners[ev] = this._listeners[ev] || []).push(fn);
    },
    dispatchEvent(ev) {
      (this._listeners[ev.type] || []).forEach(fn => fn(ev));
    },
    querySelector(sel) {
      // Only `.value-num` / `.unit` / `.flame` are queried in tests — return
      // a child element matching the class.
      const cls = sel.startsWith('.') ? sel.slice(1) : null;
      if (!cls) return null;
      return this.children.find(c => c.classList.contains(cls)) || null;
    },
  };
  return el;
}

function makeStatElement(extraClasses = []) {
  const el = makeElement();
  extraClasses.forEach(c => el.classList.add(c));
  const num = makeElement();
  num.classList.add('value-num');
  const unit = makeElement();
  unit.classList.add('unit');
  const flame = makeElement();
  flame.classList.add('flame');
  el.children.push(num, unit, flame);
  return el;
}

function makeFakeDocument() {
  const elems = {
    'greeting-name':  makeElement(),
    'hero-streak':    makeStatElement(['hero-stat', 'streak']),
    'hero-sessions':  makeStatElement(['hero-stat']),
    'hero-essays':    makeStatElement(['hero-stat']),
    'error-banner':   makeElement(),
  };
  const skillCards = {
    writing:    makeElement('article', { 'data-skill': 'writing' }),
    speaking:   makeElement('article', { 'data-skill': 'speaking' }),
    grammar:    makeElement('article', { 'data-skill': 'grammar' }),
    vocabulary: makeElement('article', { 'data-skill': 'vocabulary' }),
    reading:    makeElement('article', { 'data-skill': 'reading' }),
    listening:  makeElement('article', { 'data-skill': 'listening' }),
  };
  Object.values(skillCards).forEach(c => c.classList.add('skeleton'));

  return {
    readyState: 'complete',
    addEventListener() {},
    getElementById(id) { return elems[id] || null; },
    querySelector(sel) {
      const m = sel.match(/^\[data-skill="(\w+)"\]$/);
      return m ? skillCards[m[1]] || null : null;
    },
    _elems: elems,
    _skillCards: skillCards,
  };
}

// ── Load js/home.js into an isolated context ────────────────────────

function loadHome(doc) {
  const scriptPath = path.join(__dirname, '..', 'js', 'home.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  const alertCalls = [];
  const sandbox = {
    document: doc,
    setTimeout,
    clearTimeout,
    console,
    alert: (msg) => { alertCalls.push(msg); },
    window: {
      // Stub the API to return null — loadHome short-circuits on falsy
      // payloads (the production flow uses that branch for the 401
      // redirect). These tests bypass the bootstrap and hit the
      // rendering layer directly via window.__home.
      api: { get: async () => null },
      location: { href: '' },
      __alertCalls: alertCalls,
    },
  };
  // home.js sets `window.__home`; expose `window` itself on the sandbox
  // so the IIFE's binding to window.__home actually persists.
  sandbox.window.document = doc;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window;
}

// ── Tests ───────────────────────────────────────────────────────────

test('formatRelativeTime — today / yesterday / days / weeks / months / null', () => {
  const doc = makeFakeDocument();
  const win = loadHome(doc);
  const f = win.__home.formatRelativeTime;

  assert.equal(f(null), 'Chưa có hoạt động');
  assert.equal(f(''),   'Chưa có hoạt động');
  assert.equal(f('not-a-date'), 'Chưa có hoạt động');

  const now = new Date();
  assert.equal(f(now.toISOString()), 'Hôm nay');

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  assert.equal(f(yesterday.toISOString()), 'Hôm qua');

  const threeDays = new Date(now);
  threeDays.setDate(now.getDate() - 3);
  assert.equal(f(threeDays.toISOString()), '3 ngày trước');

  const twoWeeks = new Date(now);
  twoWeeks.setDate(now.getDate() - 14);
  assert.equal(f(twoWeeks.toISOString()), '2 tuần trước');

  const twoMonths = new Date(now);
  twoMonths.setDate(now.getDate() - 60);
  assert.equal(f(twoMonths.toISOString()), '2 tháng trước');
});

test('METRIC_FORMATTERS produce expected shapes for each skill', () => {
  const doc = makeFakeDocument();
  const win = loadHome(doc);
  const formatters = win.__home.METRIC_FORMATTERS;

  // Writing: band + essays_count + in_progress.
  const w = formatters.writing({
    last_band: 6.5, essays_count: 3, essays_in_progress: 1,
  });
  assert.equal(w.primary.value, '6.5');
  assert.equal(w.primary.unit, 'band');
  assert.match(w.sub, /3 bài đã nộp/);
  assert.match(w.sub, /1 đang chờ/);

  // Writing — no data: shows "Chưa có bài nào".
  const wEmpty = formatters.writing({});
  assert.equal(wEmpty.primary.value, '—');
  assert.equal(wEmpty.sub, 'Chưa có bài nào');

  // Speaking: band + sessions count.
  const s = formatters.speaking({ last_band: 6.0, sessions_count: 12 });
  assert.equal(s.primary.value, '6.0');
  assert.match(s.sub, /12 session/);

  // Grammar: lessons_viewed.
  const g = formatters.grammar({ lessons_viewed: 7 });
  assert.equal(g.primary.value, '7');
  assert.equal(g.primary.unit, 'bài đã xem');

  // Vocabulary with due cards.
  const v = formatters.vocabulary({ words_learned: 42, flashcards_due: 5 });
  assert.equal(v.primary.value, '42');
  assert.match(v.sub, /5 thẻ đến hạn/);

  // Vocabulary — no due cards but words exist.
  const vNoDue = formatters.vocabulary({ words_learned: 20, flashcards_due: 0 });
  assert.equal(vNoDue.sub, 'Wallet từ vựng cá nhân');
});

test('renderSkillCard wires a click handler that navigates to primary_cta_url', () => {
  const doc = makeFakeDocument();
  const win = loadHome(doc);

  win.__home.renderSkillCard('writing', {
    status: 'active',
    last_band: 6.5,
    essays_count: 3,
    essays_in_progress: 0,
    last_activity_at: new Date().toISOString(),
    primary_cta: 'Submit new essay',
    primary_cta_url: '/pages/writing-dashboard.html',
  });

  const card = doc._skillCards.writing;
  assert.ok(!card.classList.contains('skeleton'),
    'skeleton class should be removed after render');
  assert.match(card.innerHTML, /Writing/);
  assert.match(card.innerHTML, /6\.5/);

  // Click handler should redirect.
  card.dispatchEvent({ type: 'click' });
  assert.equal(win.location.href, '/pages/writing-dashboard.html');
});

test('renderSkillCard renders coming_soon variant without click handler', () => {
  const doc = makeFakeDocument();
  const win = loadHome(doc);

  win.__home.renderSkillCard('reading', {
    status: 'coming_soon',
    primary_cta: null,
    primary_cta_url: null,
  });

  const card = doc._skillCards.reading;
  assert.ok(card.classList.contains('coming-soon'),
    'coming-soon class must be present');
  assert.match(card.innerHTML, /Sắp ra mắt/);

  // Click should NOT navigate (coming_soon has no handler attached).
  win.location.href = '__before__';
  card.dispatchEvent({ type: 'click' });
  assert.equal(win.location.href, '__before__',
    'coming_soon cards must not navigate on click');
});

// ── Sprint 5.2 — Writing permission lock state ────────────────────────

test('renderSkillCard locks Writing card when permissions.writing is false', () => {
  const doc = makeFakeDocument();
  const win = loadHome(doc);

  // Active skill data — but permissions object says writing=false.
  win.__home.renderSkillCard(
    'writing',
    {
      status: 'active',
      last_band: 6.5,
      essays_count: 3,
      essays_in_progress: 0,
      last_activity_at: new Date().toISOString(),
      primary_cta: 'Submit new essay',
      primary_cta_url: '/pages/writing-dashboard.html',
    },
    { writing: false },
  );

  const card = doc._skillCards.writing;
  assert.ok(card.classList.contains('coming-soon'),
    'locked card uses the coming-soon visual treatment');
  assert.equal(card.dataset.locked, 'true',
    'data-locked discriminator distinguishes lock vs coming-soon for tests/CSS');
  assert.match(card.innerHTML, /Chưa kích hoạt/);

  // Click → alert, NOT navigation. The card has a real CTA URL but the
  // lock branch must short-circuit it.
  win.location.href = '__before__';
  card.dispatchEvent({ type: 'click' });
  assert.equal(win.location.href, '__before__',
    'locked Writing card must not navigate on click');
  assert.ok(win.__alertCalls.length >= 1,
    'locked card click should surface a Vietnamese activation message');
  assert.match(win.__alertCalls[0], /chưa được kích hoạt/i);
});

test('renderSkillCard does NOT lock Writing card when permissions.writing is true', () => {
  const doc = makeFakeDocument();
  const win = loadHome(doc);

  win.__home.renderSkillCard(
    'writing',
    {
      status: 'active',
      last_band: 6.5,
      essays_count: 3,
      essays_in_progress: 0,
      last_activity_at: new Date().toISOString(),
      primary_cta: 'Submit new essay',
      primary_cta_url: '/pages/writing-dashboard.html',
    },
    { writing: true },
  );

  const card = doc._skillCards.writing;
  assert.ok(!card.classList.contains('coming-soon'),
    'unlocked Writing card must not be styled as coming-soon');

  // Click → navigate.
  card.dispatchEvent({ type: 'click' });
  assert.equal(win.location.href, '/pages/writing-dashboard.html');
});

test('renderSkillCard ignores permissions for non-Writing skills', () => {
  /* Sprint 5.2 only gates Writing. Speaking/Grammar/Vocab cards must
     not change behaviour based on the permissions payload — adding a
     wholesale "lock everything" code path would silently regress the
     UX on every other skill. */
  const doc = makeFakeDocument();
  const win = loadHome(doc);

  win.__home.renderSkillCard(
    'speaking',
    {
      status: 'active',
      last_band: 6.0,
      sessions_count: 12,
      last_activity_at: new Date().toISOString(),
      primary_cta: 'Continue practice',
      primary_cta_url: '/pages/speaking.html',
    },
    { writing: false }, // Writing locked but Speaking should still navigate.
  );

  const card = doc._skillCards.speaking;
  assert.ok(!card.classList.contains('coming-soon'));
  card.dispatchEvent({ type: 'click' });
  assert.equal(win.location.href, '/pages/speaking.html');
});

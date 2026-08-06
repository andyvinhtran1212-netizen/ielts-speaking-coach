/**
 * frontend/tests/listening-page-shell.test.mjs
 *
 * Listening landing shell contract.
 *
 * History: Sprint 11.5 pinned "exactly 6 mode-cards, all LIVE". That
 * assertion held while the markup was the only source of truth — and it is
 * exactly what let four cards (dictation / gist / true-false / mcq) stay on
 * the landing after it turned out they had no published content behind them.
 * Each linked to a page that needs `?content_id=` and shows an empty state
 * without one, so every click from the landing dead-ended.
 *
 * The contract is now the inverse: the landing may not hard-code the
 * existence of practice material. Cards are revealed by
 * GET /api/listening/overview, and the four content-dependent modes are
 * reached through the library (listening-browse.html), which offers a mode
 * only when that content row actually has a published exercise.
 *
 * These tests pin:
 *   - no bare links to the four content-dependent mode pages (the dead ends)
 *   - every card that claims a count carries a data-count-key + count slot
 *     and starts hidden, so nothing paints before the count is known
 *   - the exam-shaped surfaces (full / mini / drill) are still linked
 *   - chrome + stylesheet foundation unchanged
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const HTML = read('pages', 'listening.html');
const LANDING_JS = read('js', 'listening-landing.js');


describe('listening.html — landing shell contract', () => {

  it('mounts the canonical <aver-chrome active="listening"> Web Component', () => {
    assert.match(
      HTML,
      /<aver-chrome\s+active=["']listening["']\s*>\s*<\/aver-chrome>/,
      'listening.html must declare <aver-chrome active="listening">',
    );
  });

  it('does NOT link to the four content-dependent mode pages', () => {
    // The regression this file exists to prevent. These pages require a
    // ?content_id=; linked bare from the landing they render an empty state.
    // They are reachable from listening-browse.html, where a card carries the
    // content id and only offers modes that exist for it.
    for (const page of ['listening-dictation', 'listening-gist',
                        'listening-tf', 'listening-mcq']) {
      assert.doesNotMatch(
        HTML,
        new RegExp(`href=["']/pages/${page}\\.html["']`),
        `${page}.html must not be linked bare from the landing — it dead-ends `
        + 'without ?content_id=',
      );
    }
  });

  it('links the exam-shaped surfaces and the practice library', () => {
    // [cutover /listening/tests 2026-08-05] chỉ `tests` sang route Next; ba
    // trang kia còn legacy. Liệt kê thẳng URL thay vì dựng từ tên trang.
    for (const href of ['/listening/tests', '/pages/listening-mini-test.html',
                        '/pages/listening-skills.html', '/pages/listening-practice.html']) {
      assert.match(
        HTML,
        new RegExp(`href=["']${href.replace(/[/.]/g, '\\$&')}["']`),
        `landing must link to ${href}`,
      );
    }
  });

  it('every count-claiming card starts hidden and declares a key + slot', () => {
    // A card that painted before its count arrived would flash content that
    // may not exist — the same false promise in a different form.
    const cards = HTML.match(/<a[^>]*data-count-key=[^>]*>/g) || [];
    assert.ok(cards.length >= 4, `expected >=4 count-driven cards, got ${cards.length}`);
    for (const tag of cards) {
      assert.match(tag, /\bhidden\b/, `count-driven card must start hidden: ${tag}`);
    }
    const slots = HTML.match(/data-count-slot/g) || [];
    assert.equal(
      slots.length, cards.length,
      'each count-driven card needs exactly one [data-count-slot] badge',
    );
  });

  it('count keys resolve against the /overview payload shape', () => {
    for (const key of ['tests.full', 'tests.mini', 'tests.drill',
                       'tests.practice', 'content']) {
      assert.match(
        HTML,
        new RegExp(`data-count-key=["']${key.replace('.', '\\.')}["']`),
        `missing card for overview key "${key}"`,
      );
    }
  });

  it('loads api.js and the landing controller', () => {
    assert.match(HTML, /src=["']\/js\/api\.js["']/,
      'landing needs the authed API client to fetch counts');
    assert.match(HTML, /src=["']\/js\/listening-landing\.js["']/);
  });

  it('utility surfaces — Kho bài nghe (browse) + Thống kê (analytics)', () => {
    assert.match(HTML, /href=["']\/pages\/listening-browse\.html["']/);
    assert.match(HTML, /href=["']\/pages\/listening-analytics\.html["']/);
  });

  it('loads the canonical tokens + its own decoupled stylesheet (A6)', () => {
    assert.match(HTML, /href=["']\/css\/aver-design\/tokens\.css["']/);
    assert.match(HTML, /href=["']\/css\/aver-design\/components\.css["']/);
    assert.match(HTML, /href=["']\/css\/listening\.css["']/,
      'Listening shell must load its own decoupled listening.css (A6)');
    assert.doesNotMatch(HTML, /href=["']\/css\/vocabulary\.css["']/,
      'Listening must no longer borrow vocabulary.css (A6 decouple)');
  });

  it('landing controller fetches /api/listening/overview', () => {
    assert.match(LANDING_JS, /\/api\/listening\/overview/);
  });
});

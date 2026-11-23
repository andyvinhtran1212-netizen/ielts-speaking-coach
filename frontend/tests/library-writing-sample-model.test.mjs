// LIBRARY-0061 T010: pure model of `/library/writing-samples/[slug]`
// (FR-013 view state, FR-016 sections, FR-017 vocabulary links, FR-018 offer, plan §5.4 metadata).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_VIEW,
  displayTitle,
  keyFeatures,
  outlineRows,
  pageSections,
  pickViewState,
  sampleMetadata,
  shorten,
  viewQuery,
  vocabEntryHref,
  vocabRows,
  writeOffer,
} from '../app/(public-library)/library/writing-samples/[slug]/sample-model.mjs';
import { routeFor } from '../lib/route-registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUTE_DIR = path.join(HERE, '../app/(public-library)/library/writing-samples/[slug]');

describe('view state in the URL (FR-013)', () => {
  test('default is "Đọc từng bài", band 7.5, pair 7.5 → 7.0', () => {
    assert.deepEqual(pickViewState({}), { xem: 'doc', muc: '7.5', cap: '7.5-7.0' });
    assert.deepEqual(pickViewState(undefined), DEFAULT_VIEW);
  });

  test('valid values are kept, unknown ones fall back', () => {
    assert.deepEqual(pickViewState({ xem: 'so-sanh', muc: '6.0', cap: '7.0-6.0' }), { xem: 'so-sanh', muc: '6.0', cap: '7.0-6.0' });
    assert.deepEqual(pickViewState({ xem: 'grid', muc: '9.0', cap: '6.0-5.0' }), DEFAULT_VIEW);
    assert.deepEqual(pickViewState({ xem: ['so-sanh', 'doc'] }).xem, 'so-sanh');
  });

  test('viewQuery leaves defaults out and round-trips', () => {
    assert.equal(viewQuery(DEFAULT_VIEW), '');
    const q = viewQuery({ xem: 'so-sanh', muc: '7.5', cap: '7.0-6.0' });
    assert.equal(q, '?xem=so-sanh&cap=7.0-6.0');
    assert.deepEqual(pickViewState(Object.fromEntries(new URLSearchParams(q))), { xem: 'so-sanh', muc: '7.5', cap: '7.0-6.0' });
  });
});

describe('metadata (plan §5.4)', () => {
  test('title, description, canonical and og title', () => {
    const meta = sampleMetadata({ slug: 'working-from-home', title_en: 'Working from home', task: 'task2', prompt_text: 'More people now work from home.' });
    assert.equal(meta.title, 'Working from home — IELTS Writing Task 2: bài mẫu 7.5, 7.0, 6.0 | Aver Learning');
    assert.equal(meta.description, 'More people now work from home. Ba bài mẫu 7.5, 7.0, 6.0 kèm phân tích khác biệt.');
    assert.equal(meta.canonical, '/library/writing-samples/working-from-home');
    assert.equal(meta.ogTitle, 'Working from home');
  });

  test('Task 1 in the title; description keeps the first 150 characters of the prompt', () => {
    const prompt = 'x'.repeat(200);
    const meta = sampleMetadata({ slug: 's', title_en: 'Chart', task: 'task1', prompt_text: prompt });
    assert.match(meta.title, /IELTS Writing Task 1:/);
    assert.equal(meta.description, `${'x'.repeat(150)} Ba bài mẫu 7.5, 7.0, 6.0 kèm phân tích khác biệt.`);
  });

  test('no title_en → the start of the prompt, never the slug', () => {
    assert.equal(displayTitle({ title_en: null, prompt_text: 'Short prompt' }), 'Short prompt');
    assert.ok(shorten('one two three four five six', 12).endsWith('…'));
    assert.ok(shorten('one two three four five six', 12).length <= 12);
  });
});

describe('sections (FR-016)', () => {
  const all = { hasPrompt: true, hasOutline: true, hasIdeas: false, hasFeatures: true, hasEssays: true, hasJudgement: true, hasVocab: true, hasRelated: true };

  test('Task 1: section 3 is "Đặc điểm chính"', () => {
    const toc = pageSections({ ...all, task: 'task1' });
    assert.deepEqual(toc.map((s) => [s.n, s.label]).slice(0, 4), [['1', 'Đề bài'], ['2', 'Dàn ý'], ['3', 'Đặc điểm chính'], ['4', 'Ba bài mẫu']]);
  });

  test('a section with no data leaves the contents and the rest are renumbered', () => {
    const toc = pageSections({ ...all, task: 'task2', hasOutline: false });
    assert.deepEqual(toc.map((s) => s.n), ['1', '2', '3', '4', '5']);
    assert.ok(!toc.some((s) => s.label === 'Ma trận ý' || s.label === 'Dàn ý'));
    assert.equal(toc[1].label, 'Ba bài mẫu');
  });
});

describe('outline, features and vocabulary', () => {
  test('outline rows: known role codes get labels, unknown codes are never printed, free text is kept', () => {
    const rows = outlineRows([
      { paragraph: 1, function: 'intro', topic_sentence: 'Digital connections…' },
      { paragraph: 2, function: 'problem_solution', topic_sentence: 'First…' },
      { paragraph: 3, function: 'Thân bài 2 · lợi ích', topic_sentence: 'Second…' },
      { paragraph: 4, function: 'conclusion' },
    ], 'task2');
    assert.deepEqual(rows.map((r) => [r.part, r.fn, r.ts]), [
      ['Mở bài', null, 'Digital connections…'],
      ['Thân bài 1', null, 'First…'],
      ['Thân bài 2', 'Thân bài 2 · lợi ích', 'Second…'],
      ['Kết bài', null, null],
    ]);
    assert.ok(!JSON.stringify(rows).includes('problem_solution'));
  });

  test('outline as plain strings; Task 1 positions are intro, overview, bodies', () => {
    assert.deepEqual(outlineRows(['Intro', 'Over', 'B1', 'B2'], 'task1').map((r) => r.part), ['Mở bài', 'Tổng quan', 'Thân bài 1', 'Thân bài 2']);
    assert.deepEqual(outlineRows(null, 'task2'), []);
  });

  test('key features read from task1_data, else empty', () => {
    assert.deepEqual(keyFeatures({ key_features: ['Cost was largest.', '', 3] }), ['Cost was largest.']);
    assert.deepEqual(keyFeatures({ kind: 'bar' }), []);
    assert.deepEqual(keyFeatures(null), []);
  });

  test('vocabulary row puts the term inside its essay sentence', () => {
    const [row] = vocabRows([{ term: 'flexibility', pos: 'n', meaning_vi: 'sự linh hoạt', sentence_in_essay: 'It offers Flexibility to staff.' }]);
    assert.deepEqual(row.sentence, { pre: 'It offers ', hit: 'Flexibility', post: ' to staff.' });
    assert.deepEqual(vocabRows([{ pos: 'n' }, null]), []);
  });

  test('a vocabulary link exists only for an exact headword match (FR-017)', () => {
    const results = [{ headword: 'flexible', slug: 'flexible', category: 'work' }, { headword: 'Flexibility', slug: 'flexibility', category: 'work' }];
    assert.equal(vocabEntryHref('flexibility', results), '/vocabulary?cat=work&slug=flexibility');
    assert.equal(vocabEntryHref('flex', results), null);
    assert.equal(vocabEntryHref('flexibility', null), null);
  });
});

test('write offer: guest / write / buy (FR-018)', () => {
  assert.equal(writeOffer(null), 'guest');
  assert.equal(writeOffer({ signedIn: true, hasCourse: false, creditsLeft: 5 }), 'guest');
  assert.equal(writeOffer({ signedIn: true, hasCourse: true, creditsLeft: 2 }), 'write');
  assert.equal(writeOffer({ signedIn: true, hasCourse: true, creditsLeft: 0 }), 'buy');
});

test('route: live in the registry, no loading.tsx, reads the set uncached', () => {
  assert.equal(routeFor('/library/writing-samples/working-from-home')?.status, 'live');
  assert.equal(existsSync(path.join(ROUTE_DIR, 'loading.tsx')), false);
  const page = readFileSync(path.join(ROUTE_DIR, 'page.tsx'), 'utf8');
  assert.match(page, /export const instant = false;/);
  assert.match(page, /cache: 'no-store'/);
});

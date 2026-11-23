// LIBRARY-0061 T014 (b) (G06-T14b): Grammar Wiki home index helpers.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AZ_LETTERS,
  SEARCH_LIMIT,
  azName,
  azSections,
  buildIndex,
  commonErrors,
  foldVi,
  indexHref,
  pickGroup,
  searchIndex,
  splitTitle,
  uniqueEntries,
} from '../lib/grammar-index-model.mjs';

const art = (slug, title, status = 'complete', category = 'cat') => ({ slug, category, title, status });

const GROUPS = [
  {
    slug: 'foundations',
    title: 'Nền tảng',
    description: 'Từ loại, thành phần câu.',
    articles: [art('articles', 'Articles — a, an, the'), art('word-order', 'Word Order — Trật tự từ trong câu'), art('future-x', 'Future X', 'planned')],
  },
  { slug: 'empty', title: 'Chưa có bài', articles: [art('p1', 'P1', 'planned')] },
  {
    slug: 'sentence-structures',
    title: 'Cấu trúc câu',
    articles: [art('passive-voice', 'Passive Voice — Câu bị động'), art('articles', 'Articles — a, an, the'), art('3rd', '3rd Conditional', 'updating')],
  },
];

test('foldVi drops accents, đ and punctuation', () => {
  assert.equal(foldVi('Câu bị động'), 'cau bi dong');
  assert.equal(foldVi('Đại từ — ĐẠI'), 'dai tu dai');
  assert.equal(foldVi('  A,  an   the '), 'a an the');
  assert.equal(foldVi(null), '');
});

test('splitTitle splits English and Vietnamese on " — " or a Vietnamese bracket', () => {
  assert.deepEqual(splitTitle('Passive Voice — Câu bị động'), { en: 'Passive Voice', vi: 'Câu bị động' });
  assert.deepEqual(splitTitle('Present Simple'), { en: 'Present Simple', vi: '' });
  // Vietnamese first, English second: the parts are swapped back.
  assert.deepEqual(splitTitle('Lỗi dùng giới từ — Preposition Errors'), { en: 'Preposition Errors', vi: 'Lỗi dùng giới từ' });
  assert.deepEqual(splitTitle('Say / Tell / Speak / Talk — Phân biệt bốn động từ "nói"'), { en: 'Say / Tell / Speak / Talk', vi: 'Phân biệt bốn động từ "nói"' });
  // Older titles: Vietnamese name in a trailing bracket; an English bracket stays in the title.
  assert.deepEqual(splitTitle('Adjectives (Tính từ)'), { en: 'Adjectives', vi: 'Tính từ' });
  assert.deepEqual(splitTitle('A, An, The (Mạo từ)'), { en: 'A, An, The', vi: 'Mạo từ' });
  assert.deepEqual(splitTitle('Future Forms (will / be going to / Present Continuous)'), {
    en: 'Future Forms (will / be going to / Present Continuous)',
    vi: '',
  });
});

test('buildIndex keeps file order, drops planned articles and empty groups, numbers the shown groups 1…N', () => {
  const index = buildIndex(GROUPS);
  // "empty" has only a planned article: it is left out, and numbering does not skip it.
  assert.deepEqual(index.map((g) => [g.n, g.slug, g.entries.length]), [
    [1, 'foundations', 2],
    [2, 'sentence-structures', 3],
  ]);
  assert.ok(index[1].entries.every((e) => e.groupN === 2));
  assert.equal(buildIndex(null).length, 0);
});

test('an article in two groups stays in both, counted once', () => {
  const index = buildIndex(GROUPS);
  assert.ok(index[0].entries.some((e) => e.slug === 'articles'));
  assert.ok(index[1].entries.some((e) => e.slug === 'articles'));
  assert.equal(uniqueEntries(index).length, 4);
});

test('search matches without accents, on Vietnamese, English, slug and group name', () => {
  const index = buildIndex(GROUPS);
  assert.deepEqual(searchIndex(index, 'bi dong').results.map((e) => e.slug), ['passive-voice']);
  assert.deepEqual(searchIndex(index, 'bị ĐỘNG').results.map((e) => e.slug), ['passive-voice']);
  assert.deepEqual(searchIndex(index, 'passive').results.map((e) => e.slug), ['passive-voice']);
  // Group name matches too ("Cấu trúc câu"); "articles" is listed under its first group.
  assert.deepEqual(searchIndex(index, 'cau truc').results.map((e) => e.slug), ['passive-voice', '3rd']);
  assert.equal(searchIndex(index, 'xyz').total, 0);
  assert.equal(searchIndex(index, '   ').total, 0);
});

test('search puts English-title prefix matches first and caps at 12 with a remainder', () => {
  const many = [{ slug: 'g', title: 'G', articles: Array.from({ length: 15 }, (_, i) => art(`x${i}`, `Tense ${i} — Thì`)) }];
  many[0].articles.push(art('present', 'Present — tense of now'));
  const index = buildIndex(many);
  const found = searchIndex(index, 'tense');
  assert.equal(found.results.length, SEARCH_LIMIT);
  assert.equal(found.total, 16);
  assert.equal(found.more, 4);
  assert.equal(found.results[0].slug, 'x0');
  assert.ok(!found.results.slice(0, 12).some((e) => e.slug === 'present'));
});

test('A–Z lists every article once, by Vietnamese name, digits under # last', () => {
  const sections = azSections(buildIndex(GROUPS));
  // "a, an, the" → A; "Câu bị động" → C; "Trật tự từ…" → T; "3rd Conditional" has no Vietnamese name → #.
  assert.deepEqual(sections.map((s) => s.letter), ['A', 'C', 'T', '#']);
  assert.deepEqual(sections.map((s) => s.entries.map((e) => e.slug)), [['articles'], ['passive-voice'], ['word-order'], ['3rd']]);
  assert.equal(AZ_LETTERS.length, 26);
});

test('A–Z drops accents and đ for the letter, and sorts in Vietnamese order', () => {
  const index = buildIndex([
    { slug: 'g', title: 'G', articles: [art('inversion', 'Inversion — Đảo ngữ'), art('cleft', 'Cleft Sentences — Câu chẻ'), art('adj', 'Adjectives — Tính từ')] },
  ]);
  const sections = azSections(index);
  assert.deepEqual(sections.map((s) => s.letter), ['C', 'D', 'T']);
  assert.equal(azName(sections[1].entries[0]), 'Đảo ngữ');
  assert.equal(azName({ en: 'Grammar for Speaking', vi: '' }), 'Grammar for Speaking');
});

test('"Lỗi hay gặp" comes from the error-clinic group, in file order, capped', () => {
  const clinic = { slug: 'error-clinic', title: 'Error Clinic', description: 'Lỗi người Việt hay mắc.', articles: Array.from({ length: 8 }, (_, i) => art(`e${i}`, `Error ${i} — Lỗi ${i}`)) };
  const found = commonErrors(buildIndex([...GROUPS, clinic]));
  assert.equal(found.group.slug, 'error-clinic');
  assert.deepEqual(found.entries.map((e) => e.slug), ['e0', 'e1', 'e2', 'e3', 'e4', 'e5']);
  assert.equal(found.group.entries.length, 8);
  assert.equal(commonErrors(buildIndex(GROUPS)), null);
  assert.equal(commonErrors(buildIndex([{ ...clinic, articles: [art('p', 'P', 'planned')] }])), null);
});

test('pickGroup falls back to the first group', () => {
  const index = buildIndex(GROUPS);
  assert.equal(pickGroup(index, 'sentence-structures')?.slug, 'sentence-structures');
  assert.equal(pickGroup(index, 'nope')?.slug, 'foundations');
  assert.equal(pickGroup([], 'x'), null);
});

test('indexHref writes the view and group into the URL', () => {
  assert.equal(indexHref({ view: 'az' }), '/grammar?xem=az#groups-section');
  assert.equal(indexHref({ group: 'foundations' }), '/grammar?nhom=foundations#groups-section');
  assert.equal(indexHref(), '/grammar#groups-section');
});

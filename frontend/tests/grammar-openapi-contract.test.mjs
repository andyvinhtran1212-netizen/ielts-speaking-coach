import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = readFileSync(path.join(FRONTEND, 'types', 'api.d.ts'), 'utf8');
const API = readFileSync(path.join(FRONTEND, 'lib', 'grammar-api.ts'), 'utf8');
const SHELL = readFileSync(
  path.join(FRONTEND, 'app', '(public-content)', 'grammar', '[category]', '[slug]', 'page-shell.tsx'),
  'utf8',
);

const operations = [
  ['get_home_api_grammar_home_get', 'GrammarHomeResponse'],
  ['get_category_api_grammar_category__slug__get', 'GrammarCategoryResponse'],
  ['get_article_api_grammar_article__category___slug__get', 'GrammarArticleDocument'],
  ['get_roadmap_api_grammar_roadmap__slug__get', 'GrammarCategoryResponse'],
  ['get_compare_api_grammar_compare__slug__get', 'GrammarCompareResponse'],
];

test('public Grammar success responses are modeled instead of unknown', () => {
  for (const [operation, schema] of operations) {
    const start = TYPES.indexOf(`${operation}: {`);
    const next = TYPES.indexOf('\n    };', start);
    const source = TYPES.slice(start, next);
    assert.ok(start >= 0, operation);
    assert.match(source, new RegExp(`"application/json": components\\["schemas"\\]\\["${schema}"\\]`));
    assert.doesNotMatch(source, /"application\/json": unknown/);
  }
  assert.match(TYPES, /get_groups_api_grammar_groups_get:[\s\S]*?"application\/json": components\["schemas"\]\["GrammarGroup"\]\[\]/);
  assert.match(TYPES, /search_api_grammar_search_get:[\s\S]*?"application\/json": components\["schemas"\]\["GrammarSearchResult"\]\[\]/);
});

test('Grammar Server Components consume generated wire types without loose article escape hatches', () => {
  for (const route of [
    '/api/grammar/home',
    '/api/grammar/category/{slug}',
    '/api/grammar/article/{category}/{slug}',
    '/api/grammar/search',
    '/api/grammar/compare/{slug}',
    '/api/grammar/roadmap/{slug}',
    '/api/grammar/groups',
  ]) {
    assert.match(API, new RegExp(`ApiGetJson<'${route.replace(/[{}]/g, '\\$&')}'>`));
  }
  assert.match(SHELL, /export type GrammarArticle = GrammarArticleWire/);
  assert.doesNotMatch(SHELL, /\[key: string\]: any|Loose typing/);
});

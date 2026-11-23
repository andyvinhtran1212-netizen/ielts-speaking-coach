import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalNextRouteForLegacy } from '../tooling/legacy-url-mapping.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(public-content)', 'vocabulary', 'page.tsx');
const ENTRY = read('app', '(public-content)', 'vocabulary', 'vocabulary-entry.tsx');
const ENTRY_CLIENT = read('app', '(public-content)', 'vocabulary', 'vocabulary-entry-client.tsx');
const TABLE = read('app', '(public-content)', 'vocabulary', 'vocabulary-table.tsx');
const SEARCH = read('app', '(public-content)', 'vocabulary', 'vocabulary-search.tsx');
const SAVE = read('components', 'library', 'save-word-button.tsx');
const API = read('lib', 'vocabulary-api.ts');
const BROWSER_API = read('lib', 'browser-api.ts');
const CONTRACT = read('lib', 'openapi-contract.ts');
const TYPES = read('lib', 'vocabulary-types.ts');
const LAYOUT = read('app', '(public-content)', 'layout.tsx');
const WORKFLOW = read('..', '.github', 'workflows', 'next-native-browser.yml');
const FIXTURE_API = read('tooling', 'next-native-fixture-api.mjs');
const BROWSER = read('tooling', 'verify-vocabulary-wiki-flow.mjs');

describe('/vocabulary native public wiki (LIBRARY-0061 T015)', () => {
  test('route is public PPR and loads canonical server data', () => {
    assert.match(PAGE, /<Suspense fallback={<VocabularySkeleton \/>}>/);
    assert.match(PAGE, /import \{ connection \} from 'next\/server'/);
    assert.match(PAGE, /await connection\(\);/);
    assert.match(PAGE, /getVocabularyCategories\(\)/);
    assert.match(PAGE, /getVocabularyDirectory\(\{ category: effective \}\)/);
    assert.match(PAGE, /!directory\.categories\.some\(\(item\) => item\.slug === effective\)/);
    assert.match(PAGE, /effective = ''[\s\S]*?getVocabularyDirectory\(\)/);
    assert.match(PAGE, /getVocabularyArticle\(selected\.category, selected\.slug\)/);
    assert.match(PAGE, /resolveVocabularySelection\(categories\.flatMap/);
    assert.match(API, /getPublicJson\('\/api\/vocabulary\/categories'\)/);
    assert.match(API, /getPublicJson<VocabularyDirectoryWire>\(`\/api\/vocabulary\/directory\?\$\{params\.toString\(\)\}`\)/);
    assert.match(TYPES, /ApiGetJson<'\/api\/vocabulary\/directory'>/);
    assert.match(CONTRACT, /export type ApiGetJson<Path extends ApiGetPath>/);
    assert.match(BROWSER_API, /window\.api\.getWith<ApiGetJson<Path>>/);
    assert.match(BROWSER_API, /searchParamsSuffix\(query\)/);
    assert.doesNotMatch(BROWSER_API, /query\?\.size/);
    assert.match(TABLE, /getBrowserJson\('\/api\/vocabulary\/directory', params, controller\.signal\)/);
    assert.match(API, /\/api\/vocabulary\/articles\/\$\{encodeURIComponent\(category\)\}\/\$\{encodeURIComponent\(slug\)\}/);
    assert.doesNotMatch(PAGE, /AuthProvider|login\.html|vocabulary\.js/);
  });

  test('each entry declares its own canonical URL; other views keep /vocabulary (FR-050)', () => {
    assert.match(PAGE, /export async function generateMetadata/);
    assert.match(PAGE, /alternates: \{ canonical: entryHref\(article\) \}/);
    assert.match(PAGE, /alternates: \{ canonical: '\/vocabulary' \}/);
    assert.match(PAGE, /`\$\{article\.headword\} — nghĩa, phát âm, cách dùng \| Aver Learning`/);
    assert.doesNotMatch(PAGE, /export const metadata/);
  });

  test('lists page through the directory with abortable requests and real entry links', () => {
    assert.match(TABLE, /requestRef\.current\?\.abort\(\)/);
    assert.match(TABLE, /new AbortController\(\)/);
    assert.match(TABLE, /controller\.signal\.aborted \|\| \(caught instanceof DOMException/);
    assert.match(TABLE, /normalizeVocabularyDirectory\(payload\)/);
    assert.match(TABLE, /offset: String\(directory\.items\.length\)/);
    assert.match(TABLE, /Xem thêm \(\$\{remaining\}\)/);
    assert.match(TABLE, /<a href=\{entryHref\(word\)\}>/);
    assert.match(SEARCH, /action="\/vocabulary" method="get" role="search"/);
    assert.match(SEARCH, /role="combobox"/);
  });

  test('audio, anonymous feedback, analytics and the word bank keep their canonical contracts', () => {
    assert.match(ENTRY, /ListenButton/);
    assert.doesNotMatch(ENTRY + ENTRY_CLIENT, /speechSynthesis/);
    assert.match(ENTRY_CLIENT, /window\.api\.post\('\/api\/feedback'/);
    assert.match(ENTRY_CLIENT, /skill: 'vocabulary'/);
    assert.match(ENTRY_CLIENT, /category: reason === 'audio' \? 'audio_issue' : 'content_issue'/);
    assert.match(ENTRY_CLIENT, /event_name: 'vocab_wiki_viewed'/);
    assert.match(SAVE, /'\/api\/vocabulary\/bank\/stats'/);
    assert.match(SAVE, /window\.api\.post\('\/api\/vocabulary\/bank\/'/);
    assert.match(SAVE, /PENDING_SAVE_KEY = 'aver-pending-save-word'/);
  });

  test('look-up results never claim a word is missing when the catalogue did not load', () => {
    assert.doesNotMatch(API, /getVocabularyDirectory\([^)]*\)\.catch/);
    assert.match(PAGE, /function ResultsUnavailable/);
    assert.match(PAGE, /catch \{\n    return <ResultsUnavailable query=\{query\} \/>;/);
    assert.doesNotMatch(PAGE, /getVocabularyCategories\(\)\.catch\(\(\) => \[\]\)/);
  });

  test('card stylesheet remains before Tailwind and native browser coverage is wired', () => {
    assert.ok(LAYOUT.indexOf('/css/vocab-wiki.css') < LAYOUT.indexOf('/css/tailwind.build.css'));
    assert.equal(canonicalNextRouteForLegacy('/vocabulary.html'), '/vocabulary');
    assert.match(WORKFLOW, /frontend\/app\/\(public-content\)\/vocabulary\/\*\*/);
    assert.match(WORKFLOW, /Kiểm luồng Vocabulary Wiki native[\s\S]*?verify-vocabulary-wiki-flow\.mjs/);
    assert.match(FIXTURE_API, /url\.pathname === '\/api\/vocabulary\/directory'/);
    assert.match(BROWSER, /danh mục chỉ hydrate batch đầu rồi tải thêm theo nhu cầu/);
    assert.match(BROWSER, /canonical của mục từ là chính URL mục từ/);
  });

  test('auth-aware chrome and learner/admin entry points use the clean owner URL', () => {
    const chrome = read('public', 'js', 'components', 'aver-chrome.js');
    const hub = read('app', '(authed-vocabulary-hub)', 'vocabulary', 'hub', 'vocabulary-hub-behavior.tsx');
    const feedback = read('lib', 'admin-feedback-model.mjs');
    assert.match(chrome, /loggedIn \? '\/vocabulary\/hub' : '\/vocabulary'/);
    assert.doesNotMatch(chrome, /loggedIn \? '\/vocabulary\/hub' : '\/vocabulary\.html'/);
    assert.match(hub, /href={`\/vocabulary\?cat=\$\{encodedSlug\}`}/);
    assert.match(feedback, /`\/vocabulary\?cat=\$\{encodeURIComponent/);
  });
});

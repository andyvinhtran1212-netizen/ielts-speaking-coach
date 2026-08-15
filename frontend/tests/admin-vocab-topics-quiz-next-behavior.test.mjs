import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const TOPICS = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'topics', 'admin-vocab-topics.tsx');
const QUIZ = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'quiz', 'admin-vocab-quiz-import.tsx');
const HUB = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'page.tsx');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');

describe('Admin Topics + Quick-Check native ownership', () => {
  test('owns clean routes and retains rollback HTML', () => {
    assert.ok(existsSync(join(ROOT, 'app', '(authed-admin-vocab)', 'admin', 'vocab', 'topics', 'page.tsx')));
    assert.ok(existsSync(join(ROOT, 'app', '(authed-admin-vocab)', 'admin', 'vocab', 'quiz', 'page.tsx')));
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'vocab', 'topics.html')));
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'vocab', 'quiz.html')));
    assert.match(HUB, /href: '\/admin\/vocab\/topics'/);
    assert.match(HUB, /href: '\/admin\/vocab\/quiz'/);
    assert.match(CHROME, /slug: 'topics'[^\n]*href: '\/admin\/vocab\/topics'/);
    assert.match(CHROME, /slug: 'quiz'[^\n]*href: '\/admin\/vocab\/quiz'/);
  });

  test('topic writes require strict ACK and canonical list or bundle readback', () => {
    assert.match(TOPICS, /normalizeTopicAck\(await window\.api\.post/);
    assert.match(TOPICS, /normalizeTopicAck\(await window\.api\.patch/);
    assert.ok((TOPICS.match(/fetchTopics\(skill\)/g) || []).length >= 3);
    assert.ok((TOPICS.match(/fetchBundle\(skill/g) || []).length >= 3);
    assert.match(TOPICS, /normalizeDeleteAck/);
    assert.match(TOPICS, /mutationLock\.current/);
    assert.match(TOPICS, /setDetailLoading\(true\); setBundle\(null\); setDraft\(null\);[^\n]*setNotice\(null\)/);
    assert.match(TOPICS, /\}, \[fetchBundle, selectedId\]\);/);
    assert.doesNotMatch(TOPICS, /\bconfirm\(|\balert\(/);
  });

  test('deep links are admitted through scoped canonical lists', () => {
    assert.match(TOPICS, /requestedAllowed = isUuid\(requested\) && rows\.some/);
    assert.match(QUIZ, /admitted = isUuid\(requested\) && topicRows\.some/);
    assert.match(QUIZ, /topics\.some\(\(topic\) => topic\.id === selectedTopic\)/);
  });

  test('quiz commit is one-shot, strict, locked and followed by canonical readback', () => {
    assert.match(QUIZ, /dry_run=true/);
    assert.match(QUIZ, /dry_run=false&topic_id=/);
    assert.match(QUIZ, /normalizeImportResult/);
    assert.match(QUIZ, /const canonical = await fetchBanks\(skill\)/);
    assert.match(QUIZ, /Không tự động retry write này/);
    assert.match(QUIZ, /mutationLock\.current/);
    assert.match(QUIZ, /const \[committed, setCommitted\] = useState\(false\)/);
    assert.match(QUIZ, /!!preview && !committed/);
    assert.match(QUIZ, /setPreview\(value as ImportPreview\); setCommitted\(true\)/);
    assert.match(QUIZ, /className="av-modal-backdrop avv-dialog"/);
    assert.doesNotMatch(QUIZ, /\bconfirm\(|\balert\(/);
  });
});

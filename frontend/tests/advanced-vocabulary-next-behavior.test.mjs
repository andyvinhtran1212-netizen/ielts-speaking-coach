import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const UI = read('app', '(authed-advanced-vocab)', 'advanced-vocabulary', 'advanced-vocabulary-lesson.tsx');
const CSS = read('public', 'css', 'advanced-vocab-lesson.css');
const MANIFEST = JSON.parse(read('..', 'backend', 'content', 'advanced_vocab', 'core30-manifest.json'));
const LESSONS = MANIFEST.lessons.map(({ lesson_id }) => JSON.parse(read('..', 'backend', 'content', 'advanced_vocab', `${lesson_id}.json`)));

describe('Advanced Vocabulary core-30 content and interaction contract', () => {
  test('ships 30 lessons, 720 enriched cards and both Kokoro recordings per word', () => {
    assert.equal(MANIFEST.lesson_count, 30);
    assert.equal(LESSONS.length, 30);
    assert.equal(LESSONS.reduce((sum, lesson) => sum + lesson.vocabulary.length, 0), 720);
    for (const lesson of LESSONS) {
      assert.equal(lesson.vocabulary.length, 24);
      for (const word of lesson.vocabulary) {
        assert.ok(word.common_error);
        assert.ok(existsSync(join(ROOT, 'public', 'assets', 'advanced-vocab', lesson.lesson_id, 'vocab', basename(word.audio_headword))));
        assert.ok(existsSync(join(ROOT, 'public', 'assets', 'advanced-vocab', lesson.lesson_id, 'vocab', basename(word.audio_example))));
      }
      assert.ok(existsSync(join(ROOT, 'public', 'assets', 'advanced-vocab', lesson.lesson_id, 'listening', 'full_test.mp3')));
      for (const illustration of lesson.media.wt1_illustrations) {
        assert.ok(existsSync(join(ROOT, 'public', 'assets', 'advanced-vocab', lesson.lesson_id, 'writing', basename(illustration))));
      }
    }
    assert.match(UI, /audio_headword/);
    assert.match(UI, /audio_example/);
  });

  test('renders every selected practice input with a compatible answer shape', () => {
    assert.match(UI, /question\.input === 'syllable'/);
    assert.match(UI, /onChange\(index\)/);
    assert.match(UI, /question\.input === 'boolean'/);
    assert.match(UI, /\[true, 'Đúng'\], \[false, 'Sai'\]/);
    assert.match(UI, /response_time_ms/);
    assert.match(UI, /question\.audio_url/);
    assert.match(UI, /function InlineText/);
  });

  test('canonical IELTS truth-value controls win over stray authored options', () => {
    const truthBranch = UI.indexOf("/T\\/F\\/NG/i.test");
    const opinionBranch = UI.indexOf("/Y\\/N\\/NG/i.test");
    const genericOptions = UI.indexOf('question.options?.length');
    assert.ok(truthBranch >= 0 && truthBranch < genericOptions);
    assert.ok(opinionBranch >= 0 && opinionBranch < genericOptions);
    assert.match(UI, /\['YES', 'NO', 'NOT GIVEN'\]/);
  });

  test('keeps passage and questions as independently scrollable reading panes', () => {
    assert.match(UI, /avx-reading-passage/);
    assert.match(UI, /avx-reading-questions/);
    assert.match(UI, /Bài đọc/);
    assert.match(UI, /setMobilePane\('questions'\)/);
    assert.match(UI, /avx-reading-group/);
    assert.match(CSS, /\.avx-reading-pane\s*\{[^}]*overflow-y:\s*auto/s);
    assert.match(CSS, /\.avx-reading-pane\.is-mobile-active\s*\{[^}]*display:\s*block/s);
    assert.match(UI, /aria-controls="avx-reading-panel-passage"/);
    assert.match(UI, /role="tabpanel"/);
    assert.match(UI, /function readingSupportLines/);
    assert.match(UI, /!questionStems\.has\(text\)/);
    assert.match(UI, /sharedStem/);
    assert.match(UI, /avx-reading-shared-stem/);
  });

  test('ships and renders listening figures required by map questions', () => {
    const map = join(ROOT, 'public', 'assets', 'advanced-vocab', 'ADV-T11', 'listening', 'VOC-ADV-LIS-LSN-T11_map.svg');
    assert.ok(existsSync(map));
    assert.match(UI, /section\.figure_url/);
    assert.match(UI, /avx-listening-figure/);
    assert.match(CSS, /\.avx-listening-figure img/);
  });

  test('reopens completed stages without asking the learner to submit again', () => {
    assert.match(UI, /Đã hoàn tất phần này/);
    assert.match(UI, /Reading đã được lưu/);
    assert.match(UI, /Listening đã được lưu/);
    assert.match(UI, /completed=\{completed\.has\('reading'\)\}/);
    assert.match(UI, /completed=\{completed\.has\('listening'\)\}/);
  });

  test('requires controlled rewrite self-check without creating a writing submission', () => {
    assert.match(UI, /ControlledRewriteStage/);
    assert.match(UI, /controlled-rewrite\/complete/);
    assert.match(UI, /Câu trả lời chỉ nằm trên thiết bị này/);
    assert.match(UI, /attempted_item_ids/);
  });

  test('keeps Writing and Speaking reference-only with no submission control', () => {
    assert.match(UI, /Nội dung tham khảo — không phải nơi nộp bài/);
    assert.match(UI, /Giáo viên cần giao một Writing assignment riêng/);
    assert.match(UI, /không có điểm tổng mặc định/);
    assert.doesNotMatch(UI, /<textarea|MediaRecorder|getUserMedia/);
  });
});

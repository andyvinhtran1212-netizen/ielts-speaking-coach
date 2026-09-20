import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  preserveControlledRewriteResult,
  preserveInitialListeningResult,
  preserveReadingResult,
  questionOptionIdentity,
  readingSupportLines,
} from '../lib/advanced-vocabulary-model.mjs';

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
    assert.match(UI, /typeof answer === 'string' && answer\.trim\(\) === ''/);
    assert.match(UI, /disabled=\{busy \|\| answerMissing\}/);
  });

  test('canonical IELTS truth-value controls are scoped to section questions', () => {
    const truthBranch = UI.indexOf("/T\\/F\\/NG/i.test");
    const opinionBranch = UI.indexOf("/Y\\/N\\/NG/i.test");
    const genericOptions = UI.indexOf('question.options?.length');
    assert.ok(truthBranch >= 0 && truthBranch < genericOptions);
    assert.ok(opinionBranch >= 0 && opinionBranch < genericOptions);
    assert.match(UI, /fixedChoiceMode = false/);
    assert.match(UI, /fixedChoiceMode && \/T\\\/F\\\/NG\/i\.test/);
    assert.match(UI, /fixedChoiceMode && \/Y\\\/N\\\/NG\/i\.test/);
    assert.match(UI, /disabled=\{!!result\} fixedChoiceMode/);
    assert.match(UI, /disabled=\{Boolean\(result\) && !needsRetry\} fixedChoiceMode/);
    assert.match(UI, /value=\{answer\} onChange=\{setAnswer\} disabled=\{!!feedback \|\| busy\} \/>/);
    assert.match(UI, /\['YES', 'NO', 'NOT GIVEN'\]/);
  });

  test('submits authored option keys for key-only MCQs', () => {
    assert.deepEqual(questionOptionIdentity({ key: 'A', text: 'Alpha' }, 0), {
      answer: 'A', label: 'A. Alpha',
    });
    assert.deepEqual(questionOptionIdentity('Alpha', 2), {
      answer: 2, label: 'Alpha',
    });
    assert.match(UI, /questionOptionIdentity\(option, index\)/);
    assert.match(UI, /onChange\(identity\.answer\)/);
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
    for (const lesson of LESSONS) {
      const reading = lesson.activities.find((row) => row.activity_type === 'reading_lab').content;
      const support = readingSupportLines(reading);
      const mcqOptions = reading.questions.filter((question) => /MCQ|multiple choice/i.test(question.question_type)).flatMap((question) => question.options || []).map((option) => option.text);
      assert.ok(!support.some((line) => mcqOptions.filter((option) => line.toLowerCase().includes(option.toLowerCase())).length >= 2));
      assert.doesNotMatch(support.join('\n'), /master\s+answer\s+key|answer\s+key|vocabulary\s+profile|quality\s+checks?|supplement\b|\b\d+[YNT]\s*\(/i);
    }
    const t01Support = readingSupportLines(LESSONS[0].activities.find((row) => row.activity_type === 'reading_lab').content);
    assert.ok(t01Support.some((line) => line.startsWith('List of researchers A.')));
    assert.ok(t01Support.some((line) => line.startsWith('Box: A.')));
    assert.match(UI, /sharedStem/);
    assert.match(UI, /avx-reading-shared-stem/);
    assert.match(UI, /function ReadingSupportMaterial/);
    assert.match(UI, /<pre className="avx-reading-diagram"/);
    assert.match(CSS, /\.avx-reading-diagram\s*\{[^}]*overflow-x:\s*auto[^}]*white-space:\s*pre/s);
    for (const lessonId of ['ADV-T13', 'ADV-T22']) {
      const lesson = LESSONS.find((row) => row.lesson_id === lessonId);
      const reading = lesson.activities.find((row) => row.activity_type === 'reading_lab').content;
      assert.ok(readingSupportLines(reading).some((line) => /^\s{2,}\S/.test(line)));
    }
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
    assert.match(UI, /saved\?\.review \|\| null/);
    assert.match(UI, /saved\?\.review \|\| \(content\.initial_attempt/);
  });

  test('preserves boundary results when stage navigation remounts each child', () => {
    const initial = {
      progress: { completed_stages: ['practice_2'], sections: [] },
      lesson: { activities: {
        controlled_rewrite: { content: { prompts: [{ item_id: 'rewrite-01' }] } },
        listening: { questions: [{ question_number: 1 }] },
      } },
    };
    const readingResponse = {
      total: 13, correct: 10, pct: 76.92, submitted_at: 'now',
      answer_results: [{ id: '1', submitted_answer: 'A', is_correct: true }],
      answers: [{ id: '1', answer: 'A' }],
    };
    const afterReading = preserveReadingResult(initial, readingResponse);
    assert.equal(afterReading.progress.sections[0].review, readingResponse);
    assert.ok(afterReading.progress.completed_stages.includes('reading'));

    const rewriteResponse = {
      solutions: [{ type: 'paragraph', text: 'Suggested rewrite' }],
      progress: { ...afterReading.progress, completed_stages: ['practice_2', 'reading', 'controlled_rewrite'] },
    };
    const afterRewrite = preserveControlledRewriteResult(afterReading, rewriteResponse);
    assert.deepEqual(afterRewrite.lesson.activities.controlled_rewrite.content.solutions, rewriteResponse.solutions);

    const listeningResponse = {
      requires_guided_retry: true,
      answer_results: [{ id: '1', submitted_answer: 'B', is_correct: false }],
      progress: { ...afterRewrite.progress, listening_submitted: true },
    };
    const afterListening = preserveInitialListeningResult(afterRewrite, listeningResponse);
    assert.equal(afterListening.lesson.activities.listening.initial_attempt, listeningResponse);
    assert.equal(afterListening.progress.listening_submitted, true);
    assert.match(UI, /preserveReadingResult\(current, response\)/);
    assert.match(UI, /preserveControlledRewriteResult\(current, response\)/);
    assert.match(UI, /preserveInitialListeningResult\(current, response\)/);
  });

  test('withholds Listening solutions until a persisted guided retry', () => {
    assert.match(UI, /listening\/guided-retry/);
    assert.match(UI, /Guided retry/);
    assert.match(UI, /Đáp án và evidence chỉ hiện sau bước này/);
    assert.match(UI, /result\?\.requires_guided_retry/);
  });

  test('renders authored Listening evidence controls and the initial distractor rationale', () => {
    assert.match(UI, /ref=\{audioRef\}/);
    assert.match(UI, /solution\?\.timing\?\.answer_span\?\.start/);
    assert.match(UI, /audio\.currentTime = start/);
    assert.match(UI, /audio\.currentTime < end/);
    assert.match(UI, /initial_answer_results/);
    assert.match(UI, /solution\?\.distractor_rationales\?\.\[initialChoice\]/);
    assert.match(UI, /Vì sao lựa chọn ban đầu chưa đúng/);
    assert.match(UI, /Nghe đoạn evidence/);
  });

  test('submits all controlled rewrite answers once for batch grammar and style feedback', () => {
    assert.match(UI, /ControlledRewriteStage/);
    assert.match(UI, /controlled-rewrite\/complete/);
    assert.match(UI, /Một lượt gửi chấm cho mỗi unit/);
    assert.match(UI, /Gửi chấm một lần/);
    assert.match(UI, /\.\.\.base, answers/);
    assert.match(UI, /submission\?\.feedback/);
    assert.doesNotMatch(UI, /attempted_item_ids/);
  });

  test('keeps Writing and Speaking reference-only with no submission control', () => {
    assert.match(UI, /Nội dung tham khảo — không phải nơi nộp bài/);
    assert.match(UI, /Giáo viên cần giao một Writing assignment riêng/);
    assert.match(UI, /không có điểm tổng mặc định/);
    assert.match(UI, /sections=\{task\.prompt_analysis\}/);
    assert.match(UI, /sections=\{task\.outline\}/);
    assert.doesNotMatch(UI, /sections=\{content\.prompt_analysis\}|sections=\{content\.outline\}/);
    assert.doesNotMatch(UI, /<textarea|MediaRecorder|getUserMedia/);
  });
});

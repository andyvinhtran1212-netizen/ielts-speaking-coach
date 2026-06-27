// Mục 21 (B3 follow-up) — practice.js must explain WHY a sample/improved answer
// is absent (backend sends sample_answer_status / improved_response_status)
// instead of rendering nothing. Structural assertions over the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'js', 'practice.js'), 'utf8');

test('defines the sample-unavailable explanation block', () => {
  assert.match(src, /function\s+_sampleUnavailableBlock\s*\(/);
  // neutral explanation (PR #594 review): describes the missing sample without
  // blaming the learner's answer as off-topic.
  assert.match(src, /Chưa tạo được mẫu câu trả lời/);
  assert.doesNotMatch(src, /câu trả lời của bạn lệch khỏi chủ đề/);
});

test('renders the explanation when sample_answer is absent but status is set', () => {
  assert.match(
    src,
    /data\.sample_answer\s*\?\s*_sampleAnswerBlock\(data\.sample_answer\)\s*:\s*\(data\.sample_answer_status\s*\?\s*_sampleUnavailableBlock\(\)/,
  );
});

test('renders the explanation for improved_response too', () => {
  assert.match(
    src,
    /data\.improved_response\s*\?\s*_improvedBlock\(data\.improved_response\)\s*:\s*\(data\.improved_response_status\s*\?\s*_sampleUnavailableBlock\(\)/,
  );
});

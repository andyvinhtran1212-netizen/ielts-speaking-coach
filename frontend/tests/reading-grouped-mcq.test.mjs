import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.dirname(HERE);
const read = (relative) => readFileSync(path.join(FRONTEND, relative), 'utf8');

describe('legacy Reading grouped Cambridge MCQ', () => {
  const js = read('public/js/reading-exam.js');
  const css = read('css/reading-exam.css');

  test('detects only repeated TWO/THREE mcq_single rows with the same option bank', () => {
    assert.match(js, /function\s+_groupedMcqChooseCount\s*\(run\)/);
    assert.match(js, /\(TWO\|THREE\)/);
    assert.match(js, /_mcqOptionFingerprint\(q\)\s*!==\s*fingerprint/);
  });

  test('renders one checkbox group while preserving one autosave value per q_num', () => {
    assert.match(js, /function\s+_renderGroupedMcqRun\s*\(run\)/);
    assert.match(js, /_summaryGapChanged\(q\.q_num,\s*selected\[index\]\s*\|\|\s*['"]['"]\)/);
    assert.match(js, /groupEl\.appendChild\(_renderGroupedMcqRun\(run\)\)/);
  });

  test('restores grouped selections and locks extra choices at the authored count', () => {
    assert.match(js, /querySelectorAll\(['"]\.exam-q--grouped-mcq['"]\)/);
    assert.match(js, /boxes\[j\]\.disabled\s*=\s*!boxes\[j\]\.checked\s*&&\s*lock/);
    assert.match(css, /\.exam-q--grouped-mcq/);
  });
});

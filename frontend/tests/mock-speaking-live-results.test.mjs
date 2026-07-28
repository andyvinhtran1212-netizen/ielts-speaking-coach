/**
 * mock-speaking-live-results.test.mjs — Speaking thi trực tiếp với giáo viên.
 *
 * C2-FINAL-20260726: 13/14 học viên thi Speaking trực tiếp, kỳ thi không có
 * speaking_topic_set. Ba mặt phải khớp nhau: console có ô band Speaking khi
 * có dữ liệu chấm trực tiếp, server nhận band ngoài required (backend test),
 * và TRF render khối Speaking có cấu trúc thay vì "[object Object]".
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = (...p) => readFileSync(join(__dirname, '..', 'public', ...p), 'utf8');
const CONSOLE = pub('js', 'admin-mock-reviews.js');
const TRF = pub('pages', 'mock-result.html');

describe('console duyệt bài — ô band Speaking tuỳ dữ liệu', () => {
  test('ô nhập sinh từ bandSkills(), không phải reqSkills()', () => {
    // reqSkills() theo cấu hình kỳ thi — kỳ thi này không có speaking nên ô
    // Speaking không bao giờ hiện, và band giáo viên chấm không có chỗ nhập.
    assert.match(CONSOLE, /function bandSkills\(\)/);
    assert.match(CONSOLE, /var bandInputs = bandSkills\(\)\.map/);
    assert.doesNotMatch(CONSOLE, /var bandInputs = reqSkills\(\)\.map/);
  });

  test('chỉ thêm Speaking khi CÓ bài chấm trực tiếp', () => {
    // Mọi kỳ thi LRW khác không được tự mọc ô Speaking.
    assert.match(CONSOLE, /ai_draft \|\| \{\}\)\.speaking != null/);
    assert.match(CONSOLE, /per_skill_notes \|\| \{\}\)\.speaking != null/);
  });

  test('lưu band đọc từ bandSkills() — band nhập rồi không bị bỏ rơi', () => {
    const at = CONSOLE.indexOf('function collectBands');
    assert.match(CONSOLE.slice(at, at + 300), /bandSkills\(\)\.forEach/);
  });

  test('ô Speaking ghi rõ nguồn: thi trực tiếp', () => {
    assert.match(CONSOLE, /speaking:\s*'Thi trực tiếp với giáo viên'/);
  });
});

describe('TRF học viên — khối Speaking có cấu trúc', () => {
  test('object speaking đi khối riêng, không rơi vào ghi chú text', () => {
    // esc(object) render "[object Object]" cho học viên.
    assert.match(TRF, /typeof notes\.speaking === 'object'/);
    assert.match(TRF, /function renderSpeaking\(spk\)/);
    assert.match(TRF, /id="speaking-wrap"/);
  });

  test('nội dung do người chấm viết đi qua textContent, không innerHTML', () => {
    const fn = TRF.slice(TRF.indexOf('function renderSpeaking'),
                         TRF.indexOf('function render(data)'));
    // Lột chú thích trước khi soi — chữ "innerHTML" trong một dòng chú thích
    // từng làm sentinel này đỏ oan (cùng lớp bẫy với vụ Tailwind quét chữ
    // `ring` trong comment).
    const code = fn.replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(code, /innerHTML/);
    assert.match(code, /textContent/);
  });

  test('đủ ba tầng nội dung: band tiêu chí, số đo so lớp, cách luyện', () => {
    const fn = TRF.slice(TRF.indexOf('function renderSpeaking'),
                         TRF.indexOf('function render(data)'));
    assert.match(fn, /Fluency & Coherence/);
    assert.match(fn, /Trung bình lớp/);
    assert.match(fn, /Cách luyện: /);
  });
});

/**
 * Bài tập lớp Part 1/3: học viên phải NGHE, không được đọc.
 *
 * Chốt thật nằm ở backend (chữ không rời máy chủ). Những phép kiểm ở đây bảo vệ
 * mặt còn lại: trang phải xử lý được việc KHÔNG CÓ chữ mà không đọc ra như một
 * trang tải hỏng, và không được hứa một nút "Hiện câu hỏi" mà bấm vào không có
 * gì xảy ra.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(join(HERE, '..', 'public', 'js', 'practice.js'), 'utf8');
const HTML = readFileSync(join(HERE, '..', 'public', 'pages', 'practice.html'), 'utf8');
const CSS = readFileSync(join(HERE, '..', 'public', 'css', 'speaking-assignment.css'), 'utf8');

// Chú thích giải thích cờ này khá dài — quét cả chú thích thì chính lời giải
// thích sẽ làm xanh phép kiểm.
const codeOnly = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

const CODE = codeOnly(JS);

/** Chạy _applyListenOnlyUI thật với DOM giả. */
function loadFn() {
  const start = JS.indexOf('  function _applyListenOnlyUI(');
  const end = JS.indexOf('  function showState(');
  assert.ok(start !== -1 && end > start, '_applyListenOnlyUI not found');

  const els = {};
  const mk = (id) => (els[id] = {
    id,
    _cls: new Set(['hidden']),
    _attr: {},
    classList: {
      toggle(c, on) { on ? els[id]._cls.add(c) : els[id]._cls.delete(c); },
      add(c) { els[id]._cls.add(c); },
      remove(c) { els[id]._cls.delete(c); },
      contains(c) { return els[id]._cls.has(c); },
    },
    getAttribute(k) { return els[id]._attr[k] ?? null; },
    setAttribute(k, v) { els[id]._attr[k] = v; },
    removeAttribute(k) { delete els[id]._attr[k]; },
    pause() { els[id].paused = true; },
    textContent: '',
  });
  ['prep-q-card', 'prep-listen', 'prep-listen-audio', 'prep-listen-error'].forEach(mk);

  const $ = (id) => els[id] || null;
  let _currentQ = null;
  const fn = new Function('$', '_currentQ_ref', `
    let _currentQ = _currentQ_ref.q;
    ${JS.slice(start, end)}
    return _applyListenOnlyUI;`);
  const ref = { q: null };
  return { run: (on, q) => { ref.q = q; fn($, ref)(on); }, els, ref };
}

describe('chuyển sang chế độ nghe', () => {
  test('khối chữ bị ẩn HẲN, không phải để rỗng', () => {
    // Một thẻ "Câu hỏi" trống là lời hứa hỏng — người học tưởng trang chưa tải xong.
    const h = loadFn();
    h.run(true, { audio_url: 'https://cdn/a.mp3' });
    assert.equal(h.els['prep-q-card'].classList.contains('hidden'), true);
    assert.equal(h.els['prep-listen'].classList.contains('hidden'), false);
  });

  test('nguồn audio được gắn vào trình phát', () => {
    const h = loadFn();
    h.run(true, { audio_url: 'https://cdn/a.mp3' });
    assert.equal(h.els['prep-listen-audio'].getAttribute('src'), 'https://cdn/a.mp3');
  });

  test('không audio VÀ không chữ → nói ra, đừng để ô phát rỗng', () => {
    const h = loadFn();
    h.run(true, { audio_url: '' });
    const err = h.els['prep-listen-error'];
    assert.equal(err.classList.contains('hidden'), false);
    assert.match(err.textContent, /chưa có bản đọc đề/i);
    assert.equal(h.els['prep-listen-audio'].getAttribute('src'), null);
  });

  test('quay lại chế độ đọc thì gỡ nguồn và dừng phát', () => {
    // Để nguyên src thì câu trước còn phát chồng lên câu sau.
    const h = loadFn();
    h.run(true, { audio_url: 'https://cdn/a.mp3' });
    h.run(false, { question_text: 'Where do you live?' });
    assert.equal(h.els['prep-listen-audio'].getAttribute('src'), null);
    assert.equal(h.els['prep-listen-audio'].paused, true);
    assert.equal(h.els['prep-q-card'].classList.contains('hidden'), false);
  });
});

describe('không hứa cái nút không làm được gì', () => {
  test('nút "Hiện câu hỏi" bị ẩn ở chế độ nghe', () => {
    // Ở Full Test, chữ nằm sẵn trong trang và chỉ bị giấu — bấm là hiện được.
    // Ở đây chữ chưa từng rời máy chủ, nên nút đó là một lời hứa hỏng.
    // Cắt ĐÚNG khối `if (listenOnly) { … }` rồi mới kiểm. Quét cả một khoảng
    // dài quanh nó thì phép kiểm lọt sang nhánh `else` phía dưới — nhánh đó
    // cũng ẩn nút, nên phép phá "bỏ dòng ẩn nút" vẫn xanh.
    const i = CODE.indexOf('if (listenOnly) {');
    assert.ok(i !== -1, 'listenOnly branch not found');
    const j = CODE.indexOf('} else if', i);
    const branch = CODE.slice(i, j);
    assert.match(branch, /revealBtn[^;]*display\s*=\s*'none'/,
      'nhánh nghe phải ẩn nút "Hiện câu hỏi" — chữ chưa từng rời máy chủ');
  });

  test('cờ được đọc từ dữ liệu, không suy từ chuỗi rỗng', () => {
    // Một câu bình thường cũng có thể rỗng vì lỗi; khi đó phải hiện lỗi chứ
    // không lặng lẽ chuyển sang chế độ nghe.
    assert.match(CODE, /listen_only/);
    assert.doesNotMatch(CODE, /listenOnly\s*=\s*!\s*_currentQ\.question_text/);
  });
});

describe('trang và style', () => {
  test('markup có khối nghe kèm trình phát', () => {
    assert.match(HTML, /id="prep-listen"/);
    assert.match(HTML, /id="prep-listen-audio"[^>]*controls/);
  });

  test('nói rõ vì sao không có chữ', () => {
    assert.match(HTML, /Không có bản chữ/);
  });

  test('dùng trình phát mặc định của trình duyệt', () => {
    // Vẽ lại một trình phát riêng đánh đổi phím tắt + trình đọc màn hình lấy
    // vẻ ngoài.
    assert.match(CSS, /\.prep-listen__audio\s*\{[^}]*width:\s*100%/);
  });
});

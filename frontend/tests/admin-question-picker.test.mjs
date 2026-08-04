/**
 * Bộ chọn câu hỏi khi giao bài Speaking.
 *
 * Thao tác HẰNG NGÀY, nên mọi phép kiểm ở đây là về việc giáo viên làm nhanh và
 * không bị đánh lừa — không phải về vẻ ngoài.
 *
 * Ý chính: THỨ TỰ CHỌN LÀ THÔNG TIN. Part 1 là một mạch hội thoại và backend
 * giữ đúng thứ tự bấm, nên ô chọn chính là số thứ tự. Checkbox sẽ xoá mất nó.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');
const HTML = readFileSync(join(HERE, '..', 'public', 'pages', 'admin', 'classes', 'index.html'), 'utf8');
const CSS = readFileSync(join(HERE, '..', 'public', 'css', 'speaking-assignment.css'), 'utf8');

/** Chạy THẬT toggleQpick + renderQpick với DOM giả. */
function load(items, want) {
  const start = SRC.indexOf('let _qpick = {');
  const end = SRC.indexOf('async function loadQpick(');
  assert.ok(start !== -1 && end > start, 'qpick block not found');

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const nodes = {
    // `dataset` có ở CẢ HAI node: bộ hiển thị đánh dấu chế độ chọn lên chính
    // danh sách (data-pick), và một node giả thiếu thuộc tính ấy sẽ đổ ở nơi mã
    // thật chạy bình thường.
    'hf-qpick-list': { innerHTML: '', dataset: {} },
    'hf-qpick-foot': { innerHTML: '', textContent: '', dataset: {} },
  };
  const $ = (id) => nodes[id];
  const document = { querySelector: () => ({ value: 'manual' }) };

  const api = new Function('esc', '$', 'document', `${SRC.slice(start, end)}
    return { toggleQpick, renderQpick, get state() { return _qpick; },
             set state(v) { _qpick = v; } };`)(esc, $, document);
  api.state = { items, picked: [], want, topicId: 't', part: '1' };
  api.renderQpick();
  return { ...api, nodes };
}

const Q = (id, giveable = true, level = 'easy') =>
  ({ id, question_text: `Câu ${id}`, level, giveable });

describe('ô chọn LÀ số thứ tự', () => {
  test('chưa chọn thì không mang số', () => {
    const p = load([Q('a'), Q('b'), Q('c')], 2);
    assert.doesNotMatch(p.nodes['hf-qpick-list'].innerHTML, /av-qpick__num" aria-hidden="true">[12]</);
  });

  test('bấm lần lượt thì ra 1 rồi 2 — đó là mạch hội thoại', () => {
    const p = load([Q('a'), Q('b'), Q('c')], 2);
    p.toggleQpick('c');
    p.toggleQpick('a');
    assert.deepEqual(p.state.picked, ['c', 'a'], 'thứ tự BẤM, không phải thứ tự danh sách');
    const html = p.nodes['hf-qpick-list'].innerHTML;
    assert.match(html, /data-id="c"[\s\S]{0,160}?__num" aria-hidden="true">1</);
    assert.match(html, /data-id="a"[\s\S]{0,160}?__num" aria-hidden="true">2</);
  });

  test('bỏ chọn câu số 1 thì câu số 2 dồn lên thành 1', () => {
    // Để nguyên số cũ sẽ hiện "2" mà không có "1" — người đọc tưởng mất một câu.
    const p = load([Q('a'), Q('b')], 2);
    p.toggleQpick('a');
    p.toggleQpick('b');
    p.toggleQpick('a');
    assert.deepEqual(p.state.picked, ['b']);
    assert.match(p.nodes['hf-qpick-list'].innerHTML,
      /data-id="b"[\s\S]{0,160}?__num" aria-hidden="true">1</);
  });
});

describe('ràng buộc số câu', () => {
  test('chọn quá số thì THAY câu đầu, không im lặng bỏ qua', () => {
    // Im lặng khiến giáo viên tưởng nút hỏng và bấm lại mấy lần.
    const p = load([Q('a'), Q('b'), Q('c')], 2);
    p.toggleQpick('a');
    p.toggleQpick('b');
    p.toggleQpick('c');
    assert.deepEqual(p.state.picked, ['b', 'c']);
  });

  test('chân trang đếm và nói còn thiếu mấy câu', () => {
    const p = load([Q('a'), Q('b'), Q('c')], 2);
    assert.match(p.nodes['hf-qpick-foot'].innerHTML, /0\/2/);
    assert.match(p.nodes['hf-qpick-foot'].innerHTML, /Chọn thêm 2 câu/);
    p.toggleQpick('a');
    assert.match(p.nodes['hf-qpick-foot'].innerHTML, /Chọn thêm 1 câu/);
  });

  test('đủ số thì nói rõ thứ tự trên là thứ tự học viên sẽ nghe', () => {
    const p = load([Q('a'), Q('b')], 2);
    p.toggleQpick('a');
    p.toggleQpick('b');
    assert.equal(p.nodes['hf-qpick-foot'].dataset.ready, 'true');
    assert.match(p.nodes['hf-qpick-foot'].innerHTML, /thứ tự học viên sẽ nghe/);
  });
});

describe('câu chưa giao được', () => {
  test('vẫn HIỆN, kèm lý do — không im lặng ẩn đi', () => {
    // Ẩn đi thì giáo viên thấy danh sách ngắn không rõ vì sao, và không biết
    // rằng chạy mẻ tạo audio là mở khoá được.
    const p = load([Q('a'), Q('b', false)], 2);
    const html = p.nodes['hf-qpick-list'].innerHTML;
    assert.match(html, /data-id="b"/, 'câu chưa giao được vẫn phải hiện');
    assert.match(html, /chưa có bản đọc/);
    assert.match(html, /data-id="b"[^>]*disabled/);
  });

  test('không chọn được kể cả khi gọi thẳng', () => {
    const p = load([Q('a'), Q('b', false)], 2);
    assert.match(p.nodes['hf-qpick-list'].innerHTML, /data-id="b"[^>]*disabled/);
  });

  test('nhãn độ khó hiện cạnh câu', () => {
    const p = load([Q('a', true, 'hard')], 1);
    assert.match(p.nodes['hf-qpick-list'].innerHTML, /data-level="hard"/);
  });

  test('câu chưa gắn nhãn không hiện chip rỗng', () => {
    const p = load([{ id: 'a', question_text: 'x', level: null, giveable: true }], 1);
    assert.doesNotMatch(p.nodes['hf-qpick-list'].innerHTML, /av-qpick__level/);
  });
});

describe('markup và style', () => {
  test('hai lựa chọn, mặc định là web bốc', () => {
    assert.match(HTML, /name="hf-qmode" value="random" checked/);
    assert.match(HTML, /name="hf-qmode" value="manual"/);
  });

  test('đổi chủ đề hoặc Part thì bỏ lựa chọn cũ', () => {
    // Giữ lại nghĩa là gửi id của câu thuộc chủ đề khác, và backend từ chối
    // đúng lúc giáo viên bấm Giao.
    assert.match(SRC, /_qpick\.topicId !== topicId \|\| _qpick\.part !== part[\s\S]{0,60}?picked = \[\]/);
  });

  test('phản hồi đến muộn không vẽ đè chủ đề đang chọn', () => {
    assert.match(SRC, /if \(\$\('hf-topic'\)\.value !== topicId \|\| \$\('hf-part'\)\.value !== part\) return;/);
  });

  test('chỉ gửi question_ids khi giáo viên THẬT SỰ đã chọn', () => {
    // Mảng rỗng cũng là "bỏ trống"; gửi nó chỉ làm hợp đồng mơ hồ.
    assert.match(SRC, /qmode\(\) === 'manual' && _qpick\.picked\.length\)\s*\n?\s*\? _qpick\.picked : null/);
  });

  test('chặn số câu sai ở client để khỏi mất một vòng gọi mạng', () => {
    assert.match(SRC, /_qpick\.picked\.length !== _qpick\.want/);
  });

  test('danh sách cuộn trong khung, không đẩy nút Giao ra khỏi màn', () => {
    assert.match(CSS, /\.av-qpick__list\s*\{[^}]*overflow-y:\s*auto/);
    assert.match(CSS, /\.av-qpick__list\s*\{[^}]*max-height/);
  });

  test('có ô focus nhìn thấy được bằng bàn phím', () => {
    assert.match(CSS, /\.av-qpick__row:focus-visible\s*\{[^}]*outline/);
  });
});

describe('DÂY NỐI — hàm có test không đủ', () => {
  // Nếp đã dính bốn lần ở nhánh trước: ghim hàm mà quên ghim chỗ gọi, rồi phép
  // phá không đỏ và tưởng chốt là thừa. Ở đây bộ chọn ban đầu KHÔNG được nối
  // sự kiện nào — nghĩa là nó không bao giờ chạy, dù 17 test kia đều xanh.
  const wiring = SRC.slice(SRC.indexOf("$('hf-part').addEventListener"),
                           SRC.indexOf("$('btn-add-lesson')"));

  test('đổi chủ đề thì tải lại câu', () => {
    assert.match(wiring, /\$\('hf-topic'\)\.addEventListener\('change', loadQpick\)/);
  });

  test('đổi Part thì tải lại CẢ chủ đề lẫn câu', () => {
    // Câu thuộc về một Part cụ thể; giữ danh sách cũ là mời giáo viên chọn câu
    // Part 2 dưới nhãn Part 1.
    assert.match(wiring, /\$\('hf-part'\)\.addEventListener\('change', loadSpeakingTopics\)/);
    assert.match(wiring, /\$\('hf-part'\)\.addEventListener\('change', loadQpick\)/);
  });

  test('đổi cách chọn (bốc / tự chọn) thì đổi màn', () => {
    assert.match(wiring, /\$\('hf-qmode'\)\.addEventListener\('change', loadQpick\)/);
  });

  test('bấm vào câu dùng uỷ quyền, không gắn tay từng nút', () => {
    // Danh sách vẽ lại sau mỗi lần bấm — nút gắn tay sẽ mất ở lần vẽ kế tiếp.
    assert.match(wiring, /hf-qpick-list'\)\.addEventListener\('click'[\s\S]{0,400}?toggleQpick\(row\.dataset\.id\)/);
  });

  test('không cho bấm vào câu đã khoá', () => {
    assert.match(wiring, /if \(row && !row\.disabled\)/);
  });
});

describe('nghe thử khi giao đề', () => {
  test('nút nghe nằm NGOÀI nút chọn', () => {
    // Nút-trong-nút là HTML không hợp lệ, và bấm nghe sẽ chọn nhầm câu.
    assert.match(SRC, /<\/button>\$\{play\}/);
    assert.doesNotMatch(SRC, /av-qpick__row[\s\S]{0,300}?av-qpick__play[\s\S]{0,80}?<\/button>\s*<\/button>/);
  });

  test('bấm nghe KHÔNG chọn câu đó', () => {
    // Nếu không return sớm, một cú bấm vừa nghe vừa chọn — giáo viên nghe thử
    // xong thấy câu tự nhảy vào danh sách.
    assert.match(SRC, /data-play\]'\);\s*\n\s*if \(play\) \{ previewQuestionAudio[\s\S]{0,40}?return; \}/);
  });

  test('một trình phát dùng chung', () => {
    // Hai câu phát chồng nhau thì không nghe được câu nào, và giáo viên tưởng
    // audio hỏng.
    assert.match(SRC, /_preview = _preview \|\| new Audio\(\)/);
    assert.match(SRC, /if \(_preview\) \{ _preview\.pause\(\)/);
  });

  test('bấm lại nút đang phát thì dừng', () => {
    assert.match(SRC, /if \(wasPlaying\) return;/);
  });

  test('phát hỏng thì nói ra, không im lặng', () => {
    assert.match(SRC, /onerror[\s\S]{0,120}?toast\(/);
    assert.match(SRC, /catch\(\(\) => \{[\s\S]{0,160}?toast\(/);
  });

  test('câu chưa có bản đọc thì không có nút nghe', () => {
    assert.match(SRC, /const play = q\.audio_url\s*\n?\s*\?/);
  });
});

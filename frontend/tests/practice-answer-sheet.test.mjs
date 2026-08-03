/**
 * Phiếu làm bài — bài tập lớp nhiều câu.
 *
 * Màn phễu cũ ép làm tuần tự và bắt học viên NGỒI CHỜ chấm (15–30 giây mỗi câu).
 * Phiếu cho cả hai ô cùng hiện, lưu từng ô, và làm ô kia trong lúc ô này chấm.
 *
 * Rủi ro lớn nhất ở đây là học viên TƯỞNG ĐÃ LƯU MÀ CHƯA — nên phần lớn phép
 * kiểm dưới đây là về việc trạng thái nói đúng sự thật.
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

const codeOnly = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');
const CODE = codeOnly(JS);

/** Chạy THẬT _renderSheet với DOM giả. */
function render(slots) {
  const start = JS.indexOf('  var _SHEET_LABEL = {');
  const end = JS.indexOf('  function _sheetListen(');
  assert.ok(start !== -1 && end > start, 'render block not found');

  const nodes = {
    'sheet-slots': { innerHTML: '' },
    'sheet-submit': { dataset: {} },
    'sheet-submit-note': { textContent: '' },
    'btn-sheet-submit': { disabled: false },
  };
  const $ = (id) => nodes[id];
  const _esc = (s) => String(s == null ? '' : s);
  const _sheet = { slots, recIdx: slots.findIndex((s) => s.state === 'recording') };
  new Function('$', '_esc', '_sheet', `${JS.slice(start, end)} _renderSheet();`)($, _esc, _sheet);
  return nodes;
}

const S = (state, over = {}) => ({
  q: { id: 'q1', audio_url: 'https://cdn/a.mp3' },
  state, band: null, error: null, replays: 0, ...over,
});

describe('trạng thái nói đúng sự thật', () => {
  test('bốn trạng thái đều có nhãn tiếng Việt riêng', () => {
    const labels = new Set();
    for (const st of ['idle', 'recording', 'grading', 'saved']) {
      const html = render([S(st)])['sheet-slots'].innerHTML;
      const m = html.match(/av-slot__status">([^<]+)</);
      assert.ok(m, st);
      labels.add(m[1]);
    }
    assert.equal(labels.size, 4, 'hai trạng thái dùng chung một nhãn là bắt người ta đoán');
  });

  test('cột trạng thái mang data-state để liếc dọc là thấy', () => {
    const html = render([S('saved'), S('idle')])['sheet-slots'].innerHTML;
    assert.match(html, /data-state="saved"/);
    assert.match(html, /data-state="idle"/);
  });

  test('đang chấm thì nói rõ có thể làm ô kia', () => {
    // Đó là toàn bộ lý do phiếu này tồn tại — không nói thì học viên vẫn ngồi chờ.
    const html = render([S('grading'), S('idle')])['sheet-slots'].innerHTML;
    assert.match(html, /làm câu kia được ngay/);
  });

  test('điểm chỉ hiện khi đã có', () => {
    assert.doesNotMatch(render([S('saved')])['sheet-slots'].innerHTML, /av-slot__band/);
    assert.match(render([S('saved', { band: 6.5 })])['sheet-slots'].innerHTML, />6\.5</);
  });
});

describe('nút ghi âm nói đúng việc nó làm', () => {
  test('ba nhãn khác nhau cho ba tình huống', () => {
    const label = (st, over) => render([S(st, over)])['sheet-slots'].innerHTML
      .match(/data-rec="0"[^>]*>([^<]+)</)[1].trim();
    assert.equal(label('idle'), 'Ghi âm');
    assert.equal(label('recording'), 'Dừng ghi âm');
    assert.equal(label('saved', { band: 6 }), 'Ghi âm lại');
  });

  test('một micro: ô đang ghi thì ô kia không bấm được', () => {
    const html = render([S('recording'), S('idle')])['sheet-slots'].innerHTML;
    assert.match(html, /data-rec="1"[^>]*disabled/);
    assert.doesNotMatch(html, /data-rec="0"[^>]*disabled/, 'ô đang ghi phải dừng được');
  });
});

describe('nút nộp', () => {
  test('chưa đủ thì tắt VÀ nói còn thiếu mấy câu', () => {
    // Một nút mờ không lý do khiến học viên bấm mấy lần rồi tưởng trang hỏng.
    const n = render([S('saved', { band: 6 }), S('idle')]);
    assert.equal(n['btn-sheet-submit'].disabled, true);
    assert.match(n['sheet-submit-note'].textContent, /1\/2/);
    assert.match(n['sheet-submit-note'].textContent, /lưu nốt/);
  });

  test('đủ cả hai mới bật', () => {
    const n = render([S('saved', { band: 6 }), S('saved', { band: 7 })]);
    assert.equal(n['btn-sheet-submit'].disabled, false);
    assert.equal(n['sheet-submit'].dataset.ready, 'true');
  });

  test('đang chấm KHÔNG tính là đã lưu', () => {
    // Tính là lưu thì học viên nộp trước khi câu kịp tới server.
    const n = render([S('saved', { band: 6 }), S('grading')]);
    assert.equal(n['btn-sheet-submit'].disabled, true);
  });
});

describe('lưu hỏng thì nói ra', () => {
  test('nộp hỏng đưa ô về CHƯA LÀM, không để xanh', () => {
    // Để "đã lưu" nghĩa là học viên bấm Nộp rồi mất câu trả lời mà không biết.
    assert.match(CODE, /\.catch\(function \(err\) \{[\s\S]{0,220}?s\.state = 'idle';/);
    assert.match(CODE, /Chưa lưu được câu này/);
  });

  test('micro hỏng không làm ô kẹt ở "đang ghi âm"', () => {
    assert.match(CODE, /catch \(err\)[\s\S]{0,200}?_sheet\.recIdx = -1;/);
  });
});

describe('DÂY NỐI', () => {
  test("'sheet' là trạng thái thật của máy trạng thái", () => {
    assert.match(CODE, /_ALL_STATES = \[[^\]]*'sheet'\]/);
    assert.match(HTML, /id="state-sheet"/);
  });

  test('ghi âm xong thì phiếu tự nộp, không đi qua màn "đã ghi"', () => {
    assert.match(CODE, /if \(_sheetActive\(\)\) \{ _sheetOnRecorded\(_recordedBlob\); return; \}/);
  });

  test('phiếu được thử TRƯỚC các nhánh màn phễu', () => {
    // Các nhánh dưới đều giả định một-câu-một-lúc.
    const i = CODE.indexOf('if (_initSheet())');
    const j = CODE.indexOf('_sessionData.part === 2', i);
    assert.ok(i !== -1 && j > i, 'phải đứng trước nhánh Part 2');
  });

  test('sự kiện dùng uỷ quyền và có gọi _bindSheet', () => {
    assert.match(CODE, /slots\.addEventListener\('click'[\s\S]{0,300}?_sheetToggleRec/);
    assert.match(CODE, /_bindSheet\(\);/);
  });

  test('chỉ bật cho bài tập lớp NHIỀU câu', () => {
    // Một câu thì phiếu không hơn màn cũ; luyện tự do vẫn đi luồng cũ.
    assert.match(CODE, /class_assignment_item_id/);
    assert.match(CODE, /_questions\.length < 2\) return false/);
  });
});

describe('style', () => {
  test('mỗi trạng thái một màu cột riêng', () => {
    for (const st of ['recording', 'grading', 'saved']) {
      // \s+ chứ không phải một dấu cách: CSS căn lề bằng nhiều dấu cách, và
      // ghim định dạng thay vì ghim hành vi là cách test đỏ vì một lần format.
      assert.match(CSS, new RegExp(`data-state='${st}'\\]\\s+\\.av-slot__spine`), st);
    }
  });

  test('nút nghe là vật to nhất — nó là cách duy nhất biết đề', () => {
    assert.match(CSS, /\.av-slot__listen\s*\{[^}]*width:\s*100%/);
  });
});

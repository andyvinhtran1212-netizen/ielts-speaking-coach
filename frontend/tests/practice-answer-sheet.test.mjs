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
function render(slots, session) {
  const start = JS.indexOf('  var _SHEET_LABEL = {');
  const end = JS.indexOf('  function _sheetListen(');
  assert.ok(start !== -1 && end > start, 'render block not found');

  const nodes = {
    'sheet-slots': { innerHTML: '' },
    'sheet-submit': { dataset: {} },
    'sheet-submit-note': { textContent: '' },
    'btn-sheet-submit': { disabled: false },
    'sheet-meter': { hidden: false },
    'sheet-ticks': { innerHTML: '' },
    'sheet-meter-count': { innerHTML: '' },
  };
  // Thanh tiến độ phải dính DƯỚI thanh ngữ cảnh, nên bộ khung phải dựng được cả
  // hai: một thanh có chiều cao thật, và khối #state-sheet để nhận số đo.
  nodes['state-sheet'] = { style: { _p: {}, setProperty(k, v) { this._p[k] = v; } } };
  const bar = { offsetHeight: 52 };
  const document = { querySelector: (sel) => (sel === '.practice-context-bar' ? bar : null) };

  const $ = (id) => nodes[id];
  const _esc = (s) => String(s == null ? '' : s);
  const _sheet = { slots, recIdx: slots.findIndex((s) => s.state === 'recording') };
  // Phiếu hỏi trạng thái bài giao để biết còn nhận bài không. Mặc định là CÒN
  // NHẬN — các phép kiểm dưới đây nói về phiếu đang làm dở; ca khoá có bộ kiểm
  // riêng ở `phiếu chỉ-đọc`.
  const _sessionData = session === undefined
    ? { status: 'in_progress', class_task: { accepting: true } }
    : session;
  new Function('$', '_esc', '_sheet', '_sessionData', 'document', 'window',
    `${JS.slice(start, end)} _renderSheet();`)(
    $, _esc, _sheet, _sessionData, document, { addEventListener() {} });
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
  test('nộp hỏng đưa ô về CHƯA LÀM — nhưng chỉ khi CHƯA có bài nào', () => {
    // Để "đã lưu" nghĩa là học viên bấm Nộp rồi mất câu trả lời mà không biết.
    //
    // Chốt này từng ghim NGUYÊN VĂN `s.state = 'idle';` — lại là ghim một dòng
    // mã, không phải một hành vi. Nó đúng khi mọi lần ghi đều là lần đầu, và
    // sai ngay khi có "ghi âm lại": bản cũ vẫn nằm trên server, hạ ô về 'chưa
    // làm' là nói sai VÀ khoá lại nút Nộp. Nay ghim BẤT BIẾN đầy đủ.
    const i = CODE.indexOf('function _sheetOnRecorded');
    const body = CODE.slice(i, i + 1800);
    assert.match(body, /\.catch\(function \(err\) \{[\s\S]{0,400}?s\.state = hadWork \? 'ungraded' : 'idle';/);
    assert.match(body, /Chưa lưu được câu này/, 'lần đầu: nói rõ chưa lưu được');
    assert.match(body, /bản ghi trước của bạn vẫn còn/, 'ghi lại: trấn an bản cũ còn nguyên');
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
    // Kèm thứ tự: trả bộ ghi về 'idle' TRƯỚC khi giao bản ghi — thiếu nó thì
    // _recSubState kẹt ở 'recording' và ô thứ hai bị chặn ngay đầu
    // startRecording (codex #927). Hành vi đầy đủ nằm ở practice-mic-start.
    assert.match(CODE,
      /if \(_sheetActive\(\)\) \{\s*_showRecSub\('idle'\);\s*_sheetOnRecorded\(_recordedBlob\);\s*return;/);
  });

  test('phiếu được thử TRƯỚC các nhánh màn phễu', () => {
    // Các nhánh dưới đều giả định một-câu-một-lúc.
    const i = CODE.indexOf('if (_initSheet())');
    const j = CODE.indexOf('_sessionData.part === 2', i);
    assert.ok(i !== -1 && j > i, 'phải đứng trước nhánh Part 2');
  });

  test('sự kiện dùng uỷ quyền và có gọi _bindSheet', () => {
    // Phiếu được vẽ lại sau MỖI thay đổi trạng thái, nên nút gắn tay mất ngay ở
    // lần vẽ kế tiếp. Cả BA nút của một ô đều phải đi qua uỷ quyền.
    const i = CODE.indexOf("slots.addEventListener('click'");
    assert.ok(i !== -1, 'phải uỷ quyền trên #sheet-slots');
    const body = CODE.slice(i, i + 600);
    for (const fn of ['_sheetListen', '_sheetReview', '_sheetToggleRec']) {
      assert.ok(body.includes(fn), `${fn} phải nằm trong bộ uỷ quyền`);
    }
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

describe('đường HỎNG — chỗ dễ mất bài của học viên nhất', () => {
  test('nộp hỏng phải NÉM lên, không nuốt rồi coi như xong', () => {
    // `_submitGradingEager` cố ý nuốt lỗi cho Full Test (ở đó cảnh báo được vẽ
    // riêng). Phiếu DỰA VÀO promise này để quyết ô có "đã lưu" không — nuốt ở
    // đây nghĩa là ô hỏng vẫn xanh, học viên bấm Nộp và mất câu trả lời.
    assert.match(CODE, /if \(opts && opts\.rethrow\) throw err;/);
    assert.match(CODE, /_submitGradingEager\(_sessionId, s\.q\.id, blob, \{ rethrow: true \}\)/);
  });

  test('micro hỏng nhận ra qua GIÁ TRỊ TRẢ VỀ, không chỉ qua ngoại lệ', () => {
    // startRecording xử lý lỗi bên trong rồi trả về bình thường — `catch` một
    // mình không bao giờ chạy, và ô kẹt ở "đang ghi âm" với mọi nút khác bị khoá.
    assert.match(CODE, /ok = await startRecording\(\)/);
    assert.match(CODE, /if \(!ok\) \{[\s\S]{0,200}?_sheet\.recIdx = -1;/);
  });

  test('return true nằm TRONG startRecording, không rơi xuống _renderTimer', () => {
    // Bản cũ của phép kiểm này slice từ startRecording tới stopRecording — dải
    // ấy CHỨA LUÔN _renderTimer, nên `return true` rơi nhầm vào hàm dưới vẫn
    // khớp regex và test xanh trên đúng bản lỗi nó sinh ra để chặn (PR #918).
    // Chốt lại theo ranh giới hàm: đuôi startRecording phải trả true, còn
    // _renderTimer thì không có lý do trả gì. Hành vi thật (chạy hàm với micro
    // giả, cả ba đường) nằm ở practice-mic-start.test.mjs.
    const i = CODE.indexOf("_showRecSub('recording');");
    const j = CODE.indexOf('function _renderTimer()', i);
    const k = CODE.indexOf('function stopRecording()', j);
    assert.ok(i !== -1 && j > i && k > j, 'không tìm thấy các mốc');
    assert.match(CODE.slice(i, j), /return true;/,
      'đường thành công phải trả true — thiếu là mọi lần ghi bị coi là hỏng micro');
    assert.doesNotMatch(CODE.slice(j, k), /return true;/,
      '_renderTimer không có caller nào đọc giá trị trả về');
  });

  test('micro hỏng KHÔNG làm mất bài đã lên máy chủ', () => {
    // Ghi âm lại mà micro hỏng thì ô phải quay về ĐÚNG trạng thái cũ — bài cũ
    // vẫn còn trên server.
    //
    // Chốt này từng ghim NGUYÊN VĂN `s.band === null ? 'idle' : 'saved'`, tức
    // ghim một dòng mã chứ không phải một hành vi. Cách suy-từ-band ấy đúng khi
    // chỉ có hai trạng thái, nhưng sai ngay khi có 'ungraded' (cố ý không band)
    // — nó hạ một bài đã lưu xuống 'chưa làm'. Nay ghim BẤT BIẾN: nhớ trạng
    // thái cũ rồi trả lại đúng nó.
    const i = CODE.indexOf('function _sheetToggleRec');
    const body = CODE.slice(i, i + 1200);
    assert.match(body, /var prevState = s\.state;/, 'phải nhớ trạng thái cũ');
    assert.match(body, /s\.state = prevState;/, 'và trả lại đúng nó');
    assert.ok(!/s\.band === null/.test(body),
      'đừng suy trạng thái từ band — ô chưa-chấm-được cố ý không có band');
  });
});


// ── Phiếu DÀI: bài sau buổi học có 12-15 câu ─────────────────────────────────

describe('thanh tiến độ', () => {
  const many = (n, saved = 0) => Array.from({ length: n }, (_, i) =>
    S(i < saved ? 'saved' : 'idle', { q: { id: 'q' + i, audio_url: 'https://cdn/a.mp3' } }));

  test('phiếu ngắn KHÔNG có thanh — nó chỉ nhắc lại thứ đã trong tầm mắt', () => {
    const n = render(many(2));
    assert.equal(n['sheet-meter'].hidden, true);
  });

  test('phiếu dài thì có, vì đáy phiếu đã ra khỏi màn hình', () => {
    const n = render(many(12, 3));
    assert.equal(n['sheet-meter'].hidden, false);
    assert.match(n['sheet-meter-count'].innerHTML, /Đã lưu <strong>3\/12<\/strong>/);
  });

  test('MỘT VẠCH MỖI CÂU, đúng thứ tự — không phải một con số', () => {
    // "3/12" không nói được các em đã bỏ qua CÂU NÀO, mà làm câu nào trước cũng
    // được. Dãy vạch mới trả lời được câu hỏi thật: "còn câu nào chưa làm?".
    const slots = many(5);
    slots[0].state = 'saved';
    slots[3].state = 'saved';
    const n = render(slots);
    const ticks = n['sheet-ticks'].innerHTML.match(/data-state="[a-z]+"/g);
    assert.deepEqual(ticks, ['data-state="saved"', 'data-state="idle"',
      'data-state="idle"', 'data-state="saved"', 'data-state="idle"']);
  });

  test('vạch nói đúng trạng thái đang chấm và đang ghi âm', () => {
    const slots = many(6);
    slots[1].state = 'grading';
    slots[2].state = 'recording';
    const n = render(slots);
    assert.match(n['sheet-ticks'].innerHTML, /<i data-state="grading"><\/i>/);
    assert.match(n['sheet-ticks'].innerHTML, /<i data-state="recording"><\/i>/);
  });

  test('thanh DÍNH ở đầu phiếu — cuộn tới câu thứ tám vẫn thấy', () => {
    assert.match(CSS, /\.av-sheet__meter \{[\s\S]{0,200}?position: sticky/);
  });

  test('số đếm dùng chữ số đều bề ngang, để nó không nhảy khi đổi', () => {
    assert.match(CSS, /\.av-sheet__meter-count \{[\s\S]{0,300}?font-variant-numeric: tabular-nums/);
  });

  test('vạch dùng CÙNG bảng màu với vạch bên trái mỗi ô', () => {
    // Hai chỗ nói cùng một thứ tiếng, nếu không thì học viên phải học hai lần.
    // `\s+` chứ không phải một dấu cách: CSS căn thẳng hàng bằng nhiều dấu
    // cách, và một phép kiểm đỏ vì ĐỊNH DẠNG là một phép kiểm vô dụng.
    for (const st of ['recording', 'grading', 'saved']) {
      assert.match(CSS, new RegExp(`\\.av-sheet__ticks i\\[data-state='${st}'\\]`));
      assert.match(CSS, new RegExp(`\\.av-slot\\[data-state='${st}'\\]\\s+\\.av-slot__spine`));
    }
  });
});

/**
 * Phiếu ra tới MÀN HÌNH, không chỉ ra tới chuỗi HTML.
 *
 * Mọi phép kiểm phía trên đọc `speaking-assignment.css` THẲNG TỪ ĐĨA, nên chúng
 * xanh kể cả khi trang không hề nạp tệp ấy — và đó đúng là chuyện đã xảy ra:
 * `practice.html` nạp 5 tệp CSS, không có tệp nào định nghĩa `.av-sheet` hay
 * `.av-slot`. Học viên bấm "Làm bài" thì phiếu hiện ra không một quy tắc nào.
 *
 * Nên phần này kiểm ĐƯỜNG DÂY: lớp mà bộ vẽ phát ra phải tra được trong đúng
 * những tệp CSS mà trang thật khai báo.
 */
describe('phiếu làm bài — CSS thật sự tới được trang', () => {
  const linked = [...HTML.matchAll(/<link[^>]+href="(\/css\/[^"]+\.css)"/g)]
    .map((m) => m[1]);
  const loadedCss = linked
    .map((href) => readFileSync(join(HERE, '..', 'public', href.replace(/^\//, '')), 'utf8'))
    .join('\n');

  // Lấy lớp từ HTML mà CHÍNH bộ vẽ sinh ra, không chép tay — chép tay thì sửa
  // tên lớp trong practice.js xong phép kiểm vẫn ghim tên cũ.
  const emitted = new Set();
  for (const html of [
    render([S('idle'), S('saved', { band: 6.5 })])['sheet-slots'].innerHTML,
  ]) {
    for (const m of html.matchAll(/class="([^"]+)"/g)) {
      for (const c of m[1].split(/\s+/)) if (c.startsWith('av-')) emitted.add(c);
    }
  }

  // Thẻ nghe-đề nằm sẵn trong HTML tĩnh của trang, không do bộ vẽ sinh ra — nhưng
  // `.prep-listen__*` cũng chỉ được định nghĩa ở speaking-assignment.css, nên một
  // dòng <link> thiếu làm hỏng CẢ HAI. Gộp vào cùng một phép kiểm đường dây.
  for (const m of HTML.matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c.startsWith('prep-listen')) emitted.add(c);
  }

  const rule = (c) => new RegExp(`\\.${c.replace(/[^\w-]/g, '\\$&')}(?![\\w-])`);

  test('mọi lớp riêng của trang đều có quy tắc trong CSS trang nạp', () => {
    assert.ok(emitted.size >= 8, `phải gom được lớp riêng, đang có ${emitted.size}`);
    const missing = [...emitted].filter((c) => !rule(c).test(loadedCss));
    assert.deepEqual(missing, [],
      `practice.html không nạp tệp CSS định nghĩa: ${missing.join(', ')}`);
  });

  // Thanh ngữ cảnh của trang cũng `sticky top-0`, ở z-30 — cao hơn thanh tiến
  // độ (z-2). Cùng dính ở 0 thì thanh tiến độ chui xuống dưới và mất hút đúng
  // lúc cần nhất: khi học viên đã cuộn qua vài ô của bài 12 câu.
  describe('thanh tiến độ dính DƯỚI thanh ngữ cảnh', () => {
    const SHEET_CSS = readFileSync(
      join(HERE, '..', 'public', 'css', 'speaking-assignment.css'), 'utf8');
    const meter = /\.av-sheet__meter\s*\{([^}]*)\}/.exec(SHEET_CSS)[1];
    const VAR = /top:\s*var\(\s*(--[\w-]+)/.exec(meter);

    test('meter lấy độ lệch từ biến, không dính cứng ở 0', () => {
      assert.ok(VAR, `.av-sheet__meter vẫn đang \`top\` cứng: ${meter.trim()}`);
      assert.match(meter, /top:\s*var\(--[\w-]+,\s*0px\)/,
        'phải có giá trị lui về 0px cho trang không có thanh ngữ cảnh');
    });

    test('JS đặt ĐÚNG cái biến mà CSS đọc', () => {
      assert.match(CODE, new RegExp(`setProperty\\(\\s*'${VAR[1]}'`),
        `CSS đọc ${VAR[1]} — practice.js phải đặt đúng tên ấy`);
    });

    test('số đo là chiều cao THẬT của thanh, chỉ khi meter hiện', () => {
      const p = (n) => render(Array.from({ length: n }, () => S('idle')))['state-sheet'].style._p;
      // Bộ khung dựng thanh cao 52px; hằng số trong CSS/JS nào khác cũng sẽ lệch.
      assert.equal(p(4)[VAR[1]], '52px', 'bài ≥4 câu: meter hiện, phải có số đo');
      assert.equal(p(2)[VAR[1]], undefined, 'bài 2 câu: meter ẩn, không cần đo');
    });
  });

  // Lỗi NẶNG NHẤT, và là lỗi duy nhất thật sự làm trang TRỐNG hoàn toàn.
  // `showState()` gỡ `.active` khỏi mọi khối state không được chọn. Phiếu từng
  // nằm trong #state-prep, nên `showState('sheet')` tự tay tắt tổ tiên của nó —
  // CSS đúng bao nhiêu cũng vô nghĩa vì cả cây con đã `display:none`.
  test('phiếu KHÔNG được lồng trong một khối state nào khác', () => {
    const upto = HTML.slice(0, HTML.indexOf('<div id="state-sheet"'));
    const open = [];
    for (const m of upto.matchAll(/<(div|main)\b[^>]*?(\/?)>|<\/(div|main)>/g)) {
      if (m[3]) open.pop();
      else if (!m[2]) open.push((/id="([^"]+)"/.exec(m[0]) || [, m[1]])[1]);
    }
    assert.deepEqual(open.filter((t) => t.startsWith('state-')), [],
      `#state-sheet đang lồng trong: ${open.join(' > ')}`);
  });

  test('khối phiếu có cùng bộ lớp bố cục với các khối state anh em', () => {
    const cls = (id) => (HTML.match(new RegExp(`id="${id}" class="([^"]*)"`)) || [])[1] || '';
    const sheet = new Set(cls('state-sheet').split(/\s+/));
    // `.state.active` là display:flex (HÀNG ngang). Chỉ `block-state` mới lật nó
    // về display:block — thiếu nó thì các ô bị ép vào một dải hẹp.
    for (const need of ['block-state', 'flex-1', 'av-w-read']) {
      assert.ok(sheet.has(need), `#state-sheet thiếu lớp bố cục "${need}"`);
    }
  });
});

/**
 * Bài đã làm phải SỐNG QUA REFRESH, và xem lại được bất cứ lúc nào.
 *
 * Lỗi người dùng báo: làm xong, tải lại trang thì phiếu trắng trơn — trong khi
 * `GET /sessions/{id}` vẫn trả đủ `responses`. Ô hiện "Chưa làm" ở câu vừa nộp
 * khiến học viên ghi âm lại và mất luôn bản cũ (ghi âm lại GHI ĐÈ cùng câu).
 */
describe('dựng lại phiếu từ bài đã nộp', () => {
  const initSheet = (questions, responses, session = {}) => {
    const start = JS.indexOf('  function _initSheet() {');
    const end = JS.indexOf('  var _SHEET_LABEL = {');
    assert.ok(start !== -1 && end > start, 'không tìm thấy _initSheet');
    // Lấy kèm các hàm đọc dòng đã lưu (nằm ngay sau _SHEET_LABEL).
    const h0 = JS.indexOf('  function _respFeedback(r) {');
    const h1 = JS.indexOf('  function _renderSheet() {');
    let sheet = null;
    const env = {
      _sessionData: { class_assignment_item_id: 'it-1', responses, ...session },
      _questions: questions,
      _renderSheet: () => {},
      showState: () => {},
      _syncMeterTop: () => {},
      window: { addEventListener() {} },
    };
    const names = Object.keys(env);
    sheet = new Function(...names, `
      var _sheet = null, _meterTopBound = false;
      ${JS.slice(h0, h1)}
      ${JS.slice(start, end)}
      _initSheet();
      return _sheet;
    `)(...names.map((n) => env[n]));
    return sheet;
  };

  const Q = (id) => ({ id, question_text: 'Q' + id });
  const R = (qid, over = {}) => ({
    id: 'r-' + qid, question_id: qid, grading_status: 'completed',
    overall_band: 6.5, feedback: JSON.stringify({ band_fc: 6, strengths: ['x'] }),
    transcript: 'tôi nói gì đó', ...over,
  });

  test('câu đã chấm hiện ĐÃ LƯU kèm điểm, không phải "Chưa làm"', () => {
    const s = initSheet([Q('a'), Q('b')], [R('a')]);
    assert.equal(s.slots[0].state, 'saved');
    assert.equal(s.slots[0].band, 6.5);
    assert.equal(s.slots[1].state, 'idle', 'câu chưa làm vẫn là chưa làm');
  });

  test('band ĐÃ HIỆU CHỈNH phát âm thắng band thô', () => {
    // Trang kết quả và bảng của giáo viên đều dùng con số này; hiện số thô ở
    // phiếu sẽ mâu thuẫn với cả hai.
    const s = initSheet([Q('a'), Q('b')], [R('a', { final_overall_band: 6.0 })]);
    assert.equal(s.slots[0].band, 6.0);
  });

  test('có dòng nhưng CHƯA chấm xong thì là "đang chấm", không hứa nhận xét', () => {
    const s = initSheet([Q('a'), Q('b')], [R('a', { grading_status: 'processing' })]);
    assert.equal(s.slots[0].state, 'grading');
  });

  test('giữ nguyên dòng đã lưu để xem lại — không phải tải thêm gì', () => {
    const s = initSheet([Q('a'), Q('b')], [R('a')]);
    assert.equal(s.slots[0].resp.id, 'r-a');
  });
});

describe('nút Xem nhận xét', () => {
  test('chỉ hiện ở ô đã lưu VÀ có nhận xét để đọc', () => {
    const withResp = render([S('saved', { band: 6, resp: { id: 'r1' } })])['sheet-slots'].innerHTML;
    assert.match(withResp, /data-review="0"/);
    // Đã lưu nhưng dòng chưa về (mạng chập lúc dựng lại) thì đừng hứa suông.
    assert.doesNotMatch(render([S('saved', { band: 6 })])['sheet-slots'].innerHTML, /data-review/);
    assert.doesNotMatch(render([S('idle')])['sheet-slots'].innerHTML, /data-review/);
  });

  test('xem lại DÙNG LẠI màn nhận xét của luồng luyện tập', () => {
    // Một bộ vẽ rút gọn riêng là chỗ thứ hai để trôi khỏi bộ vẽ thật.
    const i = CODE.indexOf('function _sheetReview');
    assert.ok(i !== -1);
    const body = CODE.slice(i, i + 900);
    assert.ok(body.includes('_showFeedback'), 'phải gọi đúng _showFeedback');
    assert.ok(body.includes("btn-back-sheet"), 'phải có đường quay lại phiếu');
    assert.match(HTML, /id="btn-back-sheet"/);
  });
});

describe('phiếu chỉ-đọc khi hết hạn / đã nộp', () => {
  const locked = (session) => render(
    [S('saved', { band: 6, resp: { id: 'r1' } }), S('saved', { band: 7, resp: { id: 'r2' } })],
    session);

  test('hết hạn: không còn nút ghi âm, nhưng VẪN xem lại được', () => {
    const n = locked({ status: 'in_progress', class_task: { accepting: false } });
    assert.doesNotMatch(n['sheet-slots'].innerHTML, /data-rec=/);
    assert.match(n['sheet-slots'].innerHTML, /data-review="0"/);
    assert.equal(n['btn-sheet-submit'].disabled, true);
    assert.match(n['sheet-submit-note'].textContent, /hết hạn nộp/i);
  });

  test('đã nộp: khoá nộp lại, nói rõ vẫn xem lại được', () => {
    const n = locked({ status: 'completed', class_task: { accepting: true } });
    assert.equal(n['btn-sheet-submit'].disabled, true);
    assert.match(n['sheet-submit-note'].textContent, /đã nộp/i);
    assert.match(n['sheet-submit-note'].textContent, /xem lại/i);
  });

  test('còn hạn và chưa nộp thì KHÔNG khoá oan', () => {
    const n = locked({ status: 'in_progress', class_task: { accepting: true } });
    assert.match(n['sheet-slots'].innerHTML, /data-rec="0"/);
    assert.equal(n['btn-sheet-submit'].disabled, false);
  });

  test('backend cũ không trả class_task → không khoá', () => {
    // Khoá oan một bài còn hạn tệ hơn để lệnh nộp từ chối một bài đã muộn.
    const n = locked({ status: 'in_progress' });
    assert.match(n['sheet-slots'].innerHTML, /data-rec="0"/);
    assert.equal(n['btn-sheet-submit'].disabled, false);
  });
});

describe('xem lại: hai bẫy của việc DÙNG LẠI màn nhận xét (codex #931)', () => {
  test('KHÔNG rơi vào nhánh test-mode — bài giao lớp có thể là test_part', () => {
    // `_showFeedback` mở đầu bằng nhánh test-mode gom kết quả rồi
    // `_advanceTestMode()`. Admin chọn được "Luyện từng Part" khi giao, nên
    // không tắt thì bấm "Xem nhận xét" đá học viên sang luồng tuần tự cũ.
    const i = CODE.indexOf('function _sheetReview');
    const body = CODE.slice(i, i + 900);
    assert.ok(/_testMode = null;/.test(body), 'phải tắt test-mode trước khi vẽ');
    assert.ok(/finally/.test(body) && /_testMode = savedMode;/.test(body),
      'và PHẢI trả lại — vẽ hỏng mà mất test-mode thì cả phiên thi lệch');
    const off = body.indexOf('_testMode = null;');
    assert.ok(off !== -1 && off < body.indexOf('_showFeedback('),
      'tắt phải đứng TRƯỚC lời gọi, không thì vô nghĩa');
  });

  test('điểm phát âm ánh xạ sang tên trường bộ vẽ ĐỌC, không phải tên cột DB', () => {
    // `_renderPronBlock` đọc fluency_score/accuracy_score/completeness_score.
    // Đưa tên cột xuống thì điểm tổng hiện còn ba ô con thành dấu gạch.
    const i = CODE.indexOf('function _respToFeedbackData');
    assert.ok(i !== -1, 'không tìm thấy _respToFeedbackData');
    // Neo hai đầu bằng chính CÚ PHÁP của khối (từ `pronunciation:` tới nhánh
    // `: null` của ternary) chứ không bằng một số ký tự đoán chừng — đoán ngắn
    // thì phép kiểm xanh/đỏ theo độ dài chú thích, không theo hành vi.
    const map = /pronunciation:[\s\S]*?:\s*null,/.exec(CODE.slice(i, i + 3000));
    assert.ok(map, 'không tìm thấy khối ánh xạ phát âm');
    for (const k of ['fluency_score', 'accuracy_score', 'completeness_score']) {
      assert.ok(map[0].includes(k), `phải ánh xạ ${k}`);
      assert.ok(!new RegExp(`pronunciation_${k.replace('_score', '')}:`).test(map[0]),
        `đừng đưa tên cột DB (pronunciation_${k.replace('_score', '')}) xuống bộ vẽ`);
    }
    // Và bộ vẽ vẫn phải đang đọc đúng những tên ấy — hai bên khớp mới có nghĩa.
    const c = CODE.indexOf("_pronChip('Tổng thể'");
    assert.ok(c !== -1, 'không tìm thấy dãy ô điểm phát âm');
    const chips = CODE.slice(c, c + 300);
    for (const k of ['fluency_score', 'accuracy_score', 'completeness_score']) {
      assert.ok(chips.includes(k), `bộ vẽ vẫn đọc ${k} — hai bên phải khớp`);
    }
  });

  test('pronunciation_payload là CHUỖI JSON trong cột jsonb, phải gỡ ra', () => {
    // 4696/4696 dòng trên prod lưu như vậy; đọc thẳng thì `.words` là undefined
    // và mục "Từ cần chú ý" trống trơn.
    const i = CODE.indexOf('function _pronPayload');
    assert.ok(i !== -1, 'phải có bộ gỡ payload');
    const body = CODE.slice(i, i + 400);
    assert.ok(body.includes('JSON.parse'), 'phải gỡ chuỗi');
    assert.ok(/catch/.test(body), 'payload hỏng không được làm nổ màn xem lại');
  });
});

describe('xem lại phát ĐÚNG audio của câu ấy (codex #931 vòng 3)', () => {
  test('không dùng _recordedBlob — biến ấy luôn là bản ghi GẦN NHẤT', () => {
    // Ghi câu 1, ghi câu 2, xem lại câu 1 → nghe ra câu 2.
    const i = CODE.indexOf('var audioSection = $(\'feedback-audio-section\');');
    assert.ok(i !== -1);
    const body = CODE.slice(i, i + 700);
    const review = body.indexOf('_reviewAudioUrl');
    const blob = body.indexOf('_recordedBlob');
    assert.ok(review !== -1, 'phải có nhánh audio của lượt xem lại');
    assert.ok(review < blob, 'nhánh xem lại phải xét TRƯỚC nhánh blob');
    assert.ok(/_review\b/.test(body),
      'xem lại mà KHÔNG có audio thì ẩn hẳn, không rơi xuống blob của câu khác');
  });

  test('URL đã ký không bị revokeObjectURL', () => {
    // Nó không phải blob URL; thu hồi là sai nghĩa và là chỗ sau này chết khó hiểu.
    const i = CODE.indexOf('if (_feedbackAudioUrl) {');
    assert.match(CODE.slice(i, i + 260), /_feedbackAudioIsBlob\) URL\.revokeObjectURL/);
  });

  test('bảng URL dựng từ MẢNG mà endpoint thật trả về', () => {
    // /sessions/{id}/audio-urls trả [{question_id, url}] — đoán là object thì
    // bảng tra rỗng và không câu nào nghe được.
    const i = CODE.indexOf('async function _loadSheetAudioUrls');
    const body = CODE.slice(i, i + 700);
    assert.ok(/\(rows \|\| \[\]\)\.forEach/.test(body), 'phải duyệt mảng');
    assert.ok(/x\.question_id/.test(body) && /x\.url/.test(body));
    assert.ok(/catch/.test(body), 'hỏng thì vẫn xem được nhận xét, chỉ thiếu nút nghe');
  });

  test('nạp URL MỘT lần, không mỗi lần bấm xem lại', () => {
    const i = CODE.indexOf('async function _loadSheetAudioUrls');
    assert.match(CODE.slice(i, i + 160), /if \(_sheetAudioUrls\) return _sheetAudioUrls;/);
  });
});

describe('Tải audio ở lượt xem lại (codex #931 vòng 4)', () => {
  test('KHÔNG đọc _recordedBlob.type khi URL là URL đã ký', () => {
    // Tải lại trang xong thì bản ghi trong bộ nhớ không còn — đọc `.type` là nổ
    // ngay lúc bấm Tải.
    const i = CODE.indexOf('function _downloadAudio');
    const body = CODE.slice(i, i + 900);
    const guard = body.indexOf('if (_feedbackAudioIsBlob) {');
    const deref = body.indexOf('_recordedBlob.type');
    assert.ok(guard !== -1, 'phải rẽ nhánh theo loại URL');
    assert.ok(deref === -1 || deref > guard,
      'mọi lần đọc _recordedBlob phải nằm TRONG nhánh blob');
    assert.ok(/return;/.test(body.slice(guard, guard + 120)),
      'nhánh blob mà mất blob thì thoát, không đoán');
  });

  test('đuôi tệp suy từ chính URL khi không có blob', () => {
    const i = CODE.indexOf('function _downloadAudio');
    assert.match(CODE.slice(i, i + 900), /exec\(String\(_feedbackAudioUrl\)\)/);
  });
});

/**
 * CHẤM HỎNG là một trạng thái RIÊNG (báo cáo thật của học viên thyanh0809,
 * bài 12 câu — 11 câu chấm xong, 1 câu `grading_status='failed'`).
 *
 * Trên prod 38/1000 lượt chấm gần nhất hỏng (3,8%), nên đây không phải ca lẻ.
 * Gộp nó vào 'saved' là hiện "Đã lưu" không điểm không lời giải thích; gộp vào
 * 'grading' là ô kẹt "Đang chấm…" vĩnh viễn và khoá luôn nút Nộp.
 */
describe('chấm hỏng: một trạng thái riêng, không gộp vào đâu cả', () => {
  test('năm trạng thái, năm nhãn khác nhau', () => {
    const labels = new Set();
    for (const st of ['idle', 'recording', 'grading', 'saved', 'ungraded']) {
      const html = render([S(st)])['sheet-slots'].innerHTML;
      const m = html.match(/av-slot__status">([^<]+)</);
      assert.ok(m, st);
      labels.add(m[1]);
    }
    assert.equal(labels.size, 5, 'hai trạng thái dùng chung một nhãn là bắt người ta đoán');
  });

  test('ô chưa chấm được TÍNH LÀ XONG — không nhốt học viên', () => {
    // Bài đã lên máy chủ; máy chấm hỏng là việc của hệ thống. Không tính thì
    // nút Nộp khoá vĩnh viễn và em ấy không có lối ra.
    const n = render([S('saved', { band: 6 }), S('ungraded')]);
    assert.equal(n['btn-sheet-submit'].disabled, false);
    assert.match(n['sheet-submit-note'].textContent, /2\/2|cả 2/);
  });

  test('nhưng KHÔNG hiện điểm và KHÔNG mời xem nhận xét', () => {
    const html = render([S('ungraded', { resp: { id: 'r1' } })])['sheet-slots'].innerHTML;
    assert.doesNotMatch(html, /av-slot__band/, 'không có điểm thì đừng vẽ ô điểm');
    assert.doesNotMatch(html, /data-review/, 'không có nhận xét để xem');
    assert.match(html, /data-state="ungraded"/);
  });

  test('vẫn ghi âm lại được để thử chấm lần nữa', () => {
    const label = render([S('ungraded')])['sheet-slots'].innerHTML
      .match(/data-rec="0"[^>]*>([^<]+)</)[1].trim();
    assert.equal(label, 'Ghi âm lại');
  });

  test('phản hồi _stub của máy chủ KHÔNG được đọc thành "đã lưu"', () => {
    // Máy chủ trả 200 kèm `_stub` (đã lưu bài, bộ chấm hỏng) — nhánh `catch`
    // không bao giờ chạy, nên không đọc cờ này là im lặng hoàn toàn.
    const i = CODE.indexOf('function _sheetOnRecorded');
    const body = CODE.slice(i, i + 1400);
    assert.match(body, /_stub/);
    assert.match(body, /'ungraded'/);
    assert.ok(body.indexOf("s.state = stub ? 'ungraded' : 'saved'") !== -1,
      'trạng thái phải rẽ theo cờ ấy');
  });

  test('tải lại trang: grading_status="failed" KHÔNG hiện "Đang chấm…"', () => {
    const i = CODE.indexOf('function _respFailed');
    assert.ok(i !== -1, 'phải phân biệt được chấm-hỏng với đang-chấm');
    assert.match(CODE.slice(i, i + 200), /grading_status === 'failed'/);
    const j = CODE.indexOf('state: _respGraded(r)');
    assert.match(CODE.slice(j, j + 160), /_respFailed\(r\) \? 'ungraded' : 'grading'/);
  });

  test('trang KẾT QUẢ nhận ra dòng chấm hỏng qua grading_status', () => {
    // Dòng hỏng nay CÓ `feedback` ({_failed, _reason} để điều tra), nên chỉ hỏi
    // `!fb` là bỏ sót và bản ghi đã lưu bị đọc thành "Chưa có câu trả lời".
    const RES = readFileSync(join(HERE, '..', 'public', 'pages', 'result.html'), 'utf8');
    const m = /var gradingFailed = ([^;]+);/.exec(RES);
    assert.ok(m, 'không tìm thấy phép phân loại');
    assert.match(m[1], /grading_status === 'failed'/);
    assert.match(m[1], /_failed/);
  });

  test('ghi âm LẠI mà hỏng thì GIỮ bản cũ, không hạ về "chưa làm"', () => {
    // Bản cũ vẫn nằm nguyên trên server; hạ ô về 'idle' là nói sai và khoá lại
    // nút Nộp. Chỉ lần ghi ĐẦU TIÊN mới rơi về 'idle' (codex #942).
    const i = CODE.indexOf('function _sheetOnRecorded');
    const body = CODE.slice(i, i + 1800);
    assert.match(body, /var hadWork = s && \(s\.state === 'saved' \|\| s\.state === 'ungraded'\)/);
    assert.match(body, /s\.state = hadWork \? 'ungraded' : 'idle';/);
    assert.ok(!/^\s*s\.state = 'idle';\s*$/m.test(body),
      'không còn nhánh nào hạ thẳng về idle');
  });

  test('vạch tiến độ có màu riêng cho ô chưa chấm được', () => {
    // Thiếu nó thì vạch xám y hệt câu CHƯA LÀM, trong khi ô đã tính là xong —
    // bảng tổng quan nói ngược lại chính phiếu ngay bên dưới.
    const ticks = [...CSS.matchAll(/\.av-sheet__ticks i\[data-state='(\w+)'\]/g)]
      .map((m) => m[1]);
    for (const st of ['recording', 'grading', 'saved', 'ungraded']) {
      assert.ok(ticks.includes(st), `vạch thiếu màu cho '${st}'`);
    }
  });

  test('có câu chưa chấm được thì NÓI RA ở đáy phiếu', () => {
    // "Đã lưu cả 12 câu" mà thiếu điểm sẽ khiến học viên tưởng mình bị chấm 0 —
    // trong khi bài các em không sai gì.
    const n = render([S('saved', { band: 6 }), S('ungraded')]);
    assert.match(n['sheet-submit-note'].textContent, /1 câu máy chưa chấm được/);
    assert.match(n['sheet-submit-note'].textContent, /vẫn nộp được/);
  });

  test('không có câu nào hỏng thì giữ nguyên câu cũ', () => {
    const n = render([S('saved', { band: 6 }), S('saved', { band: 7 })]);
    assert.match(n['sheet-submit-note'].textContent, /Đã lưu cả 2 câu\. Nộp để chốt bài\./);
  });
});

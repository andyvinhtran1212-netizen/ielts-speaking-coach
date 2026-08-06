/**
 * Báo cáo bài làm — MỘT bộ vẽ cho HAI người đọc.
 *
 * Việc chính của nó KHÔNG phải đếm điểm. Một em sai 47/90 câu thì "47" không
 * nói được gì để làm tiếp; điều cần biết là YẾU TRỤC NÀO.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderReport, groupByAxis, needsWork, optLabel }
  from '../public/js/course-report.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, '..', 'public', 'css', 'course-report.css'), 'utf8');

const Q = (over = {}) => ({
  qid: 'q1', item_key: 'trục A', prompt: 'Câu hỏi', options: ['A', 'B', 'C', 'D'],
  picked: 1, picked_text: 'B', answer: 0, answer_text: 'A',
  is_correct: false, why_wrong: 'vì sao sai', explain: 'lời giải', seconds: 12,
  ...over,
});
const data = (qs, totals = {}) => ({
  questions: qs,
  totals: { answered: qs.length, correct: qs.filter((q) => q.is_correct).length,
            median_sec: 20, active_sec: 600, idle_sec: 0, ...totals },
});

describe('gom theo TRỤC, không liệt kê 47 câu', () => {
  test('trục sai nhiều nhất lên đầu', () => {
    const g = groupByAxis([
      Q({ item_key: 'ít sai', is_correct: true }),
      Q({ item_key: 'ít sai', is_correct: false }),
      Q({ item_key: 'sai nhiều', is_correct: false }),
      Q({ item_key: 'sai nhiều', is_correct: false }),
      Q({ item_key: 'sai nhiều', is_correct: false }),
    ]);
    assert.equal(g[0].axis, 'sai nhiều');
    assert.equal(g[0].wrong, 3);
  });

  test('hoà thì trục DÀI hơn đứng trước', () => {
    // Nhiều câu = nhiều bằng chứng hơn. Một trục 1 câu sai 1 chưa nói được gì.
    const g = groupByAxis([
      Q({ item_key: 'ngắn', is_correct: false }),
      Q({ item_key: 'dài', is_correct: false }),
      Q({ item_key: 'dài', is_correct: true }),
      Q({ item_key: 'dài', is_correct: true }),
    ]);
    assert.equal(g[0].axis, 'dài');
  });

  test('trục VỮNG vẫn giữ lại, chỉ nằm dưới', () => {
    // Học viên cần thấy mình được gì, giáo viên cần biết trục nào KHÔNG phải lo.
    const g = groupByAxis([Q({ item_key: 'vững', is_correct: true })]);
    assert.equal(g.length, 1);
    assert.equal(needsWork(g[0]), false);
  });

  test('"cần ôn" đòi ít nhất 2 câu làm bằng chứng', () => {
    assert.equal(needsWork({ total: 1, wrong: 1, rate: 1 }), false, 'một câu chưa đủ kết luận');
    assert.equal(needsWork({ total: 2, wrong: 1, rate: 0.5 }), true);
    assert.equal(needsWork({ total: 4, wrong: 1, rate: 0.25 }), false);
  });
});

describe('màn hình nói được bốn điều học viên hỏi', () => {
  const html = renderReport(data([
    Q({ item_key: 'give/send SVOO', is_correct: false }),
    Q({ item_key: 'give/send SVOO', is_correct: false }),
    Q({ item_key: 'vững', is_correct: true, picked: 0, picked_text: 'A' }),
  ]));

  test('mở đầu bằng TRỤC YẾU NHẤT, không phải điểm số', () => {
    // Điểm số nói em ấy đứng đâu; trục yếu nói em ấy phải làm gì tiếp.
    const hero = html.slice(html.indexOf('cr-hero'), html.indexOf('cr-stats'));
    assert.match(hero, /Yếu nhất/);
    assert.match(hero, /give\/send SVOO/);
    assert.ok(!/\d+\/\d+ đúng/.test(hero), 'điểm số KHÔNG được là thứ đầu tiên đọc thấy');
  });

  test('em chọn gì · đáp án là gì · vì sao sai', () => {
    assert.match(html, /Em chọn/);
    assert.match(html, /Đáp án/);
    assert.match(html, /vì sao sai/);
  });

  test('câu ĐÚNG không hiện dòng "Đáp án" thừa', () => {
    const one = renderReport(data([Q({ is_correct: true, picked: 0, picked_text: 'A' })]));
    assert.ok(!/Đáp án/.test(one), 'em ấy chọn đúng rồi, nhắc lại là nhiễu');
  });

  test('phương án hiện bằng CHỮ CÁI, không phải chỉ số', () => {
    assert.equal(optLabel(0), 'A');
    assert.equal(optLabel(3), 'D');
    assert.equal(optLabel(null), '—');
    assert.match(html, /<b>B<\/b>/);
  });

  test('in đậm trong đề bài được giữ — nó chỉ đúng cụm đang hỏi', () => {
    const one = renderReport(data([Q({ prompt: 'The museum gave **the visitors** free tickets.' })]));
    assert.match(one, /<strong>the visitors<\/strong>/);
  });

  test('đề bài vẫn được thoát HTML', () => {
    const one = renderReport(data([Q({ prompt: '<img src=x onerror=alert(1)>' })]));
    assert.ok(!/<img/.test(one));
  });
});

describe('con số', () => {
  test('rời máy CHỈ hiện khi có', () => {
    // Một dòng "rời máy 0 giây" là nhiễu.
    const no = renderReport(data([Q()], { idle_sec: 0 }));
    assert.ok(!/rời máy/.test(no));
    const yes = renderReport(data([Q()], { idle_sec: 600 }));
    assert.match(yes, /rời máy/);
  });

  test('chưa có câu nào thì nói ra, không vẽ bảng rỗng', () => {
    assert.match(renderReport({ questions: [], totals: {} }), /Chưa có câu nào được chấm/);
  });
});

describe('mực = chỗ cần chú ý (cùng quy ước với bảng Speaking)', () => {
  test('ô SAI tô kín, ô đúng chỉ một nét mảnh', () => {
    assert.match(CSS, /\.cr-strip i\s*\{[^}]*background:\s*var\(--av-border-subtle\)/);
    assert.match(CSS, /\.cr-strip i\[data-ok='0'\]\s*\{\s*background:\s*var\(--av-error\)/);
  });

  test('amber chỉ dùng cho ĐÚNG MỘT con số: số trục cần ôn', () => {
    // Tô nhấn hai chỗ là không tô nhấn chỗ nào.
    // `<= 2` là quá lỏng và chính nó đã để lọt một lần dùng thứ hai (viền "vì
    // sao sai"). Luật là MỘT con số, nên chốt phải đếm đúng một.
    const uses = (CSS.match(/var\(--av-accent\)/g) || []).length;
    assert.equal(uses, 1, `--av-accent dùng ${uses} lần — luật là ĐÚNG MỘT`);
    assert.match(CSS, /\.cr-hero__count b\s*\{[^}]*color:\s*var\(--av-accent\)/);
  });

  test('không có mã màu thô — mọi màu đi qua token', () => {
    assert.equal((CSS.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length, 0);
  });
});

describe('trang bài tập của học viên nói rõ CHƯA HOÀN TẤT', () => {
  const MC = readFileSync(join(HERE, '..', 'public', 'js', 'my-class.js'), 'utf8');
  const MCH = readFileSync(join(HERE, '..', 'public', 'pages', 'my-class.html'), 'utf8');

  test('xong trắc nghiệm mà chưa nộp tự luận là một trạng thái RIÊNG', () => {
    // Không nói ra thì bài nằm im ở "Cần nộp" y như một bài chưa mở — mà em ấy
    // đã làm chín chặng rồi và chỉ còn một bước.
    assert.match(MC, /const awaitingWriting = \(a\) => a\.assignment\.skill === 'course'/);
    assert.match(MC, /!!a\.passed_at && !a\.submitted_at/);
    assert.match(MC, /Chưa hoàn tất — còn phần tự luận/);
  });

  test('chỉ áp cho bài theo buổi', () => {
    // Bài Speaking/Reading không có phần tự luận — thêm nhãn ở đó là nói sai.
    const i = MC.indexOf('const awaitingWriting');
    assert.match(MC.slice(i, i + 200), /skill === 'course'/);
  });

  test('nhãn ấy có kiểu riêng, không màu lỗi và KHÔNG chiếm màu nhấn', () => {
    // Em ấy không làm sai gì cả — tô đỏ là một lời trách. Nhưng cũng không được
    // dùng --av-accent: màu ấy để dành cho ĐÚNG MỘT con số quan trọng nhất trên
    // mỗi màn, và tô nhấn hai chỗ là không tô nhấn chỗ nào.
    const i = MCH.indexOf('.mc-partial');
    // Cắt ĐÚNG một quy tắc CSS (cửa sổ rộng sẽ trùm sang quy tắc kế tiếp), rồi
    // BỎ CHÚ THÍCH — khối này có chữ `--av-accent` nằm trong chính lời chú giải
    // thích vì sao không dùng nó. Bộ quét đọc MÃ, không đọc lời chú.
    const block = MCH.slice(i, MCH.indexOf('}', i) + 1)
      .replace(/\/\*[\s\S]*?\*\//g, '');
    assert.match(block, /var\(--av-warning\)/);
    assert.ok(!/--av-error/.test(block), 'không phải lỗi của em ấy');
    assert.ok(!/--av-accent/.test(block), 'màu nhấn dành cho con số, không cho nhãn');
  });
});

describe('đọc thiếu thì NÓI RA (codex cục bộ 06/08)', () => {
  test('có câu nhưng thiếu → vẫn vẽ, kèm cảnh báo', () => {
    const html = renderReport({ ...data([Q()]), stale: true });
    assert.match(html, /Chưa đọc được đầy đủ bài làm/);
    assert.match(html, /cr-hero/, 'vẫn phải vẽ phần đọc được');
  });

  test('thiếu SẠCH thì KHÔNG được nói "chưa có câu nào được chấm"', () => {
    // Đó là một khẳng định mà lượt đọc hỏng không chứng minh được.
    const html = renderReport({ questions: [], totals: {}, stale: true });
    assert.match(html, /Chưa đọc được đầy đủ bài làm/);
    assert.ok(!/Chưa có câu nào được chấm/.test(html));
  });

  test('đọc đủ mà thật sự chưa làm thì vẫn nói đúng như cũ', () => {
    const html = renderReport({ questions: [], totals: {}, stale: false });
    assert.match(html, /Chưa có câu nào được chấm/);
  });
});

describe('nhãn tự luận không được ĐOÁN (codex cục bộ 06/08)', () => {
  const MC2 = readFileSync(join(HERE, '..', 'public', 'js', 'my-class.js'), 'utf8');

  test('đòi cờ từ máy chủ, không suy từ hai mốc thời gian', () => {
    // Bộ đề KHÔNG có tự luận + một lượt ghi sổ hỏng (best-effort) cũng cho ra
    // đúng hình dạng `passed_at && !submitted_at` — học viên khi ấy đọc thành
    // "còn phần tự luận" cho một phần không tồn tại.
    const i = MC2.indexOf('const awaitingWriting');
    const body = MC2.slice(i, i + 700);
    assert.match(body, /!!a\.writing_expected/);
    assert.match(body, /!!a\.passed_at && !a\.submitted_at/);
  });
});

// ── Hai mức: trục yếu mở luôn, từng câu chờ đạt ───────────────────────────
//
// Em CHƯA đạt mới là em cần biết mình yếu chỗ nào nhất. Nhưng chi tiết từng
// câu phải chờ: kỳ kiểm tra lại bốc mẫu từ chính bộ câu ấy.

describe('bản rút gọn khi chưa đạt', () => {
  const lockedData = {
    locked: true,
    threshold: 75,
    totals: { answered: 4, correct: 1 },
    questions: [
      { item_key: 'chia động từ', is_correct: false },
      { item_key: 'chia động từ', is_correct: false },
      { item_key: 'mạo từ', is_correct: true },
      { item_key: 'mạo từ', is_correct: false },
    ],
  };

  test('vẫn vẽ được trục yếu', () => {
    const html = renderReport(lockedData);
    assert.match(html, /chia động từ/);
    assert.match(html, /Yếu nhất/);
  });

  test('KHÔNG vẽ thẻ câu nào', () => {
    const html = renderReport(lockedData);
    assert.doesNotMatch(html, /class="cr-qs"/,
      'danh sách câu là chỗ đáp án hiện ra');
    assert.doesNotMatch(html, /cr-q__prompt/);
  });

  test('nói ra ĐIỀU KIỆN mở mức hai', () => {
    // Không nói thì bảng trục trông như đã đầy đủ, và em ấy không biết còn gì.
    const html = renderReport(lockedData);
    assert.match(html, /cr-locked/);
    assert.match(html, /75%/);
  });

  test('đầu trục không bấm được — đừng mời một cú bấm không mở gì', () => {
    assert.match(renderReport(lockedData), /cr-axis__head[^>]*disabled/);
  });

  test('đã đạt thì mọi thứ trở lại như cũ', () => {
    const open = {
      totals: { answered: 2, correct: 1 },
      questions: [
        { item_key: 'mạo từ', is_correct: false, prompt: '___ apple',
          picked: 0, picked_text: 'a', answer: 1, answer_text: 'an',
          why_wrong: 'a đi với phụ âm', explain: 'trước nguyên âm' },
        { item_key: 'mạo từ', is_correct: true, prompt: 'x', picked: 1, answer: 1 },
      ],
    };
    const html = renderReport(open);
    assert.match(html, /class="cr-qs"/);
    assert.match(html, /trước nguyên âm/);
    assert.doesNotMatch(html, /cr-locked/);
    assert.doesNotMatch(html, /cr-axis__head[^>]*disabled/);
  });
});

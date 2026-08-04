/**
 * Trang làm bài tập ngữ pháp theo buổi.
 *
 * Kho này có một thứ mà không kho nào khác trên web có: MỖI PHƯƠNG ÁN NHIỄU kèm
 * một dòng nói nó đang bẫy hiểu lầm nào. Nếu dòng ấy không tới đúng ô học viên
 * vừa bấm thì cả tính năng mất hết ý nghĩa — nên phần lớn phép kiểm ở đây là về
 * chuyện đó.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(join(HERE, '..', 'public', 'js', 'course-exercises.js'), 'utf8');
const HTML = readFileSync(join(HERE, '..', 'public', 'pages', 'course-exercises.html'), 'utf8');
const CSS = readFileSync(join(HERE, '..', 'public', 'css', 'course-exercises.css'), 'utf8');

/** Chạy THẬT các hàm thuần bên trong IIFE bằng cách cắt lát rồi nạp lại. */
function load() {
  const start = JS.indexOf('  var $ = function');
  const end = JS.indexOf('  // ── Vẽ');
  assert.ok(start !== -1 && end > start, 'không tìm thấy vùng hàm nền');
  // Lát cắt có `var api = window.api;` — tiêm một `window` rỗng thay vì cắt né
  // dòng ấy: cắt né nghĩa là test một đoạn mã KHÁC với đoạn chạy thật.
  return new Function('window', `${JS.slice(start, end)}
    return { esc, md, splitStem, KEYS };`)({ api: null, document: null });
}

describe('dựng nội dung đề', () => {
  const f = load();

  test('**in đậm** thành <mark> — đó là chỗ câu hỏi đang chỉ vào', () => {
    assert.equal(f.md('The council, **following months**, opened.'),
      'The council, <mark>following months</mark>, opened.');
  });

  test('HTML trong nội dung bị thoát TRƯỚC khi dựng thẻ', () => {
    // Nội dung đi từ cơ sở dữ liệu ra màn hình; một dấu `<` trong câu tiếng Anh
    // không được biến thành thẻ.
    const out = f.md('a < b và <script>x</script> **đậm**');
    assert.ok(!out.includes('<script>'));
    assert.ok(out.includes('&lt;script&gt;'));
    assert.ok(out.includes('<mark>đậm</mark>'));
  });

  test('dòng đầu là CÂU HỎI, phần còn lại là mẫu vật', () => {
    const s = f.splitStem('Phần in đậm lấp ô nào?\nThe council opened libraries.');
    assert.equal(s.ask, 'Phần in đậm lấp ô nào?');
    assert.equal(s.spec, 'The council opened libraries.');
  });

  test('đề nhiều dòng giữ NGUYÊN các dòng của mẫu vật', () => {
    // Dạng B3 cho hai câu để so sánh — gộp chúng làm một dòng là xoá mất chính
    // thứ đang được hỏi.
    const s = f.splitStem('Khác biệt làm đổi cái gì?\n(1) A made B new uniforms.\n(2) A made B happier.');
    assert.ok(s.spec.includes('(1)') && s.spec.includes('(2)'));
    assert.ok(s.spec.includes('\n'));
  });

  test('đề một dòng thì không có mẫu vật', () => {
    assert.deepEqual(f.splitStem('Câu nào ĐÚNG?'), { ask: 'Câu nào ĐÚNG?', spec: '' });
  });
});

describe('cái bẫy tới đúng ô đã bấm', () => {
  test('chỉ ô CHỌN-SAI mới mở bẫy, không phải mọi ô sai', () => {
    // Bung hết bốn dòng bẫy cùng lúc là trả bài về đúng chỗ nó bắt đầu: một
    // đống chữ mà học viên phải tự tìm phần nói về mình.
    const src = JS.slice(JS.indexOf('function markOptions'));
    assert.match(src, /if \(role === 'miss'\)/);
    assert.match(src, /why\[String\(idx\)\]/);
  });

  test('nội dung bẫy được thoát HTML', () => {
    const src = JS.slice(JS.indexOf('function markOptions'));
    assert.match(src, /cx-trap[^]{0,60}?esc\(trap\)/);
  });

  test('ô đáp án đúng KHÔNG tô nền khi học viên đã chọn sai', () => {
    // data-r="key" = đúng nhưng không được chọn → chỉ viền.
    const m = CSS.match(/\.cx-opt\[data-r='key'\]\s*\{[^}]*\}/);
    assert.ok(m, 'thiếu quy tắc cho ô đáp án đúng');
    assert.doesNotMatch(m[0], /background:/);
    // Chọn đúng thì MỚI được tô.
    assert.match(CSS, /\.cx-opt\[data-r='hit'\]\s*\{[^}]*background:/);
  });
});

describe('câu tự luận không bị chấm máy', () => {
  test('không gửi lượt làm cho câu không có đúng/sai', () => {
    // Backend bỏ qua mọi lượt thiếu `is_correct`, nên gửi đi là gửi vào hư
    // không; ghi một giá trị đúng/sai bịa ra thì làm sai số giáo viên đọc.
    assert.match(JS, /if \(ok === null\) return;/);
  });

  test('màn tự đối chiếu nói rõ là KHÔNG chấm máy', () => {
    assert.match(JS, /không chấm máy/);
  });
});

describe('không mất bài đã làm', () => {
  test('gửi hỏng thì TRẢ LẠI hàng đợi', () => {
    // Mất lượt làm nghĩa là giáo viên đọc một con số thấp hơn thực tế và tưởng
    // em ấy bỏ bài.
    assert.match(JS, /_pending = batch\.concat\(_pending\)/);
  });

  test('đóng tab giữa chừng vẫn đẩy nốt', () => {
    assert.match(JS, /addEventListener\('pagehide'[^]{0,60}?flush\(true\)/);
  });

  test('chặng đang làm được nhớ lại', () => {
    assert.match(JS, /localStorage\.setItem\(key\(\)/);
    // Ghim HÀNH VI, không ghim nguyên văn một dòng: dòng ấy đã đổi một lần và
    // test đỏ vì định dạng chứ không vì lỗi.
    assert.match(JS, /_stage \* STAGE >= _qs\.length[^]{0,80}?_stage = 0/,
      'buổi bị soạn ngắn lại thì vị trí cũ phải bị bỏ, không thì mở ra trang trắng');
  });
});

describe('khung trang', () => {
  test('không có mã màu cứng — hệ token là nguồn duy nhất', () => {
    assert.equal((CSS.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length, 0);
  });

  test('nạp đúng bộ token và bộ phần chung', () => {
    assert.match(HTML, /aver-design\/tokens\.css/);
    assert.match(HTML, /course-exercises\.css/);
    assert.match(HTML, /course-exercises\.js/);
  });

  test('theme được đặt trước khi vẽ, tránh nháy trắng', () => {
    assert.match(HTML, /localStorage\.getItem\('av-theme'\)/);
  });

  test('thiếu mã bài tập thì nói rõ, không im lặng', () => {
    assert.match(JS, /Thiếu mã bài tập/);
  });
});


// ── Vòng review 1 ────────────────────────────────────────────────────────────

describe('dữ liệu phải tới được giáo viên', () => {
  test('trang KHỞI TẠO Supabase trước khi gọi API', () => {
    // Thiếu bước này thì mọi request đi không kèm Bearer, backend trả 401 và
    // trang tự đá về màn đăng nhập — kể cả với học viên đang đăng nhập. Tức là
    // cả trang không dùng được, không phải một lỗi nhỏ.
    assert.match(HTML, /initSupabase\('https:\/\/[a-z0-9]+\.supabase\.co'/);
    // Và phải đứng TRƯỚC bộ chạy, nếu không nó gọi API khi chưa có phiên.
    assert.ok(HTML.indexOf('initSupabase') < HTML.indexOf('course-exercises.js'));
  });

  test('hết chặng là KẾT phiên, không chỉ đẩy lượt làm', () => {
    // `quiz_admin_student_rollup` chỉ đếm phiên có `ended_at`. Không kết phiên
    // thì giáo viên mở mặt đọc ra thấy TRỐNG dù học viên vừa làm xong.
    assert.match(JS, /api\.patch\('\/api\/quiz\/sessions\/'/);
    assert.match(JS, /ended_by: 'completed'/);
  });

  test('đẩy hết lượt làm TRƯỚC rồi mới chốt phiên', () => {
    // Chốt trước thì con số tổng kết được ghi khi chưa có đủ lượt để đối chiếu.
    const fn = JS.slice(JS.indexOf('async function endSession'));
    assert.ok(fn.indexOf('await flush()') < fn.indexOf('api.patch'));
  });

  test('tạo phiên hỏng thì NÓI RA, không để làm xong mới biết mất bài', () => {
    // Câu thông báo được nối từ hai chuỗi, nên tìm cả cụm liền mạch sẽ đỏ vì
    // CÁCH XUỐNG DÒNG chứ không vì thiếu chốt.
    const blk = JS.slice(JS.indexOf('if (!_sessionId) {'));
    assert.ok(blk.startsWith('if (!_sessionId) {'), 'thiếu hẳn nhánh xử lý');
    assert.match(blk.slice(0, 600), /cx-error'\)\.hidden = false/);
    assert.match(blk.slice(0, 600), /Không kết nối được để lưu bài/);
    assert.match(blk.slice(0, 600), /tới giáo viên/);
  });
});

describe('không bắt làm lại phần đã làm', () => {
  const f2 = (() => {
    const start = JS.indexOf('  function key()');
    const end = JS.indexOf('  // ── Khởi động');
    return JS.slice(start, end);
  })();

  test('nhớ CẢ vị trí trong chặng và kết quả từng câu', () => {
    // Chỉ nhớ số chặng thì làm 9/10 câu rồi đóng tab sẽ quay lại đầu chặng —
    // làm lại chín câu vừa làm là thứ khiến người ta bỏ hẳn.
    assert.match(f2, /stage: _stage, at: _at, marks: _marks/);
    assert.match(f2, /if \(typeof v\.at === 'number'\) _at = v\.at;/);
    assert.match(f2, /if \(Array\.isArray\(v\.marks\)\) _marks = v\.marks;/);
  });

  test('lưu sau MỖI câu, không chỉ cuối chặng', () => {
    const nx = JS.slice(JS.indexOf('function next()'), JS.indexOf('function next()') + 300);
    assert.match(nx, /save\(\)/);
  });

  test('vị trí cũ vượt quá bài hiện tại thì bị bỏ, không mở ra trang trắng', () => {
    assert.match(JS, /if \(_at >= STAGE\) \{ _at = 0; _marks = \[\]; \}/);
  });
});

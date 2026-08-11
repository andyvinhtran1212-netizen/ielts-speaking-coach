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
// Logic của trang đã TÁCH sang `/js/mock-result.js` khi port sang Next: bản Next
// phải chạy CHÍNH mã đó chứ không chép lại. Khẳng định ở đây là "nguồn trang có
// chứa X", nên nguồn trang nay = HTML + module của nó. Đã kiểm: tệp này không có
// khẳng định nào phụ thuộc THỨ TỰ trong HTML, nên gộp giữ đúng ý định cũ.
const TRF = pub('pages', 'mock-result.html') + '\n' + pub('js', 'mock-result.js');

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

describe('TRF học viên — Speaking là thẻ mở trang riêng (bản duyệt trf-v2)', () => {
  // Logic đã TÁCH khỏi mã inline sang `/js/speaking-result.js` khi port trang
  // sang Next: bản Next phải chạy CHÍNH mã đó chứ không chép lại. Các khẳng định
  // về HÀNH VI vì thế soi tệp JS; phần markup vẫn soi HTML.
  const SPR = pub('js', 'speaking-result.js');
  const SPR_HTML = pub('pages', 'speaking-result.html');

  test('TRF đẩy thẻ Speaking vào Việc tiếp theo, KHÔNG render inline nữa', () => {
    assert.match(TRF, /href:\s*'\/speaking\/result\?sitting='/);
    assert.doesNotMatch(TRF, /pages\/speaking-result\.html\?sitting=/);
    assert.match(TRF, /typeof notes\.speaking === 'object'/);
    assert.doesNotMatch(TRF, /function renderSpeaking/);
    assert.doesNotMatch(TRF, /id="speaking-wrap"/);
  });

  test('trang riêng render đủ ba tầng: band tiêu chí, số đo so lớp, cách luyện', () => {
    assert.match(SPR, /function render\(spk\)/);
    assert.match(SPR, /Fluency & Coherence/);
    assert.match(SPR, /Trung bình lớp/);
    assert.match(SPR, /Cách luyện: /);
  });

  test('nội dung người chấm viết đi qua textContent, không innerHTML', () => {
    const code = SPR.replace(/\/\/[^\n]*/g, '');
    const body = code.slice(code.indexOf('function render(spk)'), code.indexOf('async function boot'));
    assert.doesNotMatch(body, /innerHTML/);
    assert.match(body, /textContent/);
  });

  test('trang riêng gate đúng: thiếu sitting hay không có nhận xét đều báo rõ', () => {
    assert.match(SPR, /Thiếu mã lượt thi/);
    assert.match(SPR, /không có nhận xét Speaking/);
    assert.match(SPR, /\/mock\/result\?sitting='/);
    assert.doesNotMatch(SPR, /\/pages\/mock-result\.html\?sitting=/);
  });

  test('trang riêng NẠP supabase-js trước api.js', () => {
    // initSupabase dereference window.supabase.createClient — thiếu script CDN
    // là trang chết vĩnh viễn ở "Đang tải" ngay lần ghé đầu tiên (Codex #875).
    // Đây là khẳng định về THẺ SCRIPT, nên nó soi HTML — không phải tệp logic
    // vừa tách ra.
    const at = SPR_HTML.indexOf('@supabase/supabase-js');
    assert.ok(at > 0, 'thiếu script supabase-js');
    assert.ok(at < SPR_HTML.indexOf('/js/api.js'), 'supabase-js phải đứng trước api.js');
  });

  test('phiếu v2 co được về 320px: media query trỏ đúng class đang tồn tại', () => {
    // Media query cũ trỏ .trf-overall/.trf-band-grid đã gỡ — phiếu 168px +
    // overflow:hidden CẮT mất thanh và con số trên máy nhỏ (Codex #875).
    assert.match(TRF, /\.trf-card__body \{ grid-template-columns: 1fr/);
    assert.doesNotMatch(TRF, /@media[^}]*\.trf-overall/);
  });

  test('phiếu điểm v2: vòng cung overall + hàng kỹ năng có thanh mức', () => {
    assert.match(TRF, /id="overall-ring"/);
    assert.match(TRF, /conic-gradient\(var\(--av-primary\)/);
    assert.match(TRF, /trf-sk__bar/);
  });
});

/**
 * Giao bài cho MỘT NHÓM, và bù học viên mới vào bài đã giao.
 *
 * Hai lỗ hổng có thật: em vào lớp sau ngày giao thì bài vô hình với em, và
 * muốn giao riêng cho vài em thì phải giao cả lớp rồi dặn miệng.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');
const HTML = readFileSync(
  join(HERE, '..', 'public', 'pages', 'admin', 'classes', 'index.html'), 'utf8');
const CODE = JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('giao cho một nhóm', () => {
  test('MỌI lệnh giao bài đều mang người nhận', () => {
    // Ba hàm gửi riêng, bốn payload (một hàm có hai nhánh). Vá ba chỗ rồi sót
    // chỗ thứ tư thì đúng loại bài ấy vẫn lặng lẽ giao cho cả lớp — và không có
    // gì đỏ để báo. Nên ĐẾM, đừng tin là đã sửa hết.
    const posts = [...CODE.matchAll(/api\.post\(\s*\n?\s*'\/admin\/cohorts\/'[^;]*?\n\s*\);/gs)]
      .map((m) => m[0]);
    const gives = posts.filter((p) => p.includes("+ '/assignments'"));
    assert.ok(gives.length >= 3, `phải thấy cả ba lệnh giao bài, thấy ${gives.length}`);
    for (const g of gives) {
      const bodies = (g.match(/student_ids: whoRecipients\(\)/g) || []).length;
      const objects = (g.match(/\n\s{8}skill/g) || []).length || 1;
      assert.ok(bodies >= objects,
        `một payload trong lệnh giao này thiếu student_ids:\n${g.slice(0, 200)}`);
    }
  });

  test('bỏ trống = CẢ LỚP, gửi null chứ không phải mảng rỗng', () => {
    // `[]` nghĩa là "không ai" — backend sẽ raise empty_roster và bài giao hằng
    // ngày ngừng hoạt động cho toàn hệ thống.
    const i = CODE.indexOf('function whoRecipients');
    const body = CODE.slice(i, i + 260);
    assert.match(body, /if \(whoIsAll\(\)\) return null;/);
  });

  test('mở hộp thoại thì quay về cả lớp', () => {
    // Giữ lựa chọn của lần trước là để giáo viên giao nhầm cho ba em rồi tưởng
    // cả lớp đã nhận.
    const i = CODE.indexOf('function openHomeworkModal');
    const body = CODE.slice(i, i + 700);
    assert.match(body, /\$\('hf-who'\)\.value = 'all'/);
    assert.match(body, /_who\.picked = new Set\(\)/);
  });

  test('chọn nhóm mà chưa chọn ai thì không bấm giao được', () => {
    const i = CODE.indexOf('function syncWho');
    const body = CODE.slice(i, i + 700);
    assert.match(body, /btn\.disabled = !whoIsAll\(\) && _who\.picked\.size === 0/);
  });

  test('nút nói rõ nó sắp giao cho ai', () => {
    const i = CODE.indexOf('function syncWho');
    const body = CODE.slice(i, i + 700);
    assert.match(body, /Giao cho cả lớp/);
    assert.match(body, /Giao cho ' \+ _who\.picked\.size/);
  });

  test('khối chọn người nhận có trong trang', () => {
    // Bài học PR #925: mã vẽ vào một id không tồn tại thì không có gì đỏ, chỉ
    // có một tính năng lặng lẽ không chạy.
    for (const id of ['hf-who', 'hf-who-pick', 'hf-who-list', 'hf-who-count',
                      'btn-hf-who-all', 'btn-hf-who-none']) {
      assert.ok(HTML.includes(`id="${id}"`), `trang thiếu #${id}`);
    }
  });

  test('danh sách đọc ĐÚNG hình dạng /members trả về', () => {
    // `/members` trả {student_id, student_code, name, user_id} — đọc
    // `display_name`/`email` là vẽ ra một danh sách toàn "Chưa có tên".
    const i = CODE.indexOf('function renderWho');
    const body = CODE.slice(i, i + 800);
    assert.match(body, /m\.name \|\| m\.student_code/);
    assert.match(body, /m\.student_id/);
    assert.ok(!/m\.display_name|m\.email/.test(body), 'trường không có trong hợp đồng');
  });

  test('sĩ số dùng lại từ lần nạp lớp, không gọi mạng khi mở hộp thoại', () => {
    assert.match(CODE, /_who\.members = members;/);
  });
});

describe('bù học viên vào bài đã giao', () => {
  test('có nút, và nút gọi đúng đường', () => {
    assert.match(CODE, /data-action="backfill"/);
    assert.match(CODE, /if \(btn\.dataset\.action === 'backfill'\) backfillHomework/);
    const i = CODE.indexOf('async function backfillHomework');
    const body = CODE.slice(i, i + 700);
    assert.match(body, /\/assignments\/'[\s\S]{0,60}\+ '\/backfill'/);
  });

  test('không có ai để bù thì NÓI RA, không im lặng', () => {
    const i = CODE.indexOf('async function backfillHomework');
    const body = CODE.slice(i, i + 900);
    assert.match(body, /đều đã có bài này rồi/);
    assert.match(body, /Đã thêm \$\{r\.added\}/);
  });

  test('bù xong nạp lại danh sách và bỏ cache tiến độ', () => {
    // Bảng ngày dựng TỪ danh sách bài giao — thêm người nhận làm nó cũ ngay.
    const i = CODE.indexOf('async function backfillHomework');
    const body = CODE.slice(i, i + 900);
    assert.match(body, /await loadHomework\(\)/);
    assert.match(body, /invalidateProgress\(\)/);
  });
});

describe('chi tiết làm bài', () => {
  test('nút CHỈ hiện cho bài tập theo buổi', () => {
    // Kỹ năng khác không có `quiz_attempts`, nút sẽ mở ra một bảng rỗng và
    // giáo viên đọc thành "không ai làm".
    const i = CODE.indexOf('const effort = ');
    const body = CODE.slice(i, i + 320);
    assert.match(body, /a\.skill === 'course' && a\.content_id/);
  });

  test('mở theo BANK, không phải theo id bài giao', () => {
    // Báo cáo đọc `quiz_sessions.bank_id`; truyền nhầm id bài giao sẽ ra rỗng
    // mà không có gì đỏ.
    const i = CODE.indexOf('const effort = ');
    assert.match(CODE.slice(i, i + 320), /data-id="\$\{esc\(a\.content_id\)\}"/);
  });

  test('gọi đúng đường báo cáo, KÈM bài giao', () => {
    // Cùng một bộ đề giao được cho nhiều lớp — hỏi theo bank thôi thì bảng
    // trộn lượt làm của lớp khác vào (codex PR 945).
    const i = CODE.indexOf('async function openEffort');
    const body = CODE.slice(i, i + 900);
    assert.match(body, /\/admin\/quiz\/banks\/'[\s\S]{0,140}\/attempt-report\?assignment_id=/);
    assert.match(body, /encodeURIComponent\(assignmentId\)/);
  });

  test('nút mang CẢ bank lẫn id bài giao', () => {
    const i = CODE.indexOf('const effort = ');
    const body = CODE.slice(i, i + 400);
    assert.match(body, /data-id="\$\{esc\(a\.content_id\)\}"/, 'bank');
    assert.match(body, /data-asg="\$\{esc\(a\.id\)\}"/, 'bài giao');
  });

  test('số chặng hiện cả MẪU SỐ, không chỉ số đã xong', () => {
    // "2 chặng" một mình không nói được là 2/9 hay 2/2.
    const i = CODE.indexOf('async function openEffort');
    assert.match(CODE.slice(i, i + 2000), /x\.stages_done\}\$\{r\.stages_total/);
  });

  test('bốn tình trạng đều có chữ tiếng Việt riêng', () => {
    const i = CODE.indexOf('const EFFORT_STATE');
    const body = CODE.slice(i, i + 260);
    for (const s of ['stalled', 'doing', 'done', 'untouched']) {
      assert.ok(body.includes(s + ':'), `thiếu nhãn cho '${s}'`);
    }
    assert.match(body, /Bỏ dở/);
  });

  test('modal có trong trang VÀ nút Đóng được nối', () => {
    // Vẽ ra một hộp thoại không đóng được là bẫy người dùng trong đó.
    for (const id of ['effort-modal', 'effort-body', 'btn-effort-close']) {
      assert.ok(HTML.includes(`id="${id}"`), `trang thiếu #${id}`);
    }
    assert.match(CODE, /\$\('btn-effort-close'\)\.addEventListener\('click'/);
    assert.match(CODE, /bindModalBackdrop\('effort-modal'/);
  });

  test('ghép tên từ sĩ số, không đòi backend biết về lớp', () => {
    // Cùng một bank giao được cho nhiều lớp.
    const i = CODE.indexOf('async function openEffort');
    assert.match(CODE.slice(i, i + 1400), /_who\.members[\s\S]{0,120}nameOf\[m\.user_id\]/);
  });

  test('nói rõ thời gian nghĩa là gì', () => {
    const i = CODE.indexOf('async function openEffort');
    assert.match(CODE.slice(i, i + 3000), /cộng từ các chặng đã chốt/);
  });
});

describe('nói ra khi dữ liệu chưa đọc đủ', () => {
  test('báo cáo thiếu thì hiện cảnh báo, không vẽ bảng như thật', () => {
    // Bảng trông bình thường mà sai còn tệ hơn bảng không hiện: giáo viên sẽ
    // nhắc nhầm một em đang làm dở (codex PR 945 vòng 2).
    const i = CODE.indexOf('async function openEffort');
    const body = CODE.slice(i, i + 3200);
    assert.match(body, /r\.stale/);
    assert.match(body, /Chưa đọc được đầy đủ dữ liệu/);
  });
});

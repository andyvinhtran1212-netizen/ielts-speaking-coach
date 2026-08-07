// Cổng nặng PHẢI chạy lại trên `main` sau khi merge, không chỉ trên PR.
//
// VÌ SAO CÓ CHỐT NÀY: cổng theo PR chỉ chứng minh «nhánh này so với main LÚC
// ĐÓ». Nó KHÔNG chứng minh main sau khi hợp nhất. Ngày 2026-08-07, chín PR
// chồng nhau lên main liên tiếp — mỗi PR đều xanh — mà trạng thái hợp nhất
// không cổng nào chạm tới: đẩy lên main chỉ kích hoạt `typecheck.yml`, vốn
// được khai là non-blocking. Phải dispatch tay mới biết main lành.
//
// Main deploy THẲNG ra production, nên khoảng trống đó nằm ngay trước mặt người
// dùng. Lịch đêm không lấp được: chú thích trong `parity-gate.yml` ghi rõ cron
// ấy CHƯA TỪNG CHẠY lần nào (đo 2026-08-04), và cron `*/15` của G2 bị GitHub
// giãn ra trung vị 84 phút. Lịch trên GitHub Actions là best-effort thật sự.
//
// PHẠM VI CÓ Ý THỨC: chốt chỉ khẳng định workflow CÓ đường kích hoạt khi đẩy
// lên main. Nó KHÔNG khẳng định workflow đó kiểm đúng thứ cần kiểm — chuyện ấy
// là việc của từng cổng.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WF_DIR = path.join(ROOT, '.github/workflows');

// Cổng mà kết quả HỢP NHẤT có thể khác kết quả từng-PR. Đây là tiêu chí chọn,
// không phải danh sách tuỳ hứng: mỗi tệp dưới đây dựng lại/chạy lại thứ gì đó
// trên TOÀN BỘ cây, nên hai nhánh cùng xanh vẫn có thể hợp lại thành đỏ.
const MUST_RUN_ON_MAIN = [
  'parity-gate.yml',    // G1 parity + cổng đường-ghi
  'backend-tests.yml',  // pytest + node --test
  'route-manifest.yml', // npm run build + kiểm sở hữu route + sàn trình duyệt
  'e2e.yml',            // smoke Playwright
  'legacy-freeze.yml',  // không thêm trang HTML legacy
];

/**
 * Khối `on:` của một workflow, ĐÃ BỎ chú thích.
 *
 * Bỏ chú thích trước khi dò là bắt buộc: các tệp này chú thích rất dày, và một
 * dòng văn xuôi nhắc tới `push:` hay `branches: [main]` sẽ làm bộ dò báo đạt
 * trong khi workflow không hề có trigger nào — đúng kiểu «xanh mà chưa kiểm gì».
 */
function onBlock(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^on:/.test(l));
  if (start < 0) return null;
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^[A-Za-z_]/.test(line)) break;           // sang khoá cấp cao kế tiếp
    if (/^\s*#/.test(line) || !line.trim()) continue;
    out.push(line);
  }
  return out.join('\n');
}

/** Khối `on:` này có kích hoạt khi đẩy lên `main` không? */
function runsOnMainPush(block) {
  if (block == null) return false;
  const lines = block.split('\n');
  const i = lines.findIndex((l) => /^ {2}push:\s*$/.test(l));
  if (i < 0) return false;
  // Chỉ đọc phần THÂN của `push:` (thụt sâu hơn 2 dấu cách), để `branches:` của
  // một trigger khác — ví dụ `pull_request:` — không bị tính nhầm sang đây.
  const body = [];
  for (const l of lines.slice(i + 1)) {
    if (/^ {2}\S/.test(l)) break;
    body.push(l);
  }
  const b = body.join('\n');
  if (/branches:/.test(b)) {
    return /branches:\s*\[[^\]]*\bmain\b[^\]]*\]/.test(b) || /branches:[\s\S]*?^\s*-\s*main\s*$/m.test(b);
  }
  // Không khai `branches:`. Vắng luôn `tags:` thì là MỌI nhánh ⇒ có main. Nhưng
  // nếu CHỈ khai `tags:` thì GitHub chạy đúng khi đẩy TAG, không chạy khi đẩy
  // nhánh — bộ dò bản đầu của tôi coi đó là «đạt», và chính đối chứng âm dưới
  // đây bắt được. Đó là lý do đối chứng âm phải viết trước, không phải viết cho đủ.
  return !/tags:/.test(b);
}

/**
 * Workflow này có dùng `github.base_ref` mà KHÔNG có đường thoát cho ca push?
 *
 * Hai hình dạng dự phòng hợp lệ, và chỉ hai:
 *   · dựng mốc khác khi base_ref rỗng (`github.event.before`);
 *   · thoát sớm theo `github.event_name` TRƯỚC khi chạm tới base_ref.
 * Điều kiện «trước» là VỊ TRÍ, không phải sự có mặt: một `exit 0` nằm SAU chỗ
 * dùng base_ref thì không cứu được gì.
 */
function thiếuDựPhòngBaseRef(text) {
  const lines = text.split('\n').map((l) => (/^\s*#/.test(l) ? '' : l));
  const iBase = lines.findIndex((l) => /github\.base_ref/.test(l));
  if (iBase < 0) return false;                       // không dùng thì không có rủi ro
  const cả = lines.join('\n');
  if (/github\.event\.before/.test(cả)) return false;
  const trước = lines.slice(0, iBase).join('\n');
  return !(/github\.event_name/.test(trước) && /exit 0/.test(trước));
}

describe('cổng nặng chạy lại trên main sau khi merge', () => {
  // ĐỐI CHỨNG ÂM. Không có nó, một bộ dò luôn-trả-true sẽ làm mọi khẳng định
  // dưới đây xanh mà chẳng chứng minh gì — đúng cái bẫy chốt này sinh ra để
  // tránh. Ghim HÀNH VI của bộ dò, không ghim tên tệp.
  test('bộ dò thật sự phân biệt được có/không có trigger', () => {
    const có = onBlock('on:\n  push:\n    branches: [main]\n  pull_request:\n\njobs:\n');
    assert.equal(runsOnMainPush(có), true, 'khai đúng mà bộ dò báo KHÔNG');

    assert.equal(runsOnMainPush(onBlock('on:\n  pull_request:\n\njobs:\n')), false,
      'chỉ có pull_request mà bộ dò vẫn báo CÓ');

    assert.equal(runsOnMainPush(onBlock('on:\n  push:\n    branches: [staging]\n\njobs:\n')), false,
      'push nhánh khác main mà bộ dò vẫn báo CÓ');

    // Chú thích nhắc tới trigger KHÔNG được tính là trigger.
    assert.equal(
      runsOnMainPush(onBlock('on:\n  # push:\n  #   branches: [main]\n  pull_request:\n\njobs:\n')),
      false, 'chú thích bị đọc thành khai báo thật');

    // `branches:` của pull_request không được nhận nhầm thành của push.
    assert.equal(
      runsOnMainPush(onBlock('on:\n  push:\n    tags: ["v*"]\n  pull_request:\n    branches: [main]\n\njobs:\n')),
      false, '`branches` của pull_request bị tính sang push');

    // Dạng danh sách nhiều dòng cũng phải nhận ra.
    assert.equal(
      runsOnMainPush(onBlock('on:\n  push:\n    branches:\n      - main\n\njobs:\n')),
      true, 'dạng danh sách nhiều dòng không được nhận ra');
  });

  test('mỗi cổng nặng có đường kích hoạt khi đẩy lên main', () => {
    const thiếu = [];
    for (const f of MUST_RUN_ON_MAIN) {
      const p = path.join(WF_DIR, f);
      if (!existsSync(p)) { thiếu.push(`${f}: KHÔNG TỒN TẠI (đổi tên mà quên sửa chốt?)`); continue; }
      if (!runsOnMainPush(onBlock(readFileSync(p, 'utf8')))) thiếu.push(`${f}: thiếu \`push.branches: [main]\``);
    }
    assert.deepEqual(thiếu, [],
      'cổng chỉ chạy trên PR thì main sau hợp nhất KHÔNG được kiểm — mà main deploy '
      + 'thẳng ra production. Xem đầu tệp này để biết ca đã xảy ra thật.');
  });

  // Trên `push`, GitHub KHÔNG cung cấp `github.base_ref`. Một bước dựng mốc so
  // sánh từ nó sẽ ra `origin/` và `git diff` hỏng — mà các bước này thường kèm
  // `|| true`, nên lỗi bị nuốt, danh sách tệp thành rỗng và cổng XANH mà chưa
  // so gì. Đây là kiểu hỏng tệ nhất: nó trông y hệt lúc chạy đúng.
  test('bộ dò base_ref phân biệt được có/không có dự phòng', () => {
    const dùngKhôngDựPhòng = 'on:\n  push:\n    branches: [main]\njobs:\n  a:\n    steps:\n'
      + '      - run: |\n          BASE="origin/${{ github.base_ref }}"\n          git diff "$BASE"...HEAD || true\n';
    assert.equal(thiếuDựPhòngBaseRef(dùngKhôngDựPhòng), true, 'ca hỏng thật mà bộ dò bỏ qua');

    const cóBefore = dùngKhôngDựPhòng.replace('BASE="origin/', 'BASE="${{ github.event.before }}" # origin/');
    assert.equal(thiếuDựPhòngBaseRef(cóBefore), false, 'có mốc dự phòng mà bộ dò vẫn báo thiếu');

    const thoátSớm = 'on:\n  push:\njobs:\n  a:\n    steps:\n      - run: |\n'
      + '          case "${{ github.event_name }}" in push) exit 0 ;; esac\n'
      + '          BASE="origin/${{ github.base_ref }}"\n';
    assert.equal(thiếuDựPhòngBaseRef(thoátSớm), false, 'thoát sớm trước base_ref mà vẫn báo thiếu');

    // VỊ TRÍ mới là điều kiện: thoát sớm nằm SAU thì không cứu được gì.
    const thoátMuộn = 'on:\n  push:\njobs:\n  a:\n    steps:\n      - run: |\n'
      + '          BASE="origin/${{ github.base_ref }}"\n'
      + '          case "${{ github.event_name }}" in push) exit 0 ;; esac\n';
    assert.equal(thiếuDựPhòngBaseRef(thoátMuộn), true, 'thoát sớm nằm SAU base_ref mà vẫn được tính');

    // Chú thích không phải mã.
    const chỉChúThích = 'on:\n  push:\njobs:\n  a:\n    steps:\n      - run: |\n'
      + '          # ${{ github.event_name }} ... exit 0\n'
      + '          BASE="origin/${{ github.base_ref }}"\n';
    assert.equal(thiếuDựPhòngBaseRef(chỉChúThích), true, 'chú thích bị đọc thành nhánh dự phòng');
  });

  test('không cổng nào dựng mốc so sánh CHỈ từ base_ref', () => {
    const xấu = [];
    for (const f of MUST_RUN_ON_MAIN) {
      const p = path.join(WF_DIR, f);
      if (!existsSync(p)) continue;
      if (thiếuDựPhòngBaseRef(readFileSync(p, 'utf8'))) {
        xấu.push(`${f}: dùng base_ref mà không có đường thoát khi đẩy lên main`);
      }
    }
    assert.deepEqual(xấu, [],
      'base_ref rỗng trên push ⇒ git diff hỏng ⇒ `|| true` nuốt lỗi ⇒ cổng xanh mà chưa so gì');
  });
});

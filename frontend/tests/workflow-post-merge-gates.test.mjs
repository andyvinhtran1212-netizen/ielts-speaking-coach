// Cổng nặng PHẢI chạy lại trên `main` sau khi merge, không chỉ trên PR.
//
// VÌ SAO CÓ CHỐT NÀY: cổng theo PR chỉ chứng minh «nhánh này so với main LÚC
// ĐÓ». Nó KHÔNG chứng minh main sau khi hợp nhất. Ngày 2026-08-07, chín PR
// chồng nhau lên main liên tiếp — mỗi PR đều xanh — mà trạng thái hợp nhất
// không cổng blocking nào chạm tới: `typecheck.yml` khi đó vẫn được khai là
// non-blocking. Phải dispatch tay mới biết main lành.
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
// `dấuHiệu` là LỆNH cổng đó thật sự chạy. Không có nó, một workflow bị rút hết
// việc sang tệp khác nhưng giữ lại cái vỏ có trigger vẫn qua chốt — tức chốt chỉ
// canh cái tên chứ không canh việc. Đây không phải giả định: cả tệp này ra đời
// vì một cổng «có tồn tại» mà không chạy.
const MUST_RUN_ON_MAIN = [
  { tệp: 'parity-gate.yml', dấuHiệu: /node tooling\/parity-diff\.mjs/ },
  { tệp: 'backend-tests.yml', dấuHiệu: /pytest/ },
  { tệp: 'route-manifest.yml', dấuHiệu: /npm run build/ },
  { tệp: 'e2e.yml', dấuHiệu: /playwright test/ },
  { tệp: 'legacy-freeze.yml', dấuHiệu: /--diff-filter=A/ },
  { tệp: 'typecheck.yml', dấuHiệu: /npx tsc --noEmit/ },
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

/**
 * Các MỤC của một khoá danh sách (`branches`, `branches-ignore`) dưới `push:`.
 *
 * So từng mục ĐÚNG BẰNG, không dò bằng `\bmain\b` trên cả khối: `[main-old]`
 * cũng khớp `\bmain\b` (sau `main` là dấu `-`, một ký tự không-từ), nên bộ dò
 * cũ sẽ báo đạt cho một workflow KHÔNG hề chạy trên main.
 *
 * Nhận cả hai cú pháp YAML: dạng ngoặc vuông và dạng gạch đầu dòng.
 */
function mụcCủa(block, key) {
  const lines = block.split('\n');
  const i = lines.findIndex((l) => new RegExp(`^\\s*${key}:`).test(l));
  if (i < 0) return [];
  const đầu = lines[i].slice(lines[i].indexOf(':') + 1).trim();
  const gọn = (s) => s.trim().replace(/^['"]|['"]$/g, '');
  if (đầu.startsWith('[')) {
    return đầu.replace(/^\[|\]$/g, '').split(',').map(gọn).filter(Boolean);
  }
  const out = [];
  for (const l of lines.slice(i + 1)) {
    const m = /^\s*-\s*(.+?)\s*$/.exec(l);
    if (!m) break;
    out.push(gọn(m[1]));
  }
  return out;
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
  // `branches-ignore: [main]` loại main dù có `branches:` hay không.
  if (/branches-ignore:/.test(b) && mụcCủa(b, 'branches-ignore').includes('main')) return false;
  if (/(^|\n)\s*branches:/.test(b)) {
    const mục = mụcCủa(b, 'branches');
    // Pattern phủ định đứng sau sẽ loại nhánh đã khớp trước đó (thứ tự có nghĩa
    // trong Actions), nên `[main, '!main']` KHÔNG chạy trên main.
    if (mục.includes('!main')) return false;
    return mục.includes('main');
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
  // XÉT THEO TỪNG STEP. Bản trước quét cả tệp, nên một `github.event.before` ở
  // step KHÁC — kể cả trong một lệnh `echo` vô hại — cũng đủ làm nó tuyên bố
  // «có dự phòng» cho một step hoàn toàn không có. Dự phòng chỉ có nghĩa khi
  // nó nằm cùng chỗ với thứ nó phải cứu.
  const lines = text.split('\n').map((l) => (/^\s*#/.test(l) ? '' : l));
  const mốcStep = lines.map((l, i) => (/^\s*- (name|run|uses):/.test(l) ? i : -1))
    .filter((i) => i >= 0);
  if (!mốcStep.length) return /github\.base_ref/.test(lines.join('\n'));

  for (let k = 0; k < mốcStep.length; k++) {
    const step = lines.slice(mốcStep[k], mốcStep[k + 1] ?? lines.length);
    const iBase = step.findIndex((l) => /github\.base_ref/.test(l));
    if (iBase < 0) continue;
    const cả = step.join('\n');
    // Step bị chặn bằng `if:` chỉ chạy cho pull_request thì base_ref luôn có.
    if (/^\s*if:.*pull_request/m.test(cả)) continue;
    if (/github\.event\.before/.test(cả)) continue;
    const trước = step.slice(0, iBase).join('\n');
    if (/github\.event_name/.test(trước) && /exit 0/.test(trước)) continue;
    return true;
  }
  return false;
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

    // ── Các ca codex nêu ở vòng review #998 ──────────────────────────────
    // Bộ dò bản đầu dò `\bmain\b` trên cả khối, nên `main-old` cũng khớp: một
    // workflow KHÔNG chạy trên main vẫn được báo đạt.
    assert.equal(runsOnMainPush(onBlock('on:\n  push:\n    branches: [main-old]\n\njobs:\n')),
      false, '`main-old` bị nhận nhầm thành `main`');

    // Thứ tự pattern có nghĩa trong Actions: phủ định đứng sau loại nhánh đã khớp.
    assert.equal(runsOnMainPush(onBlock("on:\n  push:\n    branches: [main, '!main']\n\njobs:\n")),
      false, 'pattern phủ định bị bỏ qua');

    assert.equal(runsOnMainPush(onBlock('on:\n  push:\n    branches-ignore: [main]\n\njobs:\n')),
      false, '`branches-ignore: [main]` bị bỏ qua');

    // `tags:` có `main` KHÔNG được đọc nhầm sang `branches:`.
    assert.equal(
      runsOnMainPush(onBlock('on:\n  push:\n    branches: [staging]\n    tags:\n      - main\n\njobs:\n')),
      false, '`main` trong tags bị tính sang branches');
  });

  test('mỗi cổng nặng có đường kích hoạt khi đẩy lên main', () => {
    const thiếu = [];
    for (const { tệp, dấuHiệu } of MUST_RUN_ON_MAIN) {
      const p = path.join(WF_DIR, tệp);
      if (!existsSync(p)) { thiếu.push(`${tệp}: KHÔNG TỒN TẠI (đổi tên mà quên sửa chốt?)`); continue; }
      const text = readFileSync(p, 'utf8');
      if (!runsOnMainPush(onBlock(text))) thiếu.push(`${tệp}: thiếu \`push.branches: [main]\``);
      // Còn trigger nhưng hết việc thì trigger vô nghĩa.
      const chạyThật = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
      if (!dấuHiệu.test(chạyThật)) {
        thiếu.push(`${tệp}: không còn chạy ${dấuHiệu} — việc đã dời đi nơi khác?`);
      }
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

    // ── Ca codex nêu ở vòng review #998 ──────────────────────────────────
    // Dự phòng ở STEP KHÁC không cứu được step đang hỏng. Bản đầu quét cả tệp
    // nên ca này lọt.
    const beforeỞStepKhác = 'on:\n  push:\njobs:\n  a:\n    steps:\n'
      + '      - run: echo "${{ github.event.before }}"\n'
      + '      - run: |\n          BASE="origin/${{ github.base_ref }}"\n'
      + '          git diff "$BASE"...HEAD || true\n';
    assert.equal(thiếuDựPhòngBaseRef(beforeỞStepKhác), true,
      '`event.before` ở step khác bị tính là dự phòng cho step này');

    // Ngược lại: step chỉ chạy cho pull_request thì base_ref luôn tồn tại.
    const chặnBằngIf = 'on:\n  push:\njobs:\n  a:\n    steps:\n'
      + "      - name: chỉ PR\n        if: github.event_name == 'pull_request'\n"
      + '        run: |\n          BASE="origin/${{ github.base_ref }}"\n';
    assert.equal(thiếuDựPhòngBaseRef(chặnBằngIf), false,
      'step đã chặn bằng `if` pull_request mà vẫn bị báo thiếu');
  });

  test('không cổng nào dựng mốc so sánh CHỈ từ base_ref', () => {
    const xấu = [];
    for (const { tệp } of MUST_RUN_ON_MAIN) {
      const p = path.join(WF_DIR, tệp);
      if (!existsSync(p)) continue;
      if (thiếuDựPhòngBaseRef(readFileSync(p, 'utf8'))) {
        xấu.push(`${tệp}: dùng base_ref mà không có đường thoát khi đẩy lên main`);
      }
    }
    assert.deepEqual(xấu, [],
      'base_ref rỗng trên push ⇒ git diff hỏng ⇒ `|| true` nuốt lỗi ⇒ cổng xanh mà chưa so gì');
  });
});

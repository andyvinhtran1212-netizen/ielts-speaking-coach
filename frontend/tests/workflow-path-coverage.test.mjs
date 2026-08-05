// Tệp mà một workflow THỰC SỰ ĐỌC phải nằm trong `on.pull_request.paths` của nó.
//
// VÌ SAO CÓ CHỐT NÀY: cùng một họ lỗi lặp BỐN lần trong một đợt, lần nào cũng do
// người review bắt chứ không phải máy — #930, #937, #943, #944 đều là "chốt có
// tồn tại, nhưng đường kích hoạt của nó không phủ hết thứ nó canh". Bốn lần cùng
// một lỗi là tín hiệu về THIẾT KẾ: việc "nhớ liệt kê đủ glob" đang được giao cho
// trí nhớ con người. Chốt này giao nó cho máy.
//
// PHẠM VI THẬT SỰ PHỦ ĐƯỢC — nói thẳng để không ai tưởng nó phủ nhiều hơn thực tế.
// Nó thấy tệp qua hai đường TĨNH:
//   (1) import cục bộ bắc cầu của script được workflow gọi;
//   (2) chuỗi trong script trỏ tới một đường dẫn CÓ THẬT trong repo — đây là
//       đường mà #943 đi (`pre-push-hook.test.mjs` mở `scripts/hooks/*` bằng
//       tên tệp, không phải bằng `import`).
// Nó KHÔNG thấy phụ thuộc chỉ tồn tại lúc chạy: #944 lệ thuộc `public/js/api.js`
// vì TRÌNH DUYỆT nạp tệp đó khi harness mở trang — không script nào nêu tên nó,
// nên không cơ chế tĩnh nào suy ra được. Muốn phủ nhóm đó thì harness phải TỰ
// KHAI ra danh sách tệp nó đã phục vụ (Playwright đã chặn sẵn mọi request); đó là
// việc riêng, chưa làm ở đây.
//
// Nói cách khác: chốt này bắt được 1 trong 4 ca lịch sử, cộng với mọi ca cùng
// hình dạng về sau. Nó không phải tấm lưới kín.
//
// VÀ NÓ SẼ KHÔNG BAO GIỜ KÍN. Quá trình review PR #946 chứng minh điều đó: ba
// vòng liên tiếp phát hiện thêm một lớp đầu vào chưa mô hình hoá — đường dẫn
// dựng từ hằng của script, rồi bước `npm run build`, rồi siêu dữ liệu bản dựng
// (`package.json`/`tsconfig.json`). Mỗi lần vá xong lại lộ lớp kế tiếp. Một mô
// hình TĨNH về "thứ một bước CI đọc" không thể đầy đủ, nên đừng đọc chốt này
// như một chứng minh về tính đầy đủ: nó chỉ khẳng định các LỚP nó mô hình hoá
// (lệnh gọi trực tiếp, import bắc cầu, chuỗi đường dẫn, gốc bí danh, siêu dữ
// liệu bản dựng). Muốn tiến xa hơn thì phải đổi cách: để chính harness TỰ KHAI
// danh sách tệp nó đã đọc/phục vụ, thay vì suy đoán từ ngoài.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WF_DIR = path.join(ROOT, '.github/workflows');

/**
 * Glob của GitHub Actions → RegExp. `**` xuyên thư mục, `*` thì không.
 *
 * Ký tự giữ chỗ cho `**` phải là CHỮ. Bản đầu dùng NUL literal, và git xếp cả
 * tệp vào loại nhị phân (`Bin 10358 -> 11829 bytes`) — nghĩa là mọi thay đổi sau
 * này với chốt CI này sẽ không xem diff được, không review được. Cả `Read` lẫn
 * mắt đều hiển thị NUL thành dấu cách nên tôi không thấy; Codex bắt ở PR #946.
 * `@@GLOBSTAR@@` không chứa `*` nên nó sống sót qua bước đổi `*` → `[^/]*` ở
 * giữa, và không glob thật nào chứa nó.
 */
function globToRe(glob) {
  const rx = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/?/g, '@@GLOBSTAR@@')      // giữ chỗ trước khi xử lý `*` đơn
    .replace(/\*/g, '[^/]*')
    .replace(/@@GLOBSTAR@@/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${rx}$`);
}

/**
 * Đọc `on.pull_request.paths` mà KHÔNG cần thư viện YAML.
 *
 * Cố ý thô: bộ test frontend chạy bằng `node --test` trần, không phụ thuộc gói
 * nào; kéo `js-yaml` về chỉ để đọc một danh sách chuỗi là quá tay. Cái giá là nó
 * chỉ hiểu đúng dạng đang dùng trong repo — nên có test "đọc được ≥2 workflow" ở
 * dưới, để ngày định dạng đổi thì chốt ĐỎ chứ không im lặng thành rỗng.
 */
function readPaths(src) {
  const lines = src.split('\n');
  // Neo vào `pull_request:` chứ không lấy `paths:` ĐẦU TIÊN trong tệp: một
  // workflow có thêm trigger `push:` với `paths:` riêng sẽ khiến bản lấy-đầu-tiên
  // đọc nhầm bộ lọc. Repo hiện chưa có ca đó — neo sẵn để nó không thành bẫy.
  const pr = lines.findIndex((l) => /^\s*pull_request:\s*$/.test(l));
  if (pr < 0) return null;
  // `paths-ignore:` có nghĩa NGƯỢC LẠI; regex đòi `paths:` rồi hết dòng nên
  // không dính, và ta cũng không giả vờ hiểu nó.
  const i = lines.findIndex((l, n) => n > pr && /^\s*paths:\s*$/.test(l));
  if (i < 0) return null;
  const out = [];
  for (let j = i + 1; j < lines.length; j += 1) {
    const l = lines[j];
    if (/^\s*#/.test(l) || /^\s*$/.test(l)) continue;
    if (!/^\s*-\s/.test(l)) break;                   // hết khối danh sách
    const m = /^\s*-\s*'([^']+)'\s*$/.exec(l) || /^\s*-\s*"([^"]+)"\s*$/.exec(l);
    // Dòng VẪN là một mục danh sách nhưng không đọc được (không nháy, hoặc glob
    // phủ định `!…` mà bộ này cố tình không diễn giải). Im lặng bỏ qua sẽ làm
    // danh sách glob ngắn đi và chốt yếu đi mà không ai hay — nên ném thẳng.
    if (!m) throw new Error(`không đọc được mục paths: ${JSON.stringify(l)}`);
    out.push(m[1]);
  }
  return out;
}

/**
 * Tệp mà các bước `run:` thực sự chạy, trả về đường dẫn TƯƠNG ĐỐI SO VỚI REPO.
 *
 * Đường dẫn trong YAML được viết theo `working-directory` của từng bước
 * (parity-gate chạy từ `frontend/`, backend-tests chạy từ gốc). Thay vì phân tích
 * YAML để biết thư mục nào, cứ thử vài gốc ứng viên và lấy cái CÓ THẬT — vừa
 * ngắn vừa không sai khi một workflow trộn nhiều working-directory.
 */
const CANDIDATE_ROOTS = ['.', 'frontend'];

function resolveInRepo(rel) {
  for (const base of CANDIDATE_ROOTS) {
    const abs = path.join(ROOT, base, rel);
    if (existsSync(abs)) return abs;
  }
  return null;
}

/** Nở một glob một-cấp kiểu `frontend/tests/*.test.mjs`. */
function expandGlob(rel) {
  if (!rel.includes('*')) {
    const abs = resolveInRepo(rel);
    return abs ? [abs] : [];
  }
  const dir = path.dirname(rel);
  const re = globToRe(path.basename(rel));
  for (const base of CANDIDATE_ROOTS) {
    const absDir = path.join(ROOT, base, dir);
    if (!existsSync(absDir)) continue;
    return readdirSync(absDir).filter((f) => re.test(f)).map((f) => path.join(absDir, f));
  }
  return [];
}

function executedFiles(src) {
  const out = new Set();
  // `node --test a.mjs b.js \` — danh sách nhiều dòng, có cả glob.
  for (const m of src.matchAll(/node\s+--test\b([\s\S]*?)(?:\n\s*\n|\n\s*-\s|\n\s*#|$)/g)) {
    for (const tok of m[1].split(/[\s\\]+/)) {
      if (!/\.(mjs|js)$/.test(tok) || tok.startsWith('-')) continue;
      expandGlob(tok).forEach((f) => out.add(f));
    }
  }
  // `node x.mjs` / `bash y.sh`
  for (const m of src.matchAll(/\b(?:node|bash)\s+([\w./-]+\.(?:mjs|js|sh))/g)) {
    if (m[1].includes('node_modules')) continue;
    const abs = resolveInRepo(m[1]);
    if (abs) out.add(abs);
  }
  // Bước DỰNG cũng là một thứ "được chạy", và đầu vào của nó là mã nguồn app.
  // `route-manifest.yml:72` chạy `npm run build` rồi mới soi kết quả, nhưng
  // `paths` của nó thiếu `frontend/components/**` — trong khi
  // `app/(authed)/layout.tsx` import `@/components/authed-shell`. Đổi component
  // đó là đổi chunk đã dựng và đổi kết quả quét, mà PR ấy không chạy cổng nào.
  // (Codex bắt ở #946 vòng 3.)
  if (/npm run build|next build/.test(src)) {
    nextBuildInputs().forEach((d) => out.add(d));
  }
  return [...out];
}

/**
 * Mã DÙNG CHUNG mà một lần `next build` kéo vào, SUY RA chứ không liệt kê tay:
 * quét `frontend/app` tìm bí danh `@/<gốc>` rồi ánh xạ qua `tsconfig`
 * (`@/*` → `./*`, tức thư mục `frontend/`). Hiện ra `components` và `lib`. Liệt
 * kê tay sẽ mục ngay lần thêm thư mục mới — đúng họ lỗi chốt này sinh ra để diệt.
 *
 * CỐ Ý KHÔNG đòi cả `frontend/app/**`. Việc khoanh `paths` theo từng nhóm route
 * (`app/(authed-speaking)/**`, …) là thu hẹp CÓ CHỦ ĐÍCH và hợp lệ: đổi một
 * route không đổi DOM của route khác. Nhưng mã dùng chung thì đổi được BẤT KỲ
 * trang nào, nên một workflow có bước dựng phải phản ứng với nó — kể cả khi
 * hôm nay nó mới chỉ ghim vài tệp lẻ trong `components/` và `lib/`.
 */
function nextBuildInputs() {
  const app = path.join(ROOT, 'frontend', 'app');
  if (!existsSync(app)) return [];
  const roots = new Set();
  // Siêu dữ liệu của bản dựng cũng là đầu vào thật, không chỉ mã nguồn:
  // `package.json` quyết định script nào chạy và phiên bản gói nào được cài,
  // còn `tsconfig.json` định nghĩa CHÍNH bí danh `@/*` mà hàm này dựa vào để
  // suy ra gốc mã dùng chung. `parity-gate.yml` ghim `package-lock.json` nhưng
  // bỏ cả hai tệp kia, nên một PR chỉ đổi script hoặc đổi ánh xạ bí danh sẽ đổi
  // thứ được dựng mà không kích hoạt cổng (Codex bắt ở #946 vòng 4).
  for (const meta of ['package.json', 'tsconfig.json', 'next.config.ts']) {
    const abs = path.join(ROOT, 'frontend', meta);
    if (existsSync(abs)) roots.add(abs);
  }
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(tsx?|mjs|js)$/.test(e.name)) continue;
      for (const m of readFileSync(full, 'utf8').matchAll(/['"]@\/([\w-]+)/g)) {
        const target = path.join(ROOT, 'frontend', m[1]);
        if (existsSync(target)) roots.add(realpathSync(target));
      }
    }
  };
  walk(app);
  return [...roots];
}

/**
 * Các thư mục dùng làm gốc khi ghép một chuỗi thành đường dẫn: thư mục của chính
 * script, rồi lần lượt các thư mục cha lên tới gốc repo.
 *
 * Cần thiết vì script hay dựng đường dẫn từ hằng của chính nó chứ không viết
 * nguyên đường dẫn: `route-ownership-check.mjs` đặt
 * `FRONTEND = dirname(dirname(import.meta.url))` rồi đọc
 * `path.join(FRONTEND, 'next.config.ts')` và đi cả cây `path.join(FRONTEND,
 * 'public')`. Bản chỉ-ghép-với-gốc-repo không thấy hai phụ thuộc đó (Codex bắt
 * ở #946), nên cổng route-manifest có thể không chạy khi thêm một route công
 * khai mới trong `frontend/public/`.
 */
function baseDirs(file) {
  const out = [];
  let d = path.dirname(file);
  while (d.startsWith(ROOT) && d !== ROOT) { out.push(d); d = path.dirname(d); }
  out.push(ROOT);
  return out;
}

/**
 * Mọi tệp/thư mục repo mà `file` phụ thuộc: import cục bộ bắc cầu, cộng các
 * chuỗi ghép được thành đường dẫn CÓ THẬT. Chuỗi chỉ được tính khi đích tồn tại
 * — nên `'text/html'` hay `'a/b'` bịa ra tự rụng, không cần danh sách loại trừ.
 *
 * Kết quả đi qua `realpathSync`: `frontend/pages`, `frontend/js` và
 * `frontend/grammar.html` là SYMLINK trỏ vào `frontend/public/`. GitHub liệt kê
 * tệp-đã-đổi theo đường THẬT, nên đòi một glob cho đường symlink là dương tính
 * giả — nó buộc người bảo trì thêm một glob không bao giờ khớp.
 *
 * NÓI RÕ: hiện KHÔNG script nào tham chiếu đường symlink ngoài chú thích, nên
 * nhánh này là phòng thủ chứ chưa có ca sống — tắt `realpathSync` đi thì bộ test
 * vẫn xanh. Tiền đề của nó (symlink có thật và quy về đâu) được ghim bằng một
 * khẳng định riêng ở dưới, để nó không phải là mã không ai kiểm.
 */
function dependencies(file, seen = new Set()) {
  const real = existsSync(file) ? realpathSync(file) : file;
  if (seen.has(real) || !existsSync(real)) return seen;
  seen.add(real);
  if (!/\.(mjs|js)$/.test(real)) return seen;
  // Bỏ các dòng THUẦN chú thích trước khi dò đường dẫn. Chú thích trong repo này
  // hay dẫn tên tệp khác để giải thích bối cảnh — `verify-speaking-flow.mjs:3`
  // nhắc `tests/staging-e2e/speaking-start-flow.spec.js` mà không hề đọc nó — và
  // tính chúng thành phụ thuộc sẽ bắt người bảo trì thêm glob vô nghĩa.
  // Chỉ bỏ dòng-thuần-chú-thích, không cắt `//` giữa dòng, để không phá hỏng
  // chuỗi kiểu `'http://…'`.
  const src = readFileSync(real, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join('\n');

  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    dependencies(path.resolve(path.dirname(real), m[1]), seen);
  }
  // Ứng viên đường dẫn đến từ HAI nguồn, đều có ràng buộc để khỏi ồn:
  //   · chuỗi bên trong `path.join(...)` / `path.resolve(...)` — kể cả mảnh trần
  //     không dấu chấm như `'public'`, vì ngữ cảnh đã nói rõ đó là đường dẫn;
  //   · chuỗi ở bất kỳ đâu NHƯNG phải có `/` hoặc phần mở rộng.
  // Chấp nhận mọi chuỗi trần ở mọi nơi thì quá lỏng: `'components'` ở
  // parity-core.mjs:151 chỉ là tên TRƯỜNG trong một danh sách, còn `'commission'`
  // và `'data'` trong test lại trùng tên hai thư mục gốc của repo — cả ba đều
  // thành phụ thuộc giả và bắt người bảo trì thêm glob vô nghĩa.
  const cands = new Set();
  for (const call of src.matchAll(/\bpath\.(?:join|resolve)\(([^)]*)\)/g)) {
    for (const lit of call[1].matchAll(/['"`]([\w][\w./-]*)['"`]/g)) cands.add(lit[1]);
  }
  for (const m of src.matchAll(/['"`]([\w][\w./-]*(?:\/[\w./-]+|\.[\w]+))['"`]/g)) {
    cands.add(m[1]);
  }
  for (const p of cands) {
    if (p.startsWith('node:') || p.includes('node_modules')) continue;
    for (const base of baseDirs(real)) {
      const abs = path.join(base, p);
      if (existsSync(abs)) { seen.add(realpathSync(abs)); break; }
    }
  }
  return seen;
}

const workflows = readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ name: f, src: readFileSync(path.join(WF_DIR, f), 'utf8') }))
  .map((w) => ({ ...w, paths: readPaths(w.src) }))
  .filter((w) => w.paths && w.paths.length);

describe('workflow — tệp được CHẠY phải nằm trong paths', () => {
  test('bộ đọc YAML thô vẫn hiểu được định dạng hiện tại', () => {
    // Nếu bộ đọc hỏng, `workflows` rỗng và MỌI khẳng định dưới thành xanh-rỗng.
    assert.ok(workflows.length >= 3,
      `chỉ đọc được ${workflows.length} workflow có paths — bộ đọc hỏng?`);
    const names = workflows.map((w) => w.name);
    for (const must of ['backend-tests.yml', 'parity-gate.yml']) {
      assert.ok(names.includes(must), `mất ${must} khỏi danh sách`);
    }
  });

  test('bộ dò tệp-được-chạy không trả về rỗng', () => {
    // Cùng lý do: regex `run:` hỏng ⇒ không tệp nào bị kiểm ⇒ xanh vô nghĩa.
    const bt = workflows.find((w) => w.name === 'backend-tests.yml');
    assert.ok(executedFiles(bt.src).length > 50,
      'backend-tests chạy cả thư mục frontend/tests — phải thấy hàng chục tệp');
    const pg = workflows.find((w) => w.name === 'parity-gate.yml');
    assert.ok(executedFiles(pg.src).length >= 2, 'parity-gate gọi ít nhất 2 script');
  });

  for (const w of workflows) {
    const files = executedFiles(w.src);
    if (!files.length) continue;

    test(`${w.name} — mọi phụ thuộc đều kích hoạt được workflow`, () => {
      const res = w.paths.map(globToRe);
      const missing = new Set();
      for (const f of files) {
        for (const dep of dependencies(f)) {
          const rel = path.relative(ROOT, dep);
          // Phụ thuộc là THƯ MỤC (script đi cả cây) thì thứ cần phủ là tệp BÊN
          // TRONG nó, không phải chính đường dẫn thư mục: glob `frontend/public/**`
          // không khớp chuỗi `frontend/public`, mà GitHub cũng chẳng bao giờ liệt
          // kê một thư mục trong danh sách tệp-đã-đổi.
          const probe = statSync(dep).isDirectory() ? `${rel}/x` : rel;
          if (!res.some((re) => re.test(probe))) {
            missing.add(statSync(dep).isDirectory() ? `${rel}/** (cả cây)` : rel);
          }
        }
      }

      assert.deepEqual([...missing].sort(), [],
        `${w.name} đọc những tệp này nhưng KHÔNG chạy khi chúng đổi ⇒ một PR sửa `
        + 'đúng chúng sẽ merge mà không hề chạy chốt đang canh chúng. '
        + 'Sửa bằng cách thêm glob vào `paths`, đừng nới lỏng test này.');
    });
  }

  test('chốt này tự kích hoạt được khi MỘT workflow BẤT KỲ đổi', () => {
    // Điểm mù đệ quy: bản thân test này đọc mọi tệp trong `.github/workflows/`,
    // nhưng nạp bằng `readdirSync` nên không nêu tên tệp nào — cơ chế chuỗi ở
    // trên không tự thấy phụ thuộc đó. Nếu workflow chạy nó chỉ ghim chính nó
    // (`- '.github/workflows/backend-tests.yml'`), thì một PR sửa `paths` của
    // `parity-gate.yml` sẽ merge mà KHÔNG chạy đúng cái chốt canh `paths`.
    // Tìm workflow theo HÀNH VI — workflow nào thực sự chạy CHÍNH TỆP NÀY — chứ
    // không theo chữ `node --test` xuất hiện trong src: chuỗi đó còn nằm trong
    // chú thích của `e2e.yml` và `route-manifest.yml`, nên bản dò-theo-chữ chỉ
    // đúng nhờ thứ tự đọc thư mục. Đó là bẫy "ghim tên thay vì ghim hành vi".
    const self = fileURLToPath(import.meta.url);
    const runner = workflows.find((w) => executedFiles(w.src).includes(self));
    assert.ok(runner, 'không workflow nào thực sự chạy tệp test này — nó vô dụng');
    const res = runner.paths.map(globToRe);
    for (const other of ['.github/workflows/parity-gate.yml',
                         '.github/workflows/route-manifest.yml']) {
      assert.ok(res.some((re) => re.test(other)),
        `${runner.name} không chạy khi ${other} đổi — thêm '.github/workflows/**'`);
    }
  });

  test('đường symlink quy được về đường THẬT trong public/', () => {
    // Ghim tiền đề mà `dependencies()` dựa vào để chuẩn hoá: `frontend/pages` là
    // symlink trỏ vào `frontend/public/pages`. Nếu ai đó biến nó thành thư mục
    // thật, phần chuẩn hoá kia thành thừa và test này nói rõ điều đó thay vì để
    // mã phòng thủ nằm im không ai kiểm.
    const link = path.join(ROOT, 'frontend/pages');
    assert.ok(existsSync(link), 'frontend/pages biến mất — cập nhật lại ghi chú');
    assert.equal(path.relative(ROOT, realpathSync(link)), 'frontend/public/pages',
      'frontend/pages không còn trỏ vào public/pages');
  });

  test('glob → regex khớp đúng như GitHub Actions', () => {
    // Bộ chuyển sai thì mọi khẳng định trên đều vô nghĩa — kiểm nó trước.
    const m = (g, p) => globToRe(g).test(p);
    assert.ok(m('frontend/**', 'frontend/a/b.mjs'));
    assert.ok(m('frontend/tooling/*.mjs', 'frontend/tooling/x.mjs'));
    assert.ok(!m('frontend/tooling/*.mjs', 'frontend/tooling/sub/x.mjs'),
      '`*` KHÔNG được xuyên thư mục');
    assert.ok(m('frontend/tooling/**', 'frontend/tooling/sub/x.mjs'));
    assert.ok(m('a/b.js', 'a/b.js'));
    assert.ok(!m('a/b.js', 'a/c.js'));
    assert.ok(!m('docs/*.md', 'docs/x/y.md'));
  });
});

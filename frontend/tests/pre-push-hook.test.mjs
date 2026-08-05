// Hook pre-push của repo — kiểm HÀNH VI, không kiểm mã nguồn.
//
// VÌ SAO CÓ TEST NÀY: hook từng nằm ngoài repo (`.git/hooks/`, không được git
// theo dõi) nên mỗi máy một bản, và nó đã hỏng HAI LẦN theo hai kiểu ngược
// nhau — mỗi lần tốn một vòng chẩn đoán vì triệu chứng giống hệt "test đỏ":
//
//   1. `--git-common-dir` trả ".git" (TƯƠNG ĐỐI) khi chạy từ clone chính. Hook
//      có `cd` nên đường dẫn đó hết phân giải sau lệnh cd ⇒ hook báo
//      "BLOCKED: backend tests red" trong khi pytest CHƯA HỀ CHẠY.
//   2. Sửa bằng `--show-toplevel` thì hỏng chiều kia: trong worktree nó trả gốc
//      WORKTREE, nơi không có `backend/venv`.
//
// Nên test này KHÔNG grep mã nguồn — nó THỰC THI bộ giải đường dẫn từ nhiều thư
// mục và đòi kết quả là một interpreter TUYỆT ĐỐI, CHẠY ĐƯỢC, CÓ pytest. Đó là
// khác biệt giữa "mã trông đúng" và "mã chạy đúng".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RESOLVER = path.join(ROOT, 'scripts/hooks/lib/resolve-python.sh');
const HOOK = path.join(ROOT, 'scripts/hooks/pre-push');
const INSTALL = path.join(ROOT, 'scripts/hooks/install.sh');

const run = (cwd) => execFileSync('bash', [RESOLVER], { cwd, encoding: 'utf8' }).trim();

/**
 * Máy đang chạy có Python + pytest thật không.
 *
 * Job "Frontend (node --test)" ở CI KHÔNG cài Python, nên hai test cần
 * interpreter THẬT phải bỏ qua ở đó — nếu để chúng đỏ thì cả bộ frontend đỏ vì
 * một thứ nó không chịu trách nhiệm, và người ta sẽ học cách phớt lờ.
 *
 * Bốn test còn lại HERMETIC (repo giả, symlink, cú pháp) nên chạy ở mọi nơi —
 * và chúng mới là phần ghim ba bẫy lịch sử. Cái bỏ qua chỉ là "máy này có cài
 * venv chưa", vốn là chuyện môi trường chứ không phải chuyện đúng/sai của hook.
 */
function hasRealPytest() {
  try { run(ROOT); return true; } catch { return false; }
}
const REAL_PY = hasRealPytest();
const SKIP_REASON = 'môi trường không có Python+pytest (job frontend ở CI) — '
  + 'các test hermetic vẫn chạy và chúng mới là phần ghim bẫy';

describe('hook pre-push của repo', () => {
  test('ba tệp tồn tại và có quyền chạy', () => {
    for (const f of [RESOLVER, HOOK, INSTALL]) {
      assert.ok(existsSync(f), `thiếu ${path.relative(ROOT, f)}`);
      assert.ok(statSync(f).mode & 0o111, `${path.relative(ROOT, f)} phải có quyền chạy`);
    }
  });

  test('cú pháp bash hợp lệ', () => {
    for (const f of [RESOLVER, HOOK, INSTALL]) {
      execFileSync('bash', ['-n', f]);   // ném nếu sai cú pháp
    }
  });

  test('trả interpreter TUYỆT ĐỐI, chạy được, từ MỌI thư mục', (t) => {
    if (!REAL_PY) return t.skip(SKIP_REASON);
    // Bẫy #1 chỉ lộ ra khi chạy từ gốc repo (nơi `--git-common-dir` trả ".git").
    // Bẫy #2 chỉ lộ ra khi chạy từ worktree. Nên phải thử NHIỀU chỗ, và thử cả
    // thư mục con vì hook có `cd` trước khi dùng đường dẫn.
    const dirs = [ROOT, path.join(ROOT, 'frontend'), path.join(ROOT, 'backend')]
      .filter(existsSync);
    assert.ok(dirs.length >= 2, 'cần ít nhất hai thư mục để phép thử có nghĩa');

    for (const d of dirs) {
      const py = run(d);
      assert.ok(py.startsWith('/'),
        `chạy từ ${path.relative(ROOT, d) || '.'} → "${py}" không phải đường tuyệt đối`);
      assert.ok(existsSync(py), `interpreter không tồn tại: ${py}`);
      assert.ok(statSync(py).mode & 0o111, `interpreter không chạy được: ${py}`);
    }
  });

  test('vẫn TUYỆT ĐỐI kể cả khi git trả `.git` (đường tương đối)', () => {
    // Bẫy #1 CHỈ xuất hiện ở clone chính, nơi `--git-common-dir` trả ".git".
    // Trong worktree nó vốn đã tuyệt đối nên chạy từ đây KHÔNG chạm ca đó —
    // phép phá thử đầu của tôi vì thế báo xanh vô nghĩa.
    //
    // Bản thứ hai mượn repo thật + git giả, và hỏng vì lý do KHÁC: trong
    // worktree `.git` là TỆP, `cd .git` thất bại trước khi chạm điều đang kiểm.
    //
    // Nên dựng hẳn một repo GIẢ hermetic: có `.git/` là thư mục thật, có
    // interpreter giả ở đúng vị trí, và `git` giả trả đường TƯƠNG ĐỐI. Không
    // phụ thuộc bố cục repo thật, chạy giống nhau ở máy và ở CI.
    const T = mkdtempSync(path.join(tmpdir(), 'hookrepo-'));
    mkdirSync(path.join(T, '.git'), { recursive: true });
    const pyDir = path.join(T, 'backend/venv/bin');
    mkdirSync(pyDir, { recursive: true });
    const pyStub = path.join(pyDir, 'python');
    writeFileSync(pyStub, '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(pyStub, 0o755);

    const bin = mkdtempSync(path.join(tmpdir(), 'fakegit-'));
    const fake = path.join(bin, 'git');
    writeFileSync(fake, [
      '#!/usr/bin/env bash',
      '# git giả: mô phỏng clone chính — --git-common-dir trả đường TƯƠNG ĐỐI.',
      'for a in "$@"; do',
      '  case "$a" in',
      '    --git-common-dir) echo ".git"; exit 0 ;;',
      '  esac',
      'done',
      'exit 1',
    ].join('\n'));
    chmodSync(fake, 0o755);

    const out = execFileSync('bash', [RESOLVER], {
      cwd: T, encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    }).trim();

    assert.ok(out.startsWith('/'),
      `git trả ".git" ⇒ phải tuyệt-đối-hoá, nhận được "${out}"`);
    assert.equal(realpathSync(out), realpathSync(pyStub),
      'phải trỏ đúng interpreter trong repo giả');
  });

  test('interpreter trả về THỰC SỰ có pytest', (t) => {
    if (!REAL_PY) return t.skip(SKIP_REASON);
    // Đúng cái mà bản hook đầu tiên đã sai: nó trả về một python KHÔNG có
    // pytest, rồi exit-code khác 0 bị đọc nhầm thành "test đỏ".
    const py = run(ROOT);
    const out = execFileSync(py, ['-c', 'import pytest; print(pytest.__version__)'],
      { encoding: 'utf8' }).trim();
    assert.match(out, /^\d+\./, `không import được pytest bằng ${py}`);
  });

  test('hook phân biệt "không chạy được" với "chạy rồi và đỏ"', () => {
    // Bất biến ĐẮT NHẤT của hook. Nếu nó gộp hai ca này thì mọi phép "thử phá
    // để xem test có đỏ không" đều vô nghĩa.
    const src = readFileSync(HOOK, 'utf8');
    assert.match(src, /Đây KHÔNG phải test đỏ/,
      'phải nói rõ khi pytest không chạy được');
    assert.match(src, /exit 5/,
      'pytest exit 5 = không thu thập được test nào, KHÔNG phải xanh');
    assert.match(src, /BLOCKED: backend tests red/,
      'và vẫn phải chặn khi test đỏ thật');
  });

  test('hook tìm được lib khi ĐƯỢC CÀI BẰNG SYMLINK', () => {
    // Đây là ca đã hỏng ngay lần cài đầu: `install.sh` dùng `ln -s`, mà với
    // symlink thì `BASH_SOURCE[0]` trỏ về CHỖ ĐẶT LINK (`.git/hooks/pre-push`),
    // không phải tệp gốc — nên `$HOOK_DIR/lib/…` không tồn tại. Hook thất bại
    // an toàn (nói đúng "KHÔNG phải test đỏ") nhưng đổ lỗi sai cho pytest.
    //
    // Kiểm bằng cách tạo symlink thật ở một thư mục khác rồi chạy hook qua nó.
    // Hook sẽ chạy pytest thật nên chỉ cần khẳng định nó KHÔNG chết ở bước tìm
    // lib — dùng biến môi trường để dừng ngay sau khi giải xong đường dẫn.
    const linkDir = mkdtempSync(path.join(tmpdir(), 'hooklink-'));
    const link = path.join(linkDir, 'pre-push');
    symlinkSync(HOOK, link);

    // Hook có khe `PREPUSH_PRINT_RESOLVER`: in đường đã giải rồi thoát, không
    // chạy pytest (45 giây). Gọi QUA symlink — đó mới là ca hỏng.
    const out = execFileSync('bash', [link], {
      encoding: 'utf8',
      env: { ...process.env, PREPUSH_PRINT_RESOLVER: '1' },
    }).trim();

    assert.ok(out.endsWith('lib/resolve-python.sh'),
      `giải sai đường tới lib: "${out}"`);
    assert.ok(existsSync(out),
      `qua symlink, hook trỏ vào lib KHÔNG tồn tại: ${out}`);
    assert.equal(realpathSync(out), realpathSync(RESOLVER),
      'phải trỏ về lib trong repo, không phải cạnh symlink');
  });

  test('installer trỏ vào --git-common-dir (worktree dùng chung hook)', () => {
    const src = readFileSync(INSTALL, 'utf8');
    assert.match(src, /git-common-dir/,
      'dùng --show-toplevel sẽ cài hook vào worktree, nơi git không đọc');
    assert.match(src, /ln -sf/, 'symlink để sửa hook trong repo là có hiệu lực ngay');
  });
});

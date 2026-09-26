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
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, statSync, symlinkSync, writeFileSync,
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

  test('venv CÓ nhưng THIẾU pytest ⇒ KHÔNG nhận (hermetic)', () => {
    // Codex bắt ở PR #943: `[ -x "$VENV" ]` nhận một venv chỉ vì nó chạy được.
    // Nếu venv đó chưa cài phụ thuộc thì hook chạy `python -m pytest`, nhận
    // "No module named pytest", exit khác 0, và báo "BLOCKED: backend tests
    // red" — ĐÚNG sự nhầm lẫn mà bộ giải này sinh ra để ngăn.
    //
    // Hermetic: dựng repo giả có interpreter luôn thất bại ở `import pytest`.
    const T = mkdtempSync(path.join(tmpdir(), 'nopytest-'));
    mkdirSync(path.join(T, '.git'), { recursive: true });
    const pyDir = path.join(T, 'backend/venv/bin');
    mkdirSync(pyDir, { recursive: true });
    const stub = path.join(pyDir, 'python');
    writeFileSync(stub, '#!/usr/bin/env bash\nexit 1\n');   // mọi lệnh đều hỏng
    chmodSync(stub, 0o755);

    const bin = mkdtempSync(path.join(tmpdir(), 'fakegit2-'));
    const fake = path.join(bin, 'git');
    writeFileSync(fake, [
      '#!/usr/bin/env bash',
      'for a in "$@"; do case "$a" in --git-common-dir) echo ".git"; exit 0 ;; esac; done',
      'exit 1',
    ].join('\n'));
    chmodSync(fake, 0o755);

    let failed = false;
    let out = '';
    try {
      out = execFileSync('bash', [RESOLVER], {
        cwd: T, encoding: 'utf8',
        // PATH tối giản để `python3` dự phòng cũng không có pytest.
        env: { PATH: `${bin}:/usr/bin:/bin` },
      }).trim();
    } catch { failed = true; }

    assert.ok(failed,
      `venv thiếu pytest mà vẫn được nhận: "${out}" — hook sẽ báo nhầm "tests red"`);
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

  for (const linked of [false, true]) {
    test(`installed hook isolates nested Git repos during a real ${linked ? 'worktree' : 'main checkout'} push`, () => {
      const temp = mkdtempSync(path.join(tmpdir(), 'installed-hook-'));
      const main = path.join(temp, 'main');
      const remote = path.join(temp, 'remote.git');
      const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
      for (const key of Object.keys(env)) {
        if (key.startsWith('GIT_') && !['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'].includes(key)) delete env[key];
      }
      const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      try {
        mkdirSync(main);
        git(temp, 'init', '--bare', '-q', remote);
        git(main, 'init', '-q');
        git(main, 'config', 'user.name', 'Hook Owner');
        git(main, 'config', 'user.email', 'hook-owner@example.test');
        git(main, 'remote', 'add', 'origin', remote);
        const hookDir = path.join(main, 'scripts/hooks');
        mkdirSync(path.join(hookDir, 'lib'), { recursive: true });
        for (const [source, relative] of [[HOOK, 'pre-push'], [INSTALL, 'install.sh'], [RESOLVER, 'lib/resolve-python.sh']]) {
          copyFileSync(source, path.join(hookDir, relative));
          chmodSync(path.join(hookDir, relative), 0o755);
        }
        mkdirSync(path.join(main, 'backend'));
        writeFileSync(path.join(main, 'backend/.gitkeep'), '');
        git(main, 'add', '.');
        git(main, 'commit', '-qm', 'hook fixture');
        // Install from a disposable worktree, then delete it. The installed
        // entry point must still resolve the checkout being pushed.
        const installerTree = path.join(temp, 'installer');
        git(main, 'worktree', 'add', '-qb', 'installer', installerTree);
        execFileSync('bash', [path.join(installerTree, 'scripts/hooks/install.sh')], { cwd: installerTree, env });
        git(main, 'worktree', 'remove', installerTree);
        const cwd = linked ? path.join(temp, 'topic') : main;
        if (linked) git(main, 'worktree', 'add', '-qb', 'topic', cwd);
        const pyDir = path.join(main, 'backend/venv/bin');
        mkdirSync(pyDir, { recursive: true });
        const python = path.join(pyDir, 'python');
        writeFileSync(python, [
          '#!/usr/bin/env bash', 'set -euo pipefail',
          'if [ "${1:-}" = "-c" ]; then exit 0; fi',
          // Behave like a test that creates and commits a foreign repository.
          'pwd > "$HOOK_TEST_CWD"',
          'git init -q "$HOOK_TEST_NESTED"',
          'git -C "$HOOK_TEST_NESTED" config user.name "Nested Tests"',
          'git -C "$HOOK_TEST_NESTED" config user.email "nested@example.test"',
          'git -C "$HOOK_TEST_NESTED" commit -qm nested --allow-empty',
          'exit "${HOOK_TEST_EXIT:-0}"',
        ].join('\n'));
        chmodSync(python, 0o755);
        env.HOOK_TEST_CWD = path.join(temp, 'pytest-cwd');
        env.HOOK_TEST_NESTED = path.join(temp, 'nested');
        const head = git(cwd, 'rev-parse', 'HEAD');
        git(cwd, 'push', 'origin', 'HEAD:refs/heads/verified');
        assert.equal(git(remote, 'rev-parse', 'refs/heads/verified'), head);
        assert.equal(realpathSync(readFileSync(env.HOOK_TEST_CWD, 'utf8').trim()), realpathSync(path.join(cwd, 'backend')));
        assert.equal(git(main, 'config', '--local', 'core.bare'), 'false');
        assert.equal(git(main, 'config', '--local', 'user.name'), 'Hook Owner');
        assert.equal(git(main, 'config', '--local', 'user.email'), 'hook-owner@example.test');
        assert.equal(git(cwd, 'rev-parse', 'HEAD'), head);
        assert.equal(git(env.HOOK_TEST_NESTED, 'log', '-1', '--format=%s'), 'nested');
        // Isolation must preserve the verification gate: a failing test still
        // prevents the remote branch from being created.
        env.HOOK_TEST_EXIT = '1';
        assert.throws(() => git(cwd, 'push', 'origin', 'HEAD:refs/heads/rejected'), (error) => {
          assert.match(String(error.stdout), /BLOCKED: backend tests red/);
          return true;
        });
        assert.equal(git(remote, 'for-each-ref', '--format=%(refname)', 'refs/heads/rejected'), '');
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    });
  }
});

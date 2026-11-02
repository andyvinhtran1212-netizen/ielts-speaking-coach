/**
 * Decision table for the Vercel Ignored Build Step
 * (frontend/vercel.json "ignoreCommand" → tooling/vercel-ignore-build.sh).
 *
 * Vercel contract: exit 1 = build, exit 0 = skip. main/staging and every
 * error/unknown state must build; other branches build only when they opt in
 * ("[preview]" in the commit message or a preview/ branch) AND change a
 * frontend-affecting path. Each case runs the real script against a throwaway
 * git repository.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPT = path.join(FRONTEND, 'tooling', 'vercel-ignore-build.sh');
const BUILD = 1;
const SKIP = 0;

let TMP;
let HOME;

function cleanEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('VERCEL') || key.startsWith('GIT_')) delete env[key];
  }
  return {
    ...env,
    HOME,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid',
    ...extra,
  };
}

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, env: cleanEnv({}), encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function commitFile(repo, file, message = `touch ${file}`) {
  const full = path.join(repo, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, `${file} ${Math.random()}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

function newRepo(name) {
  const repo = path.join(TMP, name);
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  commitFile(repo, 'README.md', 'base');
  return repo;
}

/** Runs the ignore step the way Vercel does: cwd = Root Directory (frontend/). */
function decide(repo, env) {
  const cwd = path.join(repo, 'frontend');
  mkdirSync(cwd, { recursive: true });
  const r = spawnSync('bash', [SCRIPT], { cwd, env: cleanEnv(env), encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

before(() => {
  TMP = mkdtempSync(path.join(tmpdir(), 'vercel-ignore-build-'));
  HOME = path.join(TMP, 'home');
  mkdirSync(HOME);
});
after(() => rmSync(TMP, { recursive: true, force: true }));

describe('vercel.json wiring', () => {
  test('ignoreCommand runs the committed script from the Root Directory', () => {
    const vercel = JSON.parse(readFileSync(path.join(FRONTEND, 'vercel.json'), 'utf8'));
    assert.equal(vercel.ignoreCommand, 'bash tooling/vercel-ignore-build.sh');
  });
});

describe('main / staging always build (fail-safe, no git needed)', () => {
  for (const ref of ['main', 'staging', 'refs/heads/main', 'refs/heads/staging']) {
    test(`${ref} builds even outside a git repo and without a message`, () => {
      const dir = path.join(TMP, `nogit-${ref.replaceAll('/', '_')}`);
      mkdirSync(dir, { recursive: true });
      const r = spawnSync('bash', [SCRIPT], {
        cwd: dir, env: cleanEnv({ VERCEL_GIT_COMMIT_REF: ref }), encoding: 'utf8',
      });
      assert.equal(r.status, BUILD, r.stdout);
    });
  }

  test('staging builds a docs-only commit with no opt-in', () => {
    const repo = newRepo('staging-docs');
    const prev = git(repo, 'rev-parse', 'HEAD');
    commitFile(repo, 'docs/notes.md');
    const r = decide(repo, {
      VERCEL_GIT_COMMIT_REF: 'staging', VERCEL_GIT_PREVIOUS_SHA: prev,
      VERCEL_GIT_COMMIT_MESSAGE: 'docs only',
    });
    assert.equal(r.code, BUILD, r.out);
  });
});

describe('unknown state builds', () => {
  test('missing VERCEL_GIT_COMMIT_REF builds', () => {
    const repo = newRepo('no-ref');
    assert.equal(decide(repo, { VERCEL_GIT_COMMIT_MESSAGE: 'x' }).code, BUILD);
  });

  test('unset VERCEL_GIT_COMMIT_MESSAGE on a feature branch builds', () => {
    const repo = newRepo('no-message');
    assert.equal(decide(repo, { VERCEL_GIT_COMMIT_REF: 'q/x' }).code, BUILD);
  });

  test('opted-in run outside a git repository builds', () => {
    const dir = path.join(TMP, 'nogit-optin');
    mkdirSync(dir);
    const r = spawnSync('bash', [SCRIPT], {
      cwd: dir,
      env: cleanEnv({ VERCEL_GIT_COMMIT_REF: 'q/x', VERCEL_GIT_COMMIT_MESSAGE: 'ui [preview]' }),
      encoding: 'utf8',
    });
    assert.equal(r.status, BUILD, r.stdout);
  });
});

describe('opt-in gate on other branches', () => {
  let repo;
  let prev;
  before(() => {
    repo = newRepo('optin');
    prev = git(repo, 'rev-parse', 'HEAD');
    commitFile(repo, 'frontend/app/page.tsx');
  });

  const cases = [
    ['q/feature', 'fix(ui): button', SKIP],
    ['q/feature', 'fix(ui): button [preview]', BUILD],
    ['q/feature', 'fix(ui): button [Preview]', BUILD],
    ['q/feature', 'fix(ui): button\n\nbody line [PREVIEW]', BUILD],
    ['q/feature', 'fix(ui): preview of the button', SKIP],
    ['preview/button', 'fix(ui): button', BUILD],
    ['q/preview/button', 'fix(ui): button', SKIP],
    ['mainline', 'fix(ui): button', SKIP],
  ];
  for (const [ref, message, expected] of cases) {
    test(`${ref} + ${JSON.stringify(message)} → ${expected === BUILD ? 'build' : 'skip'}`, () => {
      const r = decide(repo, {
        VERCEL_GIT_COMMIT_REF: ref, VERCEL_GIT_PREVIOUS_SHA: prev,
        VERCEL_GIT_COMMIT_MESSAGE: message,
      });
      assert.equal(r.code, expected, r.out);
    });
  }
});

describe('frontend-affecting paths (opted in, diff vs previous deployment)', () => {
  let repo;
  let base;
  before(() => {
    repo = newRepo('paths');
    base = git(repo, 'rev-parse', 'HEAD');
  });

  const table = [
    ['frontend/app/(marketing)/page.tsx', BUILD],
    ['frontend/components/x.tsx', BUILD],
    ['frontend/lib/browser-api.ts', BUILD],
    ['frontend/types/api.d.ts', BUILD],
    ['frontend/public/js/practice.js', BUILD],
    ['frontend/public/css/aver-design/DESIGN_SYSTEM.md', BUILD],
    ['frontend/public/templates/reading/test.md', BUILD],
    ['frontend/package.json', BUILD],
    ['frontend/package-lock.json', BUILD],
    ['frontend/next.config.ts', BUILD],
    ['frontend/proxy.ts', BUILD],
    ['frontend/vercel.json', BUILD],
    ['frontend/tailwind.config.cjs', BUILD],
    ['frontend/tooling/content-security-policy.mjs', BUILD],
    ['frontend/tooling/vercel-ignore-build.sh', BUILD],
    ['vercel.json', BUILD],
    ['docs/AGENT_WORKFLOW.md', SKIP],
    ['specs/0040-x/spec.md', SKIP],
    ['backend/main.py', SKIP],
    ['backend/migrations/400_x.sql', SKIP],
    ['.github/workflows/backend-tests.yml', SKIP],
    ['README.md', SKIP],
    ['scripts/ci/check-grammar-health.sh', SKIP],
    ['frontend/AGENTS.md', SKIP],
    ['frontend/tooling/README.md', SKIP],
    ['frontend/tests/vercel-ignore-build.test.mjs', SKIP],
    ['frontend/tests/fixtures/legacy-html-retired/admin.html', SKIP],
    ['frontend/playwright.staging.config.js', SKIP],
    ['frontend/vitest.config.mts', SKIP],
    ['frontend/tooling/verify-login-flow.mjs', SKIP],
    ['frontend/tooling/write-flows/a.mjs', SKIP],
  ];
  for (const [file, expected] of table) {
    test(`${file} → ${expected === BUILD ? 'build' : 'skip'}`, () => {
      git(repo, 'checkout', '-q', '--detach', base);
      commitFile(repo, file);
      const r = decide(repo, {
        VERCEL_GIT_COMMIT_REF: 'q/x', VERCEL_GIT_PREVIOUS_SHA: base,
        VERCEL_GIT_COMMIT_MESSAGE: 'change [preview]',
      });
      assert.equal(r.code, expected, r.out);
    });
  }

  test('a mixed docs + frontend diff builds', () => {
    git(repo, 'checkout', '-q', '--detach', base);
    commitFile(repo, 'docs/a.md');
    commitFile(repo, 'frontend/lib/a.ts');
    commitFile(repo, 'backend/a.py');
    const r = decide(repo, {
      VERCEL_GIT_COMMIT_REF: 'q/x', VERCEL_GIT_PREVIOUS_SHA: base,
      VERCEL_GIT_COMMIT_MESSAGE: 'mixed [preview]',
    });
    assert.equal(r.code, BUILD, r.out);
  });

  test('moving a frontend file out of frontend/ builds (renames not collapsed)', () => {
    git(repo, 'checkout', '-q', '--detach', base);
    commitFile(repo, 'frontend/lib/moved.ts');
    const before = git(repo, 'rev-parse', 'HEAD');
    mkdirSync(path.join(repo, 'docs'), { recursive: true });
    git(repo, 'mv', 'frontend/lib/moved.ts', 'docs/moved.ts');
    git(repo, 'commit', '-q', '-m', 'move');
    const r = decide(repo, {
      VERCEL_GIT_COMMIT_REF: 'q/x', VERCEL_GIT_PREVIOUS_SHA: before,
      VERCEL_GIT_COMMIT_MESSAGE: 'move [preview]',
    });
    assert.equal(r.code, BUILD, r.out);
  });

  test('an empty diff skips', () => {
    git(repo, 'checkout', '-q', '--detach', base);
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'empty');
    const r = decide(repo, {
      VERCEL_GIT_COMMIT_REF: 'q/x', VERCEL_GIT_PREVIOUS_SHA: base,
      VERCEL_GIT_COMMIT_MESSAGE: 'empty [preview]',
    });
    assert.equal(r.code, SKIP, r.out);
  });
});

describe('base fallback: merge-base with origin/staging', () => {
  let upstream;
  before(() => {
    upstream = newRepo('upstream');
    git(upstream, 'branch', 'staging');
    git(upstream, 'checkout', '-q', 'staging');
    commitFile(upstream, 'frontend/app/staging-only.tsx');
    git(upstream, 'checkout', '-q', '-b', 'q/docs', 'main');
    commitFile(upstream, 'docs/a.md');
    git(upstream, 'checkout', '-q', '-b', 'q/ui', 'main');
    commitFile(upstream, 'frontend/app/ui.tsx');
    git(upstream, 'checkout', '-q', 'main');
  });

  function clone(name, branch, ...flags) {
    const dir = path.join(TMP, name);
    git(TMP, 'clone', '-q', ...flags, '--branch', branch, `file://${upstream}`, dir);
    return dir;
  }

  test('no previous SHA, full clone: frontend change since merge-base builds', () => {
    const repo = clone('full-ui', 'q/ui');
    const r = decide(repo, { VERCEL_GIT_COMMIT_REF: 'q/ui', VERCEL_GIT_COMMIT_MESSAGE: 'ui [preview]' });
    assert.equal(r.code, BUILD, r.out);
  });

  test('no previous SHA, full clone: docs-only change since merge-base skips', () => {
    // origin/staging carries a frontend commit; it is not part of this branch.
    const repo = clone('full-docs', 'q/docs');
    const r = decide(repo, { VERCEL_GIT_COMMIT_REF: 'q/docs', VERCEL_GIT_COMMIT_MESSAGE: 'docs [preview]' });
    assert.equal(r.code, SKIP, r.out);
  });

  test('previous SHA not in the clone falls back to the merge-base', () => {
    const repo = clone('full-docs-prev', 'q/docs');
    const r = decide(repo, {
      VERCEL_GIT_COMMIT_REF: 'q/docs', VERCEL_GIT_COMMIT_MESSAGE: 'docs [preview]',
      VERCEL_GIT_PREVIOUS_SHA: 'f'.repeat(40),
    });
    assert.equal(r.code, SKIP, r.out);
  });

  test('single-branch clone fetches origin/staging, then decides', () => {
    const repo = clone('single-docs', 'q/docs', '--single-branch');
    const r = decide(repo, { VERCEL_GIT_COMMIT_REF: 'q/docs', VERCEL_GIT_COMMIT_MESSAGE: 'docs [preview]' });
    assert.equal(r.code, SKIP, r.out);
  });

  test('shallow clone without a reachable merge-base builds', () => {
    const repo = clone('shallow-docs', 'q/docs', '--depth=1');
    const r = decide(repo, { VERCEL_GIT_COMMIT_REF: 'q/docs', VERCEL_GIT_COMMIT_MESSAGE: 'docs [preview]' });
    assert.equal(r.code, BUILD, r.out);
  });

  test('no origin remote and no previous SHA builds (fetch failure)', () => {
    const repo = newRepo('no-remote');
    commitFile(repo, 'docs/a.md');
    const r = decide(repo, { VERCEL_GIT_COMMIT_REF: 'q/x', VERCEL_GIT_COMMIT_MESSAGE: 'docs [preview]' });
    assert.equal(r.code, BUILD, r.out);
  });
});

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHA = /^[a-f0-9]{40}$/;

// A moved branch alone is insufficient: both serving releases must have
// replaced this run with descendants on staging's current history.
export function supersedingStagingHead(evidence, cwd = ROOT) {
  const { source_sha: source, frontend_release: frontend, backend_release: backend } = evidence;
  if (![source, frontend, backend].every((sha) => SHA.test(sha)) ||
      frontend === source || backend === source ||
      evidence.runtime_environment !== 'staging' || evidence.frontend_git_ref !== 'staging' ||
      evidence.backend_git_branch !== 'staging' || evidence.backend_environment_name !== 'staging') {
    return null;
  }

  const git = (...args) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
  }).trim();
  const ancestor = (older, newer) => {
    try {
      git('merge-base', '--is-ancestor', older, newer);
      return true;
    } catch (error) {
      if (error.status === 1) return false;
      throw error;
    }
  };

  try {
    const shallow = git('rev-parse', '--is-shallow-repository') === 'true';
    git('fetch', '--no-tags', ...(shallow ? ['--unshallow'] : []),
      'origin', 'staging:refs/remotes/origin/staging');
    const head = git('rev-parse', 'refs/remotes/origin/staging');
    if (source === head || !ancestor(source, head)) return null;
    return [frontend, backend].every((release) => (
      ancestor(source, release) && ancestor(release, head)
    )) ? head : null;
  } catch {
    // Never print git transport diagnostics, which may include credentials.
    throw new Error('staging-ancestry-unavailable');
  }
}

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateListeningPhaseLineage } from './gate-e-listening-coexistence-lineage.mjs';

const SHA = /^[a-f0-9]{40}$/;

function run() {
  const phase = process.env.GATE_E_DRILL_PHASE || '';
  const sourceSha = process.env.GATE_E_SOURCE_SHA || '';
  const floorSha = process.env.GATE_E_ROLLBACK_FLOOR_SHA || '';
  const output = path.resolve('test-results/gate-e-dictation-coexistence-lineage.json');
  let evidence;
  try {
    for (const sha of [sourceSha, floorSha]) if (SHA.test(sha)) {
      execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' });
    }
    evidence = validateListeningPhaseLineage({
      phase, sourceSha, floorSha,
      isAncestor(ancestor, descendant) {
        try {
          execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { stdio: 'ignore' });
          return true;
        } catch { return false; }
      },
    });
  } catch (error) {
    evidence = { phase: phase || null, source_sha: sourceSha || null,
      rollback_floor_sha: floorSha || null, verified: false,
      error: String(error?.message || error) };
  }
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({ schema_version: 1, ...evidence }, null, 2)}\n`);
  if (evidence.verified && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, 'verified=true\n');
    if (evidence.rollback_mode) appendFileSync(process.env.GITHUB_OUTPUT, `rollback_mode=${evidence.rollback_mode}\n`);
  }
  if (!evidence.verified) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) run();

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;

export function validatePhaseLineage({ phase, sourceSha, floorSha, isAncestor }) {
  if (!['floor', 'cutover', 'rollback'].includes(phase)) throw new Error('phase-invalid');
  if (!SHA.test(sourceSha || '')) throw new Error('source-sha-invalid');
  if (!SHA.test(floorSha || '')) throw new Error('rollback-floor-sha-invalid');

  if (phase === 'floor' && sourceSha !== floorSha) {
    throw new Error('floor-source-must-equal-rollback-floor');
  }
  if (phase === 'cutover') {
    if (sourceSha === floorSha) throw new Error('cutover-source-must-follow-floor');
    if (!isAncestor(floorSha, sourceSha)) {
      throw new Error('cutover-source-is-not-floor-descendant');
    }
  }
  if (phase === 'rollback' && sourceSha !== floorSha && !isAncestor(floorSha, sourceSha)) {
    throw new Error('rollback-source-is-not-floor-descendant');
  }

  return {
    phase,
    source_sha: sourceSha,
    rollback_floor_sha: floorSha,
    rollback_mode: phase === 'rollback'
      ? (sourceSha === floorSha ? 'exact-floor' : 'forward-revert')
      : null,
    verified: true,
  };
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function run() {
  const phase = process.env.GATE_E_DRILL_PHASE || '';
  const sourceSha = process.env.GATE_E_SOURCE_SHA || '';
  const floorSha = process.env.GATE_E_ROLLBACK_FLOOR_SHA || '';
  const output = path.resolve('test-results/gate-e-speaking-coexistence-lineage.json');

  let evidence;
  try {
    if (SHA.test(sourceSha)) git('cat-file', '-e', `${sourceSha}^{commit}`);
    if (SHA.test(floorSha)) git('cat-file', '-e', `${floorSha}^{commit}`);
    evidence = validatePhaseLineage({
      phase,
      sourceSha,
      floorSha,
      isAncestor(ancestor, descendant) {
        try {
          execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
            stdio: 'ignore',
          });
          return true;
        } catch {
          return false;
        }
      },
    });
  } catch (error) {
    evidence = {
      phase: phase || null,
      source_sha: sourceSha || null,
      rollback_floor_sha: floorSha || null,
      verified: false,
      error: String(error?.message || error),
    };
  }

  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({ schema_version: 1, ...evidence }, null, 2)}\n`);
  if (evidence.verified && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, 'verified=true\n');
    if (evidence.rollback_mode) {
      appendFileSync(process.env.GITHUB_OUTPUT, `rollback_mode=${evidence.rollback_mode}\n`);
    }
  }
  console.log(`Gate E coexistence lineage: ${evidence.verified ? 'VERIFIED' : 'INVALID'}`);
  if (!evidence.verified) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) run();

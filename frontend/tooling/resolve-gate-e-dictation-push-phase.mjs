import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CORE_PLAYER_AFFINITY_POLICY,
  corePlayerAdmissionForDeployment,
} from '../lib/core-player-affinity.mjs';
import { resolveListeningPushPhase } from './resolve-gate-e-listening-push-phase.mjs';

export function resolveDictationPushPhase({ sourceSha, admission, inputs }) {
  return resolveListeningPushPhase({ sourceSha, admission, inputs });
}

function run() {
  const sourceSha = process.env.SOURCE_SHA || '';
  const inputs = JSON.parse(readFileSync(
    path.resolve('tooling/gate-e-dictation-coexistence-push-inputs.json'), 'utf8',
  ));
  const resolved = resolveDictationPushPhase({
    sourceSha,
    admission: corePlayerAdmissionForDeployment(
      'listening_dictation',
      { vercelEnv: 'preview', gitRef: 'staging' },
      CORE_PLAYER_AFFINITY_POLICY,
    ),
    inputs,
  });
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT-missing');
  appendFileSync(process.env.GITHUB_OUTPUT,
    `${Object.entries(resolved).map(([key, value]) => `${key}=${value}`).join('\n')}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) run();

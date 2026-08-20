// Gate E -> core cutover release boundary.
//
// The 20-run remediation floor must contain every runtime/schema fix while
// four stateful players still admit Legacy. The descendant cutover may flip
// only admission policy plus its assertions/evidence; otherwise the streak no
// longer proves the runtime that receives fresh sessions.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CORE_CUTOVER_SURFACES = Object.freeze([
  'speaking',
  'reading_exam',
  'listening_test',
  'listening_dictation',
]);

export const CORE_CUTOVER_FILE_ALLOWLIST = Object.freeze(new Set([
  'frontend/lib/core-player-affinity.mjs',
  'frontend/tests/gate-e-active-session-affinity.test.mjs',
  'frontend/tests/listening-dictation-next-behavior.test.mjs',
  'frontend/tests/listening-test-native-controller.test.mjs',
  'frontend/tests/next-migration-status.test.mjs',
  'frontend/tests/parity-core.test.mjs',
  'frontend/tests/reading-exam-native-controller.test.mjs',
  'frontend/tests/speaking-core-dark-route.test.mjs',
  'frontend/tests/write-flow-manifests.test.mjs',
  'docs/ROUTE_LEDGER.md',
]));

const SHA = /^[0-9a-f]{40}$/;

function admissionMap(source) {
  const text = String(source || '');
  const map = {};
  for (const surface of [...CORE_CUTOVER_SURFACES, 'writing_assignment']) {
    const escaped = surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`${escaped}:\\s*Object\\.freeze\\(\\{[\\s\\S]*?admit_new:\\s*'(legacy|next)'`));
    if (match) map[surface] = match[1];
  }
  return map;
}

function normalizedPolicyRuntime(source) {
  return String(source || '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trimEnd())
    .filter((line) => line.trim())
    .join('\n')
    .replace(/admit_new:\s*'(?:legacy|next)'/g, "admit_new: '<ADMISSION>'");
}

function allowedChangedFile(file) {
  return CORE_CUTOVER_FILE_ALLOWLIST.has(file)
    || /^docs\/GATE_E_CORE_CUTOVER_EVIDENCE_[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$/.test(file);
}

export function validateCoreCutoverDiff({
  floorSha,
  cutoverSha,
  floorPolicySource,
  cutoverPolicySource,
  changedFiles,
  isAncestor,
}) {
  const errors = [];
  if (!SHA.test(String(floorSha || ''))) errors.push('floor-sha-invalid');
  if (!SHA.test(String(cutoverSha || ''))) errors.push('cutover-sha-invalid');
  if (floorSha === cutoverSha) errors.push('cutover-must-differ-from-floor');
  if (typeof isAncestor !== 'function' || !isAncestor(floorSha, cutoverSha)) {
    errors.push('cutover-is-not-floor-descendant');
  }

  const files = [...new Set((changedFiles || []).map(String))].sort();
  if (!files.includes('frontend/lib/core-player-affinity.mjs')) {
    errors.push('admission-policy-file-not-changed');
  }
  const forbidden = files.filter((file) => !allowedChangedFile(file));
  if (forbidden.length) errors.push(`cutover-files-forbidden:${forbidden.join(',')}`);

  const floor = admissionMap(floorPolicySource);
  const cutover = admissionMap(cutoverPolicySource);
  for (const surface of CORE_CUTOVER_SURFACES) {
    if (floor[surface] !== 'legacy') errors.push(`floor-admission-not-legacy:${surface}`);
    if (cutover[surface] !== 'next') errors.push(`cutover-admission-not-next:${surface}`);
  }
  if (floor.writing_assignment !== 'next' || cutover.writing_assignment !== 'next') {
    errors.push('writing-admission-drift');
  }
  if (normalizedPolicyRuntime(floorPolicySource) !== normalizedPolicyRuntime(cutoverPolicySource)) {
    errors.push('core-policy-non-admission-runtime-drift');
  }
  return [...new Set(errors)];
}

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

export function verifyCoreCutoverCommits(floorSha, cutoverSha) {
  const changedFiles = git(['diff', '--name-only', `${floorSha}..${cutoverSha}`])
    .split('\n').filter(Boolean);
  const policyPath = 'frontend/lib/core-player-affinity.mjs';
  const errors = validateCoreCutoverDiff({
    floorSha,
    cutoverSha,
    floorPolicySource: git(['show', `${floorSha}:${policyPath}`]),
    cutoverPolicySource: git(['show', `${cutoverSha}:${policyPath}`]),
    changedFiles,
    isAncestor: (ancestor, descendant) => {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    },
  });
  return { floorSha, cutoverSha, changedFiles, verified: errors.length === 0, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , floorSha = '', cutoverSha = ''] = process.argv;
  const result = verifyCoreCutoverCommits(floorSha, cutoverSha);
  console.log(JSON.stringify(result, null, 2));
  if (!result.verified) process.exitCode = 1;
}

// Gate E active-session policy.
//
// An implementation-specific PATH is the affinity key. Query flags are not:
// they are forgeable, easy to drop and cannot make a same-path deployment
// sticky. A cutover changes only `admit_new`; existing attempt URLs continue to
// resolve to the implementation on which they started.

export const CORE_PLAYER_AFFINITY_POLICY = Object.freeze({
  schema_version: 1,
  strategy_id: 'stable-player-url-admission-switch-v1',
  surfaces: Object.freeze({
    speaking: Object.freeze({
      admit_new: 'legacy',
      identity_query_any_of: Object.freeze(['session_id']),
      allowed_query: Object.freeze(['session_id']),
      legacy: Object.freeze({ path: '/pages/practice.html', route_ready: true }),
      next: Object.freeze({ path: '/practice/session', route_ready: false }),
    }),
    reading_exam: Object.freeze({
      admit_new: 'legacy',
      identity_query_any_of: Object.freeze(['test_id', 'share']),
      allowed_query: Object.freeze([
        'test_id', 'share', 'sitting_id', 'mock_embed', 'from', 'class_item',
      ]),
      legacy: Object.freeze({ path: '/pages/reading-exam.html', route_ready: true }),
      next: Object.freeze({ path: '/reading/exam/session', route_ready: false }),
    }),
    listening_test: Object.freeze({
      admit_new: 'legacy',
      identity_query_any_of: Object.freeze(['id']),
      allowed_query: Object.freeze(['id', 'sitting_id', 'mock_embed', 'from', 'class_item']),
      legacy: Object.freeze({ path: '/pages/listening-test.html', route_ready: true }),
      next: Object.freeze({ path: '/listening/test/session', route_ready: false }),
    }),
    listening_dictation: Object.freeze({
      admit_new: 'legacy',
      identity_query_any_of: Object.freeze(['test_id']),
      allowed_query: Object.freeze(['test_id', 'section']),
      legacy: Object.freeze({ path: '/pages/listening-test-dictation.html', route_ready: true }),
      next: Object.freeze({ path: '/listening/dictation/session', route_ready: false }),
    }),
  }),
});

const IMPLEMENTATIONS = new Set(['legacy', 'next']);
const REQUIRED_SURFACES = Object.freeze([
  'speaking',
  'reading_exam',
  'listening_test',
  'listening_dictation',
]);

function surfacePolicy(surface, policy) {
  const found = policy?.surfaces?.[surface];
  if (!found) throw new Error(`unknown-core-player-surface:${surface}`);
  return found;
}

function scalarQueryValue(value, key) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const normalized = String(value);
    if (normalized) return normalized;
  }
  throw new Error(`invalid-core-player-query:${key}`);
}

function isSafeSameOriginPath(value) {
  if (typeof value !== 'string' || !/^\/(?!\/)[A-Za-z0-9._/-]+$/.test(value)) return false;
  if (value.includes('//')) return false;
  return value.split('/').every((segment) => segment !== '.' && segment !== '..');
}

export function validateCorePlayerAffinityPolicy(policy = CORE_PLAYER_AFFINITY_POLICY) {
  const errors = [];
  if (policy?.schema_version !== 1) errors.push('schema-version-invalid');
  if (policy?.strategy_id !== 'stable-player-url-admission-switch-v1') {
    errors.push('strategy-id-invalid');
  }
  for (const surface of REQUIRED_SURFACES) {
    if (!policy?.surfaces?.[surface]) errors.push(`${surface}:surface-missing`);
  }
  for (const [surface, config] of Object.entries(policy?.surfaces || {})) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      errors.push(`${surface}:surface-invalid`);
      continue;
    }
    if (!IMPLEMENTATIONS.has(config.admit_new)) errors.push(`${surface}:admission-invalid`);
    for (const implementation of IMPLEMENTATIONS) {
      const target = config[implementation];
      if (!isSafeSameOriginPath(target?.path)) {
        errors.push(`${surface}:${implementation}-path-invalid`);
      }
      if (typeof target?.route_ready !== 'boolean') {
        errors.push(`${surface}:${implementation}-readiness-invalid`);
      }
    }
    if (config.legacy?.path === config.next?.path) errors.push(`${surface}:paths-not-distinct`);
    if (config[config.admit_new]?.route_ready !== true) errors.push(`${surface}:admission-route-not-ready`);
    const identityKeys = config.identity_query_any_of;
    const allowedKeys = config.allowed_query;
    if (!Array.isArray(identityKeys) || !identityKeys.length ||
        identityKeys.some((key) => typeof key !== 'string' || !/^[A-Za-z0-9_]+$/.test(key))) {
      errors.push(`${surface}:identity-query-missing`);
    }
    if (!Array.isArray(allowedKeys) ||
        allowedKeys.some((key) => typeof key !== 'string' || !/^[A-Za-z0-9_]+$/.test(key)) ||
        (Array.isArray(identityKeys) && identityKeys.some((key) => !allowedKeys.includes(key)))) {
      errors.push(`${surface}:query-contract-invalid`);
    }
  }
  return errors;
}

export function corePlayerUrl(
  surface,
  implementation,
  query,
  policy = CORE_PLAYER_AFFINITY_POLICY,
) {
  const policyErrors = validateCorePlayerAffinityPolicy(policy);
  if (policyErrors.length) {
    throw new Error(`invalid-core-player-policy:${policyErrors.join(',')}`);
  }
  if (!IMPLEMENTATIONS.has(implementation)) {
    throw new Error(`invalid-core-player-implementation:${implementation}`);
  }
  const config = surfacePolicy(surface, policy);
  const target = config[implementation];
  if (target?.route_ready !== true) throw new Error(`${surface}:${implementation}-route-not-ready`);

  const supplied = Object.entries(query || {})
    .filter(([, value]) => value !== null && value !== undefined);
  const unknown = supplied.find(([key]) => !config.allowed_query.includes(key));
  if (unknown) throw new Error(`unknown-core-player-query:${surface}:${unknown[0]}`);
  if (!config.identity_query_any_of.some((key) => supplied.some(([name]) => name === key))) {
    throw new Error(`missing-core-player-identity:${surface}`);
  }

  const params = new URLSearchParams();
  for (const [key, value] of supplied) params.set(key, scalarQueryValue(value, key));
  return `${target.path}?${params.toString()}`;
}

export function admitCorePlayer(
  surface,
  query,
  policy = CORE_PLAYER_AFFINITY_POLICY,
) {
  const config = surfacePolicy(surface, policy);
  return corePlayerUrl(surface, config.admit_new, query, policy);
}

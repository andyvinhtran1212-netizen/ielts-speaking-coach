// Gate E active-session policy.
//
// An implementation-specific PATH is the affinity key. Query flags are not:
// they are forgeable, easy to drop and cannot make a same-path deployment
// sticky. A cutover changes only `admit_new`; after admission, the browser uses
// the implementation-specific destination URL for the lifetime of the attempt.

export const CORE_PLAYER_AFFINITY_POLICY = Object.freeze({
  schema_version: 1,
  strategy_id: 'stable-player-url-admission-switch-v1',
  surfaces: Object.freeze({
    speaking: Object.freeze({
      // Gate E floor remains Legacy while the canonical first-player claim is
      // deployed and verified separately. Only a descendant release may flip
      // fresh admission to Next; claimed sessions keep their stable URL.
      admit_new: 'legacy',
      identity_query_any_of: Object.freeze(['session_id']),
      allowed_query: Object.freeze(['session_id']),
      legacy: Object.freeze({ path: '/pages/practice.html', route_ready: true }),
      // The dark route was established in a separate floor release. This
      // staging-only cutover is evidence collection, not a production cutover.
      next: Object.freeze({ path: '/practice/session', route_ready: true }),
    }),
    reading_exam: Object.freeze({
      admit_new: 'legacy',
      identity_query_any_of: Object.freeze(['test_id', 'share']),
      allowed_query: Object.freeze([
        'test_id', 'share', 'sitting_id', 'mock_embed', 'from', 'class_item',
      ]),
      legacy: Object.freeze({ path: '/pages/reading-exam.html', route_ready: true }),
      // Native App Router player exists as a dark route. Admission stays
      // legacy until Gate E's Reading failure matrix and coexistence drill pass.
      next: Object.freeze({ path: '/reading/exam/session', route_ready: true }),
    }),
    listening_test: Object.freeze({
      admit_new: 'legacy',
      identity_query_any_of: Object.freeze(['id']),
      allowed_query: Object.freeze(['id', 'sitting_id', 'mock_embed', 'from', 'class_item']),
      legacy: Object.freeze({ path: '/pages/listening-test.html', route_ready: true }),
      // Native App Router player is dark-ready. Admission stays legacy until
      // the Listening Gate E failure matrix and coexistence drill pass.
      next: Object.freeze({ path: '/listening/test/session', route_ready: true }),
    }),
    listening_dictation: Object.freeze({
      admit_new: 'legacy',
      identity_query_any_of: Object.freeze(['test_id']),
      allowed_query: Object.freeze(['test_id', 'section']),
      legacy: Object.freeze({ path: '/pages/listening-test-dictation.html', route_ready: true }),
      // Native App Router player owns the complete dark-route flow, including
      // durable completion reconciliation. Admission stays legacy until its
      // Gate E browser/failure matrix passes.
      next: Object.freeze({ path: '/listening/dictation/session', route_ready: true }),
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
const RUNTIME_ADMISSION_PATH = '/core-player/launch';

function surfacePolicy(surface, policy) {
  const surfaces = policy?.surfaces;
  const found = typeof surface === 'string' && Object.hasOwn(surfaces || {}, surface)
    ? surfaces[surface]
    : null;
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

function normalizedQueryEntries(surface, config, query) {
  const provided = Object.entries(query || {})
    .filter(([, value]) => value !== null && value !== undefined);
  const unknown = provided.find(([key]) => !config.allowed_query.includes(key));
  if (unknown) throw new Error(`unknown-core-player-query:${surface}:${unknown[0]}`);
  const supplied = provided.filter(([key, value]) => (
    value !== '' || config.identity_query_any_of.includes(key)
  ));
  if (!config.identity_query_any_of.some((key) => supplied.some(([name]) => name === key))) {
    throw new Error(`missing-core-player-identity:${surface}`);
  }
  return supplied.map(([key, value]) => [key, scalarQueryValue(value, key)]);
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
      if (!isSafeSameOriginPath(target?.path) || target?.path === RUNTIME_ADMISSION_PATH) {
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
        allowedKeys.includes('surface') ||
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

  const params = new URLSearchParams();
  for (const [key, value] of normalizedQueryEntries(surface, config, query)) {
    params.set(key, value);
  }
  return `${target.path}?${params.toString()}`;
}

/** Resolve on the server/runtime deployment that receives the navigation. */
export function resolveCorePlayerAdmission(
  surface,
  query,
  policy = CORE_PLAYER_AFFINITY_POLICY,
) {
  const config = surfacePolicy(surface, policy);
  return corePlayerUrl(surface, config.admit_new, query, policy);
}

/** Parse and resolve the exact query-string contract accepted by the runtime route. */
export function resolveCorePlayerAdmissionFromParams(
  searchParams,
  policy = CORE_PLAYER_AFFINITY_POLICY,
) {
  const entries = [...searchParams.entries()];
  const seen = new Set();
  const hasDuplicate = entries.some(([key]) => {
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  const surfaces = searchParams.getAll('surface');
  if (hasDuplicate || surfaces.length !== 1) {
    throw new Error('invalid-core-player-admission-query');
  }
  return resolveCorePlayerAdmission(
    surfaces[0],
    Object.fromEntries(entries.filter(([key]) => key !== 'surface')),
    policy,
  );
}

/**
 * Build a stable, same-origin admission URL for launchers.
 *
 * Deliberately do not embed `admit_new` in this URL: an already-open launcher
 * can outlive a cutover or rollback deployment. The no-store route resolves
 * the current admission policy when the user actually navigates.
 */
export function admitCorePlayer(
  surface,
  query,
  policy = CORE_PLAYER_AFFINITY_POLICY,
) {
  const policyErrors = validateCorePlayerAffinityPolicy(policy);
  if (policyErrors.length) {
    throw new Error(`invalid-core-player-policy:${policyErrors.join(',')}`);
  }
  const config = surfacePolicy(surface, policy);
  const params = new URLSearchParams([['surface', surface]]);
  for (const [key, value] of normalizedQueryEntries(surface, config, query)) {
    params.set(key, value);
  }
  return `${RUNTIME_ADMISSION_PATH}?${params.toString()}`;
}

/**
 * Convert an N-1 backend's implementation-specific URL into a fresh runtime
 * admission decision. Compatibility parsing lives here so callers never need
 * to copy legacy player paths and silently bypass a later cutover/rollback.
 */
export function admitCorePlayerFromLegacyUrl(
  surface,
  legacyUrl,
  expectedQuery = {},
  policy = CORE_PLAYER_AFFINITY_POLICY,
) {
  const config = surfacePolicy(surface, policy);
  if (typeof legacyUrl !== 'string' || !legacyUrl.startsWith('/')) {
    throw new Error(`invalid-core-player-legacy-url:${surface}`);
  }
  let parsed;
  try {
    parsed = new URL(legacyUrl, 'https://aver.invalid');
  } catch {
    throw new Error(`invalid-core-player-legacy-url:${surface}`);
  }
  if (parsed.origin !== 'https://aver.invalid' || parsed.pathname !== config.legacy.path
      || parsed.hash || parsed.username || parsed.password) {
    throw new Error(`invalid-core-player-legacy-url:${surface}`);
  }
  const entries = [...parsed.searchParams.entries()];
  const keys = new Set();
  for (const [key] of entries) {
    if (keys.has(key)) throw new Error(`invalid-core-player-legacy-query:${surface}`);
    keys.add(key);
  }
  const query = Object.fromEntries(entries);
  for (const [key, value] of Object.entries(expectedQuery || {})) {
    if (query[key] !== scalarQueryValue(value, key)) {
      throw new Error(`mismatched-core-player-legacy-query:${surface}:${key}`);
    }
  }
  return admitCorePlayer(surface, query, policy);
}

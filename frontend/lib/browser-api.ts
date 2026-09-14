import 'client-only';

import type { ApiGetJson, ApiGetPath, ApiPostJson, ApiPostPath } from '@/lib/openapi-contract';

/**
 * Typed adapter over the migration-era browser transport.
 *
 * Keep auth, request correlation and 401 behavior in api.js while domains move
 * off ad-hoc response generics. Static OpenAPI paths are separate from query
 * values, so a caller cannot accidentally bind one endpoint's response type to
 * another endpoint URL.
 */
export function getBrowserJson<Path extends ApiGetPath>(
  endpoint: Path,
  query?: URLSearchParams,
  signal?: AbortSignal,
): Promise<ApiGetJson<Path>> {
  const suffix = query?.size ? `?${query.toString()}` : '';
  return window.api.getWith<ApiGetJson<Path>>(
    `${endpoint}${suffix}`,
    undefined,
    signal ? { signal } : undefined,
  );
}

/**
 * Variant for OpenAPI paths containing parameters.
 *
 * ``contractPath`` exists only to bind the generated response type; ``endpoint``
 * is the concrete, encoded URL sent through the same authenticated transport.
 */
export function getBrowserJsonAt<Path extends ApiGetPath>(
  _contractPath: Path,
  endpoint: string,
  signal?: AbortSignal,
): Promise<ApiGetJson<Path>> {
  return window.api.getWith<ApiGetJson<Path>>(
    endpoint,
    undefined,
    signal ? { signal } : undefined,
  );
}

/** Typed POST response for a concrete URL bound to an OpenAPI path template. */
export function postBrowserJsonAt<Path extends ApiPostPath>(
  _contractPath: Path,
  endpoint: string,
  body: unknown = {},
): Promise<ApiPostJson<Path>> {
  return window.api.post<ApiPostJson<Path>>(endpoint, body);
}

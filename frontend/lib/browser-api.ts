import 'client-only';

import type {
  ApiDeleteJson,
  ApiDeletePath,
  ApiGetJson,
  ApiGetPath,
  ApiPatchJson,
  ApiPatchPath,
  ApiPostJson,
  ApiPostPath,
  ApiPostSuccessJson,
} from '@/lib/openapi-contract';
import { searchParamsSuffix } from '@/lib/search-params.mjs';

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
  /**
   * `noRedirect`: a 401 throws (`status: 401`) instead of sending the page to
   * /login. Only for reads on public pages, where an expired session must not
   * move the visitor (LIBRARY-0061 FR-001).
   */
  { noRedirect = false }: { noRedirect?: boolean } = {},
): Promise<ApiGetJson<Path>> {
  const suffix = searchParamsSuffix(query);
  const opts = signal || noRedirect
    ? { ...(signal ? { signal } : {}), ...(noRedirect ? { noRedirect: true } : {}) }
    : undefined;
  return window.api.getWith<ApiGetJson<Path>>(`${endpoint}${suffix}`, undefined, opts);
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
  { noRedirect = false }: { noRedirect?: boolean } = {},
): Promise<ApiGetJson<Path>> {
  const opts = signal || noRedirect
    ? { ...(signal ? { signal } : {}), ...(noRedirect ? { noRedirect: true } : {}) }
    : undefined;
  return window.api.getWith<ApiGetJson<Path>>(
    endpoint,
    undefined,
    opts,
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

/** Typed PATCH response for a concrete URL bound to an OpenAPI path template. */
export function patchBrowserJsonAt<Path extends ApiPatchPath>(
  _contractPath: Path,
  endpoint: string,
  body: unknown = {},
): Promise<ApiPatchJson<Path>> {
  return window.api.patch<ApiPatchJson<Path>>(endpoint, body);
}

/**
 * POST with the transport options (`noRedirect` for public pages). The type
 * accepts a 201/202 answer, which `ApiPostJson` (200 only) would make `never`.
 */
export function postBrowserJsonAtWith<Path extends ApiPostPath>(
  _contractPath: Path,
  endpoint: string,
  body: unknown = {},
  { noRedirect = false, signal }: { noRedirect?: boolean; signal?: AbortSignal } = {},
): Promise<ApiPostSuccessJson<Path>> {
  const opts = signal || noRedirect ? { signal, noRedirect } : undefined;
  return window.api.postWith<ApiPostSuccessJson<Path>>(endpoint, body, undefined, opts);
}

/** Typed DELETE with a JSON body (e.g. a mail-link token that must stay out of the URL). */
export function deleteBrowserJsonAt<Path extends ApiDeletePath>(
  _contractPath: Path,
  endpoint: string,
  body: unknown = {},
  { noRedirect = false, signal }: { noRedirect?: boolean; signal?: AbortSignal } = {},
): Promise<ApiDeleteJson<Path>> {
  const opts = signal || noRedirect ? { signal, noRedirect } : undefined;
  return window.api.deleteWith<ApiDeleteJson<Path>>(endpoint, body, undefined, opts);
}

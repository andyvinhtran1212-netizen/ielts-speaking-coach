/**
 * Serialize query parameters without relying on URLSearchParams.size, which is
 * absent from the repository's oldest supported browsers.
 */
export function searchParamsSuffix(query) {
  const serialized = query?.toString() || '';
  return serialized ? `?${serialized}` : '';
}

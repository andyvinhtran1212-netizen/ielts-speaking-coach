// Shared App Router source inventory used by permanent repository checks.

export const NON_PRODUCT_APP_PAGE_ROUTES = Object.freeze([
  '/next-probe',
  '/recorder-spike',
]);

export function appPageRoute(relativeFile) {
  const normalized = String(relativeFile || '').replaceAll('\\', '/');
  if (!/(^|\/)page\.(tsx|ts)$/.test(normalized)) return null;
  const segments = normalized.split('/').slice(0, -1);
  if (segments.some((segment) => segment.startsWith('_'))) return null;
  const routeSegments = segments.filter((segment) => (
    !segment.startsWith('@') && !(segment.startsWith('(') && segment.endsWith(')'))
  ));
  return `/${routeSegments.join('/')}`;
}

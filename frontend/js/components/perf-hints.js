/**
 * Shared performance resource hints for authenticated chrome surfaces.
 *
 * Installed by <aver-chrome> and <aver-admin-chrome>. JS injection lets us
 * honor Save-Data users instead of forcing preconnect sockets on constrained
 * connections.
 */

const PERF_ORIGINS = [
  'https://ielts-speaking-coach-production.up.railway.app',
  'https://nqhrtqspznepmveyurzm.supabase.co',
  'https://res.cloudinary.com',
];


function hasResourceHint(rel, href) {
  return Boolean(document.head.querySelector(`link[rel="${rel}"][href="${href}"]`));
}


function appendHint(rel, href) {
  if (hasResourceHint(rel, href)) return;
  const link = document.createElement('link');
  link.rel = rel;
  link.href = href;
  if (rel === 'preconnect') link.crossOrigin = '';
  document.head.appendChild(link);
}


export function installPerfResourceHints() {
  if (navigator.connection && navigator.connection.saveData) return;
  PERF_ORIGINS.forEach((origin) => {
    appendHint('preconnect', origin);
    appendHint('dns-prefetch', origin);
  });
}


export { PERF_ORIGINS };

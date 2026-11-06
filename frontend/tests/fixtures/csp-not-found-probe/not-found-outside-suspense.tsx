// Test-only fixture (PC-J566 item 5), never committed under app/. CI copies it
// to app/(authed-home)/home/csp-not-found-probe/[id]/page.tsx before the
// enforced rebuild: a request-time page under an AuthedShell layout that calls
// notFound() outside any <Suspense>. tooling/verify-csp-nonce-404-flow.mjs
// checks that the response is never a nonce header over unstamped scripts.
import { notFound } from 'next/navigation';

export default async function CspNotFoundProbe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id !== 'ok') notFound();
  return <main>csp not-found probe</main>;
}

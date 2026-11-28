// What a device does once the server says another device took the session
// (ENROLL-0060 G05-T20, FR-052, screen 8c). Order matters:
//  1. keep the page's drafts (registered savers, bounded),
//  2. remember the email and time for 8c,
//  3. sign out locally only (the server already ended this session; a global
//     sign-out would end the NEW device's session too),
//  4. purge the persisted session, then replace() to /login?notice=displaced.
import { saveAllDrafts } from '@/lib/auth/draft-savers.mjs';
import { DISPLACED_LOGIN_PATH, rememberDisplaced } from '@/lib/auth/session-claim.mjs';
import { clearPersistedAuthSession } from '@/lib/auth/sign-out-state.mjs';

type LocalSignOutClient = { auth?: { signOut?: (opts?: { scope?: string }) => Promise<unknown> } } | null;

export async function signOutDisplaced({
  client,
  email,
  displacedAt = null,
  now = () => new Date().toISOString(),
  navigate = (path: string) => window.location.replace(path),
  draftTimeoutMs,
}: {
  client: LocalSignOutClient;
  email: string | null;
  /** The server's `displaced_at`; the local clock only when it is missing. */
  displacedAt?: string | null;
  now?: () => string;
  navigate?: (path: string) => void;
  draftTimeoutMs?: number;
}): Promise<void> {
  let saved = 0;
  try { saved = await saveAllDrafts(draftTimeoutMs); } catch { /* drafts never block the sign-out */ }
  // 8c says "Bài bạn đang viết dở đã được lưu nháp." only when a page saved one.
  rememberDisplaced({ email, at: displacedAt || now(), draftsSaved: saved > 0 });
  try { await client?.auth?.signOut?.({ scope: 'local' }); } catch { /* fail closed below */ }
  clearPersistedAuthSession();
  try { (window as any).api?.clearAuthCache?.(); } catch { /* optional */ }
  navigate(DISPLACED_LOGIN_PATH);
}

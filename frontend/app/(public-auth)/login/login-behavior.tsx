'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import type { AuthMeWire } from '@/lib/auth-api';
import {
  clearPersistedAuthSession,
  forgetSignedOutSession,
  isSignedOutSession,
  rememberSignedOutSession,
} from '@/lib/auth/sign-out-state.mjs';
import { loginDestination, normalizeAccessCode, normalizeLoginProfile } from '@/lib/login-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Session = { access_token?: string };
type SupabaseClient = {
  auth: {
    getSession(): Promise<{ data?: { session?: Session | null }; error?: { message?: string } | null }>;
    exchangeCodeForSession(code: string): Promise<{ data?: { session?: Session | null }; error?: { message?: string } | null }>;
    signInWithOAuth(input: unknown): Promise<{ error?: { message?: string } | null }>;
    signOut(): Promise<{ error?: { message?: string } | null } | void>;
  };
};

type LoginProfile = {
  id: string;
  isActive: boolean;
  onboardingCompleted: boolean;
};

type BootResult =
  | { kind: 'signed-out'; client: SupabaseClient }
  | { kind: 'profile'; client: SupabaseClient; profile: LoginProfile };

let bootPromise: Promise<BootResult> | null = null;

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function sharedClient() {
  const ready = await whenGlobalReady(
    () => typeof window.getSupabase === 'function' && Boolean(window.getSupabase()),
    'window.getSupabase (login)',
  );
  if (!ready) throw new Error('Không thể khởi tạo đăng nhập. Vui lòng tải lại trang.');
  return window.getSupabase() as SupabaseClient;
}

async function canonicalProfile(token: string) {
  const ready = await whenGlobalReady(() => Boolean(window.api?.base), 'window.api (login)');
  if (!ready) throw new Error('Không thể kết nối tới máy chủ. Vui lòng thử lại sau.');
  const response = await fetch(`${window.api.base}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.detail === 'string'
      ? payload.detail
      : 'Không thể kiểm tra trạng thái tài khoản.');
  }
  const profile = normalizeLoginProfile(payload as AuthMeWire) as LoginProfile | null;
  if (!profile) throw new Error('Trạng thái tài khoản trả về không đúng định dạng.');
  return profile;
}

// The OAuth redirect lands here as `/login?code=` (PKCE) or with an error.
// Implicit-flow material (`#access_token=`…) is never honored: the shared
// client runs PKCE only, so such a fragment is stale or forged.
function readAuthCallback(): { code: string | null } | null {
  const query = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const errorKeys = ['error', 'error_code', 'error_description'];
  const failed = errorKeys.some((key) => query.has(key) || fragment.has(key));
  const implicit = ['access_token', 'refresh_token', 'expires_in', 'token_type']
    .some((key) => fragment.has(key));
  const code = query.get('code');
  if (!failed && !implicit && !query.has('code')) return null;
  return { code: failed || implicit ? null : code };
}

// U-07: a session this tab already signed out (its page died mid-revoke, or
// the revoke failed) is dead or dying — never send it to /auth/me. Finish the
// revoke the logout started (an already-revoked session counts as signed out)
// and purge it locally whatever the outcome.
async function discardSignedOutSession(client: SupabaseClient) {
  try { await client.auth.signOut(); } catch { /* purged below */ }
  clearPersistedAuthSession();
  forgetSignedOutSession();
}

async function bootstrap(): Promise<BootResult> {
  // Callback material leaves the address bar and the history entry before any
  // network work can stall or reject; the code is held only in memory.
  const callback = readAuthCallback();
  if (callback) window.history.replaceState(null, '', '/login');
  const client = await sharedClient();
  if (callback) {
    if (!callback.code) throw new Error('Đăng nhập thất bại. Vui lòng thử lại.');
    // One explicit exchange (the client's URL detection is off): the verifier
    // stored by signInWithOAuth in this browser proves the code is ours.
    const { data, error } = await client.auth.exchangeCodeForSession(callback.code);
    const token = data?.session?.access_token;
    if (error || !token) throw new Error('Đăng nhập thất bại. Vui lòng thử lại.');
    forgetSignedOutSession(); // a fresh sign-in supersedes the last logout
    return { kind: 'profile', client, profile: await canonicalProfile(token) };
  }
  const { data, error } = await client.auth.getSession();
  const session = data?.session;
  if (error) throw new Error('Đăng nhập thất bại. Vui lòng thử lại.');
  if (!session?.access_token) return { kind: 'signed-out', client };
  if (isSignedOutSession(session.access_token)) {
    await discardSignedOutSession(client);
    return { kind: 'signed-out', client };
  }
  return { kind: 'profile', client, profile: await canonicalProfile(session.access_token) };
}

function formatStat(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace('.0', '')}K+`;
  return `${value}+`;
}

export function LoginBehavior({ googleIcon }: { googleIcon: ReactNode }) {
  const [busyMessage, setBusyMessage] = useState('Đang xác thực…');
  const [error, setError] = useState('');
  const [activationOpen, setActivationOpen] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [activateBusy, setActivateBusy] = useState(false);
  const [activateError, setActivateError] = useState('');
  const [activateSuccess, setActivateSuccess] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const clientRef = useRef<SupabaseClient | null>(null);
  const activateInFlight = useRef(false);
  const signOutInFlight = useRef(false);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyProfile = useCallback((profile: LoginProfile) => {
    const destination = loginDestination(profile);
    if (destination === 'activate') {
      setBusyMessage('');
      setActivationOpen(true);
      return;
    }
    window.location.replace(destination);
  }, []);

  useEffect(() => {
    let disposed = false;
    if (!bootPromise) bootPromise = bootstrap();
    const pendingBoot = bootPromise;
    void pendingBoot.then((result) => {
      if (disposed) return;
      clientRef.current = result.client;
      if (result.kind === 'signed-out') setBusyMessage('');
      else applyProfile(result.profile);
    }).catch((caught) => {
      if (disposed) return;
      setBusyMessage('');
      setError(messageOf(caught, 'Không thể khởi tạo đăng nhập. Vui lòng thử lại.'));
    }).finally(() => {
      // Share an in-flight boot across Strict Mode mounts, never a stale profile.
      if (bootPromise === pendingBoot) bootPromise = null;
    });

    const themeButton = document.querySelector<HTMLButtonElement>('.av-theme-toggle');
    const toggleTheme = () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('av-theme', next); } catch { /* optional preference */ }
    };
    themeButton?.addEventListener('click', toggleTheme);

    const stat = document.getElementById('pitch-stat');
    const loadStat = async () => {
      const ready = await whenGlobalReady(() => Boolean(window.api?.base), 'window.api (login stats)');
      if (!ready || disposed || !stat) return;
      try {
        const response = await fetch(`${window.api.base}/api/public-stats`);
        const payload = response.ok ? await response.json() : null;
        if (!disposed && payload) stat.textContent = formatStat(payload.sessions_completed);
      } catch { /* social proof is non-critical */ }
    };
    void loadStat();

    return () => {
      disposed = true;
      themeButton?.removeEventListener('click', toggleTheme);
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, [applyProfile]);

  async function signInWithGoogle() {
    setError('');
    setBusyMessage('Đang chuyển đến Google…');
    try {
      const client = clientRef.current || await sharedClient();
      clientRef.current = client;
      const { error: oauthError } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/login` },
      });
      if (oauthError) throw new Error(oauthError.message || 'Không thể mở Google Login.');
    } catch (caught) {
      setBusyMessage('');
      setError(messageOf(caught, 'Không thể mở Google Login. Vui lòng thử lại.'));
    }
  }

  async function activate() {
    if (activateInFlight.current) return;
    const code = normalizeAccessCode(accessCode);
    setAccessCode(code);
    setActivateError('');
    setActivateSuccess('');
    if (!code) {
      setActivateError('Vui lòng nhập access code.');
      return;
    }

    activateInFlight.current = true;
    setActivateBusy(true);
    let keepLockedForRedirect = false;
    try {
      const client = clientRef.current || await sharedClient();
      clientRef.current = client;
      const { data } = await client.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');

      let mutationError: Error | null = null;
      try {
        const response = await fetch(`${window.api.base}/auth/activate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ access_code: code }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          mutationError = new Error(typeof payload?.detail === 'string'
            ? payload.detail
            : `Kích hoạt thất bại (HTTP ${response.status}).`);
        }
      } catch {
        // The request may have committed while its ACK was lost. Do not tell
        // the learner it failed until canonical `/auth/me` is reconciled.
        mutationError = new Error('Không nhận được xác nhận kích hoạt từ máy chủ.');
      }

      let profile: LoginProfile;
      try {
        profile = await canonicalProfile(token);
      } catch (caught) {
        throw new Error(mutationError
          ? `${mutationError.message} Chưa kiểm tra lại được trạng thái tài khoản.`
          : `Đã gửi kích hoạt nhưng chưa xác nhận được trạng thái tài khoản. ${messageOf(caught, '')}`.trim());
      }

      const destination = loginDestination(profile);
      if (destination === 'activate') {
        throw mutationError || new Error('Access code chưa được máy chủ chấp nhận. Vui lòng kiểm tra lại.');
      }

      setActivateSuccess('Tài khoản đã được kích hoạt! Đang chuyển tiếp…');
      keepLockedForRedirect = true;
      redirectTimer.current = setTimeout(() => window.location.replace(destination), 450);
    } catch (caught) {
      setActivateError(messageOf(caught, 'Kích hoạt thất bại.'));
    } finally {
      if (!keepLockedForRedirect) {
        activateInFlight.current = false;
        setActivateBusy(false);
      }
    }
  }

  // BL-13: the activation dialog has no other exit, so a learner signed in
  // with the wrong Google account was stuck. Same order as the chrome logout
  // (U-07): remember the session, revoke, then purge whatever the outcome.
  async function signOutFromActivation() {
    if (signOutInFlight.current || activateInFlight.current) return;
    signOutInFlight.current = true;
    setSigningOut(true);
    const client = clientRef.current || await sharedClient().catch(() => null);
    if (client) {
      await rememberSignedOutSession(client);
      try {
        const result = await client.auth.signOut();
        if (result && result.error) {
          (window as any).aver?.reportError?.(
            'signOut revoke failed: ' + (result.error.message || String(result.error)),
            { type: 'auth_signout_revoke_failed' },
          );
        }
      } catch { /* purged below */ }
    }
    clearPersistedAuthSession();
    try { window.api?.clearAuthCache?.(); } catch { /* best effort */ }
    setActivationOpen(false);
    setAccessCode('');
    setActivateError('');
    setActivateSuccess('');
    setError('');
    setBusyMessage('');
    signOutInFlight.current = false;
    setSigningOut(false);
  }

  return (
    <>
      {!busyMessage && (
        <button className="lx-action-google" type="button" onClick={signInWithGoogle}>
          {googleIcon}
          Đăng nhập bằng Google
        </button>
      )}

      {busyMessage && (
        <div className="lx-loading" role="status" aria-live="polite">
          <div className="lx-loading-dots" aria-hidden="true"><span /><span /><span /></div>
          <p>{busyMessage}</p>
        </div>
      )}

      {error && <p className="lx-error" role="alert">{error}</p>}

      <div className="lx-access-hint">
        <svg className="lx-access-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
        <span>Nhập <strong>access code</strong> từ lớp/trung tâm để mở các bài luyện được cấp quyền</span>
      </div>

      <p className="lx-fine-print">Quyền học phụ thuộc vào mã kích hoạt được cấp cho tài khoản.<br />Chưa có mã kích hoạt? Liên hệ lớp học hoặc trung tâm của bạn.</p>

      {activationOpen && (
        <div className="lx-dialog-backdrop" role="presentation">
          <section
            className="lx-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="activate-title"
            aria-describedby="activate-description"
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return;
              const controls = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)'),
              );
              const first = controls[0];
              const last = controls[controls.length - 1];
              if (!first || !last) return;
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
          >
            <div className="lx-dialog-header">
              <div className="lx-dialog-icon" aria-hidden="true">🔑</div>
              <div>
                <h2 className="lx-dialog-title" id="activate-title">Kích hoạt tài khoản</h2>
                <p className="lx-dialog-desc" id="activate-description">Nhập mã để bắt đầu luyện tập</p>
              </div>
            </div>
            <label className="lx-code-label" htmlFor="access-code-input">Access Code</label>
            <input
              autoFocus
              id="access-code-input"
              className="lx-code-input"
              type="text"
              placeholder="VD: IELTS-TEST-001"
              autoComplete="off"
              value={accessCode}
              disabled={activateBusy || signingOut}
              onChange={(event) => setAccessCode(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !activateInFlight.current) void activate();
              }}
            />
            <button
              className="lx-action-activate"
              type="button"
              onClick={() => { if (!activateInFlight.current) void activate(); }}
              disabled={activateBusy || signingOut}
            >
              {activateBusy ? 'Đang kích hoạt…' : 'Kích hoạt'}
            </button>
            {activateError && <p className="lx-activate-error" role="alert">{activateError}</p>}
            {activateSuccess && <p className="lx-activate-success" role="status">{activateSuccess}</p>}
            <p className="lx-dialog-hint">Chưa có mã? <span>Liên hệ giáo viên để nhận access code</span></p>
            <button
              className="lx-dialog-signout"
              type="button"
              onClick={() => void signOutFromActivation()}
              disabled={activateBusy || signingOut}
            >
              {signingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}
            </button>
          </section>
        </div>
      )}
    </>
  );
}

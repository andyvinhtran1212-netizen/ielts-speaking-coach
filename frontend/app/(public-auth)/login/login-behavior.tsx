'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { loginDestination, normalizeAccessCode, normalizeLoginProfile } from '@/lib/login-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Session = { access_token?: string };
type SupabaseClient = {
  auth: {
    getSession(): Promise<{ data?: { session?: Session | null }; error?: { message?: string } | null }>;
    signInWithOAuth(input: unknown): Promise<{ error?: { message?: string } | null }>;
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
  const profile = normalizeLoginProfile(payload) as LoginProfile | null;
  if (!profile) throw new Error('Trạng thái tài khoản trả về không đúng định dạng.');
  return profile;
}

function hasAuthCallbackMaterial() {
  const query = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const errorKeys = ['error', 'error_code', 'error_description'];
  return query.has('code')
    || errorKeys.some((key) => query.has(key))
    || ['access_token', 'refresh_token', 'expires_in', 'token_type', ...errorKeys]
      .some((key) => fragment.has(key));
}

async function bootstrap(): Promise<BootResult> {
  const client = await sharedClient();
  const callback = hasAuthCallbackMaterial();
  // Supabase must inspect the implicit fragment first, but callback material
  // must leave the address bar before an exchange can stall or reject.
  let sessionRead: ReturnType<SupabaseClient['auth']['getSession']>;
  try {
    sessionRead = client.auth.getSession();
  } finally {
    if (callback) window.history.replaceState(null, '', '/login');
  }
  const { data, error } = await sessionRead;
  const session = data?.session;
  if (error || (callback && !session?.access_token)) {
    throw new Error('Đăng nhập thất bại. Vui lòng thử lại.');
  }
  if (!session?.access_token) return { kind: 'signed-out', client };
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
  const clientRef = useRef<SupabaseClient | null>(null);
  const activateInFlight = useRef(false);
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
    void bootPromise.then((result) => {
      if (disposed) return;
      clientRef.current = result.client;
      if (result.kind === 'signed-out') setBusyMessage('');
      else applyProfile(result.profile);
    }).catch((caught) => {
      if (disposed) return;
      setBusyMessage('');
      setError(messageOf(caught, 'Không thể khởi tạo đăng nhập. Vui lòng thử lại.'));
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
        <span>Nhập <strong>access code</strong> từ lớp/trung tâm để mở toàn bộ 6 kỹ năng</span>
      </div>

      <p className="lx-fine-print">Bằng cách đăng nhập, bạn đồng ý với Điều khoản sử dụng.<br />Chưa có access code? Liên hệ lớp học hoặc trung tâm của bạn.</p>

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
              disabled={activateBusy}
              onChange={(event) => setAccessCode(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !activateInFlight.current) void activate();
              }}
            />
            <button
              className="lx-action-activate"
              type="button"
              onClick={() => { if (!activateInFlight.current) void activate(); }}
              disabled={activateBusy}
            >
              {activateBusy ? 'Đang kích hoạt…' : 'Kích hoạt'}
            </button>
            {activateError && <p className="lx-activate-error" role="alert">{activateError}</p>}
            {activateSuccess && <p className="lx-activate-success" role="status">{activateSuccess}</p>}
            <p className="lx-dialog-hint">Chưa có mã? <span>Liên hệ giáo viên để nhận access code</span></p>
          </section>
        </div>
      )}
    </>
  );
}

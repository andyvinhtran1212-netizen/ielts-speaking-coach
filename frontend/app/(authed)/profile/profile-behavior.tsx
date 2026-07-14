'use client';

// ProfileBehavior — Client Component port of the pages/profile.html inline
// IIFE (helpers ported verbatim: fmtDate, showToast, renderBandBtns, setLevel,
// renderProfile). Auth gating goes through useAuth() (ADR-011 state machine)
// instead of the legacy raw getSession() check.
//
// PILOT 4 — the mutation is live (plan Phase 2 pilot #4): saveProfile() is
// the legacy PATCH /auth/profile port, hardened per the mutation-pilot entry
// checklist: double-submit lock, timeout-after-commit → canonical reconcile
// GET (repo rule: refetch canonical state after mutations — no optimistic
// divergence), 401 (api.js redirect) / 503 kill-switch (require_flag
// "profile_update", ADR-010) surfaced verbatim, and an account-switch guard
// so a stale reconcile can never render over a newer user.
import { useEffect, useRef } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';

// api.js is deferred; effects can run before it. Same readiness pattern the
// AuthProvider uses for the supabase client.
const API_READY_TIMEOUT_MS = 10_000;

function waitForApi(): Promise<any | null> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const tick = () => {
      const api = (window as any).api;
      if (api && typeof api.get === 'function') return resolve(api);
      if (performance.now() - startedAt > API_READY_TIMEOUT_MS) return resolve(null);
      setTimeout(tick, 50);
    };
    tick();
  });
}

export function ProfileBehavior() {
  const { status, user } = useAuth();
  // Which user id the DOM currently renders — cross-tab account switch A→B
  // keeps status 'signed-in' (only `user` changes), so render state must be
  // keyed by id, never by a one-shot "inited" flag (review #742).
  const renderedForRef = useRef<string | null>(null);
  // Double-submit lock: the disabled attribute alone is DOM-mutable state;
  // the ref is the authoritative in-flight latch.
  const savingRef = useRef(false);

  // Fail-closed gate (ADR-011): signed-out — including refresh failure, chrome
  // sign-out and bfcache-restored-after-logout — leaves via replace() so Back
  // cannot restore the private page from history (legacy parity target:
  // profile.html redirects to login when there is no session).
  useEffect(() => {
    if (status === 'signed-out') {
      window.location.replace('/login.html');
    }
  }, [status]);

  // ── Listeners (attach while signed-in; paired cleanup keeps StrictMode
  //    re-runs and account switches idempotent) ───────────────────────
  useEffect(() => {
    if (status !== 'signed-in') return;

    const cleanups: Array<() => void> = [];

    // ── Static listeners (legacy IIFE top level) ─────────────────────
    document.querySelectorAll('#level-options .level-card').forEach((el) => {
      const onClick = () => setLevel((el as HTMLElement).dataset.level || '');
      el.addEventListener('click', onClick);
      cleanups.push(() => el.removeEventListener('click', onClick));
    });

    const slider = document.getElementById('inp-weekly-goal') as HTMLInputElement | null;
    const goalDisplay = document.getElementById('goal-display');
    if (slider && goalDisplay) {
      const onInput = () => {
        goalDisplay.textContent = slider.value;
      };
      slider.addEventListener('input', onInput);
      cleanups.push(() => slider.removeEventListener('input', onInput));
    }

    // Legacy <form onsubmit="return false;"> — keep Enter from navigating.
    const form = document.getElementById('profile-form');
    if (form) {
      const onSubmit = (e: Event) => e.preventDefault();
      form.addEventListener('submit', onSubmit);
      cleanups.push(() => form.removeEventListener('submit', onSubmit));
    }

    // ── Save (legacy saveProfile(), pilot-4 hardened) ─────────────────
    const saveBtn = document.getElementById('btn-save') as HTMLButtonElement | null;
    if (saveBtn) {
      const onClick = async () => {
        if (savingRef.current) return; // double-submit lock
        // Not-yet-loaded guard (review #743): before the canonical GET has
        // rendered — slow first load, or the blanked window right after an
        // account switch — the form holds SHELL DEFAULTS (weekly_goal 5,
        // empty name). Saving would overwrite the user's real profile with
        // placeholders. renderedForRef is null exactly in those windows.
        if (!renderedForRef.current) {
          showToast('Hồ sơ chưa tải xong — vui lòng đợi giây lát.', true);
          return;
        }
        savingRef.current = true;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Đang lưu…';

        // Payload gathering — verbatim legacy: strip nulls so PATCH only
        // updates provided fields.
        const selectedLevel = document.querySelector(
          '#level-options input[type=radio]:checked',
        ) as HTMLInputElement | null;
        const nameInput = document.getElementById('inp-display-name') as HTMLInputElement | null;
        const dateInput = document.getElementById('inp-exam-date') as HTMLInputElement | null;
        const goalInput = document.getElementById('inp-weekly-goal') as HTMLInputElement | null;
        const payload: Record<string, unknown> = {
          display_name: nameInput?.value.trim() || null,
          target_band: _selectedBand,
          exam_date: dateInput?.value || null,
          self_level: selectedLevel ? selectedLevel.value : null,
          weekly_goal: parseInt(goalInput?.value || '5', 10),
        };
        Object.keys(payload).forEach((k) => {
          if (payload[k] === null) delete payload[k];
        });

        // Canonical reconcile (repo rule + checklist "canonical reload"):
        // ALWAYS refetch the full profile after the mutation attempt — the
        // PATCH response has no stats, and on an ambiguous outcome (network
        // died after the server may have committed) the GET is the only
        // truth. Account-switch guard: render only if the DOM still belongs
        // to the same user this save started for.
        const startedFor = renderedForRef.current;
        const reconcile = async (api: any) => {
          const fresh = await api.get('/auth/profile');
          if (fresh && fresh.id && fresh.id === renderedForRef.current && renderedForRef.current === startedFor) {
            renderProfile(fresh);
          }
          return fresh;
        };

        try {
          const api = (window as any).api;
          const saved = await api.patch('/auth/profile', payload);
          if (saved === null) return; // 401 — api.js redirect to login in flight
          await reconcile(api).catch(() => {});
          showToast('✓ Đã lưu thành công');
        } catch (err: any) {
          if (err && err.status === undefined) {
            // Timeout-after-commit ambiguity: no HTTP status means the
            // request died in transit — the server MAY have committed.
            // Reconcile with the canonical GET and say exactly that.
            await reconcile((window as any).api).catch(() => {});
            showToast('Mạng gián đoạn — đã tải lại dữ liệu mới nhất từ máy chủ. Kiểm tra rồi lưu lại nếu cần.', true);
          } else {
            // 400 validation / 403 / 503 kill switch: api.js already coerces
            // detail.message (vd. "Tính năng này đang tạm khóa…") into
            // err.message — legacy toast format shows it verbatim.
            showToast('Lỗi: ' + (err?.message || err), true);
          }
        } finally {
          savingRef.current = false;
          saveBtn.disabled = false;
          saveBtn.textContent = 'Lưu thay đổi';
        }
      };
      saveBtn.addEventListener('click', onClick);
      cleanups.push(() => saveBtn.removeEventListener('click', onClick));
    }

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, [status]);

  // ── Data (legacy init(), auth already proven by the provider) ────────
  // Keyed by the signed-in user id: a same-status account switch (cross-tab
  // sign-in of another user overwrites the shared storage without an
  // intervening SIGNED_OUT) must blank A's data and refetch as B — never
  // keep rendering A's email/stats under B's session (ADR-011, review #742).
  useEffect(() => {
    if (status !== 'signed-in' || !user) return;
    let disposed = false;

    if (renderedForRef.current && renderedForRef.current !== user.id) {
      resetProfileDom(); // account switch: stale private data goes FIRST
      // The DOM now renders NO user — saving in this window would PATCH the
      // blanked shell defaults into the NEW user's profile (review #743).
      renderedForRef.current = null;
    }

    // Save is armed only once a canonical profile is on screen: the shell
    // (and the post-switch blank) hold placeholder defaults that must never
    // be committable. renderProfile → the data effect re-enables below.
    const saveBtn = document.getElementById('btn-save') as HTMLButtonElement | null;
    if (saveBtn && !renderedForRef.current) saveBtn.disabled = true;

    (async () => {
      const api = await waitForApi();
      if (disposed) return;
      if (!api) {
        showToast('Không thể tải hồ sơ: API chưa sẵn sàng', true);
        return;
      }
      try {
        const profile = await api.get('/auth/profile');
        if (disposed) return;
        if (profile) {
          renderProfile(profile); // null = api.js 401 redirect in flight
          renderedForRef.current = user.id;
          if (saveBtn && !savingRef.current) saveBtn.disabled = false;
        }
      } catch (err: any) {
        console.error('Could not load profile:', err?.message);
        // Fallback: try /auth/me (verbatim legacy fallback shape)
        try {
          const me = await api.get('/auth/me');
          if (disposed) return;
          if (me) {
            renderProfile(Object.assign({ stats: {} }, me));
            renderedForRef.current = user.id;
            if (saveBtn && !savingRef.current) saveBtn.disabled = false;
          }
        } catch (e2: any) {
          if (!disposed) showToast('Không thể tải hồ sơ: ' + (e2?.message || e2), true);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [status, user?.id]);

  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Helper functions (verbatim from the pages/profile.html inline script)
// ──────────────────────────────────────────────────────────────────────

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString('vi-VN', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return String(s);
  }
}

function showToast(msg?: string, isError?: boolean) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg || '✓ Đã lưu thành công';
  t.classList.toggle('pf-toast--error', !!isError);
  t.classList.add('show');
  setTimeout(() => {
    t.classList.remove('show');
  }, 2800);
}

// ── Band buttons ─────────────────────────────────────────────────────
const BANDS = [4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0];
let _selectedBand: number | null = null;

function renderBandBtns(current: number | null) {
  const wrap = document.getElementById('band-btns');
  if (!wrap) return;
  wrap.innerHTML = '';
  BANDS.forEach((b) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'band-btn' + (b === current ? ' active' : '');
    btn.textContent = b.toFixed(1);
    btn.onclick = () => {
      _selectedBand = b;
      wrap.querySelectorAll('.band-btn').forEach((el) => el.classList.remove('active'));
      btn.classList.add('active');
    };
    wrap.appendChild(btn);
  });
  _selectedBand = current;
}

// ── Level cards ──────────────────────────────────────────────────────
function setLevel(val: string) {
  document.querySelectorAll('#level-options .level-card').forEach((el) => {
    const isMatch = (el as HTMLElement).dataset.level === val;
    el.classList.toggle('active', isMatch);
    const radio = el.querySelector('input[type=radio]') as HTMLInputElement | null;
    if (radio) radio.checked = isMatch;
  });
}

// ── Reset to the shell's placeholder state (account switch, review #742):
//    undoes everything renderProfile() touches before the next user's fetch.
function resetProfileDom() {
  const set = (id: string, text: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set('profile-initials', '—');
  set('profile-display-name', '—');
  set('profile-email', '—');
  set('profile-joined', '—');
  set('stat-sessions', '—');
  set('stat-avg-band', '—');
  set('stat-weekly', '—');

  document.getElementById('profile-initials')?.classList.remove('hidden');
  const img = document.getElementById('profile-avatar-img') as HTMLImageElement | null;
  if (img) {
    img.removeAttribute('src');
    img.classList.add('hidden');
  }

  const chrome = document.querySelector('aver-chrome') as any;
  if (chrome && typeof chrome.setUser === 'function') {
    chrome.setUser({ name: '—', initials: '—' });
  }

  const setVal = (id: string, v: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = v;
  };
  setVal('inp-display-name', '');
  setVal('inp-email', '');
  setVal('inp-exam-date', '');

  const wrap = document.getElementById('band-btns');
  if (wrap) wrap.innerHTML = '';
  _selectedBand = null;
  setLevel('');

  setVal('inp-weekly-goal', '5');
  const goalDisplay = document.getElementById('goal-display');
  if (goalDisplay) goalDisplay.textContent = '5';
}

// ── Render profile data ──────────────────────────────────────────────
function renderProfile(p: any) {
  const displayName = p.display_name || (p.email ? p.email.split('@')[0] : '—');
  const initials = displayName
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  // Sprint 7.13: chrome pill lives in the <aver-chrome> shadow root — delegate
  // via the typed setUser() API.
  const chrome = document.querySelector('aver-chrome') as any;
  if (chrome && typeof chrome.setUser === 'function') {
    chrome.setUser({ name: displayName, initials });
  }

  // Identity card
  const set = (id: string, text: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set('profile-initials', initials);
  set('profile-display-name', displayName);
  set('profile-email', p.email || '—');
  set('profile-joined', fmtDate(p.joined_at));

  if (p.avatar_url) {
    const img = document.getElementById('profile-avatar-img') as HTMLImageElement | null;
    if (img) {
      img.src = p.avatar_url;
      img.classList.remove('hidden');
    }
    document.getElementById('profile-initials')?.classList.add('hidden');
  }

  // Stats
  const stats = p.stats || {};
  set('stat-sessions', stats.total_sessions != null ? String(stats.total_sessions) : '—');
  set('stat-avg-band', stats.avg_band != null ? stats.avg_band.toFixed(1) : '—');
  set('stat-weekly', (p.weekly_goal || 5) + '/tuần');

  // Form fields
  const setVal = (id: string, v: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = v;
  };
  setVal('inp-display-name', p.display_name || '');
  setVal('inp-email', p.email || '');
  setVal('inp-exam-date', p.exam_date || '');

  renderBandBtns(p.target_band ? parseFloat(p.target_band) : null);
  if (p.self_level) setLevel(p.self_level);

  const goal = p.weekly_goal || 5;
  const slider = document.getElementById('inp-weekly-goal') as HTMLInputElement | null;
  const goalDisplay = document.getElementById('goal-display');
  if (slider) slider.value = String(goal);
  if (goalDisplay) goalDisplay.textContent = String(goal);
}

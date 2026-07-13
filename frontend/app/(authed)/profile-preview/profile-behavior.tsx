'use client';

// ProfileBehavior — Client Component port of the pages/profile.html inline
// IIFE (helpers ported verbatim: fmtDate, showToast, renderBandBtns, setLevel,
// renderProfile). Auth gating goes through useAuth() (ADR-011 state machine)
// instead of the legacy raw getSession() check.
//
// PILOT 3 BOUNDARY — authenticated READ only (plan Phase 2 pilot #3): the
// legacy saveProfile() PATCH /auth/profile mutation is pilot #4 scope (first
// require_flag wiring + double-submit/timeout-after-commit hardening). The
// Save button renders for visual parity but explains itself instead of
// mutating.
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
  const { status } = useAuth();
  const hasInitedRef = useRef(false);

  // Fail-closed gate (ADR-011): signed-out — including refresh failure, chrome
  // sign-out and bfcache-restored-after-logout — leaves via replace() so Back
  // cannot restore the private page from history (legacy parity target:
  // profile.html redirects to login when there is no session).
  useEffect(() => {
    if (status === 'signed-out') {
      window.location.replace('/login.html');
    }
  }, [status]);

  useEffect(() => {
    if (status !== 'signed-in') return;
    if (hasInitedRef.current) return;
    hasInitedRef.current = true;

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

    // Pilot-3 read-only boundary: legacy onclick="saveProfile()" is NOT wired.
    const saveBtn = document.getElementById('btn-save');
    if (saveBtn) {
      const onClick = () => {
        showToast('Bản xem trước chỉ đọc — lưu thay đổi tại trang Hồ sơ hiện tại.', true);
      };
      saveBtn.addEventListener('click', onClick);
      cleanups.push(() => saveBtn.removeEventListener('click', onClick));
    }

    // ── Init (legacy init(), auth already proven by the provider) ───
    (async () => {
      const api = await waitForApi();
      if (!api) {
        showToast('Không thể tải hồ sơ: API chưa sẵn sàng', true);
        return;
      }
      try {
        const profile = await api.get('/auth/profile');
        if (profile) renderProfile(profile); // null = api.js 401 redirect in flight
      } catch (err: any) {
        console.error('Could not load profile:', err?.message);
        // Fallback: try /auth/me (verbatim legacy fallback shape)
        try {
          const me = await api.get('/auth/me');
          if (me) renderProfile(Object.assign({ stats: {} }, me));
        } catch (e2: any) {
          showToast('Không thể tải hồ sơ: ' + (e2?.message || e2), true);
        }
      }
    })();

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, [status]);

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

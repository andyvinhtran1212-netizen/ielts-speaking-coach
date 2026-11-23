'use client';

// The new Hồ sơ tree (LEARNERCORE-0063 FR-063, FR-064, FR-088, FR-090), drawn
// only when `learnerV2Enabled(me)`; the legacy tree is untouched otherwise.
//
// - "Thông tin cá nhân": display name and weekly goal ("buổi mỗi tuần", not
//   "SESSIONS/TUẦN"), saved through `PATCH /auth/profile`, then the profile is
//   read again (canonical reconcile, like the legacy page). The
//   `profile_update` kill switch (503 `feature_disabled`) makes the fields
//   read-only with a sentence. Band and exam date live on Tiến độ (FR-061).
// - "Email đăng nhập": the current email. G05-T24's `ChangeEmail` is not merged
//   yet, so there is no "Đổi email đăng nhập" button (FR-088).
// - "Phiên đăng nhập": how this account signs in (never a password) and
//   G04-T16's recent sign-ins (`LoginEventsBlock`, hidden when absent). G05-T20's
//   "Đăng xuất khỏi mọi thiết bị" is not merged, so there is no button (FR-064).
// - "Lưu trữ": recordings are kept at most 60 days, then deleted. No consent
//   switch and no consent request (FR-063).
//
// The av2 tokens are imported here, scoped by `.av2-root`, because /profile
// stays in the legacy `(authed)` layout while the old tree lives (FR-090).
import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { PageState } from '@/components/ui/page-state';
import { Select } from '@/components/ui/select';
import { TextField } from '@/components/ui/text-field';
import { liveHref } from '@/components/ui/shell/learner-sections';
import { LearnerFrame } from '@/components/learner/learner-frame';
import { getCurrentProfile, type AuthProfileWire } from '@/lib/auth-api';
import { patchBrowserJsonAt } from '@/lib/browser-api';
import { WEEKLY_GOALS, signInMethodLine } from '@/lib/profile-v2-model.mjs';
import { isFeatureDisabled } from '@/lib/progress-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';
import { av2FontClass } from '@/styles/av2/fonts';

import { LoginEventsBlock } from './login-events-block';
import styles from './profile-v2.module.css';

type Phase = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; profile: AuthProfileWire };

const PROGRESS = liveHref({ href: '/progress', today: null });
const GOAL_OPTIONS = WEEKLY_GOALS.map((n) => ({ value: String(n), label: `${n} buổi mỗi tuần` }));

async function readSignInMethod(): Promise<string | null> {
  try {
    const sb = (window as any).getSupabase?.();
    const { data } = (await sb?.auth?.getSession?.()) ?? {};
    return signInMethodLine(data?.session?.user ?? null);
  } catch {
    return null;
  }
}

function ProfileForm({ profile, onSaved }: { profile: AuthProfileWire; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(profile.display_name ?? '');
  const [goal, setGoal] = useState(String(profile.weekly_goal || 5));
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [note, setNote] = useState<'saved' | 'error' | null>(null);

  const save = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    const body: Record<string, unknown> = { weekly_goal: Number(goal) };
    if (name.trim()) body.display_name = name.trim();
    try {
      await patchBrowserJsonAt('/auth/profile', '/auth/profile', body);
      await onSaved();
      setNote('saved');
    } catch (error) {
      if (isFeatureDisabled(error)) setLocked(true);
      else setNote('error');
    } finally {
      setBusy(false);
    }
  }, [busy, goal, name, onSaved]);

  const lockedReason = locked ? 'Tạm khoá sửa hồ sơ để bảo trì.' : undefined;
  return (
    <>
      <div className={styles.fields}>
        {locked ? (
          <dl className={styles.view}>
            <div><dt>Tên hiển thị</dt><dd>{profile.display_name || 'Chưa đặt'}</dd></div>
            <div><dt>Mục tiêu luyện tập</dt><dd>{profile.weekly_goal || 5} buổi mỗi tuần</dd></div>
          </dl>
        ) : (
          <>
            <TextField label="Tên hiển thị" value={name} maxLength={60} onChange={(v) => { setName(v); setNote(null); }} readOnlyReason={lockedReason} />
            <Select label="Mục tiêu luyện tập" options={GOAL_OPTIONS} value={goal} onChange={(v) => { setGoal(v); setNote(null); }} />
          </>
        )}
      </div>
      {locked ? (
        <Notice kind="info" live="status" className={styles.notice}>
          Tạm khoá sửa hồ sơ để bảo trì. Bạn vẫn xem được thông tin đã lưu.
        </Notice>
      ) : (
        <>
          {note === 'error' ? <Notice kind="error" live="alert" className={styles.notice}>Chưa lưu được. Thử lại.</Notice> : null}
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => void save()} loading={busy} loadingLabel="Đang lưu…">Lưu thay đổi</Button>
            <p role="status" className={styles.muted}>{note === 'saved' ? 'Đã lưu.' : ''}</p>
          </div>
        </>
      )}
    </>
  );
}

export default function ProfileV2({ accountId }: { accountId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [method, setMethod] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const profile = await getCurrentProfile(signal);
    if (!signal?.aborted) setPhase({ kind: 'ready', profile });
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    (async () => {
      const ok = await whenGlobalReady(() => typeof window.api?.getWith === 'function', 'window.api (profile v2)');
      if (abort.signal.aborted) return;
      if (!ok) { setPhase({ kind: 'error' }); return; }
      try {
        await load(abort.signal);
      } catch {
        if (!abort.signal.aborted) setPhase({ kind: 'error' });
      }
      const line = await readSignInMethod();
      if (!abort.signal.aborted) setMethod(line);
    })();
    return () => abort.abort();
  }, [accountId, load]);

  return (
    <div className={`av2-root av2-body ${av2FontClass} ${styles.root}`}>
      <LearnerFrame>
        <div className={styles.page}>
          <header className={styles.header}>
            <p className={styles.eyebrow}>Hồ sơ</p>
            <h1 className={styles.title}>
              {phase.kind === 'ready' ? phase.profile.display_name || phase.profile.email || 'Hồ sơ của bạn' : 'Hồ sơ của bạn'}
            </h1>
          </header>

          {phase.kind === 'loading' ? <PageState kind="loading" title="Đang tải hồ sơ…" /> : null}
          {phase.kind === 'error' ? (
            <PageState
              kind="error"
              title="Chưa tải được hồ sơ"
              body="Kết nối có thể đang chập chờn."
              action={<Button variant="secondary" onClick={() => window.location.reload()}>Tải lại</Button>}
            />
          ) : null}

          {phase.kind === 'ready' ? (
            <>
              <section className={styles.section} aria-labelledby="ho-so-thong-tin">
                <h2 id="ho-so-thong-tin" className={styles.sectionTitle}>Thông tin cá nhân</h2>
                <ProfileForm key={phase.profile.id} profile={phase.profile} onSaved={() => load()} />
                {PROGRESS ? (
                  <p className={styles.hint}>
                    Band muốn đạt và ngày thi sửa ở <a href={PROGRESS} className={styles.link}>Tiến độ</a>.
                  </p>
                ) : null}
              </section>

              <section className={styles.section} aria-labelledby="ho-so-email">
                <h2 id="ho-so-email" className={styles.sectionTitle}>Email đăng nhập</h2>
                <p className={styles.value}>{phase.profile.email || 'Chưa có email'}</p>
              </section>

              <section className={styles.section} aria-labelledby="ho-so-phien">
                <h2 id="ho-so-phien" className={styles.sectionTitle}>Phiên đăng nhập</h2>
                {method ? (
                  <dl className={styles.view}>
                    <div><dt>Cách đăng nhập đang dùng</dt><dd>{method}. Không dùng mật khẩu.</dd></div>
                  </dl>
                ) : null}
                <LoginEventsBlock />
              </section>

              <section className={styles.section} aria-labelledby="ho-so-luu-tru">
                <h2 id="ho-so-luu-tru" className={styles.sectionTitle}>Lưu trữ</h2>
                <p className={styles.muted}>Bản ghi âm bài nói được giữ tối đa 60 ngày rồi xoá.</p>
              </section>
            </>
          ) : null}
        </div>
      </LearnerFrame>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import {
  buildOnboardingPayload,
  normalizeOnboardingProfile,
  onboardingDestination,
  validateOnboardingStep,
} from '@/lib/onboarding-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Draft = {
  targetBand: string;
  examDate: string;
  selfLevel: string;
  topic: string;
};

type CanonicalProfile = {
  id: string;
  isActive: boolean;
  onboardingCompleted: boolean;
};

const EMPTY_DRAFT: Draft = { targetBand: '', examDate: '', selfLevel: '', topic: '' };

const levels = [
  ['beginner', '🌱', 'Mới bắt đầu', 'Chưa quen với IELTS Speaking, cần câu hỏi đơn giản và gợi ý nhiều'],
  ['intermediate', '📚', 'Trung cấp (Band 5–6)', 'Có thể giao tiếp cơ bản, đang hướng tới band 6.0–6.5'],
  ['upper_intermediate', '🚀', 'Trên trung cấp (Band 6–7)', 'Giao tiếp tốt, muốn nâng cao từ vựng và cấu trúc câu phức tạp hơn'],
  ['advanced', '🏆', 'Nâng cao (Band 7+)', 'Sử dụng tiếng Anh thành thạo, cần câu hỏi chuyên sâu và phản hồi tinh tế'],
] as const;

const topics = [
  ['work', '💼', 'Công việc & Nghề nghiệp', 'Kế hoạch career, môi trường làm việc, kỹ năng nghề nghiệp — phù hợp với hầu hết thí sinh IELTS'],
  ['technology', '💻', 'Công nghệ & Xã hội số', 'AI, mạng xã hội, tác động của công nghệ — chủ đề xuất hiện nhiều trong đề thi gần đây'],
  ['education', '🎓', 'Giáo dục & Học tập', 'Hệ thống giáo dục, phương pháp học, du học — quen thuộc và dễ triển khai ý tưởng'],
] as const;

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function readCanonicalProfile(expectedAccount: string) {
  const ready = await whenGlobalReady(() => Boolean(window.api?.get), 'window.api (onboarding)');
  if (!ready) throw new Error('Không thể kết nối tới máy chủ. Vui lòng tải lại trang.');
  const raw = await window.api.get<unknown>('/auth/me');
  const profile = normalizeOnboardingProfile(raw) as CanonicalProfile | null;
  if (!profile || profile.id !== expectedAccount) {
    throw new Error('Trạng thái tài khoản trả về không đúng định dạng.');
  }
  return profile;
}

function CheckIcon() {
  return (
    <svg className="check-icon w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function OnboardingBehavior() {
  const { status, user } = useAuth();
  const [bootState, setBootState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [readyAccount, setReadyAccount] = useState<string | null>(null);
  const [bootError, setBootError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [step, setStep] = useState(1);
  const [backward, setBackward] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const requestRef = useRef(0);
  const accountRef = useRef<string | null>(null);
  const submitRef = useRef<{ account: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (status === 'signed-out') {
      window.location.replace('/login');
      return;
    }
    if (status !== 'signed-in' || !user?.id) return;

    const account = user.id;
    const request = ++requestRef.current;
    accountRef.current = account;
    submitRef.current = null;
    setBootState('loading');
    setReadyAccount(null);
    setBootError('');
    setStep(1);
    setBackward(false);
    setDraft(EMPTY_DRAFT);
    setError('');
    setSuccess('');
    setSubmitting(false);

    void readCanonicalProfile(account).then((profile) => {
      if (requestRef.current !== request || accountRef.current !== account) return;
      const destination = onboardingDestination(profile);
      if (destination) {
        window.location.replace(destination);
        return;
      }
      setReadyAccount(account);
      setBootState('ready');
    }).catch((caught) => {
      if (requestRef.current !== request || accountRef.current !== account) return;
      setReadyAccount(account);
      setBootState('error');
      setBootError(messageOf(caught, 'Không thể kiểm tra trạng thái tài khoản.'));
    });
  }, [retryKey, status, user?.id]);

  useEffect(() => {
    if (bootState === 'ready') headingRef.current?.focus();
  }, [bootState, step]);

  const patchDraft = useCallback((value: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...value }));
    setError('');
  }, []);

  function goNext() {
    const validation = validateOnboardingStep(step, draft);
    if (!validation.ok) {
      setError(validation.error || 'Thông tin ở bước này chưa hợp lệ.');
      return;
    }
    if (step < 3) {
      setBackward(false);
      setStep((current) => current + 1);
      setError('');
      return;
    }
    void submit();
  }

  function goBack() {
    if (step <= 1 || submitting) return;
    setBackward(true);
    setStep((current) => current - 1);
    setError('');
  }

  async function submit() {
    if (submitRef.current || submitting || status !== 'signed-in' || !user?.id) return;
    const built = buildOnboardingPayload(draft);
    if (!('payload' in built)) {
      setStep('step' in built && typeof built.step === 'number' ? built.step : 1);
      setError('error' in built && built.error ? built.error : 'Thông tin thiết lập chưa hợp lệ.');
      return;
    }

    const account = user.id;
    submitRef.current = { account };
    setSubmitting(true);
    setError('');
    setSuccess('');
    let keepLockedForRedirect = false;
    let mutationError: Error | null = null;
    try {
      try {
        await window.api.patch('/auth/profile', built.payload);
      } catch (caught) {
        mutationError = new Error(messageOf(caught, 'Không nhận được xác nhận lưu hồ sơ.'));
      }

      let profile: CanonicalProfile;
      try {
        profile = await readCanonicalProfile(account);
      } catch (caught) {
        throw new Error(mutationError
          ? `${mutationError.message} Chưa kiểm tra lại được trạng thái tài khoản; bạn có thể thử lại an toàn.`
          : `Đã gửi hồ sơ nhưng chưa xác nhận được trạng thái lưu. ${messageOf(caught, '')}`.trim());
      }
      if (accountRef.current !== account) return;

      const destination = onboardingDestination(profile);
      if (destination === '/login') {
        window.location.replace('/login');
        return;
      }
      if (destination !== '/home') {
        throw mutationError || new Error('Máy chủ chưa ghi nhận hoàn tất thiết lập. Vui lòng thử lại.');
      }

      setSuccess('Đã lưu hồ sơ. Đang mở trang chủ…');
      keepLockedForRedirect = true;
      window.location.replace(`/home?first_topic=${encodeURIComponent(draft.topic)}`);
    } catch (caught) {
      if (accountRef.current === account) {
        setError(messageOf(caught, 'Không thể lưu thông tin. Vui lòng thử lại.'));
      }
    } finally {
      if (submitRef.current?.account === account && !keepLockedForRedirect) {
        submitRef.current = null;
        if (accountRef.current === account) setSubmitting(false);
      }
    }
  }

  if (status === 'initial-loading'
    || bootState === 'loading'
    || (status === 'signed-in' && readyAccount !== user?.id)) {
    return (
      <main className="ob-gate" aria-busy="true">
        <div className="ob-gate__card" role="status">Đang kiểm tra tài khoản…</div>
      </main>
    );
  }

  if (bootState === 'error') {
    return (
      <main className="ob-gate">
        <section className="ob-gate__card" role="alert">
          <h1>Chưa thể mở phần thiết lập</h1>
          <p>{bootError}</p>
          <button className="btn-primary" type="button" onClick={() => setRetryKey((value) => value + 1)}>
            Thử lại
          </button>
        </section>
      </main>
    );
  }

  const progress = Math.round((step / 3) * 100);
  return (
    <main className="flex-1 flex items-center justify-center px-4 pt-20 pb-12">
      <div className="w-full max-w-lg">
        <section className="ob-card rounded-2xl p-8 sm:p-10" aria-labelledby={`onboarding-step-${step}`}>
          <div className="mb-8">
            <div className="flex justify-between items-center mb-2">
              <span className="ob-step-label text-xs font-semibold uppercase tracking-widest">Bước {step} / 3</span>
              <span className="ob-step-pct text-xs">{progress}%</span>
            </div>
            <div
              className="ob-progress-track h-1.5 rounded-full"
              role="progressbar"
              aria-label="Tiến độ thiết lập tài khoản"
              aria-valuemin={1}
              aria-valuemax={3}
              aria-valuenow={step}
            >
              <div className="ob-progress-fill h-1.5 rounded-full" style={{ width: `${progress}%` }} />
            </div>
          </div>

          {error && <div className="ob-error-banner show mb-4 px-4 py-3 rounded-xl text-sm" role="alert">{error}</div>}
          {success && <div className="ob-success-banner mb-4 px-4 py-3 rounded-xl text-sm" role="status">{success}</div>}

          <div className={`step-panel active${backward ? ' slide-back' : ''}`}>
            {step === 1 && (
              <>
                <p className="eyebrow">Bắt đầu</p>
                <h1 ref={headingRef} tabIndex={-1} id="onboarding-step-1" className="ob-step__title text-2xl font-bold mb-1">Chào mừng đến Aver Learning! 👋</h1>
                <p className="ob-step__subtitle text-sm mb-7">Chúng mình cần biết thêm về bạn để lên lịch luyện tập phù hợp nhất.</p>
                <div className="space-y-5">
                  <div>
                    <label className="ob-field-label block text-xs font-semibold uppercase tracking-wider mb-2" htmlFor="target-band">Mục tiêu band score</label>
                    <select id="target-band" className="form-input" value={draft.targetBand} onChange={(event) => patchDraft({ targetBand: event.target.value })} disabled={submitting}>
                      <option value="">-- Chọn band mục tiêu --</option>
                      {['5.0', '5.5', '6.0', '6.5', '7.0', '7.5', '8.0'].map((band) => <option value={band} key={band}>{band}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="ob-field-label block text-xs font-semibold uppercase tracking-wider mb-2" htmlFor="exam-date">Ngày thi dự kiến <span className="ob-field-label__hint">(tuỳ chọn)</span></label>
                    <input id="exam-date" type="date" className="form-input" value={draft.examDate} onChange={(event) => patchDraft({ examDate: event.target.value })} disabled={submitting} />
                  </div>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h1 ref={headingRef} tabIndex={-1} id="onboarding-step-2" className="ob-step__title text-xl font-bold mb-1">Trình độ hiện tại của bạn? 📊</h1>
                <p className="ob-step__subtitle text-sm mb-6">Chọn mức phù hợp nhất — AI sẽ điều chỉnh câu hỏi theo trình độ của bạn.</p>
                <fieldset className="space-y-3 ob-choice-group" disabled={submitting}>
                  <legend className="ob-visually-hidden">Trình độ hiện tại</legend>
                  {levels.map(([value, icon, title, hint]) => (
                    <label className={`opt-card p-4 flex items-center gap-4${draft.selfLevel === value ? ' selected' : ''}`} key={value}>
                      <input className="ob-choice-input" type="radio" name="self-level" value={value} checked={draft.selfLevel === value} onChange={() => patchDraft({ selfLevel: value })} />
                      <span className="opt-card__icon w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0" aria-hidden="true">{icon}</span>
                      <span className="flex-1"><span className="opt-card__title block font-semibold text-sm">{title}</span><span className="opt-card__hint block text-xs mt-0.5">{hint}</span></span>
                      <CheckIcon />
                    </label>
                  ))}
                </fieldset>
              </>
            )}

            {step === 3 && (
              <>
                <h1 ref={headingRef} tabIndex={-1} id="onboarding-step-3" className="ob-step__title text-xl font-bold mb-1">Chọn chủ đề đầu tiên 🎯</h1>
                <p className="ob-step__subtitle text-sm mb-6">Bạn sẽ luyện với chủ đề này ngay sau khi hoàn tất. Có thể đổi chủ đề bất cứ lúc nào.</p>
                <fieldset className="grid grid-cols-1 gap-3 ob-choice-group" disabled={submitting}>
                  <legend className="ob-visually-hidden">Chủ đề luyện tập đầu tiên</legend>
                  {topics.map(([value, icon, title, hint]) => (
                    <label className={`opt-card p-5 flex items-start gap-4${draft.topic === value ? ' selected' : ''}`} key={value}>
                      <input className="ob-choice-input" type="radio" name="first-topic" value={value} checked={draft.topic === value} onChange={() => patchDraft({ topic: value })} />
                      <span className="opt-card__icon opt-card__icon--lg w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0" aria-hidden="true">{icon}</span>
                      <span className="flex-1"><span className="opt-card__title block font-semibold">{title}</span><span className="opt-card__hint block text-xs mt-1 leading-relaxed">{hint}</span></span>
                      <CheckIcon />
                    </label>
                  ))}
                </fieldset>
              </>
            )}
          </div>

          <div className="mt-8 flex items-center">
            {step > 1 && <button className="btn-back" type="button" onClick={goBack} disabled={submitting}>← Quay lại</button>}
            <div className="flex-1" />
            <button className="btn-primary" type="button" onClick={goNext} disabled={submitting}>
              {submitting ? 'Đang lưu…' : step === 3 ? '🚀 Bắt đầu luyện tập ngay' : 'Tiếp theo →'}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

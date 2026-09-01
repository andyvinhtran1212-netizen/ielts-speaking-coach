'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAuth } from '@/lib/auth/auth-provider';
import {
  INSTRUCTOR_CRITERION_LABELS,
  MIX_CRITERIA,
  assembleInstructorPreview,
  defaultInstructorPicks,
  instructorCompareBackHref,
  instructorComposePayload,
  instructorVersionLabel,
  normalizeInstructorVersions,
} from '@/lib/instructor-compare-model.mjs';
import {
  instructorApiPath,
  normalizeInstructorProfile,
} from '@/lib/instructor-dashboard-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Phase = 'loading' | 'ready' | 'insufficient' | 'denied' | 'error';
type Banner = { tone: 'success' | 'danger' | 'warning'; message: string } | null;
type Picks = Record<string, number>;

const SECTION_LABELS: Record<string, string> = {
  overview: 'Tổng quan',
  criteria: 'Theo tiêu chí',
  mistakes: 'Lỗi',
  'key-takeaways': 'Điểm chính',
  coherence: 'Mạch lạc',
  lexical: 'Từ vựng',
  'idea-development': 'Phát triển ý',
  improved: 'Bài mẫu',
};

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught || 'Lỗi không xác định.');
}

function readCompareQuery(params: URLSearchParams) {
  const essayIds = params.getAll('essay_id');
  const targets = params.getAll('as_instructor');
  if (essayIds.length !== 1 || !essayIds[0]?.trim()) {
    throw new Error(essayIds.length > 1 ? 'URL có nhiều essay_id.' : 'Thiếu essay_id.');
  }
  if (targets.length > 1) throw new Error('URL có nhiều as_instructor. Hãy mở lại workspace từ trang Admin.');
  return { essayId: essayIds[0].trim(), requestedInstructor: targets[0]?.trim() || null };
}

function ChevronLeft() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function Preview({ feedback }: { feedback: any }) {
  const sections = useMemo(() => {
    const renderers = window.WritingRenderers;
    if (!renderers) return [];
    return Object.keys(renderers.SECTION_KEYS).flatMap((sectionKey) => {
      const value = feedback[renderers.SECTION_KEYS[sectionKey]];
      if (value == null
          || (Array.isArray(value) && value.length === 0)
          || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)) return [];
      const renderer = renderers.SECTION_RENDERERS[sectionKey];
      if (!renderer) return [];
      try {
        return [{
          key: sectionKey,
          title: SECTION_LABELS[sectionKey] || sectionKey,
          html: renderer(value),
        }];
      } catch (caught) {
        console.error('[instructor-compare] preview renderer failed', sectionKey, caught);
        return [];
      }
    });
  }, [feedback]);

  if (!sections.length) return <p className="ic-muted">Không có nội dung để xem trước.</p>;
  return (
    <div className="ic-preview-stack">
      {sections.map((section) => (
        <section className="ic-preview-section" key={section.key}>
          <h3>{section.title}</h3>
          <div dangerouslySetInnerHTML={{ __html: section.html }} />
        </section>
      ))}
    </div>
  );
}

export function InstructorCompare() {
  const { status, user } = useAuth();
  const searchParams = useSearchParams();
  const queryKey = searchParams?.toString() || '';
  const [phase, setPhase] = useState<Phase>('loading');
  const [snapshot, setSnapshot] = useState<any>(null);
  const [essayId, setEssayId] = useState('');
  const [asInstructor, setAsInstructor] = useState<string | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [picks, setPicks] = useState<Picks>({});
  const [banner, setBanner] = useState<Banner>(null);
  const [loadError, setLoadError] = useState('');
  const [pending, setPending] = useState(false);
  const [needsReconcile, setNeedsReconcile] = useState(false);
  const sequence = useRef(0);
  const accountKey = status === 'signed-in' && user?.id ? user.id : '';
  const accountRef = useRef(accountKey);
  accountRef.current = accountKey;

  const applySnapshot = (next: any) => {
    const defaults = defaultInstructorPicks(next);
    setSnapshot(next);
    setBaseVersion(next.versions[0]?.version ?? null);
    setPicks(defaults ? { ...defaults } : {});
    setNeedsReconcile(false);
    setPhase(next.versions.length < 2 ? 'insufficient' : 'ready');
  };

  const readCanonical = async (id: string, target: string | null) => {
    const path = instructorApiPath(`/instructor/essays/${encodeURIComponent(id)}/versions`, target);
    const normalized = normalizeInstructorVersions(await window.api.get<unknown>(path));
    if (!normalized) throw new Error('Backend trả dữ liệu phiên bản không đúng định dạng.');
    return normalized;
  };

  useEffect(() => {
    if (status === 'signed-out') {
      window.location.replace('/login');
      return;
    }
    if (status !== 'signed-in' || !user?.id) return;
    const requestId = ++sequence.current;
    setPhase('loading');
    setSnapshot(null);
    setEssayId('');
    setAsInstructor(null);
    setBaseVersion(null);
    setPicks({});
    setBanner(null);
    setLoadError('');
    setPending(false);
    setNeedsReconcile(false);

    (async () => {
      try {
        const ready = await whenGlobalReady(
          () => typeof window.api?.get === 'function' && Boolean(window.WritingRenderers),
          'window.api + WritingRenderers (instructor compare)',
        );
        if (!ready) throw new Error('Không tải được công cụ kết nối. Hãy tải lại trang.');
        const profile = normalizeInstructorProfile(await window.api.get<unknown>('/auth/me'));
        if (!profile) throw new Error('Không xác nhận được vai trò tài khoản.');
        if (requestId !== sequence.current || user.id !== accountRef.current) return;
        if (!['instructor', 'admin'].includes(profile.role)) {
          setPhase('denied');
          return;
        }
        const query = readCompareQuery(new URLSearchParams(queryKey));
        const effective = profile.role === 'admin' ? query.requestedInstructor : null;
        const next = await readCanonical(query.essayId, effective);
        if (requestId !== sequence.current || user.id !== accountRef.current) return;
        setEssayId(query.essayId);
        setAsInstructor(effective);
        applySnapshot(next);
      } catch (caught) {
        if (requestId === sequence.current && user.id === accountRef.current) {
          setLoadError(messageOf(caught));
          setPhase('error');
        }
      }
    })();
    return () => { sequence.current += 1; };
  }, [status, user?.id, queryKey]);

  const preview = useMemo(() => {
    if (!snapshot || baseVersion == null) return null;
    try { return assembleInstructorPreview(snapshot, baseVersion, picks) as any; }
    catch { return null; }
  }, [snapshot, baseVersion, picks]);

  const overall = useMemo(() => {
    if (!preview) return null;
    const value = Number(preview.overallBandScore);
    return Number.isFinite(value) ? value : null;
  }, [preview]);

  const commit = async () => {
    if (pending || needsReconcile || !snapshot?.budget?.canCompose || !essayId || baseVersion == null) return;
    const ownerId = accountRef.current;
    const mutationScope = sequence.current;
    setPending(true);
    setBanner(null);
    const path = instructorApiPath(`/instructor/essays/${encodeURIComponent(essayId)}/compose`, asInstructor);
    try {
      await window.api.post(path, instructorComposePayload(baseVersion, picks));
      if (ownerId !== accountRef.current || mutationScope !== sequence.current) return;
      try {
        const canonical = await readCanonical(essayId, asInstructor);
        if (ownerId !== accountRef.current || mutationScope !== sequence.current) return;
        applySnapshot(canonical);
        setBanner({ tone: 'success', message: 'Đã tạo bản ghép và xác nhận phiên bản hiện hành từ dữ liệu canonical.' });
      } catch {
        setNeedsReconcile(true);
        setBanner({
          tone: 'warning',
          message: 'Yêu cầu tạo bản ghép đã được gửi nhưng chưa xác nhận được trạng thái canonical. Hãy tải lại trước khi thao tác tiếp; hệ thống không tự gửi lại mutation.',
        });
      }
    } catch (caught) {
      if (ownerId !== accountRef.current || mutationScope !== sequence.current) return;
      try {
        const canonical = await readCanonical(essayId, asInstructor);
        if (ownerId !== accountRef.current || mutationScope !== sequence.current) return;
        applySnapshot(canonical);
        setBanner({
          tone: 'danger',
          message: `${messageOf(caught)} Dữ liệu canonical đã được tải lại; hệ thống không tự gửi lại mutation.`,
        });
      } catch {
        setNeedsReconcile(true);
        setBanner({
          tone: 'danger',
          message: `${messageOf(caught)} Chưa xác nhận được trạng thái canonical; hệ thống không tự gửi lại mutation. Hãy tải lại trước khi tiếp tục.`,
        });
      }
    } finally {
      if (ownerId === accountRef.current && mutationScope === sequence.current) setPending(false);
    }
  };

  const reconcile = async () => {
    if (pending || !essayId) return;
    const ownerId = accountRef.current;
    const readScope = sequence.current;
    setPending(true);
    try {
      const canonical = await readCanonical(essayId, asInstructor);
      if (ownerId !== accountRef.current || readScope !== sequence.current) return;
      applySnapshot(canonical);
      setBanner({ tone: 'success', message: 'Đã đọc lại và xác nhận trạng thái canonical.' });
    } catch (caught) {
      if (ownerId !== accountRef.current || readScope !== sequence.current) return;
      setBanner({ tone: 'warning', message: `${messageOf(caught)} Vẫn chưa xác nhận được trạng thái canonical; không mutation nào được gửi.` });
    } finally {
      if (ownerId === accountRef.current && readScope === sequence.current) setPending(false);
    }
  };

  const backHref = essayId ? instructorCompareBackHref(essayId, asInstructor) : '/instructor';

  return (
    <div className="ic-shell">
      <header className="ic-topbar">
        <a href={backHref} className="ic-back"><ChevronLeft />Quay lại bài chấm</a>
        <div className="ic-top-title">So sánh và ghép phiên bản</div>
        <div className="ic-overall" aria-label="Điểm tổng hợp xem trước">{overall == null ? 'Band —' : `Band ${overall}`}</div>
      </header>

      <main className="ic-main">
        {asInstructor ? (
          <div className="ic-banner is-warning" role="status">
            Đang xem như giảng viên <strong>{asInstructor}</strong>. Mọi hành động được backend ghi audit.
          </div>
        ) : null}
        {banner ? <div className={`ic-banner is-${banner.tone}`} role={banner.tone === 'success' ? 'status' : 'alert'}>{banner.message}</div> : null}

        {phase === 'loading' ? <div className="ic-state" role="status"><span className="ic-spinner" />Đang tải các phiên bản…</div> : null}
        {phase === 'denied' ? <div className="ic-state is-error" role="alert"><h1>Không có quyền truy cập</h1><p>Bạn không có quyền truy cập trang giảng viên.</p></div> : null}
        {phase === 'error' ? <div className="ic-state is-error" role="alert"><h1>Không tải được phiên bản</h1><p>{loadError}</p><a href="/instructor">Về workspace giảng viên</a></div> : null}
        {phase === 'insufficient' ? <div className="ic-state is-error" role="alert"><h1>Chưa đủ phiên bản để so sánh</h1><p>Bài này chỉ có một phiên bản. Hãy quay lại màn hình chấm bài.</p><a href={backHref}>Quay lại bài chấm</a></div> : null}

        {phase === 'ready' && snapshot ? (
          <>
            <section className="ic-card ic-intro" aria-labelledby="ic-title">
              <div>
                <p className="ic-eyebrow">Writing review workspace</p>
                <h1 id="ic-title">Chọn phiên bản tốt nhất cho từng tiêu chí</h1>
                <p>Mỗi lựa chọn lấy nguyên điểm và nhận xét từ cùng một phiên bản. Điểm Overall được tính lại từ bốn tiêu chí.</p>
              </div>
              <div className="ic-budget" aria-label="Ngân sách phiên bản">
                <strong>{snapshot.budget.liveCount}/{snapshot.budget.max}</strong>
                <span>phiên bản đang dùng</span>
              </div>
            </section>

            {!snapshot.budget.canCompose ? (
              <div className="ic-banner is-danger" role="alert">Đã đạt tối đa {snapshot.budget.max} phiên bản và bản hiện hành không phải bản ghép. Không thể tạo thêm phiên bản.</div>
            ) : null}

            <section className="ic-card" aria-labelledby="ic-picker-title">
              <div className="ic-section-heading">
                <div><p className="ic-step">Bước 1</p><h2 id="ic-picker-title">So sánh theo tiêu chí</h2></div>
                <p>Chọn một ô trên mỗi hàng.</p>
              </div>
              <div className="ic-table-wrap">
                <table className="ic-table">
                  <thead><tr><th scope="col">Tiêu chí</th>{snapshot.versions.map((version: any) => <th scope="col" key={version.version}>{instructorVersionLabel(version)}</th>)}</tr></thead>
                  <tbody>
                    {MIX_CRITERIA.map((criterion: string) => (
                      <tr key={criterion}>
                        <th scope="row">{(INSTRUCTOR_CRITERION_LABELS as Record<string, string>)[criterion]}</th>
                        {snapshot.versions.map((version: any) => {
                          const detail = version.feedbackJson.criteriaFeedback[criterion];
                          return (
                            <td key={version.version}>
                              <label className={`ic-choice${picks[criterion] === version.version ? ' is-selected' : ''}`}>
                                <input
                                  type="radio"
                                  name={`pick-${criterion}`}
                                  value={version.version}
                                  checked={picks[criterion] === version.version}
                                  onChange={() => setPicks((current) => ({ ...current, [criterion]: version.version }))}
                                />
                                <span className="ic-band">Band {detail.bandScore}</span>
                                <span className="ic-feedback">{detail.feedback || detail.explanation || 'Không có nhận xét.'}</span>
                              </label>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="ic-base-row">
                <label htmlFor="ic-base">Nội dung còn lại lấy từ phiên bản</label>
                <select id="ic-base" value={baseVersion ?? ''} onChange={(event) => setBaseVersion(Number(event.target.value))}>
                  {snapshot.versions.map((version: any) => <option value={version.version} key={version.version}>{instructorVersionLabel(version)}</option>)}
                </select>
                <span>Tổng quan, lỗi, điểm chính và bài mẫu sẽ lấy từ bản nền này.</span>
              </div>
            </section>

            <section className="ic-card" aria-labelledby="ic-preview-title">
              <div className="ic-section-heading">
                <div><p className="ic-step">Bước 2</p><h2 id="ic-preview-title">Xem trước như học viên</h2></div>
                <div className="ic-preview-band">{overall == null ? 'Band —' : `Band ${overall}`}</div>
              </div>
              {preview ? <Preview feedback={preview} /> : <p className="ic-muted">Lựa chọn hiện tại không hợp lệ.</p>}
            </section>

            <div className="ic-commit-bar">
              <div><strong>Sẵn sàng tạo bản ghép?</strong><span>Backend sẽ kiểm lại quyền sở hữu, version budget và tính lại Overall.</span></div>
              <button
                type="button"
                onClick={() => void (needsReconcile ? reconcile() : commit())}
                disabled={pending || (!needsReconcile && (!snapshot.budget.canCompose || !preview))}
              >
                {pending ? 'Đang xác nhận…' : needsReconcile ? 'Đọc lại trạng thái' : 'Tạo bản ghép và đặt hiện hành'}
              </button>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

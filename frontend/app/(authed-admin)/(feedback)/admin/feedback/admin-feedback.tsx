'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  averageRating,
  feedbackDeepLink,
  formatFeedbackTime,
  groupFeedbackItems,
  normalizeFeedbackFilters,
  normalizeFeedbackInbox,
} from '@/lib/admin-feedback-model.mjs';

import type { FeedbackFilters, FeedbackInbox, FeedbackItem, FeedbackType } from './admin-feedback-types';

const TYPE_LABEL: Record<FeedbackType, string> = {
  rating: 'Đánh giá', report: 'Báo lỗi đề', flag: 'Flag bài giải',
};
const SKILL_LABEL = { reading: 'Reading', listening: 'Listening', vocabulary: 'Vocabulary' } as const;
const CATEGORY_LABEL: Record<string, string> = {
  wrong_answer: 'Sai đáp án', audio_issue: 'Lỗi audio', content_issue: 'Lỗi nội dung',
  unclear_typo: 'Đề khó hiểu / lỗi chính tả', other: 'Khác',
};

function makeKey(profileId: string, filters: FeedbackFilters) {
  return `${profileId}:${filters.type}:${filters.skill}:${filters.status}`;
}

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught || 'lỗi không xác định');
}

function Stars({ value }: { value: number }) {
  return <span className="afd-stars" aria-label={`${value} trên 5 sao`}>
    {Array.from({ length: 5 }, (_, index) => <span key={index} className={index < value ? '' : 'is-empty'} aria-hidden="true">★</span>)}
  </span>;
}

function Identity({ item }: { item: FeedbackItem }) {
  if (item.identityKind === 'user') return <>Học viên đã đăng nhập</>;
  if (item.identityKind === 'anonymous') return <>Ẩn danh qua share-link</>;
  return <>Không xác định danh tính</>;
}

function FeedbackRow({ item, pending, onToggle }: {
  item: FeedbackItem;
  pending: boolean;
  onToggle: (item: FeedbackItem) => void;
}) {
  const href = feedbackDeepLink(item);
  const location = `${item.testId || 'Không rõ nội dung'}${item.questionNumber == null ? '' : ` · Câu ${item.questionNumber}`}`;
  return <article className={`afd-item${item.status === 'resolved' ? ' is-resolved' : ''}`}>
    <div className="afd-item__rail"><span className={`afd-type is-${item.type}`}>{TYPE_LABEL[item.type]}</span></div>
    <div className="afd-item__content">
      <div className="afd-item__title">
        {href ? <a href={href}>{location}</a> : <span>{location}</span>}
        <span className={`adm-status-pill${item.status === 'resolved' ? ' is-active' : ' is-pending'}`}>{item.status === 'resolved' ? 'Đã xử lý' : 'Mới'}</span>
      </div>
      {item.type === 'rating' && <div className="afd-rating">
        {item.ratingTest != null && <span>Chất lượng đề <Stars value={item.ratingTest} /></span>}
        {item.ratingAudio != null && <span>Audio <Stars value={item.ratingAudio} /></span>}
      </div>}
      {item.type === 'report' && item.category && <p className="afd-category">{CATEGORY_LABEL[item.category] || item.category}</p>}
      {item.note && <blockquote>{item.note}</blockquote>}
      <p className="afd-meta"><Identity item={item} /><span aria-hidden="true">·</span><time dateTime={item.createdAt || undefined}>{formatFeedbackTime(item.createdAt)}</time></p>
    </div>
    <div className="afd-item__action">
      <button className={item.status === 'resolved' ? 'btn-secondary' : 'btn-primary'} type="button" disabled={pending} onClick={() => onToggle(item)}>
        {pending ? 'Đang xác nhận…' : item.status === 'resolved' ? 'Mở lại' : 'Đánh dấu đã xử lý'}
      </button>
    </div>
  </article>;
}

export function AdminFeedback() {
  const profile = useAdminProfile();
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = useMemo(() => normalizeFeedbackFilters({
    type: searchParams?.get('type') || undefined,
    skill: searchParams?.get('skill') || undefined,
    status: searchParams?.get('status') || undefined,
  }) as FeedbackFilters, [searchParams]);
  const [draft, setDraft] = useState<FeedbackFilters>(filters);
  const [snapshot, setSnapshot] = useState<{ key: string; value: FeedbackInbox } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const sequence = useRef(0);
  const pendingIds = useRef(new Set<string>());
  const latestFilters = useRef(filters);
  const latestProfileId = useRef(profile.id);
  latestFilters.current = filters;
  latestProfileId.current = profile.id;
  const currentKey = makeKey(profile.id, filters);
  const inbox = snapshot?.key === currentKey ? snapshot.value : null;

  const load = useCallback(async (next: FeedbackFilters) => {
    const requestId = ++sequence.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (next.type) params.set('type', next.type);
    if (next.skill) params.set('skill', next.skill);
    if (next.status) params.set('status', next.status);
    try {
      const suffix = params.size ? `?${params}` : '';
      const normalized = normalizeFeedbackInbox(await window.api.get<unknown>(`/api/admin/feedback${suffix}`)) as FeedbackInbox | null;
      if (!normalized) throw new Error('Phản hồi máy chủ không đúng định dạng');
      if ((normalized.type || '') !== next.type || (normalized.skill || '') !== next.skill || (normalized.itemStatus || '') !== next.status) {
        throw new Error('Phạm vi phản hồi không khớp bộ lọc');
      }
      if (requestId !== sequence.current) return false;
      setSnapshot({ key: makeKey(profile.id, next), value: normalized });
      return true;
    } catch (caught) {
      if (requestId === sequence.current) setError(messageOf(caught));
      return false;
    } finally {
      if (requestId === sequence.current) setLoading(false);
    }
  }, [profile.id]);

  useEffect(() => {
    setDraft(filters);
    setBanner(null);
    void load(filters);
    return () => { sequence.current += 1; };
  }, [filters, load, profile.id]);

  const apply = (next: FeedbackFilters) => {
    // A status PATCH may finish before Next completes this URL transition.
    // Keep the intended scope synchronously so its canonical readback cannot
    // fall back to the previous filter during that narrow window.
    latestFilters.current = next;
    setDraft(next);
    const params = new URLSearchParams();
    if (next.type) params.set('type', next.type);
    if (next.skill) params.set('skill', next.skill);
    if (next.status === '') params.set('status', 'all');
    else if (next.status !== 'new') params.set('status', next.status);
    const target = `/admin/feedback${params.size ? `?${params}` : ''}`;
    if (makeKey(profile.id, next) === currentKey) void load(next);
    else { setLoading(true); router.replace(target, { scroll: false }); }
  };

  const toggleStatus = async (item: FeedbackItem) => {
    if (pendingIds.current.has(item.id)) return;
    pendingIds.current.add(item.id);
    setPending((current) => new Set(current).add(item.id));
    setBanner(null);
    const mutationProfileId = profile.id;
    const nextStatus = item.status === 'resolved' ? 'new' : 'resolved';
    try {
      const result = await window.api.patch<{ id?: string; status?: string }>(`/api/admin/feedback/${encodeURIComponent(item.id)}`, { status: nextStatus });
      if (result?.id !== item.id || result?.status !== nextStatus) throw new Error('Máy chủ không xác nhận đúng thay đổi');
      if (latestProfileId.current !== mutationProfileId) return;
      const verified = await load(latestFilters.current);
      if (latestProfileId.current !== mutationProfileId) return;
      setBanner(verified
        ? { kind: 'success', text: nextStatus === 'resolved' ? 'Đã xử lý và đồng bộ từ máy chủ.' : 'Đã mở lại và đồng bộ từ máy chủ.' }
        : { kind: 'error', text: 'Thay đổi đã được gửi nhưng chưa đọc lại được trạng thái chuẩn. Hãy làm mới trước khi tiếp tục.' });
    } catch (caught) {
      setBanner({ kind: 'error', text: `Không cập nhật được phản hồi: ${messageOf(caught)}` });
    } finally {
      pendingIds.current.delete(item.id);
      setPending((current) => { const next = new Set(current); next.delete(item.id); return next; });
    }
  };

  const groups = useMemo(() => groupFeedbackItems(inbox?.items || []), [inbox]);
  const newCount = inbox?.items.filter((item) => item.status === 'new').length || 0;
  const issueCount = inbox?.items.filter((item) => item.type !== 'rating').length || 0;
  const average = averageRating((inbox?.items || []).map((item) => item.ratingTest));
  const lowerBound = inbox?.status === 'partial' ? '≥ ' : '';

  return <main className="afd-shell">
    <header className="afd-header">
      <div><p className="afd-eyebrow">Vận hành · Chất lượng nội dung</p><h1>Phản hồi người học</h1><p>Triage đánh giá, báo lỗi đề và flag bài giải từ Reading, Listening và Vocabulary.</p></div>
      <button className="btn-secondary" type="button" disabled={loading} onClick={() => void load(filters)}>{loading ? 'Đang làm mới…' : 'Làm mới'}</button>
    </header>

    <section className="afd-filters" aria-label="Bộ lọc phản hồi">
      <div className="afd-types" role="group" aria-label="Loại phản hồi">
        {([['', 'Tất cả'], ['report', 'Báo lỗi đề'], ['flag', 'Flag bài giải'], ['rating', 'Đánh giá']] as const).map(([value, label]) =>
          <button type="button" key={value} aria-pressed={draft.type === value} onClick={() => apply({ ...draft, type: value })}>{label}</button>)}
      </div>
      <label>Kỹ năng<select aria-label="Kỹ năng" value={draft.skill} onChange={(event) => apply({ ...draft, skill: event.target.value as FeedbackFilters['skill'] })}>
        <option value="">Mọi kỹ năng</option><option value="reading">Reading</option><option value="listening">Listening</option><option value="vocabulary">Vocabulary</option>
      </select></label>
      <label>Trạng thái<select aria-label="Trạng thái" value={draft.status} onChange={(event) => apply({ ...draft, status: event.target.value as FeedbackFilters['status'] })}>
        <option value="new">Mới</option><option value="resolved">Đã xử lý</option><option value="">Tất cả</option>
      </select></label>
    </section>

    {banner && <div className={`afd-banner is-${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}>{banner.text}</div>}
    {error && <div className="afd-banner is-error" role="alert"><strong>{inbox ? 'Không thể làm mới — đang giữ bản đã xác nhận trước đó.' : 'Không tải được phản hồi.'}</strong><span>{error}</span><button className="btn-secondary" type="button" onClick={() => void load(filters)}>Thử lại</button></div>}
    {loading && !inbox && <div className="afd-state" role="status">Đang tải hộp thư phản hồi…</div>}
    {inbox?.status === 'unavailable' && <div className="afd-state is-error" role="alert"><strong>Dữ liệu phản hồi hiện không khả dụng</strong><span>Không hiển thị số 0 vì nguồn dữ liệu chưa đọc được.</span></div>}
    {inbox?.status === 'partial' && <div className="afd-banner is-warning" role="status"><strong>Danh sách chưa đầy đủ.</strong><span>Các con số là cận dưới; hãy thu hẹp bộ lọc trước khi kết luận.</span></div>}
    {!!inbox?.malformedCount && <div className="afd-banner is-warning" role="status"><strong>Có dữ liệu sai định dạng.</strong><span>{inbox.malformedCount} mục không an toàn đã bị loại khỏi danh sách.</span></div>}

    {inbox && inbox.status !== 'unavailable' && <>
      <section className="afd-summary" aria-label="Tổng quan phản hồi">
        <div><span>Tổng trong bộ lọc</span><strong>{lowerBound}{inbox.count?.toLocaleString('vi-VN')}</strong><small>Snapshot UTC {new Date(inbox.snapshotTo).toLocaleString('vi-VN', { timeZone: 'UTC' })}</small></div>
        <div><span>Chưa xử lý</span><strong>{lowerBound}{newCount.toLocaleString('vi-VN')}</strong><small>Ưu tiên hành động</small></div>
        <div><span>Báo lỗi & flag</span><strong>{lowerBound}{issueCount.toLocaleString('vi-VN')}</strong><small>Không gồm đánh giá sao</small></div>
        <div><span>Điểm đề trung bình</span><strong>{inbox.status === 'partial' || average == null ? '—' : `${average}/5`}</strong><small>{inbox.status === 'partial' ? 'Không kết luận từ dữ liệu thiếu' : 'Chỉ các mục đánh giá hợp lệ'}</small></div>
      </section>

      <div className="afd-list-head"><div><p>Hộp thư</p><h2>{filters.status === 'new' ? 'Cần xử lý' : filters.status === 'resolved' ? 'Đã xử lý' : 'Tất cả phản hồi'}</h2></div><span>{lowerBound}{groups.length} nhóm nội dung</span></div>
      {!groups.length ? <div className="afd-empty"><strong>Không có phản hồi khớp bộ lọc</strong><span>Thử chọn trạng thái hoặc kỹ năng khác.</span></div> :
        <div className="afd-groups">{groups.map((group) => {
          const ratings = group.items.filter((item: FeedbackItem) => item.type === 'rating');
          const testAverage = inbox.status === 'partial' ? null : averageRating(ratings.map((item: FeedbackItem) => item.ratingTest));
          const audioAverage = inbox.status === 'partial' ? null : averageRating(ratings.map((item: FeedbackItem) => item.ratingAudio));
          const reports = group.items.filter((item: FeedbackItem) => item.type === 'report').length;
          const flags = group.items.filter((item: FeedbackItem) => item.type === 'flag').length;
          const groupBound = inbox.status === 'partial' ? '≥ ' : '';
          return <section className="afd-group" key={`${group.skill}:${group.testId || ''}`}>
            <header className="afd-group__header">
              <div><span className={`afd-skill is-${group.skill}`}>{SKILL_LABEL[group.skill as keyof typeof SKILL_LABEL]}</span><h3>{group.testId || 'Không rõ nội dung'}</h3></div>
              <p>{[testAverage != null ? `Đề ${testAverage}★` : '', audioAverage != null ? `Audio ${audioAverage}★` : '', reports ? `${groupBound}${reports} báo lỗi` : '', flags ? `${groupBound}${flags} flag` : ''].filter(Boolean).join(' · ') || 'Chưa có thống kê phụ'}</p>
              {!!group.newCount && <span className="afd-new-count">{groupBound}{group.newCount} mới</span>}
            </header>
            <div>{group.items.map((item: FeedbackItem) => <FeedbackRow key={item.id} item={item} pending={pending.has(item.id)} onToggle={toggleStatus} />)}</div>
          </section>;
        })}</div>}
    </>}
  </main>;
}

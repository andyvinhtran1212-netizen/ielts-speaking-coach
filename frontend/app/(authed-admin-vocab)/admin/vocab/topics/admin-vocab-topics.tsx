'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  CONTENT_SKILLS,
  contentSkillQuery,
  isUuid,
  normalizeBankAck,
  normalizeBankAnalytics,
  normalizeDeleteAck,
  normalizeTopicAck,
  normalizeTopicBundle,
  normalizeTopicList,
} from '@/lib/admin-vocab-topics-quiz-model.mjs';

type Skill = 'vocab' | 'grammar';
type Topic = { id: string; slug: string; title: string; skillArea: Skill; titleVi: string; description: string; order: number; published: boolean };
type Bank = { id: string; topicId: string; code: string; title: string; skillArea: Skill; wordsCount: number; published: boolean };
type Bundle = { topic: Topic; cards: { id: string; slug: string; headword: string }[]; banks: Bank[]; counts: { vocabCards: number; quizBanks: number } };
type Analytics = { sessionCount: number; items: { label: string; total: number; wrong: number; errorRate: number }[]; skills: { label: string; total: number; wrong: number; errorRate: number }[] };
type Draft = { title: string; titleVi: string; description: string; order: string; published: boolean };
type Notice = { kind: 'success' | 'error'; message: string };
type ConfirmState = { kind: 'topic'; item: Topic } | { kind: 'bank'; item: Bank };

const messageOf = (value: unknown) => value instanceof Error ? value.message : String(value || 'lỗi không xác định');
const skillOf = (value: string | null): Skill => value === 'grammar' ? 'grammar' : 'vocab';
const draftOf = (topic: Topic): Draft => ({ title: topic.title, titleVi: topic.titleVi, description: topic.description, order: String(topic.order), published: topic.published });

export function AdminVocabTopics() {
  const profile = useAdminProfile();
  const params = useSearchParams();
  const [skill, setSkill] = useState<Skill>(() => skillOf(params?.get('skill_area') ?? null));
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [busy, setBusy] = useState(false);
  const [analyticsBankId, setAnalyticsBankId] = useState('');
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const sequence = useRef(0);
  const analyticsSequence = useRef(0);
  const accountRef = useRef(profile.id);
  const mutationLock = useRef(false);
  accountRef.current = profile.id;

  const fetchTopics = useCallback(async (target: Skill) => {
    const query = contentSkillQuery(target);
    if (!query) throw new Error('Skill area không hợp lệ.');
    const value = normalizeTopicList(await window.api.get<unknown>(`/admin/content-topics?${query}`), target);
    if (!value) throw new Error('Backend trả về danh sách topic không đúng định dạng.');
    return value as Topic[];
  }, []);

  const fetchBundle = useCallback(async (target: Skill, id: string) => {
    if (!isUuid(id)) throw new Error('Topic ID không hợp lệ.');
    const value = normalizeTopicBundle(await window.api.get<unknown>(`/admin/content-topics/${encodeURIComponent(id)}/bundle`), target, id);
    if (!value) throw new Error('Backend trả về topic bundle không đúng định dạng.');
    return value as Bundle;
  }, []);

  const loadTopics = useCallback(async (target: Skill) => {
    const requestId = ++sequence.current;
    const account = profile.id;
    setLoading(true); setNotice(null);
    try {
      const rows = await fetchTopics(target);
      if (requestId !== sequence.current || account !== accountRef.current) return;
      const requested = params?.get('topic') ?? '';
      const currentAllowed = rows.some((row) => row.id === selectedId);
      const requestedAllowed = isUuid(requested) && rows.some((row) => row.id === requested);
      const nextId = currentAllowed ? selectedId : requestedAllowed ? requested : rows[0]?.id ?? '';
      if (requested && !requestedAllowed) {
        const url = new URL(window.location.href); url.searchParams.delete('topic');
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      }
      setTopics(rows); setSelectedId(nextId);
      if (!nextId) { setBundle(null); setDraft(null); }
    } catch (caught) {
      if (requestId === sequence.current && account === accountRef.current) setNotice({ kind: 'error', message: `Không tải được topics: ${messageOf(caught)}` });
    } finally {
      if (requestId === sequence.current && account === accountRef.current) setLoading(false);
    }
  }, [fetchTopics, params, profile.id, selectedId]);

  useEffect(() => {
    setTopics([]); setSelectedId(''); setBundle(null); setDraft(null); setAnalytics(null); setAnalyticsBankId('');
    void loadTopics(skill);
    return () => { sequence.current += 1; };
  }, [skill, profile.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedId || !topics.some((row) => row.id === selectedId)) return;
    const requestId = ++sequence.current;
    const account = profile.id;
    setDetailLoading(true); setBundle(null); setDraft(null); setAnalytics(null); setAnalyticsBankId(''); setNotice(null);
    void fetchBundle(skill, selectedId).then((value) => {
      if (requestId === sequence.current && account === accountRef.current) { setBundle(value); setDraft(draftOf(value.topic)); }
    }).catch((caught) => {
      if (requestId === sequence.current && account === accountRef.current) setNotice({ kind: 'error', message: `Không tải được topic: ${messageOf(caught)}` });
    }).finally(() => {
      if (requestId === sequence.current && account === accountRef.current) setDetailLoading(false);
    });
  }, [fetchBundle, selectedId]); // Topic admission/reset owns skill, account and list changes.

  useEffect(() => {
    if (!confirmState) return undefined;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) setConfirmState(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, confirmState]);

  const updateUrl = (nextSkill: Skill, topicId = '') => {
    const url = new URL(window.location.href);
    url.searchParams.delete('skill_area'); url.searchParams.delete('topic');
    if (nextSkill === 'grammar') url.searchParams.set('skill_area', 'grammar');
    if (topicId) url.searchParams.set('topic', topicId);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const chooseSkill = (next: Skill) => { if (!CONTENT_SKILLS.includes(next) || next === skill) return; updateUrl(next); setSkill(next); };
  const chooseTopic = (id: string) => { if (!topics.some((row) => row.id === id)) return; updateUrl(skill, id); setSelectedId(id); };

  const createTopic = async () => {
    const title = newTitle.trim();
    if (!title) { setNotice({ kind: 'error', message: 'Nhập tên chủ đề trước khi tạo.' }); return; }
    if (mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setNotice(null);
    const requestId = ++sequence.current; const account = profile.id;
    try {
      const ack = normalizeTopicAck(await window.api.post<unknown>('/admin/content-topics', { title, slug: newSlug.trim() || undefined, skill_area: skill }), skill);
      if (!ack) throw new Error('Backend không xác nhận topic vừa tạo.');
      const rows = await fetchTopics(skill);
      if (!rows.some((row) => row.id === ack.id)) throw new Error('Topic đã ACK nhưng chưa xuất hiện trong canonical list.');
      if (requestId !== sequence.current || account !== accountRef.current) return;
      setTopics(rows); setNewTitle(''); setNewSlug(''); updateUrl(skill, ack.id); setSelectedId(ack.id);
      setNotice({ kind: 'success', message: 'Đã tạo topic và tải lại dữ liệu chuẩn từ backend.' });
    } catch (caught) {
      if (requestId === sequence.current && account === accountRef.current) setNotice({ kind: 'error', message: `Không xác nhận được topic mới: ${messageOf(caught)}` });
    } finally { mutationLock.current = false; if (account === accountRef.current) setBusy(false); }
  };

  const saveTopic = async () => {
    if (!bundle || !draft || mutationLock.current) return;
    const title = draft.title.trim(); const order = Number(draft.order);
    if (!title || !Number.isInteger(order)) { setNotice({ kind: 'error', message: 'Tên không được trống và thứ tự phải là số nguyên.' }); return; }
    mutationLock.current = true; setBusy(true); setNotice(null);
    const requestId = ++sequence.current; const account = profile.id;
    try {
      const body = { title, title_vi: draft.titleVi.trim() || null, description: draft.description.trim() || null, order, is_published: draft.published };
      const ack = normalizeTopicAck(await window.api.patch<unknown>(`/admin/content-topics/${encodeURIComponent(bundle.topic.id)}`, body), skill, bundle.topic.id);
      if (!ack) throw new Error('Backend không xác nhận đúng topic đã cập nhật.');
      const [rows, canonical] = await Promise.all([fetchTopics(skill), fetchBundle(skill, bundle.topic.id)]);
      if (requestId !== sequence.current || account !== accountRef.current) return;
      setTopics(rows); setBundle(canonical); setDraft(draftOf(canonical.topic));
      setNotice({ kind: 'success', message: 'Đã lưu topic và đọc lại canonical bundle.' });
    } catch (caught) {
      if (requestId === sequence.current && account === accountRef.current) setNotice({ kind: 'error', message: `Không xác nhận được thay đổi: ${messageOf(caught)}` });
    } finally { mutationLock.current = false; if (account === accountRef.current) setBusy(false); }
  };

  const deleteConfirmed = async () => {
    const target = confirmState;
    if (!target || mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setNotice(null);
    const requestId = ++sequence.current; const account = profile.id;
    try {
      if (target.kind === 'topic') {
        const result = await window.api.delete<unknown>(`/admin/content-topics/${encodeURIComponent(target.item.id)}`);
        if (!normalizeDeleteAck(result, target.item.id)) throw new Error('Backend không ACK đúng topic đã xoá.');
        const rows = await fetchTopics(skill);
        if (rows.some((row) => row.id === target.item.id)) throw new Error('Topic vẫn còn trong canonical list sau delete.');
        if (requestId !== sequence.current || account !== accountRef.current) return;
        const nextId = rows[0]?.id ?? ''; setTopics(rows); setSelectedId(nextId); setBundle(null); setDraft(null); updateUrl(skill, nextId);
        setNotice({ kind: 'success', message: 'Đã xoá topic và tải lại danh sách chuẩn từ backend.' });
      } else {
        const result = await window.api.delete<unknown>(`/admin/quiz/banks/${encodeURIComponent(target.item.id)}`);
        if (!normalizeDeleteAck(result, target.item.id)) throw new Error('Backend không ACK đúng bank đã xoá.');
        if (!bundle) throw new Error('Topic hiện tại không còn khả dụng.');
        const canonical = await fetchBundle(skill, bundle.topic.id);
        if (canonical.banks.some((row) => row.id === target.item.id)) throw new Error('Bank vẫn còn trong canonical bundle sau delete.');
        if (requestId !== sequence.current || account !== accountRef.current) return;
        setBundle(canonical); setAnalytics(null); setAnalyticsBankId('');
        setNotice({ kind: 'success', message: 'Đã xoá bank và đọc lại canonical bundle.' });
      }
      setConfirmState(null);
    } catch (caught) {
      if (requestId === sequence.current && account === accountRef.current) setNotice({ kind: 'error', message: `Không xác nhận được thao tác xoá: ${messageOf(caught)}` });
    } finally { mutationLock.current = false; if (account === accountRef.current) setBusy(false); }
  };

  const toggleBank = async (bank: Bank) => {
    if (!bundle || mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setNotice(null);
    const requestId = ++sequence.current; const account = profile.id;
    try {
      const ack = normalizeBankAck(await window.api.patch<unknown>(`/admin/quiz/banks/${encodeURIComponent(bank.id)}`, { is_published: !bank.published }), skill, bank.id);
      if (!ack || ack.published === bank.published) throw new Error('Backend không xác nhận trạng thái publish mới.');
      const canonical = await fetchBundle(skill, bundle.topic.id);
      const saved = canonical.banks.find((row) => row.id === bank.id);
      if (!saved || saved.published !== ack.published) throw new Error('Canonical bundle chưa phản ánh trạng thái publish.');
      if (requestId !== sequence.current || account !== accountRef.current) return;
      setBundle(canonical); setNotice({ kind: 'success', message: 'Đã đổi trạng thái bank và đọc lại canonical bundle.' });
    } catch (caught) {
      if (requestId === sequence.current && account === accountRef.current) setNotice({ kind: 'error', message: `Không xác nhận được trạng thái bank: ${messageOf(caught)}` });
    } finally { mutationLock.current = false; if (account === accountRef.current) setBusy(false); }
  };

  const showAnalytics = async (bank: Bank) => {
    const requestId = ++analyticsSequence.current; const account = profile.id;
    setAnalyticsBankId(bank.id); setAnalytics(null);
    try {
      const value = normalizeBankAnalytics(await window.api.get<unknown>(`/admin/quiz/banks/${encodeURIComponent(bank.id)}/analytics`));
      if (!value) throw new Error('Backend trả về analytics không đúng định dạng.');
      if (requestId === analyticsSequence.current && account === accountRef.current) setAnalytics(value as Analytics);
    } catch (caught) {
      if (requestId === analyticsSequence.current && account === accountRef.current) { setAnalyticsBankId(''); setNotice({ kind: 'error', message: `Không tải được analytics: ${messageOf(caught)}` }); }
    }
  };

  return <main className="avv-shell avv-console-shell avv-topic-console">
    <header className="avv-stats-hero">
      <div><a href="/admin/vocab">← Vocabulary workspace</a><p className="avv-eyebrow">Cấu trúc chương trình</p><h1>Chủ đề nội dung</h1><p>Tổ chức từ vựng và Quick‑Check bank theo một topic spine duy nhất. Mọi trạng thái hiển thị đều được đọc lại từ backend.</p></div>
      <label className="avv-scope-control">Khu vực<select aria-label="Khu vực nội dung" value={skill} disabled={busy} onChange={(event) => chooseSkill(event.target.value as Skill)}><option value="vocab">Từ vựng</option><option value="grammar">Grammar</option></select></label>
    </header>

    {notice ? <p className={`avv-banner is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</p> : null}
    <div className="avv-topic-layout">
      <aside className="avv-topic-rail">
        <form className="avv-create-card" onSubmit={(event) => { event.preventDefault(); void createTopic(); }}>
          <div><p className="avv-eyebrow">Topic mới</p><h2>Tạo chủ đề</h2></div>
          <label>Tên chủ đề<input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Work & Careers" /></label>
          <label>Slug (tuỳ chọn)<input value={newSlug} onChange={(event) => setNewSlug(event.target.value)} placeholder="Tự sinh nếu để trống" /></label>
          <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Đang xác minh…' : 'Tạo chủ đề'}</button>
        </form>
        <section className="avv-topic-list" aria-label="Danh sách chủ đề">
          <header><h2>Danh sách</h2><span>{topics.length} topic</span></header>
          {loading ? <div className="avv-state">Đang tải topics…</div> : topics.length === 0 ? <div className="avv-state">Chưa có topic trong khu vực này.</div> : topics.map((topic) => <button key={topic.id} type="button" className={topic.id === selectedId ? 'is-active' : ''} aria-pressed={topic.id === selectedId} onClick={() => chooseTopic(topic.id)}><span><strong>{topic.title}</strong><small>{topic.slug}</small></span><span className={`avv-chip is-${topic.published ? 'teal' : 'muted'}`}>{topic.published ? 'live' : 'hidden'}</span></button>)}
        </section>
      </aside>

      <section className="avv-topic-detail">
        {detailLoading ? <div className="avv-state">Đang tải canonical bundle…</div> : !bundle || !draft ? <div className="avv-state">Chọn một topic để xem nội dung liên kết.</div> : <>
          <div className="avv-topic-detail__head"><div><p className="avv-eyebrow">{bundle.topic.slug}</p><h2>{bundle.topic.title}</h2></div><div className="avv-topic-totals"><span><strong>{bundle.counts.vocabCards}</strong> từ</span><span><strong>{bundle.counts.quizBanks}</strong> bank</span></div></div>
          <form className="avv-topic-form" onSubmit={(event) => { event.preventDefault(); void saveTopic(); }}>
            <label>Tên<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
            <label>Tên tiếng Việt<input value={draft.titleVi} onChange={(event) => setDraft({ ...draft, titleVi: event.target.value })} /></label>
            <label className="is-wide">Mô tả<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
            <label>Thứ tự<input type="number" step="1" value={draft.order} onChange={(event) => setDraft({ ...draft, order: event.target.value })} /></label>
            <label className="avv-check"><input type="checkbox" checked={draft.published} onChange={(event) => setDraft({ ...draft, published: event.target.checked })} />Hiển thị topic</label>
            <div className="avv-topic-form__actions"><button className="btn-danger" type="button" disabled={busy} onClick={() => setConfirmState({ kind: 'topic', item: bundle.topic })}>Xoá topic</button><button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Đang xác minh…' : 'Lưu thay đổi'}</button></div>
          </form>

          <section className="avv-linked-section">
            <header><div><p className="avv-eyebrow">Ngân hàng kiểm tra</p><h3>Quick‑Check banks</h3></div><a className="btn-secondary" href={`/admin/vocab/quiz?skill_area=${skill}&topic=${bundle.topic.id}`}>+ Import bank</a></header>
            {bundle.banks.length === 0 ? <div className="avv-state">Chưa có bank gắn với topic này.</div> : <div className="avv-bank-list">{bundle.banks.map((bank) => <article key={bank.id}><div><strong>{bank.code}</strong><span>{bank.title || 'Chưa đặt tiêu đề'} · {bank.wordsCount} từ</span></div><span className={`avv-chip is-${bank.published ? 'teal' : 'muted'}`}>{bank.published ? 'published' : 'hidden'}</span><div><button className="btn-secondary" type="button" disabled={busy} onClick={() => void showAnalytics(bank)}>Phân tích</button><button className="btn-secondary" type="button" disabled={busy} onClick={() => void toggleBank(bank)}>{bank.published ? 'Ẩn' : 'Hiện'}</button><button className="btn-danger" type="button" disabled={busy} onClick={() => setConfirmState({ kind: 'bank', item: bank })}>Xoá</button></div></article>)}</div>}
            {analyticsBankId ? <div className="avv-inline-analytics">{!analytics ? <p>Đang tải phân tích…</p> : <><header><strong>Từ dễ sai</strong><span>{analytics.sessionCount} phiên</span></header>{analytics.items.length ? <div className="avv-table-wrap"><table className="avv-table"><thead><tr><th>Từ / điểm</th><th>Sai</th><th>Lần</th><th>Tỉ lệ sai</th></tr></thead><tbody>{analytics.items.slice(0, 10).map((row) => <tr key={row.label}><td data-label="Từ / điểm"><strong>{row.label}</strong></td><td data-label="Sai">{row.wrong}</td><td data-label="Lần">{row.total}</td><td data-label="Tỉ lệ sai">{Math.round(row.errorRate * 100)}%</td></tr>)}</tbody></table></div> : <p>Chưa có lượt làm nào.</p>}{analytics.skills.length ? <p className="avv-skill-summary">Theo kỹ năng: {analytics.skills.map((row) => `${row.label} ${Math.round(row.errorRate * 100)}%`).join(' · ')}</p> : null}</>}</div> : null}
          </section>

          {skill === 'vocab' ? <section className="avv-linked-section avv-linked-section--compact"><div><p className="avv-eyebrow">Kho từ vựng</p><h3>{bundle.counts.vocabCards} từ đang liên kết</h3></div><a className="btn-secondary" href={`/pages/admin/vocab/content.html?category=${encodeURIComponent(bundle.topic.slug)}`}>Quản lý từ vựng →</a></section> : null}
        </>}
      </section>
    </div>

    {confirmState ? <div className="avv-modal-layer" role="dialog" aria-modal="true" aria-labelledby="topic-confirm-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConfirmState(null); }}><section className="avv-modal-card"><p className="avv-eyebrow">Thao tác không hoàn tác</p><h2 id="topic-confirm-title">{confirmState.kind === 'topic' ? 'Xoá topic?' : 'Xoá Quick‑Check bank?'}</h2><p>{confirmState.kind === 'topic' ? 'Backend sẽ từ chối nếu topic vẫn còn từ vựng hoặc bank. Không có nội dung nào bị xoá ngầm.' : 'Bank và toàn bộ câu hỏi của bank sẽ bị xoá. Lịch sử liên quan có thể không khôi phục được.'}</p><strong>{confirmState.item.title || ('code' in confirmState.item ? confirmState.item.code : confirmState.item.slug)}</strong><div className="avv-modal-actions"><button className="btn-secondary" type="button" disabled={busy} onClick={() => setConfirmState(null)}>Hủy</button><button className="btn-danger" type="button" disabled={busy} onClick={() => void deleteConfirmed()}>{busy ? 'Đang xác minh…' : confirmState.kind === 'topic' ? 'Xoá topic' : 'Xoá bank'}</button></div></section></div> : null}
  </main>;
}

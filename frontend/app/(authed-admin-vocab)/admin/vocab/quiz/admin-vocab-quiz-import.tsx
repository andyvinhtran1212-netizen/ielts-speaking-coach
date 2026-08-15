'use client';

import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  CONTENT_SKILLS,
  contentSkillQuery,
  isUuid,
  normalizeBankList,
  normalizeDeleteAck,
  normalizeImportResult,
  normalizeTopicList,
} from '@/lib/admin-vocab-topics-quiz-model.mjs';

type Skill = 'vocab' | 'grammar';
type Topic = { id: string; slug: string; title: string; skillArea: Skill; titleVi: string; description: string; order: number; published: boolean };
type Bank = { id: string; topicId: string; code: string; title: string; skillArea: Skill; wordsCount: number; published: boolean };
type ImportPreview = { dryRun: boolean; meta: { code: string; title: string; skillArea: Skill } | null; errors: { block: number; qid: string; field: string; message: string }[]; summary: { words: number; questions: number; errors: number; pools: number }; committedBankId: string };
type Notice = { kind: 'success' | 'error'; message: string };

const skillOf = (value: string | null): Skill => value === 'grammar' ? 'grammar' : 'vocab';
const messageOf = (value: unknown) => value instanceof Error ? value.message : String(value || 'lỗi không xác định');

export function AdminVocabQuizImport() {
  const profile = useAdminProfile();
  const params = useSearchParams();
  const [skill, setSkill] = useState<Skill>(() => skillOf(params?.get('skill_area') ?? null));
  const [topics, setTopics] = useState<Topic[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [selectedTopic, setSelectedTopic] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [deleteBank, setDeleteBank] = useState<Bank | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const previewSequence = useRef(0);
  const accountRef = useRef(profile.id);
  const mutationLock = useRef(false);
  accountRef.current = profile.id;

  const fetchTopics = useCallback(async (target: Skill) => {
    const query = contentSkillQuery(target); if (!query) throw new Error('Skill area không hợp lệ.');
    const value = normalizeTopicList(await window.api.get<unknown>(`/admin/content-topics?${query}`), target);
    if (!value) throw new Error('Backend trả về danh sách topic không đúng định dạng.');
    return value as Topic[];
  }, []);
  const fetchBanks = useCallback(async (target: Skill) => {
    const query = contentSkillQuery(target); if (!query) throw new Error('Skill area không hợp lệ.');
    const value = normalizeBankList(await window.api.get<unknown>(`/admin/quiz/banks?${query}`), target);
    if (!value) throw new Error('Backend trả về danh sách bank không đúng định dạng.');
    return value as Bank[];
  }, []);

  useEffect(() => {
    const requestId = ++sequence.current; const account = profile.id;
    setLoading(true); setTopics([]); setBanks([]); setSelectedTopic(''); setFile(null); setPreview(null); setNotice(null);
    if (fileRef.current) fileRef.current.value = '';
    void Promise.all([fetchTopics(skill), fetchBanks(skill)]).then(([topicRows, bankRows]) => {
      if (requestId !== sequence.current || account !== accountRef.current) return;
      const requested = params?.get('topic') ?? '';
      const admitted = isUuid(requested) && topicRows.some((topic) => topic.id === requested) ? requested : '';
      if (requested && !admitted) {
        const url = new URL(window.location.href); url.searchParams.delete('topic');
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      }
      setTopics(topicRows); setBanks(bankRows); setSelectedTopic(admitted);
    }).catch((caught) => {
      if (requestId === sequence.current && account === accountRef.current) setNotice({ kind: 'error', message: `Không tải được Quiz workspace: ${messageOf(caught)}` });
    }).finally(() => {
      if (requestId === sequence.current && account === accountRef.current) setLoading(false);
    });
    return () => { sequence.current += 1; previewSequence.current += 1; };
  }, [fetchBanks, fetchTopics, params, profile.id, skill]);

  useEffect(() => {
    if (!deleteBank) return undefined;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) setDeleteBank(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, deleteBank]);

  const updateUrl = (nextSkill: Skill, topicId = '') => {
    const url = new URL(window.location.href);
    url.searchParams.delete('skill_area'); url.searchParams.delete('topic');
    if (nextSkill === 'grammar') url.searchParams.set('skill_area', 'grammar');
    if (topicId) url.searchParams.set('topic', topicId);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };
  const chooseSkill = (next: Skill) => { if (!CONTENT_SKILLS.includes(next) || next === skill) return; updateUrl(next); setSkill(next); };
  const chooseTopic = (id: string) => {
    if (id && !topics.some((topic) => topic.id === id)) return;
    setSelectedTopic(id); updateUrl(skill, id);
    if (preview) setNotice(id ? null : { kind: 'error', message: 'Chọn topic trước khi lưu bank.' });
  };

  const runDryCheck = async (picked: File) => {
    const requestId = ++previewSequence.current; const account = profile.id;
    setChecking(true); setNotice(null); setPreview(null);
    const form = new FormData(); form.append('file', picked);
    const suffix = selectedTopic ? `&topic_id=${encodeURIComponent(selectedTopic)}` : '';
    try {
      const value = normalizeImportResult(await window.api.upload<unknown>(`/admin/quiz/import?dry_run=true${suffix}`, form), true);
      if (!value) throw new Error('Backend trả về preview import không đúng định dạng.');
      if (requestId !== previewSequence.current || account !== accountRef.current) return;
      setPreview(value as ImportPreview);
      if (value.summary.errors) setNotice({ kind: 'error', message: 'File còn lỗi. Sửa nội dung rồi chọn lại file để kiểm tra.' });
      else if (!selectedTopic) setNotice({ kind: 'error', message: 'File hợp lệ; chọn topic trước khi lưu bank.' });
      else if (value.meta?.skillArea !== skill) setNotice({ kind: 'error', message: `META đang là ${value.meta?.skillArea || 'không xác định'}, không khớp khu vực ${skill}.` });
      else setNotice({ kind: 'success', message: 'Dry-run hợp lệ. Bank sẵn sàng được lưu.' });
    } catch (caught) {
      if (requestId === previewSequence.current && account === accountRef.current) setNotice({ kind: 'error', message: `Không kiểm tra được file: ${messageOf(caught)}` });
    } finally { if (requestId === previewSequence.current && account === accountRef.current) setChecking(false); }
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    setFile(picked); setPreview(null);
    if (picked) void runDryCheck(picked);
  };
  const reset = () => {
    previewSequence.current += 1; setFile(null); setPreview(null); setChecking(false); setNotice(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const commit = async () => {
    if (!file || !preview || preview.summary.errors || preview.meta?.skillArea !== skill) { setNotice({ kind: 'error', message: 'Cần một dry-run hợp lệ đúng khu vực trước khi lưu.' }); return; }
    if (!selectedTopic || !topics.some((topic) => topic.id === selectedTopic)) { setNotice({ kind: 'error', message: 'Chọn một topic canonical trước khi lưu.' }); return; }
    if (mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setNotice(null);
    const requestId = ++sequence.current; const account = profile.id;
    const form = new FormData(); form.append('file', file);
    try {
      const value = normalizeImportResult(await window.api.upload<unknown>(`/admin/quiz/import?dry_run=false&topic_id=${encodeURIComponent(selectedTopic)}`, form), false);
      if (!value) throw new Error('Backend trả về ACK import không đúng định dạng.');
      if (value.summary.errors || !value.committedBankId) throw new Error('Import không commit vì backend vẫn báo lỗi.');
      const canonical = await fetchBanks(skill);
      const saved = canonical.find((bank) => bank.id === value.committedBankId);
      if (!saved || saved.topicId !== selectedTopic) throw new Error('Bank đã ACK nhưng chưa xuất hiện đúng topic trong canonical list.');
      if (requestId !== sequence.current || account !== accountRef.current) return;
      setBanks(canonical); setPreview(value as ImportPreview);
      setNotice({ kind: 'success', message: `Đã lưu bank ${value.meta?.code || saved.code} và đọc lại canonical list.` });
    } catch (caught) {
      if (requestId === sequence.current && account === accountRef.current) setNotice({ kind: 'error', message: `Không xác nhận được import: ${messageOf(caught)} Không tự động retry write này.` });
    } finally { mutationLock.current = false; if (account === accountRef.current) setBusy(false); }
  };

  const confirmDelete = async () => {
    const target = deleteBank;
    if (!target || mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setNotice(null);
    const requestId = ++sequence.current; const account = profile.id;
    try {
      const ack = await window.api.delete<unknown>(`/admin/quiz/banks/${encodeURIComponent(target.id)}`);
      if (!normalizeDeleteAck(ack, target.id)) throw new Error('Backend không ACK đúng bank đã xoá.');
      const canonical = await fetchBanks(skill);
      if (canonical.some((bank) => bank.id === target.id)) throw new Error('Bank vẫn còn trong canonical list sau delete.');
      if (requestId !== sequence.current || account !== accountRef.current) return;
      setBanks(canonical); setDeleteBank(null); setNotice({ kind: 'success', message: 'Đã xoá bank và đọc lại canonical list.' });
    } catch (caught) {
      if (requestId === sequence.current && account === accountRef.current) setNotice({ kind: 'error', message: `Không xác nhận được delete: ${messageOf(caught)}` });
    } finally { mutationLock.current = false; if (account === accountRef.current) setBusy(false); }
  };

  const commitReady = !!file && !!preview && preview.summary.errors === 0 && preview.meta?.skillArea === skill && !!selectedTopic && !busy && !checking;

  return <main className="avv-shell avv-console-shell avv-quiz-import">
    <header className="avv-stats-hero">
      <div><a href="/admin/vocab">← Vocabulary workspace</a><p className="avv-eyebrow">Ngân hàng kiểm tra</p><h1>Quick‑Check Quiz</h1><p>Kiểm tra file Markdown bằng dry-run trước khi commit. Write chỉ diễn ra một lần và được đối chiếu lại với danh sách bank canonical.</p></div>
      <label className="avv-scope-control">Khu vực<select aria-label="Khu vực nội dung" value={skill} disabled={busy || checking} onChange={(event) => chooseSkill(event.target.value as Skill)}><option value="vocab">Từ vựng</option><option value="grammar">Grammar</option></select></label>
    </header>
    {notice ? <p className={`avv-banner is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</p> : null}

    <div className="avv-quiz-layout">
      <section className="avv-import-card">
        <header><div><p className="avv-eyebrow">01 · Validate</p><h2>Import một bank</h2></div><span className="avv-chip is-muted">.md</span></header>
        <label>Topic canonical<select aria-label="Chủ đề (topic)" value={selectedTopic} disabled={loading || busy} onChange={(event) => chooseTopic(event.target.value)}><option value="">— Chọn topic —</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title} ({topic.slug})</option>)}</select></label>
        <label className="avv-file-field">File Markdown<input ref={fileRef} type="file" accept=".md,text/markdown,text/plain" disabled={busy} onChange={onFile} /><span>{file?.name || 'Chưa chọn file'}</span></label>
        <div className="avv-import-contract"><span>Pipeline</span><strong>Parse → Validate → Preview → Commit</strong><small>Commit bị chặn nếu file còn lỗi, sai scope hoặc chưa có topic.</small></div>
        <div className="avv-import-actions"><button className="btn-secondary" type="button" disabled={busy || checking || !file} onClick={reset}>Xóa file</button><button className="btn-primary" type="button" disabled={!commitReady} onClick={() => void commit()}>{busy ? 'Đang xác minh…' : checking ? 'Đang kiểm tra…' : 'Lưu vào hệ thống'}</button></div>
      </section>

      <section className="avv-preview-card" aria-live="polite">
        <header><div><p className="avv-eyebrow">02 · Preview</p><h2>Kết quả dry-run</h2></div>{checking ? <span className="avv-chip is-warning">checking</span> : preview ? <span className={`avv-chip is-${preview.summary.errors ? 'warning' : 'teal'}`}>{preview.summary.errors ? 'needs fix' : 'valid'}</span> : null}</header>
        {checking ? <div className="avv-state">Đang parse và kiểm tra mastery contract…</div> : !preview ? <div className="avv-state">Chọn file để xem META, số pool, câu hỏi và lỗi validation.</div> : <>
          <div className="avv-preview-meta"><div><span>Bank</span><strong>{preview.meta?.code || '(thiếu code)'}</strong><small>{preview.meta?.title || 'Chưa có title'}</small></div><div><span>Scope</span><strong>{preview.meta?.skillArea || '—'}</strong></div></div>
          <div className="avv-preview-stats"><div><span>Câu hỏi</span><strong>{preview.summary.questions}</strong></div><div><span>Pool</span><strong>{preview.summary.pools}</strong></div><div><span>Từ</span><strong>{preview.summary.words}</strong></div><div className={preview.summary.errors ? 'is-error' : ''}><span>Lỗi</span><strong>{preview.summary.errors}</strong></div></div>
          {preview.errors.length ? <div className="avv-import-errors"><strong>Lỗi cần sửa</strong><ol>{preview.errors.map((error, index) => <li key={`${error.block}-${error.field}-${index}`}><span>{error.block < 0 ? 'META' : `Block #${error.block + 1}`}{error.qid ? ` · ${error.qid}` : ''}</span><code>{error.field}</code><p>{error.message}</p></li>)}</ol></div> : <p className="avv-banner is-success">Không có lỗi validation. Chọn đúng topic và lưu khi sẵn sàng.</p>}
        </>}
      </section>
    </div>

    <section className="avv-linked-section avv-bank-catalog">
      <header><div><p className="avv-eyebrow">Canonical inventory</p><h2>Banks đã có</h2></div><span>{banks.length} bank</span></header>
      {loading ? <div className="avv-state">Đang tải danh sách bank…</div> : banks.length === 0 ? <div className="avv-state">Chưa có bank trong khu vực này.</div> : <div className="avv-table-wrap"><table className="avv-table"><thead><tr><th>Bank</th><th>Topic</th><th>Số từ</th><th>Trạng thái</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{banks.map((bank) => { const topic = topics.find((row) => row.id === bank.topicId); return <tr key={bank.id}><td data-label="Bank"><strong>{bank.code}</strong><small>{bank.title || 'Chưa đặt tiêu đề'}</small></td><td data-label="Topic">{topic ? <a href={`/admin/vocab/topics?skill_area=${skill}&topic=${topic.id}`}>{topic.title}</a> : <span className="avv-chip is-warning">Không thấy topic</span>}</td><td data-label="Số từ">{bank.wordsCount}</td><td data-label="Trạng thái"><span className={`avv-chip is-${bank.published ? 'teal' : 'muted'}`}>{bank.published ? 'published' : 'hidden'}</span></td><td className="avv-row-actions"><button className="btn-danger" type="button" disabled={busy} onClick={() => setDeleteBank(bank)}>Xoá</button></td></tr>; })}</tbody></table></div>}
    </section>

    {deleteBank ? <div className="avv-modal-layer" role="dialog" aria-modal="true" aria-labelledby="quiz-delete-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDeleteBank(null); }}><section className="avv-modal-card"><p className="avv-eyebrow">Thao tác không hoàn tác</p><h2 id="quiz-delete-title">Xoá Quick‑Check bank?</h2><p>Bank và toàn bộ câu hỏi của bank sẽ bị xoá. UI chỉ cập nhật sau khi backend ACK và canonical list không còn bank này.</p><strong>{deleteBank.code} · {deleteBank.title || 'Chưa đặt tiêu đề'}</strong><div className="avv-modal-actions"><button className="btn-secondary" type="button" disabled={busy} onClick={() => setDeleteBank(null)}>Hủy</button><button className="btn-danger" type="button" disabled={busy} onClick={() => void confirmDelete()}>{busy ? 'Đang xác minh…' : 'Xoá bank'}</button></div></section></div> : null}
  </main>;
}

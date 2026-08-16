'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  READING_LIBRARY_LABEL, canonicalReadingShareUrl, formatReadingContentDate,
  normalizeDeleteAck, normalizeExamOnlyAck, normalizeLockAck, normalizeReadingContentList,
  normalizeReadingImport, normalizeShareAck, readingPreviewRows,
} from '@/lib/admin-reading-content-model.mjs';
import { readingPreviewHref } from '@/lib/admin-reading-preview-model.mjs';

type Library = '' | 'l1_vocab' | 'l2_skill' | 'l3_test';
type Row = { id: string; slug: string; library: Exclude<Library, ''>; title: string; status: string; difficultyLevel: string | null; skillFocus: string | null; topicTags: string[]; examOnly: boolean; locked: boolean; shareActive: boolean; shareExpiresAt: string | null; updatedAt: string | null; createdAt: string | null };
type ImportIssue = { field: string; message: string };
type ImportResult = { dryRun: boolean; parsed: Record<string, unknown> | null; validationErrors: ImportIssue[]; warnings: string[]; bundleSummary: Record<string, unknown> | null; action: string | null; committedId: string | null };
type Action = null | { kind: 'delete' | 'exam' | 'lock'; row: Row };
type Banner = null | { kind: 'success' | 'error' | 'info'; text: string };
const PAGE_SIZE = 25;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error || 'Lỗi không xác định');
const previewRows = readingPreviewRows as (parsed: unknown, bundleSummary?: unknown) => Array<{ label: string; value: string }>;

export function AdminReadingContent() {
  const profile = useAdminProfile();
  const account = useRef(profile.id);
  const sequence = useRef(0);
  const [library, setLibrary] = useState<Library>('');
  const [offset, setOffset] = useState(0);
  const [snapshot, setSnapshot] = useState<{ key: string; rows: Row[]; total: number; malformed: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [testFile, setTestFile] = useState<File | null>(null);
  const [solutionFile, setSolutionFile] = useState<File | null>(null);
  const [mini, setMini] = useState(false);
  const [importMode, setImportMode] = useState<'single' | 'bundle'>('single');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [shareRow, setShareRow] = useState<Row | null>(null);
  const [shareDays, setShareDays] = useState(7);
  const [shareUrl, setShareUrl] = useState('');
  const [shareReadbackWarning, setShareReadbackWarning] = useState<string | null>(null);
  const key = `${profile.id}:${library}:${offset}`;
  const current = snapshot?.key === key ? snapshot : null;

  const load = useCallback(async (targetLibrary: Library, targetOffset: number, preserve = true) => {
    const request = ++sequence.current;
    const owner = profile.id;
    setLoading(true); setLoadError(null);
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(targetOffset) });
    if (targetLibrary) query.set('library', targetLibrary);
    try {
      const data = normalizeReadingContentList(await window.api.get<unknown>(`/admin/reading/content?${query}`), { limit: PAGE_SIZE, offset: targetOffset }) as { rows: Row[]; malformedCount: number; limit: number; offset: number; total: number } | null;
      if (!data) throw new Error('Phản hồi danh sách không đúng contract.');
      if (request !== sequence.current || account.current !== owner) return null;
      setSnapshot({ key: `${owner}:${targetLibrary}:${targetOffset}`, rows: data.rows, total: data.total, malformed: data.malformedCount });
      return data;
    } catch (error) {
      if (request === sequence.current && account.current === owner) {
        setLoadError(`${preserve && current ? 'Không thể làm mới — đang giữ snapshot trước. ' : ''}${messageOf(error)}`);
      }
      return null;
    } finally {
      if (request === sequence.current && account.current === owner) setLoading(false);
    }
  }, [profile.id, current]);

  useEffect(() => {
    account.current = profile.id;
    void load(library, offset, false);
    return () => { sequence.current += 1; };
  }, [profile.id, library, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  const findCanonical = useCallback(async (targetLibrary: Exclude<Library, ''>, slug: string) => {
    const query = new URLSearchParams({ library: targetLibrary, identity: slug, limit: '1', offset: '0' });
    const data = normalizeReadingContentList(await window.api.get<unknown>(`/admin/reading/content?${query}`), { limit: 1, offset: 0 }) as { rows: Row[]; malformedCount: number; limit: number; offset: number; total: number } | null;
    if (!data || data.malformedCount) throw new Error('Canonical readback không đúng contract.');
    if (data.total === 0 && data.rows.length === 0) return null;
    if (data.total !== 1 || data.rows.length !== 1 || data.rows[0].slug !== slug) throw new Error('Canonical readback trả identity không nhất quán.');
    return data.rows[0];
  }, []);

  const resetImport = () => {
    setSingleFile(null); setTestFile(null); setSolutionFile(null); setMini(false);
    setPreview(null); setImportError(null); setImportMode('single');
  };

  const dryRunSingle = async (file: File) => {
    if (!/\.(md|markdown)$/i.test(file.name)) return setImportError('Chỉ chấp nhận file .md hoặc .markdown.');
    setSingleFile(file); setImportMode('single'); setPreview(null); setImportError(null); setBusy(true);
    try {
      const form = new FormData(); form.append('file', file);
      const data = normalizeReadingImport(await window.api.upload<unknown>('/admin/reading/content/import?dry_run=true', form), true) as ImportResult | null;
      if (!data) throw new Error('Kết quả kiểm định không đúng contract.');
      setPreview(data);
    } catch (error) { setImportError(messageOf(error)); }
    finally { setBusy(false); }
  };

  const dryRunBundle = async (nextTest: File | null, nextSolution: File | null) => {
    setTestFile(nextTest); setSolutionFile(nextSolution); setImportMode('bundle'); setPreview(null); setImportError(null);
    if (!nextTest || !nextSolution) return;
    if (![nextTest, nextSolution].every((file) => /\.(md|markdown)$/i.test(file.name))) return setImportError('Cả file đề và file giải phải là .md hoặc .markdown.');
    setBusy(true);
    try {
      const form = new FormData(); form.append('test_file', nextTest); form.append('solution_file', nextSolution);
      const data = normalizeReadingImport(await window.api.upload<unknown>('/admin/reading/content/import-bundle?dry_run=true', form), true) as ImportResult | null;
      if (!data) throw new Error('Kết quả kiểm định bundle không đúng contract.');
      setPreview(data);
    } catch (error) { setImportError(messageOf(error)); }
    finally { setBusy(false); }
  };

  const commitImport = async () => {
    if (!preview || preview.validationErrors.length || busy) return;
    setBusy(true); setImportError(null); setBanner(null);
    try {
      const form = new FormData(); let path = '/admin/reading/content/import?dry_run=false';
      if (importMode === 'bundle') {
        if (!testFile || !solutionFile) throw new Error('Thiếu file đề hoặc file giải.');
        form.append('test_file', testFile); form.append('solution_file', solutionFile);
        path = `/admin/reading/content/import-bundle?dry_run=false&published=true${mini ? '&mini=true' : ''}`;
      } else {
        if (!singleFile) throw new Error('Thiếu file nội dung.');
        form.append('file', singleFile);
      }
      const ack = normalizeReadingImport(await window.api.upload<unknown>(path, form), false) as ImportResult | null;
      if (!ack || ack.validationErrors.length || !ack.committedId || !ack.action) throw new Error('ACK lưu nội dung không đầy đủ; chưa thể xác nhận thành công.');
      const parsed = preview.parsed || {};
      const targetLibrary = String(parsed.library || '') as Exclude<Library, ''>;
      const targetSlug = String(parsed.test_id || parsed.slug || '');
      if (!['l1_vocab', 'l2_skill', 'l3_test'].includes(targetLibrary) || !targetSlug) throw new Error('Không xác định được identity để đối chiếu sau lưu.');
      const canonical = await findCanonical(targetLibrary, targetSlug);
      if (!canonical || canonical.id !== ack.committedId) throw new Error('Đã nhận ACK nhưng canonical readback chưa khớp; hãy tải lại trước khi thao tác tiếp.');
      resetImport();
      await load(library, offset, false);
      setBanner({ kind: 'success', text: `Đã ${ack.action === 'created' ? 'tạo' : 'cập nhật'} “${canonical.title}” và xác minh lại từ thư viện.` });
    } catch (error) { setImportError(messageOf(error)); }
    finally { setBusy(false); }
  };

  const runAction = async () => {
    if (!action || busy) return;
    const row = action.row; setBusy(true); setBanner(null);
    try {
      if (action.kind === 'exam') {
        const next = !row.examOnly;
        if (!normalizeExamOnlyAck(await window.api.post<unknown>(`/admin/reading/content/tests/${encodeURIComponent(row.slug)}/exam-only`, { exam_only: next }), row.slug, next)) throw new Error('ACK chuyển thư viện không khớp.');
        const canonical = await findCanonical('l3_test', row.slug);
        if (!canonical || canonical.examOnly !== next) throw new Error('Canonical readback chưa phản ánh trạng thái exam-only.');
        setBanner({ kind: 'success', text: next ? 'Đã giữ riêng đề cho kỳ thi.' : 'Đã trả đề về thư viện luyện tập.' });
      } else if (action.kind === 'lock') {
        const next = !row.locked;
        const ack = normalizeLockAck(await window.api.post<unknown>(`/admin/reading/content/tests/${encodeURIComponent(row.slug)}/lock`, { locked: next }), row.slug, next);
        if (!ack) throw new Error('ACK khóa bài không khớp.');
        const credential = next ? `Mật khẩu mới: ${ack.password} — hãy sao chép ngay; mật khẩu cũ đã hết hiệu lực.` : '';
        if (next) { setAction(null); setBanner({ kind: 'info', text: credential }); }
        try {
          const canonical = await findCanonical('l3_test', row.slug);
          if (!canonical || canonical.locked !== next) throw new Error('Canonical readback chưa phản ánh trạng thái khóa.');
        } catch (error) {
          if (!next) throw error;
          setBanner({ kind: 'info', text: `${credential} Đã nhận ACK nhưng chưa đọc lại được trạng thái canonical (${messageOf(error)}). Hãy lưu mật khẩu rồi làm mới thư viện.` });
          return;
        }
        setBanner({ kind: next ? 'info' : 'success', text: next ? credential : 'Đã mở khóa và hủy mật khẩu cũ.' });
      } else {
        const ack = normalizeDeleteAck(await window.api.delete<unknown>(row.library === 'l3_test' ? `/admin/reading/content/tests/${encodeURIComponent(row.slug)}` : `/admin/reading/content/passages/${encodeURIComponent(row.slug)}`), row);
        if (!ack) throw new Error('ACK xóa nội dung không khớp identity.');
        const canonical = await findCanonical(row.library as Exclude<Library, ''>, row.slug);
        if (ack.action === 'archived' ? canonical?.status !== 'archived' : canonical !== null) throw new Error('Canonical readback chưa xác nhận kết quả xóa/archive.');
        setBanner({ kind: 'success', text: ack.action === 'archived' ? `Đã archive; giữ nguyên ${ack.attemptsPreserved} lượt làm bài.` : 'Đã xóa nội dung khỏi thư viện.' });
      }
      setAction(null); await load(library, offset, false);
    } catch (error) { setBanner({ kind: 'error', text: messageOf(error) }); }
    finally { setBusy(false); }
  };

  const generateShare = async () => {
    if (!shareRow || busy || shareDays < 1 || shareDays > 90) return;
    setBusy(true); setBanner(null); setShareReadbackWarning(null);
    try {
      const ack = normalizeShareAck(await window.api.post<unknown>(`/admin/reading/content/tests/${encodeURIComponent(shareRow.slug)}/share`, { expires_in_days: shareDays }), shareRow.slug);
      if (!ack) throw new Error('ACK tạo liên kết không khớp.');
      const url = canonicalReadingShareUrl(ack.token, window.location);
      setShareUrl(url);
      let canonical: Row | null;
      try {
        canonical = await findCanonical('l3_test', shareRow.slug);
        if (!canonical?.shareActive || canonical.shareExpiresAt !== ack.expiresAt) throw new Error('Canonical readback chưa xác nhận liên kết mới.');
      } catch (error) {
        const warning = `Đã nhận ACK và tạo link mới, nhưng chưa đọc lại được trạng thái canonical (${messageOf(error)}). Hãy sao chép link rồi làm mới thư viện.`;
        setShareReadbackWarning(warning);
        setBanner({ kind: 'info', text: warning });
        return;
      }
      setShareRow(canonical);
      setShareReadbackWarning(null);
      await load(library, offset, false);
    } catch (error) { setBanner({ kind: 'error', text: messageOf(error) }); }
    finally { setBusy(false); }
  };

  const revokeShare = async () => {
    if (!shareRow || busy) return; setBusy(true); setBanner(null);
    try {
      if (!normalizeShareAck(await window.api.post<unknown>(`/admin/reading/content/tests/${encodeURIComponent(shareRow.slug)}/share`, { revoke: true }), shareRow.slug, true)) throw new Error('ACK hủy liên kết không khớp.');
      const canonical = await findCanonical('l3_test', shareRow.slug);
      if (!canonical || canonical.shareActive) throw new Error('Canonical readback chưa xác nhận hủy liên kết.');
      setShareUrl(''); setShareReadbackWarning(null); setShareRow(null); await load(library, offset, false);
      setBanner({ kind: 'success', text: 'Đã hủy liên kết; token cũ không còn quyền truy cập.' });
    } catch (error) { setBanner({ kind: 'error', text: messageOf(error) }); }
    finally { setBusy(false); }
  };

  const chooseLibrary = (next: Library) => { sequence.current += 1; setLibrary(next); setOffset(0); setBanner(null); };
  const maxPage = current ? Math.max(1, Math.ceil(current.total / PAGE_SIZE)) : 1;
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  return <main className="arc-shell">
    <header className="arc-hero"><div><p className="arc-eyebrow">Reading · Content operations</p><h1>Thư viện nội dung Reading</h1><p>Kiểm định file trước khi ghi, rồi vận hành passage và full test trên trạng thái canonical của backend.</p></div><a href="/admin/reading">← Reading workspace</a></header>

    {banner && <div className={`arc-banner is-${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}><span>{banner.text}</span><button type="button" onClick={() => setBanner(null)} aria-label="Đóng thông báo">×</button></div>}

    <section className="arc-import" aria-labelledby="arc-import-title">
      <div className="arc-section-head"><div><p>01 · Import & kiểm định</p><h2 id="arc-import-title">Dry-run trước, commit sau</h2></div><a href="https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/blob/main/docs/clusters/20_x/reading_content_format_v2.md" target="_blank" rel="noreferrer">Xem đặc tả ↗</a></div>
      <div className="arc-import-grid">
        <article><div className="arc-import-card__head"><span>1 FILE</span><div><h3>L1 / L2 / L3 YAML</h3><p>Idempotent theo slug hoặc test_id.</p></div></div><label className="arc-file"><strong>{singleFile?.name || 'Chọn file Markdown'}</strong><span>.md hoặc .markdown</span><input type="file" accept=".md,.markdown,text/markdown" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void dryRunSingle(file); }} /></label><a download href="/templates/reading/l2-a2-detail-emperor-penguins.md">Tải khuôn mẫu L1/L2</a></article>
        <article><div className="arc-import-card__head"><span>2 FILE</span><div><h3>Full test đề + giải</h3><p>Ghép answer key, bản dịch và giải chi tiết.</p></div></div><div className="arc-bundle-files"><label>File đề<input type="file" accept=".md,.markdown,text/markdown" disabled={busy} onChange={(event) => void dryRunBundle(event.target.files?.[0] || null, solutionFile)} /><span>{testFile?.name || 'Chưa chọn'}</span></label><label>File giải<input type="file" accept=".md,.markdown,text/markdown" disabled={busy} onChange={(event) => void dryRunBundle(testFile, event.target.files?.[0] || null)} /><span>{solutionFile?.name || 'Chưa chọn'}</span></label></div><label className="arc-check"><input type="checkbox" checked={mini} onChange={(event) => setMini(event.target.checked)} /> Đây là Mini test (1 passage)</label></article>
      </div>
      {busy && !preview && <div className="arc-import-state" role="status">Đang phân tích nội dung…</div>}
      {importError && <div className="arc-import-state is-error" role="alert">{importError}</div>}
      {preview && <div className="arc-preview"><div className="arc-preview__head"><div><p>KẾT QUẢ DRY-RUN</p><h3>{preview.validationErrors.length ? 'Cần sửa file trước khi lưu' : 'Sẵn sàng lưu vào thư viện'}</h3></div><span className={`adm-status-pill ${preview.validationErrors.length ? 'is-failed' : 'is-live'}`}>{preview.validationErrors.length ? `${preview.validationErrors.length} LỖI` : 'VALID'}</span></div>
        {!!preview.validationErrors.length && <ul className="arc-issues is-error">{preview.validationErrors.map((issue, index) => <li key={`${issue.field}:${index}`}><code>{issue.field}</code> {issue.message}</li>)}</ul>}
        {!!preview.warnings.length && <div className="arc-issues is-warning"><strong>{preview.warnings.length} cảnh báo không chặn lưu</strong><ul>{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
        <dl className="arc-kv">{previewRows(preview.parsed, preview.bundleSummary).map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
        <div className="arc-preview__actions"><button className="btn-secondary" type="button" disabled={busy} onClick={resetImport}>Hủy</button><button className="btn-primary" type="button" disabled={busy || !!preview.validationErrors.length} onClick={() => void commitImport()}>{busy ? 'Đang đối chiếu…' : 'Lưu và xác minh'}</button></div>
      </div>}
    </section>

    <section className="arc-library" aria-labelledby="arc-library-title"><div className="arc-section-head"><div><p>02 · Canonical library</p><h2 id="arc-library-title">Nội dung đã lưu</h2></div><button className="btn-secondary" type="button" disabled={loading || busy} onClick={() => void load(library, offset)}>{loading ? 'Đang tải…' : 'Làm mới'}</button></div>
      <div className="arc-filters" role="tablist" aria-label="Lọc theo thư viện">{([['', 'Tất cả'], ['l1_vocab', 'L1 Vocab'], ['l2_skill', 'L2 Skill'], ['l3_test', 'L3 Test']] as [Library, string][]).map(([value, label]) => <button type="button" role="tab" aria-selected={library === value} key={value || 'all'} onClick={() => chooseLibrary(value)}>{label}</button>)}</div>
      {loadError && <div className="arc-read-error" role="alert"><strong>Không tải được thư viện.</strong><span>{loadError}</span></div>}
      {!!current?.malformed && <div className="arc-read-error is-warning" role="status">Đã loại {current.malformed} dòng sai contract; tổng từ server vẫn giữ nguyên.</div>}
      {loading && !current && <div className="arc-empty" role="status">Đang đọc thư viện…</div>}
      {current && !current.rows.length && <div className="arc-empty"><strong>Chưa có nội dung trong nhóm này</strong><span>Import file ở phía trên để bắt đầu.</span></div>}
      {!!current?.rows.length && <div className="arc-table-wrap" role="region" aria-label="Bảng nội dung Reading" tabIndex={0}><table className="arc-table"><thead><tr><th>Nội dung</th><th>Thư viện</th><th>Trạng thái</th><th>Cập nhật</th><th>Thao tác</th></tr></thead><tbody>{current.rows.map((row) => <tr key={row.id}><td data-label="Nội dung"><strong>{row.title}</strong><code>{row.slug}</code><small>{[row.skillFocus, row.difficultyLevel].filter(Boolean).join(' · ') || 'Chưa có mô tả kỹ năng'}</small></td><td data-label="Thư viện"><span className="arc-library-pill">{READING_LIBRARY_LABEL[row.library]}</span>{row.examOnly && <small>Đề kỳ thi</small>}</td><td data-label="Trạng thái"><span className={`adm-status-pill is-${row.status === 'published' ? 'live' : row.status === 'archived' ? 'failed' : 'new'}`}>{row.status}</span>{row.locked && <small>🔒 Có mật khẩu</small>}{row.shareActive && <small>🔗 Đang chia sẻ</small>}</td><td data-label="Cập nhật"><time dateTime={row.updatedAt || undefined}>{formatReadingContentDate(row.updatedAt)}</time></td><td data-label="Thao tác"><div className="arc-actions">{row.library === 'l3_test' ? <><a href={readingPreviewHref(row.slug)} target="_blank" rel="noreferrer">Xem trước</a><button type="button" disabled={busy} onClick={() => setAction({ kind: 'exam', row })}>{row.examOnly ? 'Trả thư viện' : 'Dành cho kỳ thi'}</button><button type="button" disabled={busy} onClick={() => setAction({ kind: 'lock', row })}>{row.locked ? 'Mở khóa' : 'Khóa'}</button><button type="button" disabled={busy} onClick={() => { setShareRow(row); setShareUrl(''); setShareReadbackWarning(null); }}>Chia sẻ</button></> : <a href={`/pages/${row.library === 'l1_vocab' ? 'reading-vocab-passage' : 'reading-skill-exercise'}.html?slug=${encodeURIComponent(row.slug)}`} target="_blank" rel="noreferrer">Xem bài</a>}<button type="button" onClick={() => { document.querySelector('.arc-import')?.scrollIntoView({ behavior: 'smooth' }); setBanner({ kind: 'info', text: `Để sửa “${row.title}”, import lại file cùng ${row.library === 'l3_test' ? 'test_id' : 'slug'}; backend sẽ cập nhật idempotent.` }); }}>Sửa</button><button className="is-danger" type="button" disabled={busy} onClick={() => setAction({ kind: 'delete', row })}>Xóa</button></div></td></tr>)}</tbody></table></div>}
      {current && current.total > PAGE_SIZE && <nav className="arc-pagination" aria-label="Phân trang thư viện"><button type="button" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>← Trước</button><span>Trang {page}/{maxPage} · {current.total} nội dung</span><button type="button" disabled={loading || offset + PAGE_SIZE >= current.total} onClick={() => setOffset(offset + PAGE_SIZE)}>Sau →</button></nav>}
    </section>

    {action && <div className="av-modal-backdrop arc-dialog" role="dialog" aria-modal="true" aria-labelledby="arc-action-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setAction(null); }}><div className="av-modal arc-dialog__panel"><p className="arc-eyebrow">Xác nhận thay đổi</p><h2 id="arc-action-title">{action.kind === 'delete' ? 'Xóa nội dung?' : action.kind === 'lock' ? (action.row.locked ? 'Mở khóa bài?' : 'Tạo mật khẩu mới?') : (action.row.examOnly ? 'Trả đề về thư viện?' : 'Giữ riêng cho kỳ thi?')}</h2><p>{action.kind === 'delete' && action.row.library === 'l3_test' ? 'Nếu đã có attempt, server chỉ archive và giữ toàn bộ dữ liệu học viên. Nếu chưa có attempt, nội dung sẽ bị xóa vật lý.' : action.kind === 'delete' ? 'Passage và câu hỏi L1/L2 sẽ bị xóa vật lý; có thể phục hồi bằng re-import.' : action.kind === 'lock' ? 'Mỗi lần khóa tạo mật khẩu mới và vô hiệu hóa mật khẩu cũ.' : 'Backend sẽ chặn trả đề về thư viện nếu một kỳ thi đang hoạt động còn sử dụng đề.'}</p><strong>{action.row.title}</strong><div className="av-modal-footer"><button className="btn-secondary" type="button" disabled={busy} onClick={() => setAction(null)}>Hủy</button><button className={action.kind === 'delete' ? 'btn-danger' : 'btn-primary'} type="button" disabled={busy} onClick={() => void runAction()}>{busy ? 'Đang xác minh…' : 'Xác nhận'}</button></div></div></div>}

    {shareRow && <div className="av-modal-backdrop arc-dialog" role="dialog" aria-modal="true" aria-labelledby="arc-share-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setShareRow(null); }}><div className="av-modal arc-dialog__panel"><p className="arc-eyebrow">Quyền truy cập</p><h2 id="arc-share-title">Liên kết chia sẻ</h2><p>Tạo lại link sẽ vô hiệu hóa token cũ ngay lập tức. Người có link hợp lệ có thể bỏ qua mật khẩu bài.</p><label className="arc-days">Thời hạn (1–90 ngày)<input type="number" min="1" max="90" value={shareDays} onChange={(event) => setShareDays(Number(event.target.value))} /></label>{shareRow.shareActive && <p className="arc-share-state">Đang chia sẻ{shareRow.shareExpiresAt ? ` · hết hạn ${formatReadingContentDate(shareRow.shareExpiresAt)}` : ''}</p>}{shareUrl && <label className="arc-share-url">Sao chép link mới ngay<input readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} /></label>}{shareReadbackWarning && <p className="arc-share-warning" role="status">{shareReadbackWarning}</p>}<div className="av-modal-footer"><button className="btn-secondary" type="button" disabled={busy} onClick={() => setShareRow(null)}>Đóng</button>{shareRow.shareActive && !shareReadbackWarning && <button className="btn-danger" type="button" disabled={busy} onClick={() => void revokeShare()}>Hủy link</button>}<button className="btn-primary" type="button" disabled={busy || !!shareReadbackWarning || shareDays < 1 || shareDays > 90} onClick={() => void generateShare()}>{busy ? 'Đang xác minh…' : shareRow.shareActive ? 'Tạo lại link' : 'Tạo link'}</button></div></div></div>}
  </main>;
}

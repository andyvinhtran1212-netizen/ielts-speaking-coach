'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog } from '@/components/admin-directory-ui';
import {
  buildListeningContentPatch, listeningContentDetailHref, listeningContentDraft,
  listeningContentEditorRollbackHref, listeningContentPatchMatches,
  normalizeListeningContentEditor, normalizePendingListeningContentEdit,
  parseListeningTopicTags, validateListeningContentDraft,
} from '@/lib/admin-listening-content-editor-model.mjs';

type Snapshot = { id: string; title: string; transcript: string; accent: string; cefr: string | null; ieltsSection: number | null; topicTags: string[]; isPremium: boolean; externalLicense: string | null; externalSourceUrl: string | null; status: 'draft' | 'published' | 'archived'; sourceType: string | null; audioStoragePath: string | null; updatedAt: string };
type Draft = { title: string; transcript: string; accent: string; cefr: string | null; ieltsSection: number | null; topicTags: string[]; isPremium: boolean; externalLicense: string; externalSourceUrl: string };
type Pending = { account: string; contentId: string; startedAt: string; patch: Record<string, unknown> };
type Banner = { kind: 'success' | 'error' | 'warning'; title: string; text: string } | null;
type Confirm = 'reset' | 'leave' | 'reload' | 'discard-pending' | null;

const ACCENT_COPY: Record<string, string> = { us_general: 'US General', uk_rp: 'UK RP', au: 'Australian', ca: 'Canadian', other: 'Khác' };
const STATUS_COPY: Record<string, string> = { draft: 'Bản nháp', published: 'Đã phát hành', archived: 'Đã lưu trữ' };
const fieldNames: Record<string, string> = { title: 'Tiêu đề', transcript: 'Transcript', accent_tag: 'Accent', cefr_level: 'CEFR', ielts_section: 'IELTS section', topic_tags: 'Topic tags', is_premium: 'Premium', external_license: 'License', external_source_url: 'Source URL' };
const messageOf = (caught: unknown) => caught instanceof Error ? caught.message : String(caught || 'Lỗi không xác định');
const statusOf = (caught: unknown) => Number((caught as { status?: number; statusCode?: number })?.status || (caught as { statusCode?: number })?.statusCode || 0);
const definitive = (status: number) => [400, 401, 403, 404, 409, 422].includes(status);
const receiptKey = (account: string, contentId: string) => `alme-pending:${account}:${contentId}`;

function readReceipt(key: string) { try { return sessionStorage.getItem(key); } catch { return null; } }
function writeReceipt(key: string, value: string) { try { sessionStorage.setItem(key, value); return sessionStorage.getItem(key) === value; } catch { return false; } }
function clearReceipt(key: string) { try { sessionStorage.removeItem(key); } catch { /* storage is already unavailable */ } }
const arraysEqual = (left: string[], right: string[]) => left.length === right.length && left.every((value, index) => value === right[index]);

export function AdminListeningContentEditor({ contentId }: { contentId: string }) {
  const profile = useAdminProfile();
  const scope = `${profile.id}:${contentId}`;
  const sequence = useRef(0);
  const account = useRef(profile.id);
  const [baseline, setBaseline] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tagsText, setTagsText] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [conflict, setConflict] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<Banner>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const editorDraft = useMemo(() => draft ? { ...draft, topicTags: parseListeningTopicTags(tagsText) } : null, [draft, tagsText]);
  const build = useMemo(() => baseline && editorDraft ? buildListeningContentPatch(baseline, editorDraft) : null, [baseline, editorDraft]);
  const dirty = Boolean(baseline && draft && editorDraft && (
    draft.title.trim() !== baseline.title || draft.transcript !== baseline.transcript || draft.accent !== baseline.accent
    || draft.cefr !== baseline.cefr || draft.ieltsSection !== baseline.ieltsSection
    || !arraysEqual(editorDraft.topicTags, baseline.topicTags) || draft.isPremium !== baseline.isPremium
    || draft.externalLicense.trim() !== (baseline.externalLicense || '') || draft.externalSourceUrl.trim() !== (baseline.externalSourceUrl || '')
  ));
  const locked = busy || Boolean(pending) || conflict;
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;

  const readCanonical = useCallback(async () => {
    const raw = await window.api.get<unknown>(`/admin/listening/content/${encodeURIComponent(contentId)}`);
    const snapshot = normalizeListeningContentEditor(raw, contentId) as Snapshot | null;
    if (!snapshot) throw new Error('Metadata trả về không đúng contract canonical.');
    return snapshot;
  }, [contentId]);

  const install = useCallback((snapshot: Snapshot) => {
    setBaseline(snapshot); setDraft(listeningContentDraft(snapshot) as Draft);
    setTagsText(snapshot.topicTags.join(', ')); setFieldErrors({}); setConflict(false);
  }, []);

  const load = useCallback(async () => {
    const request = ++sequence.current;
    account.current = profile.id;
    setLoading(true); setLoadError(null); setBanner(null); setBaseline(null); setDraft(null); setPending(null); setConflict(false);
    try {
      const snapshot = await readCanonical();
      if (request !== sequence.current || account.current !== profile.id) return;
      install(snapshot);
      const key = receiptKey(profile.id, contentId);
      let restored: Pending | null = null;
      try { restored = normalizePendingListeningContentEdit(JSON.parse(readReceipt(key) || 'null'), profile.id, contentId) as Pending | null; } catch { clearReceipt(key); }
      if (restored && listeningContentPatchMatches(snapshot, restored.patch)) {
        clearReceipt(key);
        setBanner({ kind: 'success', title: 'Đã đối chiếu lượt lưu trước', text: 'Canonical GET đã chứa đúng toàn bộ delta; không PATCH lại.' });
      } else if (restored) {
        setPending(restored);
        setBanner({ kind: 'warning', title: 'Có lượt lưu chưa đối chiếu', text: 'Biểu mẫu đang khóa. Chỉ đọc lại canonical hoặc bỏ biên nhận sau khi kiểm tra; hệ thống không tự PATCH lần hai.' });
      }
    } catch (caught) {
      if (request === sequence.current) setLoadError(messageOf(caught));
    } finally { if (request === sequence.current) setLoading(false); }
  }, [contentId, install, profile.id, readCanonical]);

  useEffect(() => { void load(); return () => { sequence.current += 1; }; }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (!hasFieldErrors || !editorDraft) return;
    const validation = validateListeningContentDraft(editorDraft) as { errors: Record<string, string> };
    setFieldErrors(validation.errors);
  }, [editorDraft, hasFieldErrors]);

  const reconcile = async () => {
    if (!pending || busy) return;
    setBusy(true); setBanner(null);
    try {
      const snapshot = await readCanonical();
      if (account.current !== pending.account) return;
      if (!listeningContentPatchMatches(snapshot, pending.patch)) throw new Error('Canonical hiện chưa chứa đủ delta của lượt lưu trước.');
      clearReceipt(receiptKey(pending.account, pending.contentId)); setPending(null); install(snapshot);
      setBanner({ kind: 'success', title: 'Đã xác nhận lưu', text: 'GET canonical khớp toàn bộ delta; không gửi lại PATCH.' });
    } catch (caught) { setBanner({ kind: 'error', title: 'Chưa đối chiếu được', text: messageOf(caught) }); }
    finally { if (account.current === profile.id) setBusy(false); }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!baseline || !editorDraft || locked) return;
    const result = buildListeningContentPatch(baseline, editorDraft) as { ok: boolean; errors: Record<string, string>; patch: Record<string, unknown> | null; changedFields: string[] };
    setFieldErrors(result.errors || {});
    if (!result.ok || !result.patch) { setBanner({ kind: 'error', title: 'Chưa thể lưu', text: 'Kiểm tra các trường được đánh dấu trong biểu mẫu.' }); return; }
    if (!result.changedFields.length) { setBanner({ kind: 'warning', title: 'Không có thay đổi', text: 'Canonical hiện tại đã trùng với biểu mẫu.' }); return; }
    const operation: Pending = { account: profile.id, contentId, startedAt: new Date().toISOString(), patch: result.patch };
    if (!writeReceipt(receiptKey(profile.id, contentId), JSON.stringify(operation))) {
      setBanner({ kind: 'error', title: 'Không thể tạo biên nhận an toàn', text: 'Trình duyệt đang chặn sessionStorage. Không có PATCH nào được gửi; hãy bật lưu trữ cho trang rồi thử lại.' });
      return;
    }
    setPending(operation); setBusy(true); setBanner(null);
    let patchAcknowledged = false;
    try {
      await window.api.patch(`/admin/listening/content/${encodeURIComponent(contentId)}`, result.patch);
      patchAcknowledged = true;
      const snapshot = await readCanonical();
      if (account.current !== operation.account) return;
      if (!listeningContentPatchMatches(snapshot, operation.patch)) throw new Error('PATCH có response nhưng canonical readback chưa khớp delta.');
      clearReceipt(receiptKey(operation.account, operation.contentId)); setPending(null); install(snapshot);
      setBanner({ kind: 'success', title: 'Đã lưu metadata', text: `${result.changedFields.map((key) => fieldNames[key] || key).join(' · ')} đã được backend xác nhận.` });
    } catch (caught) {
      if (account.current !== operation.account) return;
      const status = statusOf(caught);
      if (!patchAcknowledged && definitive(status)) {
        clearReceipt(receiptKey(operation.account, operation.contentId)); setPending(null);
        if (status === 409) setConflict(true);
        setBanner({ kind: 'error', title: status === 409 ? 'Có thay đổi song song' : 'Backend từ chối thay đổi', text: status === 409 ? 'Bản canonical đã đổi sau khi trang mở. Tải bản mới trước khi sửa tiếp để không ghi đè.' : messageOf(caught) });
      } else setBanner({ kind: 'warning', title: patchAcknowledged ? 'PATCH đã nhận, chưa đọc lại được' : 'Kết quả PATCH chưa rõ', text: `${messageOf(caught)} Biên nhận được giữ lại; dùng “Đối chiếu canonical”, không gửi lại.` });
    } finally { if (account.current === operation.account) setBusy(false); }
  };

  const applyConfirm = () => {
    if (!baseline) return setConfirm(null);
    if (confirm === 'reset') install(baseline);
    if (confirm === 'leave') window.location.assign(listeningContentDetailHref(contentId));
    if (confirm === 'reload') void load();
    if (confirm === 'discard-pending') { clearReceipt(receiptKey(profile.id, contentId)); setPending(null); void load(); }
    setConfirm(null);
  };

  if (loading) return <main className="alme-shell"><div className="alme-state" role="status"><span className="alme-spinner"/><strong>Đang đọc metadata canonical…</strong></div></main>;
  if (loadError || !baseline || !draft) return <main className="alme-shell"><div className="alc-banner is-error" role="alert"><strong>Không mở được editor</strong><span>{loadError || 'Không có snapshot hợp lệ.'}</span></div><button className="adm-btn-secondary" type="button" onClick={() => void load()}>Thử lại</button></main>;

  const changed = build?.changedFields || [];
  return <main className="alme-shell">
    <nav className="alme-breadcrumb" aria-label="Breadcrumb"><a href="/admin/listening">Listening content</a><span aria-hidden="true">/</span><a href={listeningContentDetailHref(contentId)}>Chi tiết</a><span aria-hidden="true">/</span><span>Sửa metadata</span></nav>
    {banner && <div className={`alc-banner is-${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}><strong>{banner.title}</strong><span>{banner.text}</span></div>}
    <header className="alme-hero"><div><p className="alc-eyebrow">Listening · Canonical editor</p><h1>Sửa metadata</h1><p>Chỉ gửi các trường thay đổi; backend khóa theo phiên bản và GET lại trước khi báo thành công.</p><code>{baseline.id}</code></div><div className="alme-hero__truth"><span className={`adm-status-pill ${baseline.status === 'published' ? 'is-live' : baseline.status === 'archived' ? 'is-failed' : 'is-new'}`}>{STATUS_COPY[baseline.status]}</span><strong>{dirty ? `${changed.length || 'Có'} thay đổi chưa lưu` : 'Đã đồng bộ canonical'}</strong><small>Phiên bản {new Date(baseline.updatedAt).toLocaleString('vi-VN')}</small></div></header>
    {pending && <section className="alme-receipt" aria-labelledby="alme-pending"><div><p className="alc-eyebrow">Pending receipt</p><h2 id="alme-pending">Lượt lưu cần đối chiếu</h2><p>Biên nhận {new Date(pending.startedAt).toLocaleString('vi-VN')} chỉ cho phép GET; không tự phát lại PATCH.</p></div><div><button className="adm-btn-primary" type="button" disabled={busy} onClick={() => void reconcile()}>{busy ? 'Đang đọc…' : 'Đối chiếu canonical'}</button><button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => setConfirm('discard-pending')}>Bỏ biên nhận & tải lại</button></div></section>}
    {conflict && <section className="alme-receipt is-conflict" aria-labelledby="alme-conflict"><div><p className="alc-eyebrow">Version conflict</p><h2 id="alme-conflict">Canonical đã thay đổi ở nơi khác</h2><p>Không có dữ liệu nào từ form này được ghi đè. Tải snapshot mới trước khi tiếp tục.</p></div><button className="adm-btn-primary" type="button" onClick={() => setConfirm('reload')}>Tải canonical mới</button></section>}
    <form className="alme-layout" onSubmit={(event) => void save(event)} noValidate>
      <div className="alme-form">
        <section className="alme-card" aria-labelledby="alme-core"><div className="alme-card__head"><div><p className="alc-eyebrow">Nội dung cốt lõi</p><h2 id="alme-core">Tên và transcript</h2></div><span>Bắt buộc</span></div>
          <Field label="Tiêu đề" htmlFor="alme-title" error={fieldErrors.title}><input id="alme-title" value={draft.title} maxLength={200} disabled={locked} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/><small>{draft.title.length}/200</small></Field>
          <Field label="Transcript" htmlFor="alme-transcript" error={fieldErrors.transcript}><textarea id="alme-transcript" value={draft.transcript} maxLength={20_000} disabled={locked} onChange={(event) => setDraft({ ...draft, transcript: event.target.value })}/><small>{draft.transcript.length.toLocaleString('vi-VN')}/20.000 ký tự · giữ nguyên xuống dòng</small></Field>
        </section>
        <section className="alme-card" aria-labelledby="alme-classify"><div className="alme-card__head"><div><p className="alc-eyebrow">Phân loại</p><h2 id="alme-classify">Accent và độ khó</h2></div><span>Không tự gán mặc định</span></div><div className="alme-grid-3">
          <Field label="Accent" htmlFor="alme-accent" error={fieldErrors.accent}><select id="alme-accent" value={draft.accent} disabled={locked} onChange={(event) => setDraft({ ...draft, accent: event.target.value })}>{Object.entries(ACCENT_COPY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="CEFR" htmlFor="alme-cefr" error={fieldErrors.cefr}><select id="alme-cefr" value={draft.cefr || ''} disabled={locked} onChange={(event) => setDraft({ ...draft, cefr: event.target.value || null })}><option value="">Chưa phân loại</option>{['A2', 'B1', 'B2', 'C1', 'C2'].map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label="IELTS section" htmlFor="alme-section" error={fieldErrors.ieltsSection}><select id="alme-section" value={draft.ieltsSection || ''} disabled={locked} onChange={(event) => setDraft({ ...draft, ieltsSection: event.target.value ? Number(event.target.value) : null })}><option value="">Chưa gán</option>{[1, 2, 3, 4].map((value) => <option key={value} value={value}>Section {value}</option>)}</select></Field>
        </div></section>
        <section className="alme-card" aria-labelledby="alme-discovery"><div className="alme-card__head"><div><p className="alc-eyebrow">Khả năng tìm thấy</p><h2 id="alme-discovery">Topic tags</h2></div><span>{parseListeningTopicTags(tagsText).length} tag</span></div><Field label="Phân cách bằng dấu phẩy" htmlFor="alme-tags" error={fieldErrors.topicTags}><input id="alme-tags" value={tagsText} disabled={locked} placeholder="travel, work, environment" onChange={(event) => setTagsText(event.target.value)}/></Field><div className="alme-tags" aria-label="Topic tags preview">{parseListeningTopicTags(tagsText).map((tag) => <span key={tag.toLocaleLowerCase('vi-VN')}>{tag}</span>)}{!parseListeningTopicTags(tagsText).length && <em>Chưa có tag</em>}</div></section>
        <section className="alme-card" aria-labelledby="alme-rights"><div className="alme-card__head"><div><p className="alc-eyebrow">Quyền sử dụng</p><h2 id="alme-rights">License và paid tier</h2></div><span>Attribution rule</span></div><label className={`alme-switch${fieldErrors.isPremium ? ' is-error' : ''}`}><input type="checkbox" checked={draft.isPremium} disabled={locked} onChange={(event) => setDraft({ ...draft, isPremium: event.target.checked })}/><span><strong>Premium content</strong><small>Chỉ bật khi license cho phép khai thác thương mại.</small></span></label>{fieldErrors.isPremium && <span className="alme-error" role="alert">{fieldErrors.isPremium}</span>}<div className="alme-grid-2"><Field label="External license" htmlFor="alme-license" error={fieldErrors.externalLicense}><input id="alme-license" value={draft.externalLicense} maxLength={120} disabled={locked} placeholder="CC BY 4.0" onChange={(event) => setDraft({ ...draft, externalLicense: event.target.value })}/></Field><Field label="External source URL" htmlFor="alme-source" error={fieldErrors.externalSourceUrl}><input id="alme-source" type="url" value={draft.externalSourceUrl} maxLength={500} disabled={locked} placeholder="https://…" onChange={(event) => setDraft({ ...draft, externalSourceUrl: event.target.value })}/></Field></div></section>
      </div>
      <aside className="alme-side"><section className="alme-side-card"><p className="alc-eyebrow">Read-only truth</p><h2>Nguồn kỹ thuật</h2><dl><div><dt>Source type</dt><dd>{baseline.sourceType || '—'}</dd></div><div><dt>Audio</dt><dd>{baseline.audioStoragePath ? 'Có storage path' : 'Chưa có'}</dd></div><div><dt>Trạng thái</dt><dd>{STATUS_COPY[baseline.status]}</dd></div><div><dt>Version</dt><dd><code>{baseline.updatedAt}</code></dd></div></dl><p>Audio, duration, storage path và alignment không sửa ở màn này.</p></section><section className="alme-side-card"><p className="alc-eyebrow">Delta preview</p><h2>{changed.length ? `${changed.length} trường sẽ PATCH` : dirty ? 'Dữ liệu chưa hợp lệ' : 'Không có delta'}</h2><ul>{changed.map((key) => <li key={key}>{fieldNames[key] || key}</li>)}</ul></section><a className="alc-rollback" href={listeningContentEditorRollbackHref(contentId)}>Mở bản HTML rollback ↗</a></aside>
      <footer className="alme-actions"><div><strong>{dirty ? 'Có thay đổi chưa lưu' : 'Đã đồng bộ canonical'}</strong><span>{pending ? 'Đang chờ đối chiếu receipt' : conflict ? 'Phải tải phiên bản mới' : changed.length ? changed.map((key) => fieldNames[key] || key).join(' · ') : 'Không gửi PATCH nếu không có delta'}</span></div><div><button className="adm-btn-secondary" type="button" disabled={!dirty || locked} onClick={() => setConfirm('reset')}>Hoàn tác form</button><button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => dirty ? setConfirm('leave') : window.location.assign(listeningContentDetailHref(contentId))}>Về chi tiết</button><button className="adm-btn-primary" type="submit" disabled={!dirty || locked}>{busy ? 'Đang đối chiếu…' : 'Lưu thay đổi'}</button></div></footer>
    </form>
    <Dialog open={confirm !== null} title={confirm === 'leave' ? 'Rời editor và bỏ thay đổi?' : confirm === 'reset' ? 'Hoàn tác toàn bộ form?' : confirm === 'discard-pending' ? 'Bỏ biên nhận chưa đối chiếu?' : 'Tải snapshot canonical mới?'} description={confirm === 'discard-pending' ? 'Chỉ thực hiện sau khi bạn đã kiểm tra record; biên nhận trong tab này sẽ bị xóa.' : 'Thay đổi chưa lưu trong form sẽ không thể khôi phục.'} busy={false} onClose={() => setConfirm(null)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setConfirm(null)}>Tiếp tục sửa</button><button className="adm-btn-danger" type="button" onClick={applyConfirm}>{confirm === 'leave' ? 'Rời editor' : confirm === 'discard-pending' ? 'Bỏ biên nhận' : confirm === 'reset' ? 'Hoàn tác' : 'Tải lại'}</button></>}/>
  </main>;
}

function Field({ label, htmlFor, error, children }: { label: string; htmlFor: string; error?: string; children: React.ReactNode }) {
  return <label className={`alme-field${error ? ' is-error' : ''}`} htmlFor={htmlFor}><span>{label}</span>{children}{error && <em role="alert">{error}</em>}</label>;
}

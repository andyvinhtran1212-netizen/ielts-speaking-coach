'use client';

import { useEffect, useRef, useState } from 'react';
import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog } from '@/components/admin-directory-ui';
import { adminGrammarRevisionApi } from '@/lib/admin-grammar-revision-api';
import { secureRandomUuid } from '@/lib/secure-uuid.mjs';
import {
  GRAMMAR_REVISION_CODES, commandFits, freezeRevisionCommand, grammarSourceHash,
  isGrammarRevisionCode, normalizeRevisionAck, normalizeRevisionPreview, normalizeRevisionRead,
  revisionError, revisionReadbackMatches, sourceBytes,
  type FrozenRevisionCommand, type RevisionAck, type RevisionCode, type RevisionPreview, type RevisionRead,
} from '@/lib/admin-grammar-revision-model';
import styles from './admin-grammar-revision.module.css';

type ImportedSource = { code: RevisionCode; file: File } | null;
type Notice = { kind: 'error' | 'success' | 'info'; message: string };

/** One account-owned workspace; pending operation identity never transfers accounts. */
export function AdminGrammarRevision({ imported = null }: { imported?: ImportedSource }) {
  const profile = useAdminProfile();
  return <GrammarRevisionWorkspace key={profile.id} actor={profile.id} imported={imported} />;
}

function GrammarRevisionWorkspace({ actor, imported }: { actor: string; imported: ImportedSource }) {
  const [code, setCode] = useState<RevisionCode>(GRAMMAR_REVISION_CODES[0]);
  const [source, setSource] = useState('');
  const [filename, setFilename] = useState('');
  const [canonical, setCanonical] = useState<RevisionRead | null>(null);
  const [preview, setPreview] = useState<RevisionPreview | null>(null);
  const [previewSource, setPreviewSource] = useState('');
  const [pending, setPending] = useState<FrozenRevisionCommand | null>(null);
  const [rejected, setRejected] = useState<404 | 409 | 422 | null>(null);
  const [ack, setAck] = useState<RevisionAck | null>(null);
  const [verified, setVerified] = useState(false);
  const [readbackDrift, setReadbackDrift] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [denied, setDenied] = useState(false);
  const generation = useRef(0);
  const sourceSequence = useRef(0);
  const lock = useRef(false);
  const mounted = useRef(true);
  const activeCode = useRef(code);
  const sourceRef = useRef(source);
  const latestImported = useRef(imported);
  const transport = useRef<AbortController | null>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const readButton = useRef<HTMLButtonElement>(null);
  const recoveryButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  activeCode.current = code;
  sourceRef.current = source;
  // Prop ownership changes before effect cleanup must also fence token→fetch.
  if (latestImported.current !== imported) transport.current?.abort();
  latestImported.current = imported;
  const live = (ticket: number, target: RevisionCode) => mounted.current && ticket === generation.current && target === activeCode.current && latestImported.current === imported;
  const begin = () => { transport.current?.abort(); transport.current = new AbortController(); return ++generation.current; };
  const api = (ticket: number, target: RevisionCode) => adminGrammarRevisionApi(transport.current!.signal, () => live(ticket, target));

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; transport.current?.abort(); generation.current += 1; sourceSequence.current += 1; };
  }, []);
  useEffect(() => {
    if (!pending || busy || confirm) return;
    // The dialog opener is disabled after a command exists. Return keyboard
    // focus to the usable read/recovery action once that command settles.
    if (verified) readButton.current?.focus(); else recoveryButton.current?.focus();
  }, [pending, busy, confirm, verified, ack, rejected, readbackDrift]);

  const clearOperation = () => { setPreview(null); setPreviewSource(''); setPending(null); setRejected(null); setAck(null); setVerified(false); setReadbackDrift(false); setConfirm(false); };
  const showError = (caught: unknown) => {
    const error = revisionError(caught);
    if (error.permission) { setDenied(true); setCanonical(null); setSource(''); setFilename(''); clearOperation(); }
    setNotice({ kind: 'error', message: error.message });
  };
  const read = async (ticket: number, target: RevisionCode) => {
    const raw = await api(ticket, target).read(target);
    if (!live(ticket, target)) return null;
    const result = normalizeRevisionRead(raw, target);
    if (!result) throw new Error('invalid canonical response');
    return result;
  };
  useEffect(() => {
    const ticket = begin();
    setCanonical(null); clearOperation(); setNotice(null); setLoading(true);
    void read(ticket, code).then((result) => { if (result) setCanonical(result); })
      .catch((error) => { if (live(ticket, code)) showError(error); })
      .finally(() => { if (live(ticket, code)) setLoading(false); });
    return () => { transport.current?.abort(); generation.current += 1; };
    // Account ownership is enforced by the keyed parent. Imported source changes
    // invalidate prior read/operation ownership even when the code stays the same.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, imported]);

  const loadFile = async (file: File, target: RevisionCode) => {
    const ticket = ++sourceSequence.current;
    activeCode.current = target; setCode(target); setSource(''); setFilename(file.name);
    clearOperation(); setNotice(null);
    if (!file.size || file.size > 256 * 1024) { setNotice({ kind: 'error', message: 'File cần chứa từ 1 đến 256KiB UTF-8.' }); return; }
    // Preserve BOM and original Unicode/newlines; a source fingerprint is raw-byte identity.
    try {
      const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader(); reader.onerror = () => reject(new Error('file unavailable'));
        reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('invalid file'));
        reader.readAsArrayBuffer(file);
      });
      if (!mounted.current || ticket !== sourceSequence.current || activeCode.current !== target || latestImported.current !== imported) return;
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      if (sourceBytes(text) === null) throw new Error('invalid source');
      setSource(text);
    } catch { if (mounted.current && ticket === sourceSequence.current && activeCode.current === target && latestImported.current === imported) setNotice({ kind: 'error', message: 'Không đọc được file UTF-8 hợp lệ. Giữ nguyên nguồn đã duyệt và chọn lại file.' }); }
  };
  useEffect(() => {
    if (imported) {
      // Code-change read effect and FileReader must use the same subsequent generation.
      activeCode.current = imported.code;
      setCode(imported.code); setSource(''); setFilename(imported.file.name); clearOperation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imported]);
  useEffect(() => { if (imported && imported.code === code) void loadFile(imported.file, code); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [imported, code]);

  const chooseCode = (next: string) => {
    if (lock.current || !isGrammarRevisionCode(next) || next === code) return;
    transport.current?.abort(); generation.current += 1; sourceSequence.current += 1; activeCode.current = next; setCode(next); setSource(''); setFilename(''); setCanonical(null);
    clearOperation(); setNotice(null); if (fileInput.current) fileInput.current.value = '';
  };
  const refresh = async () => {
    if (lock.current || denied || (pending && !verified)) return;
    const ticket = begin(); const target = code;
    setLoading(true); setNotice(null); setCanonical(null); clearOperation();
    try { const result = await read(ticket, target); if (result) setCanonical(result); }
    catch (error) { if (live(ticket, target)) showError(error); }
    finally { if (live(ticket, target)) setLoading(false); }
  };
  const check = async () => {
    if (lock.current || !canonical || !canonical.publication_available || denied || pending) return;
    const text = source; const target = code; const expected = canonical;
    const body = { source_markdown: text, expected_revision: expected.revision };
    if (sourceBytes(text) === null || !commandFits(body)) { setNotice({ kind: 'error', message: 'Nguồn hoặc payload JSON vượt giới hạn UTF-8 256KiB, hoặc chứa Unicode không hợp lệ.' }); return; }
    lock.current = true; setBusy(true); setNotice(null); setPreview(null); setVerified(false);
    const ticket = begin();
    try {
      const digest = await grammarSourceHash(text);
      if (!live(ticket, target)) return;
      const raw = await api(ticket, target).preview(target, body);
      if (!live(ticket, target)) return;
      const value = normalizeRevisionPreview(raw, expected, digest);
      if (!value) throw new Error('invalid source/preview identity');
      setCanonical(value.canonical); setPreview(value); setPreviewSource(text);
      setNotice({ kind: 'info', message: value.canonical.footprint.authoritative_review_required
        ? 'Lịch sử cần kiểm tra có thẩm quyền. Chưa thể xác nhận sửa.' : 'Đã đối chiếu nguồn và bản xem trước. Kiểm tra đầy đủ trước khi xác nhận.' });
      previewButton.current?.focus();
    } catch (error) { if (live(ticket, target)) showError(error); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };

  const verifyReadback = async (command: FrozenRevisionCommand, receipt: RevisionAck, ticket: number) => {
    if (!live(ticket, command.code) || command.actor !== actor) return;
    const result = await read(ticket, command.code);
    if (!result) return;
    setCanonical(result); setConfirm(false);
    if (!revisionReadbackMatches(result, receipt)) {
      setReadbackDrift(true); setVerified(false);
      setNotice({ kind: 'info', message: 'Đã đọc trạng thái hiện hành, nhưng fingerprint khác ACK trước đó. Chưa xác nhận receipt khớp hiện tại; có thể đối soát bằng cùng mã và nội dung.' });
      return;
    }
    setReadbackDrift(false); setVerified(true);
    setNotice({ kind: receipt.current_matches_committed ? 'success' : 'info', message: receipt.current_matches_committed
      ? 'Đã xác nhận receipt và đọc lại trạng thái: bản sửa là phiên bản hiện hành, câu hỏi gốc và lịch sử được giữ.'
      : 'Đã xác nhận receipt và đọc lại trạng thái. Revision hiện tại đã khác thời điểm sửa; xem riêng hai fingerprint bên dưới.' });
  };
  const submit = async (recover = false) => {
    if (lock.current || denied) return;
    let command = pending;
    if (!recover) {
      if (!confirm || !preview || previewSource !== sourceRef.current || pending) return;
      command = freezeRevisionCommand(actor, code, previewSource, preview, secureRandomUuid());
      if (!command) { setNotice({ kind: 'error', message: 'Không tạo được thao tác từ bản xem trước hiện tại. Kiểm tra nguồn và lịch sử.' }); return; }
      setPending(command);
    }
    if (!command || command.actor !== actor || command.code !== code || command.body.source_markdown !== sourceRef.current) return;
    lock.current = true; setBusy(true); setNotice(null); setVerified(false); setReadbackDrift(false); setCanonical(null);
    const ticket = begin();
    let acceptedAck = false;
    try {
      const raw = await api(ticket, command.code).commit(command.code, command.body);
      if (!live(ticket, command.code)) return;
      const result = normalizeRevisionAck(raw, command);
      if (!result) throw new Error('invalid receipt identity');
      acceptedAck = true;
      setAck(result);
      await verifyReadback(command, result, ticket);
    } catch (error) {
      if (live(ticket, command.code)) {
        // Only a definitive refusal of the POST can release a rejected command.
        // Lost/unknown ACK and errors from readback after ACK retain its identity.
        const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
        if (!acceptedAck && !ack && (status === 404 || status === 409 || status === 422)) setRejected(status);
        setConfirm(false); showError(error);
      }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const discardRejected = async () => {
    if (lock.current || denied || !pending || rejected === null || ack) return;
    const target = pending.code; const ticket = begin();
    lock.current = true; setBusy(true); setLoading(true); setNotice(null);
    clearOperation(); setCanonical(null);
    try { const result = await read(ticket, target); if (result) setCanonical(result); }
    catch (error) { if (live(ticket, target)) showError(error); }
    finally { lock.current = false; if (mounted.current) setBusy(false); if (live(ticket, target)) setLoading(false); }
  };
  const retryReadback = async () => {
    if (lock.current || !pending || !ack || pending.actor !== actor || pending.code !== code || denied) return;
    lock.current = true; setBusy(true); setNotice(null); const ticket = begin();
    try { await verifyReadback(pending, ack, ticket); }
    catch (error) { if (live(ticket, code)) showError(error); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const eligible = !!preview && preview.canonical.publication_available && !preview.canonical.footprint.authoritative_review_required && !pending && previewSource === source;
  const bytes = sourceBytes(source);

  return <section className={styles.workspace} id="grammar-revision" aria-labelledby="grammar-revision-title" aria-busy={busy || loading}>
    <header><p className="avv-eyebrow">Grammar · Bản sửa đã duyệt</p><h2 id="grammar-revision-title">Xem trước và xác nhận bản sửa Grammar</h2><p>Chỉ 12 nguồn đã duyệt. Tạo một bản sửa riêng, giữ câu hỏi gốc và lịch sử; không dùng import thông thường để thay bản cũ.</p></header>
    <label>Nguồn Grammar<select aria-label="Nguồn Grammar đã duyệt" value={code} disabled={busy || denied} onChange={(event) => chooseCode(event.target.value)}>{GRAMMAR_REVISION_CODES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
    <div className={styles.actions}><button ref={readButton} type="button" onClick={() => void refresh()} disabled={busy || denied || (!!pending && !verified)}>Đọc lại trạng thái Grammar</button></div>
    {notice && <p className={`avv-banner is-${notice.kind === 'info' ? 'warning' : notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</p>}
    {loading ? <p role="status">Đang xác minh nguồn và lịch sử…</p> : !canonical ? <p>Chưa có trạng thái được xác minh. Số lượng lịch sử chưa xác định.</p> : <>
      <p>{canonical.is_managed ? (canonical.publication_available ? 'Nguồn có bản sửa; một lần sửa bổ sung đã được duyệt.' : 'Nguồn đã có bản sửa; không tạo thêm revision.') : 'Nguồn gốc chưa được sửa trong quy trình này.'} {canonical.new_starts_enabled ? 'Lượt bắt đầu mới đang được phép.' : 'Lượt bắt đầu mới đang tạm ngừng.'}</p>
      <p>Lịch sử và fingerprint dưới đây thuộc lần đọc đã xác minh gần nhất.</p>
      <dl className={styles.counts}>{[['Người học', canonical.footprint.actors], ['Phiên', canonical.footprint.sessions], ['Thống kê', canonical.footprint.stats], ['Lượt trả lời', canonical.footprint.attempts], ['Bài giao', canonical.footprint.assignments], ['Phiên mở', canonical.footprint.open_sessions], ['Phiên tạm dừng', canonical.footprint.paused_sessions]].map(([label, n]) => <div key={label}><dt>{label}</dt><dd>{n}</dd></div>)}</dl>
      {canonical.footprint.authoritative_review_required && <p role="alert">Lịch sử chưa đủ rõ để phân loại. Cần kiểm tra có thẩm quyền; xác nhận sửa bị chặn.</p>}
      <details><summary>Phân loại lịch sử và identity canonical</summary><ul>{Object.entries(canonical.footprint.classifications).map(([reason, n]) => <li key={reason}><code>{reason}</code>: {n}</li>)}</ul><Fingerprint label="Bank gốc" value={canonical.original_bank_id} /><Fingerprint label="Bank hiện hành" value={canonical.current_bank_id} /><Fingerprint label="Topic" value={canonical.topic_id} /><Fingerprint label="Revision canonical" value={canonical.revision} /><Fingerprint label="Revision bank hiện hành" value={canonical.current_bank_revision} /><Fingerprint label="Câu hỏi gốc SHA-256" value={canonical.original_questions_sha256} /><Fingerprint label="META gốc SHA-256" value={canonical.original_metadata_sha256} /></details>
    </>}
    <label>File nguồn UTF-8 đã duyệt<input ref={fileInput} type="file" accept=".md,text/markdown,text/plain" disabled={busy || !!pending || denied} onChange={(event) => { const f = event.target.files?.[0]; if (f) void loadFile(f, code); }} /></label>
    {filename && <p>{filename}</p>}
    <label>Nguồn Markdown nguyên bản<textarea aria-label="Nguồn Markdown Grammar" rows={8} spellCheck={false} value={source} readOnly disabled={denied} /></label>
    <p>{source ? bytes === null ? 'Nguồn UTF-8 không hợp lệ hoặc vượt 256KiB.' : `${bytes.toLocaleString('vi-VN')} byte UTF-8; payload JSON cũng phải trong 256KiB.` : 'Chưa chọn nguồn.'} Không tự sửa META/map hoặc chuẩn hóa nội dung nguồn.</p>
    <button type="button" onClick={() => void check()} disabled={busy || loading || denied || !canonical || !canonical.publication_available || bytes === null || !!pending}>Xem trước bản sửa Grammar</button>
    {preview && <div className={styles.preview}>
      <h3>Diff đã được backend xác minh</h3><Fingerprint label="Nguồn SHA-256" value={preview.source_sha256} /><Fingerprint label="Manifest META + câu hỏi" value={preview.manifest_sha256} /><Fingerprint label="Preview fingerprint" value={preview.preview_fingerprint} /><Fingerprint label="Revision đề xuất" value={preview.proposed_revision} />
      <p>META/map của nguồn được ràng buộc trong manifest; mọi META không thuộc phạm vi sửa và câu hỏi/lịch sử gốc được giữ. Diff chỉ liệt kê trường câu hỏi thay đổi.</p>
      {preview.validation_messages.map((message, index) => <p key={index}>{message}</p>)}
      {preview.changed_questions.length ? <ul className={styles.diff}>{preview.changed_questions.map((q) => <li key={q.qid}><strong>{q.qid}</strong><p>Trường thay đổi: {q.fields.join(', ')}</p><Fingerprint label="Trước" value={q.before_sha256} /><Fingerprint label="Sau" value={q.after_sha256} /></li>)}</ul> : <p>Không có trường câu hỏi thay đổi trong diff này; manifest nguồn/META vẫn được xác minh.</p>}
      <button ref={previewButton} type="button" disabled={busy || !eligible || denied} onClick={() => setConfirm(true)}>Kiểm tra và xác nhận bản sửa</button>
    </div>}
    {pending && !verified && <div role="status"><p>{rejected ? `Backend đã từ chối lệnh (${rejected}). Bỏ lệnh này và đọc lại trạng thái trước khi xem trước một thao tác mới.` : 'Thao tác chưa được xác nhận đầy đủ. Giữ cùng tài khoản, nguồn và mã thao tác; không tạo mã mới hay tự động retry.'}</p><p>Mã và nội dung này chỉ được giữ khi phần quản trị còn mở. Tải lại trang sẽ mất lệnh đang chờ; trang chỉ đọc trạng thái hiện hành, không xác nhận receipt của thao tác này.</p><Fingerprint label="Mã thao tác" value={pending.body.operation_id} />{rejected ? <button ref={recoveryButton} type="button" disabled={busy || denied} onClick={() => void discardRejected()}>Bỏ lệnh bị từ chối và đọc lại trạng thái</button> : ack ? <><button ref={recoveryButton} type="button" disabled={busy || denied} onClick={() => void retryReadback()}>Đọc lại canonical sau ACK</button>{readbackDrift && <button type="button" disabled={busy || denied} onClick={() => void submit(true)}>Đối soát receipt bằng cùng mã và nội dung</button>}</> : <button ref={recoveryButton} type="button" disabled={busy || denied} onClick={() => void submit(true)}>Khôi phục bằng cùng mã và nội dung</button>}</div>}
    {ack && <div><h3>{verified ? 'Receipt đã đối chiếu canonical' : readbackDrift ? 'Receipt đã nhận; canonical hiện tại khác' : 'Receipt đã nhận; đọc lại chưa xác nhận'}</h3><p>Kết quả: {ack.outcome === 'applied' ? 'Đã áp dụng' : 'Thao tác đã được áp dụng trước đó'}. {ack.current_matches_committed ? 'Tại thời điểm ACK, revision khớp receipt.' : 'Tại thời điểm ACK, revision đã khác receipt; không che thay đổi sau thao tác.'}</p><Fingerprint label="Bank gốc được giữ" value={ack.original_bank_id} /><Fingerprint label="Bank sửa" value={ack.corrected_bank_id} /><Fingerprint label="Revision khi commit" value={ack.committed_revision} /><Fingerprint label="Revision trong ACK" value={ack.current_revision} /><Fingerprint label="Lịch sử gốc lúc sửa SHA-256" value={ack.original_history_sha256} /><p>Fingerprint lịch sử là chứng cứ lúc sửa, không phải hash của lịch sử hiện tại.</p></div>}
    <Dialog open={confirm} title="Xác nhận bản sửa Grammar đã duyệt" busy={busy} onClose={() => setConfirm(false)} description="Tạo một bản sửa mới theo đúng nguồn và preview hiện tại. Giữ bank gốc, câu hỏi và lịch sử. Không có thao tác regrade/reset lịch sử." actions={<><button type="button" disabled={busy} onClick={() => setConfirm(false)}>Hủy</button><button type="button" disabled={busy || !eligible || denied} onClick={() => void submit()}>{busy ? 'Đang xác nhận…' : 'Xác nhận tạo bản sửa'}</button></>}><p>{code}</p><Fingerprint label="Nguồn" value={preview?.source_sha256 || ''} /><Fingerprint label="Preview" value={preview?.preview_fingerprint || ''} /></Dialog>
  </section>;
}

function Fingerprint({ label, value }: { label: string; value: string }) {
  return <p className={styles.fingerprint}><span>{label}</span><code>{value}</code></p>;
}

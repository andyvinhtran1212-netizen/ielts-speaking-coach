'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog } from '@/components/admin-directory-ui';
import {
  buildFulltestImportReceipt,
  formatFulltestBytes,
  fulltestDescriptorFingerprint,
  fulltestImagePromptBlocks,
  fulltestImportReceiptKey,
  fulltestTestsHref,
  FULLTEST_FILE_SLOTS,
  groupFulltestQuestions,
  normalizeFulltestCanonical,
  normalizeFulltestCommit,
  normalizeFulltestImportReceipt,
  normalizeFulltestPreview,
  normalizeFulltestSearch,
  routeFulltestFile,
  validateFulltestFiles,
} from '@/lib/admin-listening-fulltest-import-model.mjs';

type Field = 'questionPaper' | 'solution' | 'timings' | 'audio';
type Files = Record<Field, File | null>;
type Busy = 'hashing' | 'validating' | 'preflight' | 'uploading' | 'reconciling' | 'publishing' | null;
type Preview = {
  ok: boolean; duplicate: boolean; errors: string[]; warnings: string[]; testId: string; title: string;
  formatVersion: string; transcriptSource: string; sectionCount: number | null; questionCount: number | null;
  questions: Array<{ number: number; section: number; prompt: string; options: Array<{ label: string; text: string }>; answer: string; imagePrompt: string }>;
};
type Receipt = { account: string; testId: string; fingerprint: string; mini: boolean; baselineIds: string[]; acknowledgedId: string | null; startedAt: string };
type Canonical = { id: string; testId: string; status: 'draft' | 'published' | 'archived'; type: 'full' | 'mini'; title: string; sectionCount: number };
type CommitAck = { id: string; testId: string; status: 'draft'; sectionsCreated: number; exercisesCreated: number; sizeBytes: number; durationSeconds: number; warnings: string[] };
type DialogKind = 'publish' | 'discard-receipt' | null;
type FileSlotDefinition = { field: Field; label: string; accept: string; extensions: string[]; kind: 'text' | 'audio' };

const EMPTY_FILES: Files = { questionPaper: null, solution: null, timings: null, audio: null };
const FILE_SLOTS = FULLTEST_FILE_SLOTS as unknown as ReadonlyArray<FileSlotDefinition>;
const SLOT_COPY: Record<Field, { step: string; hint: string }> = {
  questionPaper: { step: '01', hint: 'Đề và cấu trúc câu hỏi · tối đa 2 MB' },
  solution: { step: '02', hint: 'Answer key, giải thích, audio windows · tối đa 2 MB' },
  timings: { step: '03', hint: 'Section offsets và cửa sổ từng câu · tối đa 2 MB' },
  audio: { step: '04', hint: 'MP3 pre-mixed · tối đa 60 MB' },
};

const messageOf = (caught: unknown) => caught instanceof Error ? caught.message : String(caught || 'Lỗi không xác định');
const sleepLabel: Record<Exclude<Busy, null>, string> = {
  hashing: 'Đang khóa dấu vân tay…', validating: 'Đang kiểm định pack…', uploading: 'Đang tải và ghi draft…',
  preflight: 'Đang khóa lượt ghi…', reconciling: 'Đang đối chiếu canonical…', publishing: 'Đang phát hành…',
};

class UploadHttpError extends Error { constructor(message: string, readonly status: number) { super(message); } }
class UploadTransportError extends Error {}

function apiDetail(raw: unknown, fallback: string) {
  const body = raw && typeof raw === 'object' ? raw as { detail?: unknown } : null;
  const detail = body?.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') {
    const value = detail as { message?: unknown; errors?: unknown };
    const head = typeof value.message === 'string' ? value.message : fallback;
    const errors = Array.isArray(value.errors) ? value.errors.filter((item): item is string => typeof item === 'string') : [];
    return errors.length ? `${head}: ${errors.join(' · ')}` : head;
  }
  return fallback;
}

async function digestFile(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fingerprintFiles(files: Files, mini: boolean) {
  const descriptors: Record<string, { name: string; size: number; digest: string }> = {};
  for (const slot of FILE_SLOTS) {
    const file = files[slot.field];
    if (!file) return null;
    descriptors[slot.field] = { name: file.name, size: file.size, digest: await digestFile(file) };
  }
  return fulltestDescriptorFingerprint(descriptors, mini) as string | null;
}

async function accessToken() {
  const supabase = window.getSupabase() as { auth?: { getSession?: () => Promise<{ data?: { session?: { access_token?: string } } }> } };
  const token = (await supabase?.auth?.getSession?.())?.data?.session?.access_token;
  if (!token) throw new Error('Phiên admin không có access token; chưa gửi upload.');
  return token;
}

function uploadCommit(files: Files, mini: boolean, token: string, progress: (loaded: number, total: number) => void, handle: { current: XMLHttpRequest | null }) {
  return new Promise<unknown>((resolve, reject) => {
    const form = new FormData();
    form.append('question_paper', files.questionPaper!);
    form.append('solution', files.solution!);
    form.append('timings', files.timings!);
    form.append('audio', files.audio!);
    const xhr = new XMLHttpRequest();
    handle.current = xhr;
    const release = () => { if (handle.current === xhr) handle.current = null; };
    xhr.open('POST', `${window.api.base}/admin/listening/import-fulltest/commit${mini ? '?mini=true' : ''}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.timeout = 6 * 60 * 1000;
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) progress(event.loaded, event.total); };
    xhr.onload = () => {
      release();
      let body: unknown = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* contract check below */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new UploadHttpError(apiDetail(body, `HTTP ${xhr.status}`), xhr.status));
    };
    xhr.onerror = () => { release(); reject(new UploadTransportError('Mất kết nối trong khi upload; kết quả ghi chưa xác định.')); };
    xhr.ontimeout = () => { release(); reject(new UploadTransportError('Upload hết thời gian chờ; backend có thể vẫn đang hoàn tất.')); };
    xhr.onabort = () => { release(); reject(new UploadTransportError('Upload bị ngắt; kết quả ghi chưa xác định.')); };
    xhr.send(form);
  });
}

export function AdminListeningFulltestImport() {
  const profile = useAdminProfile();
  const [files, setFiles] = useState<Files>(EMPTY_FILES);
  const [mini, setMini] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Receipt | null>(null);
  const [receiptReady, setReceiptReady] = useState(false);
  const [canonical, setCanonical] = useState<Canonical | null>(null);
  const [commitAck, setCommitAck] = useState<CommitAck | null>(null);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [copied, setCopied] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const receiptOwner = useRef<string | null>(null);
  const activeAccount = useRef(profile.id);
  const activeUpload = useRef<XMLHttpRequest | null>(null);
  const dryRunLock = useRef<string | null>(null);
  const commitLock = useRef<string | null>(null);
  activeAccount.current = profile.id;
  const validation = useMemo(() => validateFulltestFiles(files) as { ok: boolean; errors: Partial<Record<Field, string>> }, [files]);
  const sections = useMemo(() => groupFulltestQuestions(preview?.questions || []) as Array<{ number: number; questions: Preview['questions'] }>, [preview]);
  const imageBlocks = useMemo(() => fulltestImagePromptBlocks(preview?.questions || []) as Array<{ section: number; first: number; last: number; prompt: string }>, [preview]);
  const accountReady = receiptOwner.current === profile.id && receiptReady;
  const modeCompatible = preview?.sectionCount === (mini ? 1 : 4);
  const locked = !accountReady || busy !== null || Boolean(pending) || Boolean(canonical);
  const receiptKey = fulltestImportReceiptKey(profile.id) as string;

  useEffect(() => {
    if (receiptOwner.current === profile.id) return () => { activeUpload.current?.abort(); activeUpload.current = null; };
    receiptOwner.current = profile.id;
    activeUpload.current?.abort(); activeUpload.current = null;
    dryRunLock.current = null;
    commitLock.current = null;
    setFiles(EMPTY_FILES); setMini(false); setAttempted(false); setPreview(null); setPreviewFingerprint(null);
    setBusy(null); setError(null); setNotice(null); setPending(null); setReceiptReady(false); setCanonical(null);
    setCommitAck(null); setProgress({ loaded: 0, total: 0 }); setCopied(null); setDialog(null);
    try {
      const raw = localStorage.getItem(receiptKey);
      if (raw) {
        const receipt = normalizeFulltestImportReceipt(JSON.parse(raw), profile.id) as Receipt | null;
        if (receipt) setPending(receipt);
        else localStorage.removeItem(receiptKey);
      }
      setReceiptReady(true);
    } catch { setReceiptReady(false); setError('Không đọc được receipt import cũ; chưa cho phép POST mới để tránh ghi trùng.'); }
    return () => { activeUpload.current?.abort(); activeUpload.current = null; };
  }, [profile.id, receiptKey]);

  useEffect(() => {
    const syncReceipt = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || event.key !== receiptKey) return;
      try {
        const next = event.newValue
          ? normalizeFulltestImportReceipt(JSON.parse(event.newValue), profile.id) as Receipt | null
          : null;
        if (event.newValue && !next) throw new Error('Receipt từ tab khác sai contract.');
        setPending(next); setReceiptReady(true);
        if (next) setError('Một tab khác đang giữ lượt import của tài khoản này; tab hiện tại đã khóa POST.');
      } catch (caught) {
        setReceiptReady(false);
        setError(`Không đồng bộ được receipt giữa các tab; đã khóa POST. ${messageOf(caught)}`);
      }
    };
    window.addEventListener('storage', syncReceipt);
    return () => window.removeEventListener('storage', syncReceipt);
  }, [profile.id, receiptKey]);

  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  const invalidate = () => {
    setPreview(null); setPreviewFingerprint(null); setAttempted(false); setError(null); setNotice(null); setCopied(null);
  };

  const assign = (field: Field, fileList: FileList | File[]) => {
    if (locked) return;
    const incoming = Array.from(fileList);
    if (!incoming.length) return;
    setFiles((current) => {
      const next = { ...current };
      if (incoming.length === 1) next[field] = incoming[0];
      else for (const file of incoming) { const target = routeFulltestFile(file.name) as Field | null; if (target) next[target] = file; }
      return next;
    });
    invalidate();
  };

  const persistReceipt = (receipt: Receipt) => {
    const serialized = JSON.stringify(receipt);
    const existingRaw = localStorage.getItem(receiptKey);
    if (existingRaw) {
      let existing: Receipt | null = null;
      try { existing = normalizeFulltestImportReceipt(JSON.parse(existingRaw), receipt.account) as Receipt | null; } catch { /* fail closed below */ }
      const sameWrite = existing && existing.testId === receipt.testId && existing.fingerprint === receipt.fingerprint
        && existing.startedAt === receipt.startedAt;
      if (!sameWrite) throw new Error('Tab khác đã giữ receipt import của tài khoản này; chưa ghi đè và chưa gửi POST.');
    }
    localStorage.setItem(receiptKey, serialized);
    if (localStorage.getItem(receiptKey) !== serialized) throw new Error('Receipt không đọc lại được từ localStorage.');
    if (activeAccount.current === receipt.account) setPending(receipt);
  };

  const clearReceipt = (account = profile.id) => {
    localStorage.removeItem(receiptKey);
    if (localStorage.getItem(receiptKey) !== null) throw new Error('Không xóa được receipt an toàn.');
    if (activeAccount.current === account) setPending(null);
  };

  const readCanonical = async (id: string, testId: string, status: 'draft' | 'published' | null = null, type: 'full' | 'mini' | null = null) => {
    const raw = await window.api.get<unknown>(`/admin/listening/tests/${encodeURIComponent(id)}`);
    const row = normalizeFulltestCanonical(raw, id, testId, status, type) as Canonical | null;
    if (!row) throw new Error('GET test detail không khớp identity, loại test, section hoặc trạng thái mong đợi.');
    return row;
  };

  const searchExact = async (testId: string, baselineIds: string[]) => {
    const limit = 100;
    let offset = 0;
    let expectedTotal: number | null = null;
    const exact = new Map<string, { id: string; status: string; baseline: boolean }>();
    for (;;) {
      const query = new URLSearchParams({ status: 'all', test_type: 'all', search: testId, limit: String(limit), offset: String(offset) });
      const raw = await window.api.get<unknown>(`/admin/listening/tests?${query}`);
      const result = normalizeFulltestSearch(raw, testId, baselineIds) as { matches: Array<{ id: string; status: string; baseline: boolean }>; malformedCount: number; total: number; limit: number; offset: number; itemCount: number } | null;
      if (!result || result.limit !== limit || result.offset !== offset || result.malformedCount) throw new Error('Danh sách đối chiếu có page hoặc row sai contract; chưa thể kết luận.');
      if (expectedTotal == null) expectedTotal = result.total;
      else if (result.total !== expectedTotal) throw new Error('Danh sách đối chiếu thay đổi trong lúc phân trang; hãy thử lại để giữ snapshot nhất quán.');
      for (const row of result.matches) exact.set(row.id, row);
      if (offset + result.itemCount >= result.total) break;
      if (!result.itemCount || offset + result.itemCount > 10_000) throw new Error('Danh sách đối chiếu không thể phân trang an toàn.');
      offset += result.itemCount;
    }
    const matches = Array.from(exact.values());
    return { matches, newMatches: matches.filter((row) => !row.baseline) };
  };

  const dryRun = async () => {
    if (busy || dryRunLock.current || pending || canonical) return;
    const account = profile.id;
    setAttempted(true); setError(null); setNotice(null); setPreview(null); setPreviewFingerprint(null);
    if (!validation.ok) { setError('Pack chưa đủ bốn file hợp lệ.'); return; }
    dryRunLock.current = account;
    try {
      setBusy('hashing');
      const fingerprint = await fingerprintFiles(files, mini);
      if (activeAccount.current !== account) return;
      if (!fingerprint) throw new Error('Không tạo được dấu vân tay đầy đủ cho pack.');
      setBusy('validating');
      const form = new FormData();
      form.append('question_paper', files.questionPaper!);
      form.append('solution', files.solution!);
      form.append('timings', files.timings!);
      const normalized = normalizeFulltestPreview(await window.api.upload<unknown>('/admin/listening/import-fulltest', form)) as Preview | null;
      if (activeAccount.current !== account) return;
      if (!normalized) throw new Error('Dry-run trả về dữ liệu không đúng contract.');
      setPreview(normalized); setPreviewFingerprint(fingerprint);
      const expectedSections = mini ? 1 : 4;
      if (normalized.ok && normalized.sectionCount !== expectedSections) setError(`${mini ? 'Mini' : 'Full'} test phải đúng ${expectedSections} section; pack này có ${normalized.sectionCount ?? 'không rõ'}. Chưa cho phép ghi draft.`);
      else setNotice(normalized.ok && !normalized.duplicate ? 'Pack đã qua dry-run; hãy rà nội dung trước khi ghi draft.' : null);
    } catch (caught) { if (activeAccount.current === account) setError(messageOf(caught)); }
    finally {
      if (dryRunLock.current === account) dryRunLock.current = null;
      if (activeAccount.current === account) setBusy(null);
    }
  };

  const commit = async () => {
    if (busy || commitLock.current || pending || canonical || !accountReady || !preview?.ok || preview.duplicate || !previewFingerprint || !validation.ok || !modeCompatible) return;
    const account = profile.id;
    commitLock.current = account;
    setBusy('preflight');
    setError(null); setNotice(null); setProgress({ loaded: 0, total: files.audio?.size || 0 });
    let receipt: Receipt | null = null;
    let acknowledged = false;
    try {
      if (!navigator.locks?.request) throw new Error('Trình duyệt không hỗ trợ khóa liên tab; đã chặn POST để bảo toàn receipt.');
      await navigator.locks.request(`aver:admin:listening-fulltest-import:${account}`, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error('Một tab khác đang import bằng tài khoản này; chưa gửi POST.');
        const token = await accessToken();
        if (activeAccount.current !== account) return;
        const baseline = await searchExact(preview.testId, []);
        if (activeAccount.current !== account) return;
        if (baseline.matches.some((row) => row.status !== 'archived')) {
          setError('Test ID đã xuất hiện sau dry-run. Mở Kho test để xử lý rồi kiểm tra pack lại.');
          return;
        }
        receipt = buildFulltestImportReceipt({ account: profile.id, testId: preview.testId, fingerprint: previewFingerprint, mini, baselineIds: baseline.matches.map((row) => row.id) }) as Receipt;
        try { persistReceipt(receipt); }
        catch (caught) { receipt = null; setReceiptReady(false); throw new Error(`Không thể tạo biên nhận an toàn; chưa gửi POST. ${messageOf(caught)}`); }
        setBusy('uploading');
        const raw = await uploadCommit(files, mini, token, (loaded, total) => {
          if (activeAccount.current === account) setProgress({ loaded, total });
        }, activeUpload);
        if (activeAccount.current !== account) return;
        acknowledged = true;
        const ack = normalizeFulltestCommit(raw, preview.testId) as CommitAck | null;
        if (!ack) throw new Error('POST đã nhận nhưng ACK import sai contract.');
        setCommitAck(ack);
        receipt = { ...receipt, acknowledgedId: ack.id };
        persistReceipt(receipt);
        setBusy('reconciling');
        const row = await readCanonical(ack.id, preview.testId, 'draft', mini ? 'mini' : 'full');
        if (activeAccount.current !== account) return;
        clearReceipt(); setCanonical(row); setNotice('Đã xác nhận draft bằng canonical GET. Chưa hiển thị cho học viên.');
      });
    } catch (caught) {
      if (activeAccount.current !== account) return;
      const definitive = caught instanceof UploadHttpError && caught.status >= 400 && caught.status < 500;
      if (definitive && receipt) {
        try { clearReceipt(); } catch { /* retain warning below */ }
      }
      if (receipt && !definitive) {
        setError(`${acknowledged ? 'POST đã nhận, nhưng chưa đọc lại được.' : 'Kết quả upload chưa xác định.'} Dùng “Đối chiếu canonical”; không tự phát lại POST. ${messageOf(caught)}`);
      } else setError(messageOf(caught));
    } finally {
      if (commitLock.current === account) commitLock.current = null;
      if (activeAccount.current === account) setBusy(null);
    }
  };

  const reconcile = async () => {
    if (!pending || busy) return;
    const account = profile.id;
    setBusy('reconciling'); setError(null); setNotice(null);
    try {
      let id = pending.acknowledgedId;
      if (!id) {
        const result = await searchExact(pending.testId, pending.baselineIds);
        if (activeAccount.current !== account) return;
        if (result.newMatches.length !== 1) throw new Error(result.newMatches.length
          ? `Có ${result.newMatches.length} test mới cùng Test ID; cần đối chiếu trong Kho test.`
          : 'Chưa thấy test mới. Backend có thể còn xử lý; chờ rồi đối chiếu lại, hoặc kiểm tra Kho test trước khi bỏ receipt.');
        id = result.newMatches[0].id;
      }
      const row = await readCanonical(id, pending.testId, null, pending.mini ? 'mini' : 'full');
      if (activeAccount.current !== account) return;
      if (row.status === 'archived') throw new Error('Test tìm thấy đang archived; cần kiểm tra trong Kho test trước khi bỏ receipt.');
      clearReceipt(); setCanonical(row); setNotice(`Đã đối chiếu ${row.testId}: ${row.status}. Không gửi lại POST.`);
    } catch (caught) { if (activeAccount.current === account) setError(messageOf(caught)); }
    finally { if (activeAccount.current === account) setBusy(null); }
  };

  const publish = async () => {
    if (!canonical || busy) return;
    const account = profile.id;
    const target = canonical;
    setDialog(null); setBusy('publishing'); setError(null); setNotice(null);
    try {
      await window.api.patch(`/admin/listening/tests/${encodeURIComponent(target.id)}/status`, { status: 'published' });
      if (activeAccount.current !== account) return;
      const row = await readCanonical(target.id, target.testId, 'published', target.type);
      if (activeAccount.current !== account) return;
      setCanonical(row); setNotice('Backend đã xác nhận Published; test có thể được phân phối theo phạm vi hiện tại.');
    } catch (caught) { if (activeAccount.current === account) setError(`Không xác nhận được trạng thái Published; chưa cập nhật UI lạc quan. ${messageOf(caught)}`); }
    finally { if (activeAccount.current === account) setBusy(null); }
  };

  const refreshCanonical = async () => {
    if (!canonical || busy) return;
    const account = profile.id;
    setBusy('reconciling'); setError(null);
    try { const row = await readCanonical(canonical.id, canonical.testId, null, canonical.type); if (activeAccount.current !== account) return; setCanonical(row); setNotice(`Đã đọc lại canonical: ${row.status}.`); }
    catch (caught) { if (activeAccount.current === account) setError(messageOf(caught)); }
    finally { if (activeAccount.current === account) setBusy(null); }
  };

  const discardReceipt = () => {
    setDialog(null);
    try { clearReceipt(); setNotice('Đã bỏ receipt cục bộ; thao tác này không đổi dữ liệu backend.'); }
    catch (caught) { setError(messageOf(caught)); }
  };

  const reset = () => {
    if (pending || busy) return;
    setFiles(EMPTY_FILES); setMini(false); setAttempted(false); setPreview(null); setPreviewFingerprint(null);
    setCanonical(null); setCommitAck(null); setProgress({ loaded: 0, total: 0 }); setError(null); setNotice(null); setCopied(null);
  };

  const copyPrompt = async (key: string, prompt: string) => {
    const account = profile.id;
    try { await navigator.clipboard.writeText(prompt); if (activeAccount.current === account) setCopied(key); }
    catch { if (activeAccount.current === account) setError('Trình duyệt không cho phép copy IMG-PROMPT.'); }
  };

  return <main className="alfi-shell">
    <nav className="alfi-breadcrumb" aria-label="Breadcrumb"><a href="/admin/listening/tests">Kho test</a><span>/</span><span>Import full test</span></nav>
    <header className="alfi-hero">
      <div><p className="alc-eyebrow">Listening · Controlled ingestion</p><h1>Import một test, giữ trọn bằng chứng</h1><p>Bốn file đi qua cùng một dấu vân tay, dry-run fail-loud và canonical readback. Upload chỉ tạo <strong>Draft</strong>; phát hành là một quyết định riêng.</p></div>
      <div className="alfi-hero__truth"><span className={`adm-status-pill ${canonical?.status === 'published' ? 'is-live' : canonical ? 'is-new' : 'is-muted'}`}>{canonical ? canonical.status : 'Chưa ghi dữ liệu'}</span><small>{busy ? sleepLabel[busy] : 'Không dùng JWT nhập tay'}</small></div>
    </header>

    <ol className="alfi-steps" aria-label="Tiến trình import">
      <li className={!preview ? 'is-current' : 'is-done'}><span>1</span><div><strong>Khóa pack</strong><small>4 file + SHA-256</small></div></li>
      <li className={preview && !canonical ? 'is-current' : canonical ? 'is-done' : ''}><span>2</span><div><strong>Kiểm định</strong><small>Cấu trúc + timing + answer</small></div></li>
      <li className={canonical ? 'is-current' : ''}><span>3</span><div><strong>Đọc lại</strong><small>Draft → Published</small></div></li>
    </ol>

    {pending && <section className="alfi-receipt" aria-labelledby="alfi-receipt-title">
      <div><p className="alc-eyebrow">Pending write receipt</p><h2 id="alfi-receipt-title">Lượt import {pending.testId} cần đối chiếu</h2><p>Receipt được tạo lúc {new Date(pending.startedAt).toLocaleString('vi-VN')}. Không chọn lại file hoặc gửi POST lần hai cho tới khi backend chứng minh kết quả.</p></div>
      <div><button className="adm-btn-primary" type="button" disabled={Boolean(busy)} onClick={() => void reconcile()}>Đối chiếu canonical</button><a className="adm-btn-secondary" href={fulltestTestsHref(pending.testId)}>Mở Kho test</a><button className="adm-btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => setDialog('discard-receipt')}>Bỏ receipt…</button></div>
    </section>}

    {error && <div className="alc-banner is-error" role="alert"><strong>Cần kiểm tra</strong><span>{error}</span></div>}
    {notice && <div className="alc-banner is-success" role="status"><strong>Đã đối chiếu</strong><span>{notice}</span></div>}

    <div className="alfi-workspace">
      <div className="alfi-main">
        <section className="alfi-card" aria-labelledby="alfi-pack-title">
          <div className="alfi-card__head"><div><p className="alc-eyebrow">01 · Pack inventory</p><h2 id="alfi-pack-title">Chọn đủ bốn nguồn</h2><p>Kéo cả pack vào một ô để tự phân loại, hoặc chọn từng file. Đổi bất kỳ file nào sẽ hủy kết quả dry-run cũ.</p></div><span>{Object.values(files).filter(Boolean).length}/4 file</span></div>
          <div className="alfi-file-grid">
            {FILE_SLOTS.map((slot) => <FileSlot key={slot.field} field={slot.field} label={slot.label} file={files[slot.field]} disabled={locked} error={attempted ? validation.errors[slot.field] : null} onFiles={assign} />)}
          </div>
          <div className="alfi-pack-footer">
            <label className="alfi-switch"><input type="checkbox" checked={mini} disabled={locked} onChange={(event) => { setMini(event.target.checked); invalidate(); }} /><span><strong>Pack này là Mini test</strong><small>Mini hợp lệ phải đúng 1 section; UI kiểm lại ở dry-run và canonical GET.</small></span></label>
            <div className="alfi-templates"><span>Template</span><a href="/templates/listening/ILR_LIS_001_Question_Paper.md" download>Question Paper</a><a href="/templates/listening/ILR_LIS_001_Solution.md" download>Solution</a><a href="/templates/listening/timings.json" download>timings.json</a></div>
          </div>
        </section>

        {preview && <section className="alfi-card" aria-labelledby="alfi-preview-title">
          <div className="alfi-card__head"><div><p className="alc-eyebrow">02 · Dry-run evidence</p><h2 id="alfi-preview-title">{preview.ok ? 'Parser đã đọc trọn pack' : 'Pack chưa qua cổng kiểm định'}</h2><p>{preview.testId || 'Chưa xác định Test ID'} · {preview.sectionCount ?? '—'} section · {preview.questionCount ?? '—'} câu · {imageBlocks.length} block cần ảnh</p></div><span className={`adm-status-pill ${preview.ok ? preview.duplicate ? 'is-warning' : 'is-live' : 'is-failed'}`}>{preview.ok ? preview.duplicate ? 'Trùng Test ID' : 'Hợp lệ' : 'Có lỗi'}</span></div>
          {!!preview.errors.length && <div className="alfi-findings is-error"><strong>Lỗi chặn import</strong><ul>{preview.errors.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>}
          {!!preview.warnings.length && <div className="alfi-findings is-warning"><strong>Cảnh báo cần đọc</strong><ul>{preview.warnings.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>}
          {preview.duplicate && <div className="alfi-duplicate"><div><strong>Không archive trong lúc upload</strong><p>Mở Kho test, archive bản đang active bằng flow có xác nhận và GET readback, rồi quay lại chạy dry-run mới.</p></div><a className="adm-btn-secondary" href={fulltestTestsHref(preview.testId)}>Xử lý {preview.testId}</a></div>}
          {!!sections.length && <div className="alfi-sections">{sections.map((section) => <details key={section.number} open={section.number === 1}><summary><span>Section {section.number}</span><small>{section.questions.length} câu</small></summary><div className="alfi-question-list">{section.questions.map((question) => <article key={question.number}><span className="alfi-qnum">{question.number}</span><div><p>{question.prompt || 'Không có prompt hiển thị'}</p>{!!question.options.length && <ol>{question.options.map((option, index) => <li key={`${question.number}-${index}`}><b>{option.label || String.fromCharCode(65 + index)}.</b> {option.text}</li>)}</ol>}<small>Đáp án <strong>{question.answer || '—'}</strong></small></div></article>)}</div>{imageBlocks.filter((block) => block.section === section.number).map((block) => { const key = `${block.section}-${block.first}-${block.last}`; return <div className="alfi-image-prompt" key={key}><div><strong>IMG-PROMPT · câu {block.first}{block.last === block.first ? '' : `–${block.last}`}</strong><button type="button" onClick={() => void copyPrompt(key, block.prompt)}>{copied === key ? 'Đã copy' : 'Copy prompt'}</button></div><pre>{block.prompt}</pre></div>; })}</details>)}</div>}
        </section>}

        {canonical && <section className="alfi-card alfi-result" aria-labelledby="alfi-result-title">
          <div className="alfi-card__head"><div><p className="alc-eyebrow">03 · Canonical result</p><h2 id="alfi-result-title">{canonical.testId} đã được backend xác nhận</h2><p>{canonical.title} · {canonical.type === 'mini' ? 'Mini test' : 'Full test'} · {canonical.sectionCount} section</p></div><span className={`adm-status-pill ${canonical.status === 'published' ? 'is-live' : canonical.status === 'archived' ? 'is-failed' : 'is-new'}`}>{canonical.status}</span></div>
          {commitAck && <dl className="alfi-metrics"><div><dt>Sections</dt><dd>{commitAck.sectionsCreated}</dd></div><div><dt>Exercise blocks</dt><dd>{commitAck.exercisesCreated}</dd></div><div><dt>Audio</dt><dd>{formatFulltestBytes(commitAck.sizeBytes)}</dd></div><div><dt>Duration</dt><dd>{Math.round(commitAck.durationSeconds / 60)} phút</dd></div></dl>}
          <div className="alfi-result-actions"><a className="adm-btn-secondary" href={`/admin/listening/tests/${encodeURIComponent(canonical.id)}`}>Mở workspace test</a><button className="adm-btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => void refreshCanonical()}>Đọc lại trạng thái</button>{canonical.status === 'draft' && <button className="adm-btn-primary" type="button" disabled={Boolean(busy)} onClick={() => setDialog('publish')}>Phát hành…</button>}<button className="adm-btn-secondary" type="button" disabled={Boolean(busy)} onClick={reset}>Import pack khác</button></div>
        </section>}
      </div>

      <aside className="alfi-side" aria-label="Điều khiển import">
        <section className="alfi-side-card"><p className="alc-eyebrow">Readiness gate</p><h2>{preview?.ok && !preview.duplicate ? 'Sẵn sàng ghi Draft' : validation.ok ? 'Sẵn sàng dry-run' : 'Pack chưa hoàn chỉnh'}</h2><ul><li className={validation.ok ? 'is-done' : ''}>Đủ bốn file đúng loại/kích thước</li><li className={preview?.ok ? 'is-done' : ''}>Parser xác nhận cấu trúc và answer key</li><li className={preview && !preview.duplicate ? 'is-done' : ''}>Test ID không trùng bản active</li><li className={canonical ? 'is-done' : ''}>Canonical GET xác nhận bản ghi</li></ul></section>
        <section className="alfi-side-card"><p className="alc-eyebrow">File manifest</p><dl>{FILE_SLOTS.map((slot) => <div key={slot.field}><dt>{slot.label}</dt><dd>{files[slot.field] ? <>{files[slot.field]!.name}<small>{formatFulltestBytes(files[slot.field]!.size)}</small></> : 'Chưa chọn'}</dd></div>)}</dl></section>
        {!canonical && <section className="alfi-action-card"><button className="adm-btn-secondary" type="button" disabled={Boolean(busy) || Boolean(pending) || !accountReady || !validation.ok} onClick={() => void dryRun()}>{busy === 'hashing' || busy === 'validating' ? sleepLabel[busy] : preview ? 'Kiểm tra lại pack' : 'Kiểm tra pack'}</button><button className="adm-btn-primary" type="button" disabled={Boolean(busy) || Boolean(pending) || !accountReady || !preview?.ok || preview.duplicate || !previewFingerprint || !modeCompatible} onClick={() => void commit()}>{busy === 'preflight' ? 'Đang kiểm tra trùng…' : busy === 'uploading' ? 'Đang upload…' : 'Ghi thành Draft'}</button>{busy === 'uploading' && <div className="alfi-progress"><div role="progressbar" aria-label="Tiến độ upload audio" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.total ? Math.min(100, Math.round(progress.loaded / progress.total * 100)) : 0} aria-valuetext={`${formatFulltestBytes(progress.loaded)} trên ${formatFulltestBytes(progress.total)}`}><span style={{ width: `${progress.total ? Math.min(100, Math.round(progress.loaded / progress.total * 100)) : 0}%` }} /></div><small aria-hidden="true">{formatFulltestBytes(progress.loaded)} / {formatFulltestBytes(progress.total)}</small></div>}<p>Không có “Archive & Import”. Duplicate được xử lý tách biệt để tránh mất bản live khi upload mơ hồ.</p></section>}
        <a className="alc-rollback" href="/pages/admin/listening/import-fulltest.html">Mở bản HTML rollback ↗</a>
      </aside>
    </div>

    <Dialog open={dialog === 'publish'} title={`Phát hành ${canonical?.testId || 'test'}?`} description="Backend sẽ kiểm cổng audio rồi chuyển test sang Published. UI chỉ báo thành công sau GET đúng UUID xác nhận trạng thái." busy={busy === 'publishing'} onClose={() => setDialog(null)} actions={<><button className="adm-btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => setDialog(null)}>Giữ Draft</button><button className="adm-btn-primary" type="button" disabled={Boolean(busy)} onClick={() => void publish()}>{busy === 'publishing' ? 'Đang đối chiếu…' : 'Xác nhận phát hành'}</button></>} />
    <Dialog open={dialog === 'discard-receipt'} title="Bỏ receipt cục bộ?" description="Thao tác này không hủy hay thay đổi request trên backend. Chỉ bỏ receipt sau khi bạn đã kiểm tra Kho test và chắc chắn không có lượt import đang hoàn tất." busy={false} onClose={() => setDialog(null)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setDialog(null)}>Tiếp tục đối chiếu</button><button className="adm-btn-danger" type="button" onClick={discardReceipt}>Tôi đã kiểm tra, bỏ receipt</button></>} />
  </main>;
}

function FileSlot({ field, label, file, disabled, error, onFiles }: { field: Field; label: string; file: File | null; disabled: boolean; error?: string | null; onFiles: (field: Field, files: FileList | File[]) => void }) {
  const slot = FILE_SLOTS.find((item) => item.field === field)!;
  return <label className={`alfi-file ${file ? 'is-set' : ''} ${error ? 'is-error' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onFiles(field, event.dataTransfer.files); }}>
    <input type="file" accept={slot.accept} disabled={disabled} onChange={(event) => event.target.files && onFiles(field, event.target.files)} />
    <span className="alfi-file__step">{SLOT_COPY[field].step}</span><span className="alfi-file__icon" aria-hidden="true">{file ? '✓' : '＋'}</span><strong>{label}</strong><small>{file ? `${file.name} · ${formatFulltestBytes(file.size)}` : SLOT_COPY[field].hint}</small>{error && <em>{error}</em>}
  </label>;
}

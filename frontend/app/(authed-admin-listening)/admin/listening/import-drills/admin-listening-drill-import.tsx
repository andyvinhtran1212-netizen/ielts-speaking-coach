'use client';

import { useEffect, useRef, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog } from '@/components/admin-directory-ui';
import {
  buildDrillImportReceipt,
  drillDescriptorFingerprint,
  drillImportReceiptKey,
  drillTestsHref,
  formatDrillBytes,
  groupDrillFiles,
  normalizeDrillCanonical,
  normalizeDrillCommit,
  normalizeDrillImportReceipt,
  normalizeDrillPreview,
  normalizeDrillSearch,
  validateDrillBundle,
} from '@/lib/admin-listening-drill-import-model.mjs';

type Busy = 'scanning' | 'committing' | 'reconciling' | null;
type Preview = { ok: boolean; duplicate: boolean; testId: string; title: string; drillType: string; level: string; task: string; questionCount: number; timingReady: boolean; errors: string[]; warnings: string[] };
type Canonical = { id: string; testId: string; title: string; status: 'draft' | 'published' | 'archived'; drillType: string; level: string; hasAudio: boolean; sectionNum: number; exerciseCount: number };
type CommitAck = { id: string; testId: string; status: 'draft'; drillType: string; level: string; hasAudio: boolean; exercisesCreated: number; warnings: string[] };
type Receipt = { account: string; testId: string; fingerprint: string; drillType: string; level: string; hasAudio: boolean; baselineIds: string[]; acknowledgedId: string | null; startedAt: string };
type BundleStatus = 'inventory' | 'scanning' | 'ready' | 'blocked' | 'committing' | 'canonical' | 'failed' | 'pending';
type Bundle = {
  testId: string; source: File; timings: File | null; audio: File | null; errors: string[];
  preview: Preview | null; fingerprint: string | null; selected: boolean; status: BundleStatus;
  canonical: Canonical | null; ack: CommitAck | null; message: string | null;
};

const messageOf = (caught: unknown) => caught instanceof Error ? caught.message : String(caught || 'Lỗi không xác định');
const busyLabel: Record<Exclude<Busy, null>, string> = {
  scanning: 'Đang dry-run từng drill…', committing: 'Đang ghi queue tuần tự…', reconciling: 'Đang đối chiếu canonical…',
};

class UploadHttpError extends Error { constructor(message: string, readonly status: number) { super(message); } }
class UploadTransportError extends Error {}
class ReceiptStorageError extends Error {}
class AuthSessionError extends Error {}

function apiDetail(raw: unknown, fallback: string) {
  const detail = raw && typeof raw === 'object' ? (raw as { detail?: unknown }).detail : null;
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

async function fingerprintBundle(bundle: Bundle) {
  const descriptor: Record<string, { name: string; size: number; digest: string } | null> = {};
  for (const field of ['source', 'timings', 'audio'] as const) {
    const file = bundle[field];
    descriptor[field] = file ? { name: file.name, size: file.size, digest: await digestFile(file) } : null;
  }
  return drillDescriptorFingerprint(descriptor) as string | null;
}

async function accessToken() {
  const supabase = window.getSupabase() as { auth?: { getSession?: () => Promise<{ data?: { session?: { access_token?: string } } }> } };
  const token = (await supabase?.auth?.getSession?.())?.data?.session?.access_token;
  if (!token) throw new AuthSessionError('Phiên admin không có access token; chưa gửi upload.');
  return token;
}

function uploadDrill(bundle: Bundle, token: string, progress: (loaded: number, total: number) => void, handle: { current: XMLHttpRequest | null }) {
  return new Promise<unknown>((resolve, reject) => {
    const form = new FormData();
    form.append('source_json', bundle.source, bundle.source.name);
    if (bundle.timings) form.append('timings', bundle.timings, 'timings.json');
    if (bundle.audio) form.append('audio', bundle.audio, 'full.mp3');
    const xhr = new XMLHttpRequest();
    handle.current = xhr;
    const release = () => { if (handle.current === xhr) handle.current = null; };
    xhr.open('POST', `${window.api.base}/admin/listening/drills/import/commit`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.timeout = 4 * 60 * 1000;
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) progress(event.loaded, event.total); };
    xhr.onload = () => {
      release();
      let body: unknown = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* normalized below */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new UploadHttpError(apiDetail(body, `HTTP ${xhr.status}`), xhr.status));
    };
    xhr.onerror = () => { release(); reject(new UploadTransportError('Mất kết nối trong lúc ghi; kết quả backend chưa xác định.')); };
    xhr.ontimeout = () => { release(); reject(new UploadTransportError('Upload hết thời gian chờ; backend có thể vẫn đang hoàn tất.')); };
    xhr.onabort = () => { release(); reject(new UploadTransportError('Upload bị ngắt; kết quả backend chưa xác định.')); };
    xhr.send(form);
  });
}

function initialBundle(raw: { testId: string; source: File; timings: File | null; audio: File | null; errors: string[] }): Bundle {
  const validation = validateDrillBundle(raw) as { ok: boolean; errors: string[] };
  return { ...raw, errors: validation.errors, preview: null, fingerprint: null, selected: false,
    status: validation.ok ? 'inventory' : 'blocked', canonical: null, ack: null, message: null };
}

export function AdminListeningDrillImport() {
  const profile = useAdminProfile();
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [inventoryErrors, setInventoryErrors] = useState<string[]>([]);
  const [unassigned, setUnassigned] = useState<string[]>([]);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Receipt | null>(null);
  const [recovered, setRecovered] = useState<Canonical | null>(null);
  const [receiptReady, setReceiptReady] = useState(false);
  const [dialog, setDialog] = useState<'commit' | 'discard' | null>(null);
  const [progress, setProgress] = useState({ testId: '', loaded: 0, total: 0 });
  const [pickerEpoch, setPickerEpoch] = useState(0);
  const receiptOwner = useRef<string | null>(null);
  const activeAccount = useRef(profile.id);
  const activeUpload = useRef<XMLHttpRequest | null>(null);
  const scanLock = useRef(false);
  const commitLock = useRef(false);
  activeAccount.current = profile.id;
  const receiptKey = drillImportReceiptKey(profile.id) as string;
  const accountReady = receiptOwner.current === profile.id && receiptReady;
  const locked = Boolean(busy || pending || recovered);
  const visiblePending = pending && busy !== 'committing' ? pending : null;
  const inventoryBlocked = inventoryErrors.length > 0 || unassigned.length > 0;
  const selected = bundles.filter((bundle) => bundle.selected && bundle.status === 'ready');
  const readyCount = bundles.filter((bundle) => bundle.status === 'ready').length;
  const canonicalCount = bundles.filter((bundle) => bundle.canonical).length;
  const scannableCount = bundles.filter((bundle) => !bundle.canonical).length;

  useEffect(() => {
    if (receiptOwner.current === profile.id) return () => { activeUpload.current?.abort(); activeUpload.current = null; };
    receiptOwner.current = profile.id;
    activeUpload.current?.abort(); activeUpload.current = null;
    scanLock.current = false; commitLock.current = false;
    setBundles([]); setInventoryErrors([]); setUnassigned([]); setIgnoredCount(0); setBusy(null); setError(null); setNotice(null);
    setPending(null); setRecovered(null); setReceiptReady(false); setDialog(null); setProgress({ testId: '', loaded: 0, total: 0 }); setPickerEpoch((value) => value + 1);
    try {
      const raw = localStorage.getItem(receiptKey);
      if (raw) {
        const receipt = normalizeDrillImportReceipt(JSON.parse(raw), profile.id) as Receipt | null;
        if (receipt) setPending(receipt);
        else localStorage.removeItem(receiptKey);
      }
      setReceiptReady(true);
    } catch { setReceiptReady(false); setError('Không đọc được receipt import cũ; chưa cho phép POST để tránh ghi trùng.'); }
    return () => { activeUpload.current?.abort(); activeUpload.current = null; };
  }, [profile.id, receiptKey]);

  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  const updateBundle = (testId: string, change: Partial<Bundle>) => {
    setBundles((current) => current.map((bundle) => bundle.testId === testId ? { ...bundle, ...change } : bundle));
  };

  const persistReceipt = (receipt: Receipt) => {
    const serialized = JSON.stringify(receipt);
    const existingRaw = localStorage.getItem(receiptKey);
    if (existingRaw) {
      let existing: Receipt | null = null;
      try { existing = normalizeDrillImportReceipt(JSON.parse(existingRaw), receipt.account) as Receipt | null; } catch { /* fail closed below */ }
      const sameWrite = existing && existing.testId === receipt.testId && existing.fingerprint === receipt.fingerprint
        && existing.startedAt === receipt.startedAt;
      if (!sameWrite) throw new Error('Đã có receipt khác của cùng tài khoản trong tab khác; chưa ghi đè và chưa gửi POST.');
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

  const onPick = (fileList: FileList | null) => {
    if (locked || !fileList) return;
    const grouped = groupDrillFiles(fileList) as { bundles: Array<{ testId: string; source: File; timings: File | null; audio: File | null; errors: string[] }>; errors: string[]; unassigned: string[]; ignored: string[] };
    setBundles(grouped.bundles.map(initialBundle));
    setInventoryErrors(grouped.errors); setUnassigned(grouped.unassigned); setIgnoredCount(grouped.ignored.length);
    setError(null); setNotice(grouped.bundles.length ? 'Đã khóa inventory. Chưa có request nào được gửi.' : null); setRecovered(null);
  };

  const readCanonical = async (expected: { id: string; testId: string; drillType: string; level: string; hasAudio: boolean; status?: string | null }) => {
    const raw = await window.api.get<unknown>(`/admin/listening/tests/${encodeURIComponent(expected.id)}`);
    const canonical = normalizeDrillCanonical(raw, expected) as Canonical | null;
    if (!canonical) throw new Error('GET test detail không khớp UUID, drill metadata, exercise hoặc audio truth mong đợi.');
    return canonical;
  };

  const searchExact = async (testId: string, baselineIds: string[]) => {
    const limit = 100;
    let offset = 0;
    let expectedTotal: number | null = null;
    const exact = new Map<string, { id: string; status: string; type: string; baseline: boolean }>();
    for (;;) {
      const query = new URLSearchParams({ status: 'all', test_type: 'all', search: testId, limit: String(limit), offset: String(offset) });
      const result = normalizeDrillSearch(await window.api.get<unknown>(`/admin/listening/tests?${query}`), testId, baselineIds) as { matches: Array<{ id: string; status: string; type: string; baseline: boolean }>; malformedCount: number; total: number; limit: number; offset: number; itemCount: number } | null;
      if (!result || result.limit !== limit || result.offset !== offset || result.malformedCount) throw new Error('Danh sách đối chiếu sai contract; chưa thể kết luận an toàn.');
      if (expectedTotal == null) expectedTotal = result.total;
      else if (result.total !== expectedTotal) throw new Error('Danh sách thay đổi trong lúc phân trang; hãy đối chiếu lại.');
      for (const row of result.matches) exact.set(row.id, row);
      if (offset + result.itemCount >= result.total) break;
      if (!result.itemCount || offset + result.itemCount > 10_000) throw new Error('Không thể phân trang danh sách đối chiếu an toàn.');
      offset += result.itemCount;
    }
    const matches = Array.from(exact.values());
    return { matches, newMatches: matches.filter((row) => !row.baseline) };
  };

  const scanAll = async () => {
    if (busy || scanLock.current || pending || !accountReady || !bundles.length || inventoryBlocked) return;
    const account = profile.id;
    scanLock.current = true; setBusy('scanning'); setError(null); setNotice(null);
    try {
      for (const bundle of bundles) {
        if (activeAccount.current !== account) return;
        if (bundle.canonical) continue;
        const validation = validateDrillBundle(bundle) as { ok: boolean; errors: string[] };
        if (!validation.ok) { updateBundle(bundle.testId, { status: 'blocked', selected: false, errors: validation.errors }); continue; }
        updateBundle(bundle.testId, { status: 'scanning', selected: false, preview: null, message: null });
        try {
          const fingerprint = await fingerprintBundle(bundle);
          if (!fingerprint) throw new Error('Không tạo được SHA-256 cho bundle.');
          const form = new FormData();
          form.append('source_json', bundle.source, bundle.source.name);
          if (bundle.timings) form.append('timings', bundle.timings, 'timings.json');
          const preview = normalizeDrillPreview(await window.api.upload<unknown>('/admin/listening/drills/import', form), bundle.testId) as Preview | null;
          if (activeAccount.current !== account) return;
          if (!preview) throw new Error('Dry-run trả dữ liệu sai contract hoặc Test ID không khớp tên file.');
          const missingTimingEvidence = Boolean(bundle.timings) && !preview.timingReady;
          const unexpectedTimingEvidence = !bundle.timings && preview.timingReady;
          const timingMismatch = missingTimingEvidence || unexpectedTimingEvidence;
          const ready = preview.ok && !preview.duplicate && !timingMismatch;
          updateBundle(bundle.testId, { preview, fingerprint, status: ready ? 'ready' : 'blocked', selected: ready,
            message: preview.duplicate ? 'Test ID đang active; xử lý ở Kho test rồi dry-run lại.'
              : missingTimingEvidence ? 'timings.json không chứa full_test/sections hợp lệ; backend không thể tạo audio windows.'
                : unexpectedTimingEvidence ? 'Backend báo có timing evidence dù bundle không có timings.json; chưa thể tin kết quả dry-run.' : null });
        } catch (caught) {
          updateBundle(bundle.testId, { status: 'failed', selected: false, message: messageOf(caught) });
        }
      }
      if (activeAccount.current === account) setNotice('Dry-run hoàn tất. Chỉ những hàng có bằng chứng hợp lệ mới được chọn.');
    } finally {
      if (activeAccount.current === account) { scanLock.current = false; setBusy(null); }
    }
  };

  const runCommit = async () => {
    if (busy || commitLock.current || pending || !accountReady) return;
    const queue = bundles.filter((bundle) => bundle.selected && bundle.status === 'ready');
    if (!queue.length) return;
    const account = profile.id;
    commitLock.current = true; setDialog(null); setBusy('committing'); setError(null); setNotice(null);
    let stopped = false;
    let confirmedCount = 0;
    let failedCount = 0;
    try {
      for (const bundle of queue) {
        if (activeAccount.current !== account || stopped) return;
        updateBundle(bundle.testId, { status: 'committing', message: null });
        setProgress({ testId: bundle.testId, loaded: 0, total: bundle.audio?.size || bundle.source.size });
        let receipt: Receipt | null = null;
        let acknowledged = false;
        try {
          const token = await accessToken();
          const baseline = await searchExact(bundle.testId, []);
          if (activeAccount.current !== account) return;
          if (baseline.matches.some((row) => row.status !== 'archived')) {
            updateBundle(bundle.testId, { status: 'blocked', selected: false, message: 'Test ID đã active sau dry-run; chưa gửi POST.' });
            failedCount += 1;
            continue;
          }
          receipt = buildDrillImportReceipt({ account, testId: bundle.testId, fingerprint: bundle.fingerprint,
            drillType: bundle.preview!.drillType, level: bundle.preview!.level, hasAudio: Boolean(bundle.audio),
            baselineIds: baseline.matches.map((row) => row.id) }) as Receipt;
          try { persistReceipt(receipt); }
          catch (caught) { receipt = null; setReceiptReady(false); throw new ReceiptStorageError(`Không thể tạo biên nhận an toàn; chưa gửi POST. ${messageOf(caught)}`); }
          const raw = await uploadDrill(bundle, token, (loaded, total) => {
            if (activeAccount.current === account) setProgress({ testId: bundle.testId, loaded, total });
          }, activeUpload);
          if (activeAccount.current !== account) return;
          acknowledged = true;
          const ack = normalizeDrillCommit(raw, { testId: bundle.testId, drillType: bundle.preview!.drillType,
            level: bundle.preview!.level, hasAudio: Boolean(bundle.audio) }) as CommitAck | null;
          if (!ack) throw new Error('POST đã nhận nhưng ACK import sai contract.');
          receipt = { ...receipt, acknowledgedId: ack.id };
          persistReceipt(receipt);
          const canonical = await readCanonical({ id: ack.id, testId: bundle.testId, drillType: ack.drillType,
            level: ack.level, hasAudio: ack.hasAudio, status: 'draft' });
          if (activeAccount.current !== account) return;
          if (canonical.exerciseCount !== ack.exercisesCreated) throw new Error('ACK và canonical GET không khớp số exercise; giữ receipt để đối chiếu.');
          updateBundle(bundle.testId, { status: 'canonical', selected: false, canonical, ack, message: 'Canonical GET đã xác nhận Draft.' });
          confirmedCount += 1;
          try { clearReceipt(); }
          catch (clearCaught) {
            setError(`${bundle.testId} đã được canonical GET xác nhận, nhưng receipt cục bộ chưa xóa được. Queue đã dừng; hãy reload rồi đối chiếu lại, không gửi POST.`);
            stopped = true;
            break;
          }
        } catch (caught) {
          if (activeAccount.current !== account) return;
          const definitive = caught instanceof UploadHttpError && caught.status >= 400 && caught.status < 500;
          let clearFailure: unknown = null;
          if (definitive && receipt) { try { clearReceipt(); } catch (clearCaught) { clearFailure = clearCaught; } }
          if (receipt && (!definitive || clearFailure)) {
            updateBundle(bundle.testId, { status: 'pending', selected: false,
              message: `${acknowledged ? 'ACK/readback chưa khép kín.' : 'Kết quả upload chưa xác định.'} Không phát lại POST.` });
            setError(`${bundle.testId} cần đối chiếu canonical; queue đã dừng để không ghi tiếp trên trạng thái mơ hồ. ${messageOf(clearFailure || caught)}`);
            stopped = true;
            break;
          }
          updateBundle(bundle.testId, { status: 'failed', selected: false, message: messageOf(caught) });
          failedCount += 1;
          if (caught instanceof UploadHttpError && caught.status === 401) {
            setError(`${bundle.testId}: phiên admin hết hạn; queue đã dừng. Đăng nhập lại rồi dry-run batch mới.`);
            stopped = true;
            break;
          }
          if (caught instanceof ReceiptStorageError) {
            setError(`${bundle.testId}: ${messageOf(caught)} Queue đã dừng trước khi gửi dữ liệu.`);
            stopped = true;
            break;
          }
          if (!receipt || caught instanceof AuthSessionError) {
            setError(`${bundle.testId}: preflight chưa hoàn tất; queue đã dừng trước POST. ${messageOf(caught)}`);
            stopped = true;
            break;
          }
        }
      }
      if (!stopped && activeAccount.current === account) {
        if (failedCount) setError(`Queue đã kết thúc: ${confirmedCount} drill được canonical GET xác nhận · ${failedCount} drill thất bại hoặc bị khóa.`);
        else setNotice(`Queue đã hoàn tất: ${confirmedCount} drill được canonical GET xác nhận.`);
      }
    } catch (caught) { if (activeAccount.current === account) setError(messageOf(caught)); }
    finally {
      if (activeAccount.current === account) { commitLock.current = false; setBusy(null); setProgress({ testId: '', loaded: 0, total: 0 }); }
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
          ? `Có ${result.newMatches.length} bản ghi mới cùng Test ID; cần mở Kho test để đối chiếu thủ công.`
          : 'Chưa thấy bản ghi mới. Hãy chờ rồi đối chiếu lại; không gửi lại POST.');
        id = result.newMatches[0].id;
      }
      const canonical = await readCanonical({ id, testId: pending.testId, drillType: pending.drillType,
        level: pending.level, hasAudio: pending.hasAudio, status: null });
      if (activeAccount.current !== account) return;
      if (canonical.status === 'archived') throw new Error('Bản ghi đối chiếu đang archived; kiểm tra Kho test trước khi bỏ receipt.');
      clearReceipt(); setRecovered(canonical);
      updateBundle(pending.testId, { status: 'canonical', selected: false, canonical, message: 'Đã reconcile bằng GET; không phát lại POST.' });
      setNotice(`Đã đối chiếu ${canonical.testId}: ${canonical.status}. Không gửi lại POST.`);
    } catch (caught) { if (activeAccount.current === account) setError(messageOf(caught)); }
    finally { if (activeAccount.current === account) setBusy(null); }
  };

  const discardReceipt = () => {
    setDialog(null);
    try { clearReceipt(); setNotice('Đã bỏ receipt cục bộ; dữ liệu backend không thay đổi.'); }
    catch (caught) { setError(messageOf(caught)); }
  };

  const reset = () => {
    if (busy || pending) return;
    setBundles([]); setInventoryErrors([]); setUnassigned([]); setIgnoredCount(0); setRecovered(null);
    setError(null); setNotice(null); setProgress({ testId: '', loaded: 0, total: 0 }); setPickerEpoch((value) => value + 1);
  };

  const stage = recovered || canonicalCount ? 4 : readyCount ? 3 : bundles.some((bundle) => bundle.preview) ? 2 : 1;
  const steps: Array<[number, string, string]> = [
    [1, 'Inventory', 'Đường dẫn + kích thước'], [2, 'Dry-run', 'Parser + duplicate'],
    [3, 'Commit queue', 'Receipt + upload'], [4, 'Canonical', 'Exact GET readback'],
  ];

  return <main className="aldi-shell">
    <nav className="aldi-breadcrumb" aria-label="Breadcrumb"><a href="/admin/listening/tests">Kho test</a><span>/</span><span>Import skill drills</span></nav>
    <header className="aldi-hero">
      <div><p className="alc-eyebrow">Listening · Batch ingestion</p><h1>Mỗi drill đúng file, đúng bằng chứng</h1><p>Ghép bundle theo đường dẫn thật, dry-run từng bài và ghi theo queue tuần tự. Drill không audio vẫn là <strong>Draft metadata-only</strong>; audio có mặt bắt buộc đi cùng timings.</p></div>
      <div className="aldi-hero__truth"><span className={`adm-status-pill ${visiblePending ? 'is-warning' : canonicalCount ? 'is-live' : 'is-muted'}`}>{visiblePending ? 'Cần đối chiếu' : canonicalCount ? `${canonicalCount} đã xác nhận` : 'Chưa ghi dữ liệu'}</span><small>{busy ? busyLabel[busy] : 'Không đoán quan hệ file'}</small></div>
    </header>

    <ol className="aldi-steps" aria-label="Tiến trình import">
      {steps.map(([number, title, hint]) => <li key={number} className={stage === number ? 'is-current' : stage > number ? 'is-done' : ''}><span>{number}</span><div><strong>{title}</strong><small>{hint}</small></div></li>)}
    </ol>

    {visiblePending && <section className="aldi-receipt" aria-labelledby="aldi-receipt-title"><div><p className="alc-eyebrow">Pending write receipt</p><h2 id="aldi-receipt-title">Lượt import {visiblePending.testId} cần đối chiếu</h2><p>Receipt tạo lúc {new Date(visiblePending.startedAt).toLocaleString('vi-VN')}. Queue đã dừng; tuyệt đối không chọn lại file hoặc gửi POST lần hai.</p></div><div><button className="adm-btn-primary" type="button" disabled={Boolean(busy)} onClick={() => void reconcile()}>Đối chiếu canonical</button><a className="adm-btn-secondary" href={drillTestsHref(visiblePending.testId)}>Mở Kho test</a><button className="adm-btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => setDialog('discard')}>Bỏ receipt…</button></div></section>}
    {error && <div className="alc-banner is-error" role="alert"><strong>Cần kiểm tra</strong><span>{error}</span>{!receiptReady && <button className="adm-btn-secondary" type="button" onClick={() => window.location.reload()}>Tải lại sau khi cấp quyền lưu trữ</button>}</div>}
    {notice && <div className="alc-banner is-success" role="status"><strong>Trạng thái</strong><span>{notice}</span></div>}

    <div className="aldi-workspace">
      <div className="aldi-main">
        <section className="aldi-card" aria-labelledby="aldi-inventory-title">
          <div className="aldi-card__head"><div><p className="alc-eyebrow">01 · File inventory</p><h2 id="aldi-inventory-title">Chọn nguồn theo cách có thể chứng minh</h2><p>Ưu tiên chọn cả thư mục <code>11_Skill_Drills_Web</code>. Chọn file rời chỉ an toàn khi đúng một Source JSON đi cùng timings/audio của chính nó.</p></div><span>{bundles.length} bundle</span></div>
          <div className="aldi-pickers">
            <label className="aldi-picker" key={`directory-${pickerEpoch}`}><input type="file" multiple disabled={locked} onChange={(event) => onPick(event.target.files)} {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} /><span aria-hidden="true">⌁</span><strong>Chọn cả thư mục</strong><small>Ghép bằng audio_output/&lt;TEST_ID&gt;/</small></label>
            <label className="aldi-picker" key={`loose-${pickerEpoch}`}><input type="file" multiple accept="application/json,.json,audio/mpeg,.mp3" disabled={locked} onChange={(event) => onPick(event.target.files)} /><span aria-hidden="true">＋</span><strong>Chọn một bundle rời</strong><small>1 Source JSON + timings + audio tùy chọn</small></label>
          </div>
          {!!inventoryErrors.length && <Finding title="Lỗi inventory" items={inventoryErrors} kind="error" />}
          {!!unassigned.length && <Finding title="File sai vị trí — đang chặn dry-run" items={['Đặt Source JSON trong Source_JSON/ và media trong audio_output/<TEST_ID>/.', ...unassigned]} kind="error" />}
          {!!ignoredCount && <p className="aldi-muted">Đã bỏ qua {ignoredCount} file không thuộc contract import.</p>}
        </section>

        {!!bundles.length && <section className="aldi-card" aria-labelledby="aldi-table-title">
          <div className="aldi-card__head"><div><p className="alc-eyebrow">02 · Bundle evidence</p><h2 id="aldi-table-title">Dry-run và chọn hàng đủ điều kiện</h2><p>Duplicate active, contract sai hoặc audio thiếu timings đều bị khóa. Không có trạng thái “có vẻ hợp lệ”.</p></div><span>{readyCount} sẵn sàng</span></div>
          <div className="aldi-table-wrap"><table className="aldi-table"><thead><tr><th scope="col"><span className="sr-only">Chọn</span></th><th scope="col">Drill</th><th scope="col">Parser</th><th scope="col">Nguồn media</th><th scope="col">Trạng thái</th></tr></thead><tbody>
            {bundles.map((bundle) => <BundleRow key={bundle.testId} bundle={bundle} disabled={Boolean(busy || pending)} onToggle={(checked) => updateBundle(bundle.testId, { selected: checked })} />)}
          </tbody></table></div>
        </section>}

        {(canonicalCount > 0 || recovered) && <section className="aldi-card aldi-result" aria-labelledby="aldi-result-title">
          <div className="aldi-card__head"><div><p className="alc-eyebrow">04 · Canonical results</p><h2 id="aldi-result-title">Backend đã xác nhận từng Draft</h2><p>Kết quả dưới đây đến từ exact GET, không phải UI optimistic hay chỉ từ ACK của POST.</p></div><span className="adm-status-pill is-live">{canonicalCount || 1} confirmed</span></div>
          <div className="aldi-results">{bundles.filter((bundle) => bundle.canonical).map((bundle) => <CanonicalResult key={bundle.testId} canonical={bundle.canonical!} />)}{recovered && !bundles.some((bundle) => bundle.canonical?.id === recovered.id) && <CanonicalResult canonical={recovered} />}</div>
        </section>}
      </div>

      <aside className="aldi-side" aria-label="Điều khiển import">
        <section className="aldi-side-card"><p className="alc-eyebrow">Readiness gate</p><h2>{busy === 'committing' ? 'Queue đang ghi tuần tự' : pending ? 'Queue đang khóa' : readyCount ? `${selected.length} drill được chọn` : bundles.length ? 'Cần dry-run' : 'Chưa có inventory'}</h2><ul><li className={bundles.length > 0 && !inventoryErrors.length && !unassigned.length ? 'is-done' : ''}>Bundle có chủ sở hữu rõ ràng</li><li className={readyCount ? 'is-done' : ''}>Parser và duplicate gate đã qua</li><li className={selected.length ? 'is-done' : ''}>Có hàng đủ điều kiện được chọn</li><li className={canonicalCount || recovered ? 'is-done' : ''}>Canonical GET xác nhận kết quả</li></ul></section>
        <section className="aldi-side-card"><p className="alc-eyebrow">Queue truth</p><dl><div><dt>Tổng bundle</dt><dd>{bundles.length}</dd></div><div><dt>Audio-ready</dt><dd>{bundles.filter((bundle) => bundle.audio && bundle.timings).length}</dd></div><div><dt>Metadata-only</dt><dd>{bundles.filter((bundle) => !bundle.audio && !bundle.errors.length).length}</dd></div><div><dt>Đã xác nhận</dt><dd>{canonicalCount}</dd></div></dl></section>
        <section className="aldi-action-card"><button className="adm-btn-secondary" type="button" disabled={Boolean(busy || pending) || !accountReady || !scannableCount || inventoryBlocked} onClick={() => void scanAll()}>{busy === 'scanning' ? 'Đang dry-run…' : bundles.some((bundle) => bundle.preview) ? 'Dry-run lại các hàng chưa ghi' : 'Dry-run tất cả'}</button><button className="adm-btn-primary" type="button" disabled={Boolean(busy || pending) || !accountReady || !selected.length || inventoryBlocked} onClick={() => setDialog('commit')}>Ghi {selected.length || 0} Draft đã chọn…</button>{busy === 'committing' && <div className="aldi-progress"><strong>{progress.testId}</strong><div role="progressbar" aria-label={`Tiến độ upload ${progress.testId}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.total ? Math.min(100, Math.round(progress.loaded / progress.total * 100)) : 0} aria-valuetext={`${formatDrillBytes(progress.loaded)} trên ${formatDrillBytes(progress.total)}`}><span style={{ width: `${progress.total ? Math.min(100, Math.round(progress.loaded / progress.total * 100)) : 0}%` }} /></div><small aria-hidden="true">{formatDrillBytes(progress.loaded)} / {formatDrillBytes(progress.total)}</small></div>}<p>Commit chạy tuần tự. Lỗi 4xx dừng hàng đó; lỗi mơ hồ giữ receipt và dừng toàn queue.</p></section>
        {(canonicalCount > 0 || recovered) && <button className="adm-btn-secondary aldi-reset" type="button" disabled={Boolean(busy || pending)} onClick={reset}>Import batch khác</button>}
        <a className="alc-rollback" href="/pages/admin/listening/import-drills.html">Mở bản HTML rollback ↗</a>
      </aside>
    </div>

    <Dialog open={dialog === 'commit'} title={`Ghi ${selected.length} skill drill thành Draft?`} description="Queue sẽ ghi tuần tự và tạo receipt trước mỗi POST. Không drill nào được coi là thành công trước canonical GET." onClose={() => setDialog(null)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setDialog(null)}>Rà lại lựa chọn</button><button className="adm-btn-primary" type="button" onClick={() => void runCommit()}>Xác nhận ghi {selected.length} Draft</button></>}>
      <dl className="aldi-dialog-summary"><div><dt>Audio-ready</dt><dd>{selected.filter((bundle) => bundle.audio).length}</dd></div><div><dt>Metadata-only</dt><dd>{selected.filter((bundle) => !bundle.audio).length}</dd></div></dl>
    </Dialog>
    <Dialog open={dialog === 'discard'} title="Bỏ receipt cục bộ?" description="Thao tác này không hủy request backend. Chỉ bỏ sau khi đã kiểm tra Kho test và chắc chắn không có lượt ghi đang hoàn tất." onClose={() => setDialog(null)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setDialog(null)}>Tiếp tục đối chiếu</button><button className="adm-btn-danger" type="button" onClick={discardReceipt}>Tôi đã kiểm tra, bỏ receipt</button></>} />
  </main>;
}

function Finding({ title, items, kind }: { title: string; items: string[]; kind: 'error' | 'warning' }) {
  return <div className={`aldi-finding is-${kind}`}><strong>{title}</strong><ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>;
}

function BundleRow({ bundle, disabled, onToggle }: { bundle: Bundle; disabled: boolean; onToggle: (checked: boolean) => void }) {
  const preview = bundle.preview;
  const checkable = bundle.status === 'ready';
  const findings = [...bundle.errors, ...(preview?.errors || []), ...(preview?.warnings || []), ...(bundle.message ? [bundle.message] : [])];
  const statusLabel: Record<BundleStatus, string> = { inventory: 'Chờ dry-run', scanning: 'Đang kiểm tra', ready: 'Sẵn sàng', blocked: 'Bị khóa', committing: 'Đang ghi', canonical: 'Đã xác nhận', failed: 'Có lỗi', pending: 'Chờ đối chiếu' };
  const statusClass = ['ready', 'canonical'].includes(bundle.status) ? 'is-live' : ['blocked', 'failed'].includes(bundle.status) ? 'is-failed' : bundle.status === 'pending' ? 'is-warning' : 'is-muted';
  return <tr data-test-id={bundle.testId}>
    <td data-label="Chọn"><input type="checkbox" aria-label={`Chọn ${bundle.testId}`} checked={bundle.selected} disabled={disabled || !checkable} onChange={(event) => onToggle(event.target.checked)} /></td>
    <td data-label="Drill"><strong className="aldi-mono">{bundle.testId}</strong><small>{preview?.title || bundle.source.name}</small>{findings.length > 0 && <details open={['blocked', 'failed', 'pending'].includes(bundle.status)}><summary>{findings.length} ghi chú</summary><ul>{findings.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></details>}</td>
    <td data-label="Parser"><strong>{preview ? `${preview.drillType} · ${preview.level || 'chưa level'}` : 'Chưa kiểm định'}</strong><small>{preview ? `${preview.questionCount} câu${preview.task ? ` · Task ${preview.task}` : ''}` : 'Chưa gửi dry-run'}</small></td>
    <td data-label="Nguồn media"><span className={`aldi-media ${bundle.audio && bundle.timings ? 'is-audio' : bundle.audio ? 'is-error' : 'is-meta'}`}>{bundle.audio && bundle.timings ? 'Audio-ready' : bundle.audio ? 'Audio thiếu timings' : 'Metadata-only'}</span><small>{bundle.timings ? 'Có timings.json' : 'Không timings'}</small></td>
    <td data-label="Trạng thái"><span className={`adm-status-pill ${statusClass}`}>{statusLabel[bundle.status]}</span>{preview?.duplicate && <a href={drillTestsHref(bundle.testId)}>Xử lý duplicate</a>}</td>
  </tr>;
}

function CanonicalResult({ canonical }: { canonical: Canonical }) {
  return <article><div><strong>{canonical.testId}</strong><small>{canonical.drillType} · {canonical.level || 'chưa level'} · Section {canonical.sectionNum}</small></div><dl><div><dt>Exercise blocks</dt><dd>{canonical.exerciseCount}</dd></div><div><dt>Media</dt><dd>{canonical.hasAudio ? 'Audio-ready' : 'Metadata-only'}</dd></div><div><dt>Status</dt><dd>{canonical.status}</dd></div></dl><a className="adm-btn-secondary" href={`/admin/listening/tests/${encodeURIComponent(canonical.id)}`}>Mở workspace</a></article>;
}

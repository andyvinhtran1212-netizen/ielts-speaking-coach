'use client';

import { useEffect, useRef, useState } from 'react';
import type { components } from '@/types/api';
import { BlackEyeReview } from '@/components/listening-blackeye';

type Catalog = components['schemas']['BlackEyeSourceCatalog'];
type Receipt = components['schemas']['BlackEyeAssignmentReceipt'];
type Progress = components['schemas']['BlackEyeAssignmentProgress'];
type Review = components['schemas']['BlackEyeActivityReview'];
const STATUS = { not_started: 'chưa bắt đầu', in_progress: 'đang làm', submitted: 'đã nộp', expired: 'quá hạn', unavailable: 'không khả dụng' };

export function AdminBlackEyeHomework({ cohortId }: { cohortId: string }) {
  return <BlackEyeHomework key={cohortId} cohortId={cohortId} />;
}
function BlackEyeHomework({ cohortId }: { cohortId: string }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [activityIds, setActivityIds] = useState<string[]>([]); const [recipients, setRecipients] = useState<string[]>([]); const [deadline, setDeadline] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null); const [progress, setProgress] = useState<Progress | null>(null); const [review, setReview] = useState<Review | null>(null);
  const retryRequest = useRef<{ fingerprint: string; requestId: string } | null>(null); const generation = useRef(0); const locked = useRef(false);
  useEffect(() => { const n = ++generation.current; return () => { if (generation.current === n) generation.current++; }; }, []);
  const prefix = `/admin/cohorts/${encodeURIComponent(cohortId)}/listening-source-assignments`;
  async function loadCatalog() {
    if (locked.current) return; locked.current = true; setBusy(true); setError(''); const n = generation.current;
    try { const value = await window.api.getWith<Catalog>(`/admin/cohorts/${encodeURIComponent(cohortId)}/listening-source-catalog`); if (n === generation.current) { setCatalog(value); if (value.lookup_errors.length) setError('Không tra cứu được học viên. Hãy thử lại.'); } }
    catch { if (n === generation.current) { setCatalog(null); setError('Không tải được Black Eye hoặc bạn chưa có quyền với lớp này.'); } }
    finally { if (n === generation.current) { locked.current = false; setBusy(false); } }
  }
  async function assign() {
    if (locked.current || !catalog || catalog.lookup_errors.length || !recipients.length || !activityIds.length || !deadline) return;
    const activities = catalog.inventory.activities.filter(a => activityIds.includes(a.binding.activity_id)).map(a => a.binding);
    const values = { activities, recipient_ids: recipients, due_at: `${deadline}:00+07:00`, deadline_timezone: 'Asia/Ho_Chi_Minh', replay_policy: 'allowed' };
    const fingerprint = JSON.stringify(values);
    if (retryRequest.current?.fingerprint !== fingerprint) retryRequest.current = { fingerprint, requestId: crypto.randomUUID() };
    locked.current = true; setBusy(true); setError(''); const n = generation.current;
    try { const value = await window.api.postWith<Receipt>(prefix, { ...values, request_id: retryRequest.current.requestId }); if (n === generation.current) { setReceipt(value); setProgress(null); setReview(null); } }
    catch { if (n === generation.current) setError('Chưa xác nhận giao bài. Không tạo biên nhận tại trình duyệt; thử lại sẽ giữ mã yêu cầu.'); }
    finally { if (n === generation.current) { locked.current = false; setBusy(false); } }
  }
  async function loadProgress() {
    if (!receipt || locked.current) return; locked.current = true; setBusy(true); setError(''); const n = generation.current;
    try { const value = await window.api.getWith<Progress>(`${prefix}/${encodeURIComponent(receipt.assignment_id)}/progress`); if (n === generation.current) setProgress(value); }
    catch { if (n === generation.current) { setProgress(null); setError('Không đọc được tiến độ. Hãy thử lại.'); } }
    finally { if (n === generation.current) { locked.current = false; setBusy(false); } }
  }
  async function openReview(itemId: string) {
    if (!receipt || locked.current) return; locked.current = true; setBusy(true); setError(''); const n = generation.current;
    try { const value = await window.api.getWith<Review>(`/admin/cohorts/${encodeURIComponent(cohortId)}/assignments/${encodeURIComponent(receipt.assignment_id)}/items/${encodeURIComponent(itemId)}/listening-review`); if (n === generation.current) setReview(value); }
    catch { if (n === generation.current) { setReview(null); setError('Không tải được chữa bài. Bài đã nộp vẫn được giữ.'); } }
    finally { if (n === generation.current) { locked.current = false; setBusy(false); } }
  }
  function toggle(value: string, values: string[], update: (v: string[]) => void) { update(values.includes(value) ? values.filter(v => v !== value) : [...values, value]); }
  return <section className="ach-course-preview" aria-label="Bài Black Eye của lớp"><h3>Black Eye · Unit 1</h3><button className="adm-btn-secondary" disabled={busy} onClick={() => void loadCatalog()}>{busy ? 'Đang tải…' : 'Xem trước Black Eye'}</button>
    {error && <p role="alert">{error}</p>}
    {catalog && <><fieldset disabled={busy || !!catalog.lookup_errors.length}><legend>Activity sẵn sàng</legend>{catalog.inventory.activities.map(a => <label key={a.binding.activity_id} style={{ display: 'block', minHeight: 44 }}><input type="checkbox" disabled={!a.selectable} checked={activityIds.includes(a.binding.activity_id)} onChange={() => toggle(a.binding.activity_id, activityIds, setActivityIds)} />{a.binding.activity_id} · {a.title}{!a.selectable && ' · Chưa mở'}</label>)}</fieldset>
      {!catalog.lookup_errors.length && !catalog.eligible_recipient_ids.length && <p>Lớp không có học viên đủ điều kiện.</p>}
      <fieldset disabled={busy || !!catalog.lookup_errors.length}><legend>Người nhận đủ điều kiện</legend>{catalog.eligible_recipient_ids.map(id => <label key={id} style={{ display: 'block', minHeight: 44 }}><input type="checkbox" checked={recipients.includes(id)} onChange={() => toggle(id, recipients, setRecipients)} />{id}</label>)}</fieldset>
      <label>Hạn nộp · Asia/Ho_Chi_Minh<input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} disabled={busy} /></label>
      <button className="adm-btn-primary" disabled={busy || !!catalog.lookup_errors.length || !activityIds.length || !recipients.length || !deadline} onClick={() => void assign()}>Giao cho {recipients.length} học viên</button></>}
    {receipt && <section><p>Biên nhận: {receipt.recipient_ids.length} người nhận · {receipt.activities.map(a => a.activity_id).join(', ')} · {receipt.due_at}</p><button disabled={busy} onClick={() => void loadProgress()}>Tải lại tiến độ</button></section>}
    {progress && <div className="acd-table-scroll" role="region" tabIndex={0} aria-label="Tiến độ Black Eye"><table className="acd-table"><thead><tr><th>Học viên</th><th>Activity</th><th>Trạng thái</th><th>Giờ nộp</th><th>Ô trống</th><th>Chính tả</th><th>Chữa bài</th></tr></thead><tbody>{progress.cells.map(cell => <tr key={`${cell.student_id}-${cell.activity_id}`}><th scope="row" style={{ position: 'sticky', left: 0, background: 'var(--av-surface, Canvas)' }}>{cell.student_id}</th><td>{cell.activity_id}</td><td>{STATUS[cell.status]}</td><td>{cell.submitted_at || '—'}</td><td>{cell.blank_count ?? '—'}</td><td>Bổ trợ tự chọn / Chưa mở</td><td>{cell.status === 'submitted' && <button disabled={busy} onClick={() => void openReview(cell.item_id)}>Xem chữa bài</button>}</td></tr>)}</tbody></table></div>}
    {review && <BlackEyeReview review={review} />}
  </section>;
}

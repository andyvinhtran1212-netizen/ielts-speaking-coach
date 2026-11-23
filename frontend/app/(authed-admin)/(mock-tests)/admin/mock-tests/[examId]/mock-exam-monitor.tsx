'use client';

// MOCKORG-0086 FR-146 / FR-151 (G09-T34 PR 1): thẻ "Theo dõi". Reads
// GET /admin/mock-exams/{id}/live every 5 s while the tab is visible. A failed
// read keeps the last snapshot dimmed and locks the controls; every control
// reads the room again afterwards instead of assuming it worked.

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button, ConfirmDialog, Dialog, Notice, PageState } from '@/components/ui';
import { messageOf } from '@/components/admin-directory-ui';
import {
  SECTION_NAMES,
  SELF_PACED_LABELS,
  answeredCopy,
  canAddTime,
  clockCopy,
  liveAlerts,
  normalizeMonitor,
  proctorState,
  selfPacedCounts,
  timeCopy,
} from '@/lib/mock-exam-record-model.mjs';

import styles from '../mock-exam-org.module.css';
import record from './mock-exam-record.module.css';

type Monitor = import('@/lib/mock-exam-record-model.mjs').Monitor;
type MonitorStudent = import('@/lib/mock-exam-record-model.mjs').MonitorStudent;
type Confirm = { kind: 'open' | 'start' | 'collect'; title: string; body: string; label: string };

const POLL_MS = 5_000;

export function useMonitor(examId: string) {
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const load = useCallback(async (): Promise<Monitor | null> => {
    const mine = ++request.current;
    try {
      const value = normalizeMonitor(await window.api.get<unknown>(`/admin/mock-exams/${encodeURIComponent(examId)}/live`));
      if (mine !== request.current) return null;
      if (!value || value.exam.id !== examId) throw new Error('Bảng phòng thi sai định dạng hoặc không khớp kỳ thi này.');
      setMonitor(value);
      setError(null);
      return value;
    } catch (caught) {
      if (mine === request.current) setError(messageOf(caught));
      return null;
    }
  }, [examId]);
  useEffect(() => () => { request.current += 1; }, []);
  return { monitor, error, load };
}

export function MockExamMonitor({ examId }: { examId: string }) {
  const { monitor, error, load } = useMonitor(examId);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [extraFor, setExtraFor] = useState<MonitorStudent | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const busyRef = useRef(false);
  busyRef.current = busy;

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !busyRef.current) void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const stale = Boolean(error && monitor);

  const run = async (operation: () => Promise<unknown>, success: string) => {
    if (busyRef.current) return;
    setBusy(true);
    setNotice(null);
    let failure: unknown = null;
    try { await operation(); } catch (caught) { failure = caught; }
    const fresh = await load();
    setBusy(false);
    if (failure) setNotice({ kind: 'error', text: `${messageOf(failure)}${fresh ? '' : ' Chưa đọc lại được phòng thi; đừng bấm lại, chờ lần cập nhật kế tiếp.'}` });
    else if (!fresh) setNotice({ kind: 'error', text: 'Yêu cầu đã gửi nhưng chưa đọc lại được phòng thi. Đừng bấm lại; chờ lần cập nhật kế tiếp.' });
    else setNotice({ kind: 'success', text: success });
  };

  if (!monitor && error) {
    return <PageState kind="error" title="Chưa tải được phòng thi" body={error} action={<Button variant="secondary" onClick={() => void load()}>Thử lại</Button>} />;
  }
  if (!monitor) return <PageState kind="loading" title="Đang tải phòng thi…" />;

  const path = `/admin/mock-exams/${encodeURIComponent(examId)}`;
  const doConfirm = async () => {
    if (!confirm) return;
    const exam = monitor.exam;
    const kind = confirm.kind;
    setConfirm(null);
    if (kind === 'open') await run(() => window.api.post(`${path}/open`, { is_open: !exam.isOpen }), exam.isOpen ? 'Đã đóng phòng.' : 'Đã mở phòng.');
    if (kind === 'start') await run(() => window.api.post(`${path}/advance`, { from_section: exam.activeSection }), 'Đã bắt đầu phần mới.');
    if (kind === 'collect') await run(() => window.api.post(`${path}/collect?from_section=${encodeURIComponent(exam.activeSection)}`, {}), `Đang thu bài ${SECTION_NAMES[exam.activeSection]}. "Bắt đầu phần" bật khi thu xong.`);
  };

  return (
    <div className={`${record.monitor}${stale ? ` ${record.stale}` : ''}`} aria-busy={busy}>
      {stale && <Notice kind="error" title="Mất cập nhật">Không đọc được phòng thi: {error}. Bảng dưới là lần đọc lúc {timeCopy(monitor.serverTime)}; các nút đã khoá tới khi đọc lại được.</Notice>}
      {notice && <Notice kind={notice.kind === 'success' ? 'success' : 'error'}>{notice.text}</Notice>}
      {monitor.exam.mode === 'live'
        ? <LiveMonitor monitor={monitor} now={now} stale={stale} busy={busy} onAsk={setConfirm} />
        : <SelfPacedMonitor monitor={monitor} stale={stale} busy={busy} onExtra={setExtraFor} />}
      <p className={styles.help}>Tự cập nhật mỗi 5 giây khi thẻ đang mở · lần đọc gần nhất {timeCopy(monitor.serverTime)}.</p>
      <ConfirmDialog
        open={Boolean(confirm)}
        tone={confirm?.kind === 'collect' ? 'warning' : 'default'}
        title={confirm?.title || ''}
        body={confirm?.body}
        confirmLabel={confirm?.label || 'Đồng ý'}
        cancelLabel="Quay lại"
        busy={busy}
        onConfirm={() => void doConfirm()}
        onCancel={() => setConfirm(null)}
      />
      {extraFor && (
        <ExtraTimeDialog
          student={extraFor}
          onClose={() => setExtraFor(null)}
          onSubmit={async (minutes, reason) => {
            const target = extraFor;
            setExtraFor(null);
            await run(() => window.api.post(`${path}/extra-time`, {
              sitting_id: target.sittingId, section: target.selfPaced?.currentSection, seconds: minutes * 60, reason,
            }), `Đã cộng ${minutes} phút cho ${target.name}.`);
          }}
        />
      )}
    </div>
  );
}

function LiveMonitor({ monitor, now, stale, busy, onAsk }: { monitor: Monitor; now: number; stale: boolean; busy: boolean; onAsk: (c: Confirm) => void }) {
  const exam = monitor.exam;
  const bar = proctorState(monitor, stale || busy);
  const alerts = liveAlerts(monitor, now);
  const running = exam.activeSection !== 'not_started' && exam.activeSection !== 'done';
  const left = bar.paused || stale || exam.timeLeftSeconds == null ? null
    : exam.timeLeftSeconds - Math.floor((now - monitor.readAt) / 1000);
  const working = running ? monitor.students.filter((s) => s.sections[exam.activeSection as 'listening']?.state === 'working').length : 0;
  return (
    <>
      <section className={record.proctor} aria-label="Điều khiển giám thị">
        <div>
          <strong>{exam.isOpen ? 'Phòng đang mở' : 'Phòng đang đóng'} · {SECTION_NAMES[exam.activeSection]}</strong>
          <span>{bar.collecting ? 'Đang thu bài…' : bar.paused ? `Đã thu ${SECTION_NAMES[exam.activeSection]} · chờ bắt đầu phần sau` : running ? `Còn lại ${clockCopy(left)}` : ''}</span>
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" disabled={!bar.open.enabled} onClick={() => onAsk({ kind: 'open', title: `${bar.open.label} "${exam.title}"?`, body: exam.isOpen ? 'Người chưa vào sẽ không vào được nữa.' : 'Người thi vào được phòng chờ; chưa phần nào bắt đầu.', label: bar.open.label })}>{bar.open.label}</Button>
          {bar.next && <Button disabled={!bar.start.enabled} onClick={() => onAsk({ kind: 'start', title: `${bar.start.label} cho cả phòng?`, body: 'Đồng hồ của phần này chạy chung cho mọi người. Không hoàn tác được.', label: bar.start.label })}>{bar.start.label}</Button>}
          {running && !bar.paused && <Button variant="secondary" disabled={!bar.collect.enabled} onClick={() => onAsk({ kind: 'collect', title: `Thu bài ${SECTION_NAMES[exam.activeSection]}?`, body: `${working ? `${working} người đang làm sẽ bị thu với phần đã làm. ` : ''}Cả phòng vào phòng chờ không có đồng hồ; sau khi thu xong mới bắt đầu được phần sau. Không hoàn tác được.`, label: 'Thu bài' })}>{bar.collect.label}</Button>}
        </div>
      </section>
      <AlertStrip alerts={alerts} idleMinutes={monitor.idleMinutes} />
      <div className={record.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Thí sinh</th>{exam.configured.map((s) => <th key={s}>{SECTION_NAMES[s]}</th>)}<th>Hoạt động gần nhất</th><th>Kết nối</th><th>Dấu hiệu</th></tr></thead>
          <tbody>
            {monitor.students.length ? monitor.students.map((s) => {
              const current = running ? s.sections[exam.activeSection as 'listening'] : undefined;
              return (
                <tr key={s.key}>
                  <td><b>{s.name}</b>{!s.inRoster && <small> · ngoài danh sách</small>}</td>
                  {exam.configured.map((section) => <td key={section}>{cellCopy(s.sections[section])}</td>)}
                  <td>{timeCopy(current?.lastActivityAt || null)}</td>
                  <td>{!s.started ? 'Chưa vào' : current?.state === 'working' ? (current.live ? 'Đang kết nối' : 'Mất kết nối') : '—'}</td>
                  <td>{signs(s, current, alerts)}</td>
                </tr>
              );
            }) : <tr><td colSpan={exam.configured.length + 4}>Chưa có ai trong danh sách thi.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function cellCopy(section: Monitor['students'][number]['sections']['listening']) {
  if (!section) return '—';
  if (section.state === 'absent') return 'Chưa vào';
  if (section.state === 'waiting') return 'Chờ mở';
  if (section.state === 'missed') return 'Chưa thu';
  if (section.state === 'submitted') return `Đã nộp ${timeCopy(section.submittedAt)}`;
  return `Đang làm · ${answeredCopy(section)}`;
}

function signs(student: MonitorStudent, current: MonitorStudent['sections']['listening'], alerts: ReturnType<typeof liveAlerts>) {
  const out: string[] = [];
  if (alerts.idle.includes(student.name)) out.push('Đứng yên');
  if (current?.state === 'working' && current.answered === 0) out.push('Chưa lưu câu nào');
  if (alerts.absent.includes(student.name)) out.push('Chưa vào');
  return out.length ? out.join(' · ') : '—';
}

function AlertStrip({ alerts, idleMinutes }: { alerts: ReturnType<typeof liveAlerts>; idleMinutes: number | null }) {
  const groups = [
    { key: 'offline', label: 'Mất kết nối', names: alerts.offline },
    { key: 'idle', label: idleMinutes != null ? `Đứng yên quá ${idleMinutes} phút` : 'Đứng yên (chưa đọc được ngưỡng ở Cài đặt; dùng mốc 5 phút)', names: alerts.idle },
    { key: 'absent', label: 'Chưa vào sau giờ bắt đầu', names: alerts.absent },
  ].filter((g) => g.names.length);
  if (!groups.length) return <p className={record.calm}>Không có cảnh báo.</p>;
  return (
    <section className={record.alerts} aria-label="Cảnh báo">
      {groups.map((g) => <div key={g.key} className={record.alert} role="status"><b>{g.label} ({g.names.length})</b><span>{g.names.join(', ')}</span></div>)}
    </section>
  );
}

function SelfPacedMonitor({ monitor, stale, busy, onExtra }: { monitor: Monitor; stale: boolean; busy: boolean; onExtra: (s: MonitorStudent) => void }) {
  const counts = selfPacedCounts(monitor);
  const derived = monitor.students.some((s) => s.selfPaced && !s.selfPaced.fromServer);
  return (
    <>
      <section className={record.counts} aria-label="Tổng quan">
        {(Object.keys(SELF_PACED_LABELS) as (keyof typeof SELF_PACED_LABELS)[]).map((key) => <div key={key}><strong>{counts[key]}</strong><span>{SELF_PACED_LABELS[key]}</span></div>)}
      </section>
      {derived && <Notice kind="info">Máy chủ chưa gửi trạng thái tự làm (cờ danh sách người thi đang tắt); trạng thái dưới đây suy ra từ các phần đã lưu.</Notice>}
      <div className={record.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Thí sinh</th><th>Trạng thái</th><th>Phần đang làm</th><th>Giờ còn lại của phần</th><th>Dự kiến xong cả bài</th><th>Thao tác</th></tr></thead>
          <tbody>
            {monitor.students.length ? monitor.students.map((s) => {
              const sp = s.selfPaced;
              const current = sp?.currentSection ? s.sections[sp.currentSection] : undefined;
              const offline = sp?.state === 'in_progress' && current && !current.live;
              return (
                <tr key={s.key}>
                  <td><b>{s.name}</b></td>
                  <td>{sp ? SELF_PACED_LABELS[sp.state] : '—'}{offline && <small> · mất kết nối</small>}</td>
                  <td>{sp?.state === 'in_progress' && sp.currentSection ? SECTION_NAMES[sp.currentSection] : '—'}</td>
                  <td>{sp?.state === 'in_progress' ? clockCopy(sp.timeLeftSeconds) : '—'}</td>
                  <td>{sp?.state === 'in_progress' ? timeCopy(sp.expectedEndAt) : '—'}</td>
                  <td>
                    {sp?.state === 'not_started' && <Button size="sm" variant="secondary" disabled title="Chưa có kênh gửi lời nhắc trên hệ thống này">Nhắc</Button>}
                    {canAddTime(s) && <Button size="sm" variant="secondary" disabled={stale || busy || !s.sittingId} onClick={() => onExtra(s)}>Cộng giờ…</Button>}
                  </td>
                </tr>
              );
            }) : <tr><td colSpan={6}>Chưa có ai trong danh sách thi.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className={styles.help}>Đã bắt đầu thì các phần chạy liền nhau và đồng hồ không dừng, kể cả khi mất kết nối. Cộng giờ chỉ cho phần đang chạy của người đang làm; các phần sau lùi theo. Người đã nộp muốn làm lại thì dùng "Cho thi bù…" ở thẻ Thí sinh. Nút "Nhắc" chưa dùng được vì hệ thống chưa có kênh gửi lời nhắc.</p>
    </>
  );
}

function ExtraTimeDialog({ student, onClose, onSubmit }: { student: MonitorStudent; onClose: () => void; onSubmit: (minutes: number, reason: string) => Promise<void> }) {
  const [minutes, setMinutes] = useState('5');
  const [reason, setReason] = useState('');
  const value = Number(minutes);
  const valid = Number.isInteger(value) && value >= 1 && value <= 60 && reason.trim().length >= 3;
  const section = student.selfPaced?.currentSection;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Cộng giờ cho ${student.name}`}
      actions={<><Button disabled={!valid} onClick={() => void onSubmit(value, reason.trim())}>Cộng giờ</Button><Button variant="secondary" onClick={onClose}>Huỷ</Button></>}
    >
      <p>Phần đang chạy: {section ? SECTION_NAMES[section] : '—'}. Các phần sau của người này lùi theo đúng số phút được cộng. Việc này ghi vào Nhật ký.</p>
      <label className={styles.field}><span>Số phút (1–60)</span><input type="number" min={1} max={60} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
      <label className={styles.field}><span>Lý do (bắt buộc)</span><textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>
    </Dialog>
  );
}

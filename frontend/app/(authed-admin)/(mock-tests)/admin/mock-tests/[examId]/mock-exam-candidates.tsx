'use client';

// MOCKORG-0086 FR-149 (G09-T34 PR 1): thẻ "Thí sinh". One row per learner from
// /live, with its audience source and retest flags from /roster. "Đánh dấu cần
// thi bù" writes the sitting's retest flags; "Cho thi bù…" assigns a separate
// self-paced make-up exam (Q13). Both read the server back afterwards.

import { useCallback, useEffect, useState } from 'react';

import { Button, Dialog, Notice, PageState } from '@/components/ui';
import { messageOf } from '@/components/admin-directory-ui';
import {
  SKILLS,
  SKILL_NAMES,
  normalizeAudience,
  vnLocalToIso,
} from '@/lib/mock-exam-org-model.mjs';
import {
  candidateRows,
  makeupTargets,
  normalizeRoster,
  retestFlagsBody,
} from '@/lib/mock-exam-record-model.mjs';

import styles from '../mock-exam-org.module.css';
import record from './mock-exam-record.module.css';
import { useMonitor } from './mock-exam-monitor';

type OrgExam = import('@/lib/mock-exam-org-model.mjs').OrgExam;
type Skill = import('@/lib/mock-exam-org-model.mjs').Skill;
type AudienceItem = import('@/lib/mock-exam-org-model.mjs').AudienceItem;
type Roster = Map<string, import('@/lib/mock-exam-record-model.mjs').RosterEntry>;
type Row = import('@/lib/mock-exam-record-model.mjs').CandidateRow;
type Flash = { kind: 'success' | 'error'; text: string };

export function MockExamCandidates({ exam, exams }: { exam: OrgExam; exams: OrgExam[] }) {
  const { monitor, error, load: loadMonitor } = useMonitor(exam.id);
  const [audience, setAudience] = useState<AudienceItem[] | null>(null);
  const [audienceNote, setAudienceNote] = useState<string | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Flash | null>(null);
  const [flagFor, setFlagFor] = useState<Row | null>(null);
  const [makeupFor, setMakeupFor] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const path = `/admin/mock-exams/${encodeURIComponent(exam.id)}`;

  const load = useCallback(async () => {
    const [fresh] = await Promise.all([
      loadMonitor(),
      (async () => {
        try {
          const value = normalizeAudience(await window.api.get<unknown>(`${path}/audience`));
          if (!value) throw new Error('Danh sách người thi sai định dạng.');
          setAudience(value.items);
          setAudienceNote(null);
        } catch (caught) {
          const code = (caught as { code?: string }).code;
          setAudience(null);
          setAudienceNote(code === 'audiences_disabled' ? null : messageOf(caught));
        }
      })(),
      (async () => {
        try {
          const value = normalizeRoster(await window.api.get<unknown>(`${path}/roster`));
          if (!value) throw new Error('Bảng chấm sai định dạng.');
          setRoster(value);
          setRosterError(null);
        } catch (caught) {
          setRoster(null);
          setRosterError(messageOf(caught));
        }
      })(),
    ]);
    return fresh;
  }, [loadMonitor, path]);
  useEffect(() => { void load(); }, [load]);

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    let failure: unknown = null;
    try { await operation(); } catch (caught) { failure = caught; }
    const fresh = await load();
    setBusy(false);
    if (failure) setNotice({ kind: 'error', text: messageOf(failure) });
    else if (!fresh) setNotice({ kind: 'error', text: 'Đã gửi nhưng chưa đọc lại được danh sách. Tải lại trang để xem trạng thái thật.' });
    else setNotice({ kind: 'success', text: success });
  };

  if (!monitor && error) return <PageState kind="error" title="Chưa tải được danh sách thí sinh" body={error} action={<Button variant="secondary" onClick={() => void load()}>Thử lại</Button>} />;
  if (!monitor) return <PageState kind="loading" title="Đang tải thí sinh…" />;

  const rows = candidateRows(monitor, audience, roster);
  const targets = makeupTargets(exams, exam.id);

  return (
    <>
      {error && <Notice kind="error" title="Mất cập nhật">{error}. Danh sách dưới là lần đọc trước.</Notice>}
      {audienceNote && <Notice kind="warning" title="Chưa đọc được nguồn người thi">{audienceNote}</Notice>}
      {rosterError && <Notice kind="warning" title="Chưa đọc được dấu thi bù">{rosterError}. Nút "Đánh dấu cần thi bù" khoá tới khi đọc được.</Notice>}
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      <div className={record.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Thí sinh</th><th>Nguồn</th><th>Kỹ năng</th><th>Đã vào thi</th><th>Cần thi bù</th><th>Thao tác</th></tr></thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.key}>
                <td><b>{row.name}</b></td>
                <td>{row.source}</td>
                <td>{row.skills ? row.skills.map((s) => SKILL_NAMES[s]).join(', ') : '—'}</td>
                <td>{row.started ? 'Đã vào' : 'Chưa vào'}</td>
                <td>{row.retestFlags.length ? row.retestFlags.map((s) => SKILL_NAMES[s]).join(', ') : '—'}</td>
                <td className={styles.actions}>
                  <Button size="sm" variant="secondary" disabled={busy || !row.canFlag} title={row.canFlag ? undefined : 'Chưa có bài để đánh dấu'} onClick={() => setFlagFor(row)}>Đánh dấu cần thi bù</Button>
                  <Button size="sm" variant="secondary" disabled={busy || !row.userId || !targets.length} title={targets.length ? undefined : 'Chưa có kỳ thi bù (tự làm, đã lên lịch)'} onClick={() => setMakeupFor(row)}>Cho thi bù…</Button>
                </td>
              </tr>
            )) : <tr><td colSpan={6}>Chưa có ai trong danh sách thi.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className={styles.help}>Thi bù là một kỳ thi tự làm riêng. Tạo kỳ thi đó ở Nháp, lên lịch, rồi chọn nó trong "Cho thi bù…".</p>
      {flagFor && (
        <FlagDialog
          row={flagFor}
          onClose={() => setFlagFor(null)}
          onSubmit={async (ticked) => {
            const target = flagFor;
            setFlagFor(null);
            await run(() => window.api.post(`/admin/mock-exams/sittings/${encodeURIComponent(target.sittingId || '')}/retest-flags`, retestFlagsBody(target.retestAllowed, ticked)), `Đã lưu dấu thi bù cho ${target.name}.`);
          }}
        />
      )}
      {makeupFor && (
        <MakeupDialog
          row={makeupFor}
          targets={targets}
          onClose={() => setMakeupFor(null)}
          onSubmit={async (targetId, skills, from, until) => {
            const target = makeupFor;
            setMakeupFor(null);
            await run(() => window.api.post(`/admin/mock-exams/${encodeURIComponent(targetId)}/assignments`, {
              assignments: [{ user_id: target.userId, skills, open_from: from, open_until: until }],
              source_exam_id: exam.id,
            }), `Đã cho ${target.name} thi bù.`);
          }}
        />
      )}
    </>
  );
}

function FlagDialog({ row, onClose, onSubmit }: { row: Row; onClose: () => void; onSubmit: (ticked: Skill[]) => Promise<void> }) {
  const [ticked, setTicked] = useState<Skill[]>(row.retestFlags);
  const toggle = (s: Skill) => setTicked((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]));
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Cần thi bù: ${row.name}`}
      actions={<><Button onClick={() => void onSubmit(ticked)}>Lưu</Button><Button variant="secondary" onClick={onClose}>Huỷ</Button></>}
    >
      <p>Đánh dấu kỹ năng người này cần thi lại. Việc này không chặn việc chấm.</p>
      <fieldset className={record.checks}>
        {row.retestAllowed.map((s) => (
          <label key={s}><input type="checkbox" checked={ticked.includes(s)} onChange={() => toggle(s)} />{SKILL_NAMES[s]}</label>
        ))}
      </fieldset>
    </Dialog>
  );
}

function MakeupDialog({ row, targets, onClose, onSubmit }: {
  row: Row;
  targets: OrgExam[];
  onClose: () => void;
  onSubmit: (targetId: string, skills: Skill[], from: string | null, until: string) => Promise<void>;
}) {
  const [targetId, setTargetId] = useState(targets[0]?.id || '');
  const target = targets.find((t) => t.id === targetId) || null;
  const offered = SKILLS.filter((s) => target?.skills.includes(s));
  const [skills, setSkills] = useState<Skill[]>(() => (row.retestFlags.length ? row.retestFlags : row.skills || []));
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const chosen = skills.filter((s) => offered.includes(s));
  const untilIso = vnLocalToIso(until);
  const fromIso = from ? vnLocalToIso(from) : null;
  const orderOk = !fromIso || !untilIso || fromIso < untilIso;
  const valid = Boolean(target && chosen.length && untilIso && orderOk);
  const toggle = (s: Skill) => setSkills((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]));
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Cho thi bù: ${row.name}`}
      actions={<><Button disabled={!valid} onClick={() => untilIso && void onSubmit(targetId, chosen, fromIso, untilIso)}>Cho thi bù</Button><Button variant="secondary" onClick={onClose}>Huỷ</Button></>}
    >
      <label className={styles.field}>
        <span>Kỳ thi bù</span>
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          {targets.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      </label>
      <fieldset className={record.checks}>
        <legend>Kỹ năng thi bù</legend>
        {offered.map((s) => <label key={s}><input type="checkbox" checked={skills.includes(s)} onChange={() => toggle(s)} />{SKILL_NAMES[s]}</label>)}
      </fieldset>
      <label className={styles.field}><span>Mở từ (giờ Việt Nam, để trống là mở ngay)</span><input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label className={styles.field}><span>Đóng lúc (giờ Việt Nam, bắt buộc)</span><input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
      {!orderOk && <p className={styles.help}>Giờ đóng phải sau giờ mở.</p>}
    </Dialog>
  );
}

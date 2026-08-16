'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { messageOf } from '@/components/admin-directory-ui';
import { filterContentByLevel, normalizeExamContent } from '@/lib/admin-mock-exams-model.mjs';

type Cohort = { id: string; name?: string };
type ContentRow = {
  id: string; kind: 'reading' | 'listening' | 'writing'; code: string; title: string; status: string;
  courseLevel: string; cohortIds: string[]; examOnly: boolean;
};
type Props = { accountId: string; cohorts: Cohort[] };
const KIND_LABEL = { reading: 'Reading', listening: 'Listening', writing: 'Writing' };

export function ExamContentLibrary({ accountId, cohorts }: Props) {
  const [kind, setKind] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [cohortFilter, setCohortFilter] = useState('');
  const [examOnly, setExamOnly] = useState(true);
  const [levelTab, setLevelTab] = useState<string | null>(null);
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [failedKinds, setFailedKinds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const [cohortEditor, setCohortEditor] = useState<ContentRow | null>(null);
  const [cohortDraft, setCohortDraft] = useState<string[]>([]);
  const requestRef = useRef(0);
  const accountRef = useRef(accountId);
  accountRef.current = accountId;

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    const account = accountId;
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (kind) query.set('kind', kind);
      if (levelFilter) query.set('course_level', levelFilter);
      if (cohortFilter) query.set('cohort_id', cohortFilter);
      if (examOnly) query.set('exam_only', 'true');
      const normalized = normalizeExamContent(await window.api.get<unknown>(`/admin/exam-content${query.size ? `?${query}` : ''}`));
      if (request !== requestRef.current || accountRef.current !== account) return false;
      if (!normalized) throw new Error('Kho đề kỳ thi sai contract.');
      setRows(normalized.rows as ContentRow[]);
      setLevels(normalized.levels);
      setFailedKinds(normalized.failedKinds);
      setError(null);
      return true;
    } catch (caught) {
      if (request === requestRef.current && accountRef.current === account) setError(messageOf(caught));
      return false;
    } finally {
      if (request === requestRef.current && accountRef.current === account) setLoading(false);
    }
  }, [accountId, cohortFilter, examOnly, kind, levelFilter]);

  useEffect(() => { void load(); return () => { requestRef.current += 1; }; }, [load]);

  const visible = useMemo(() => filterContentByLevel(rows, levelTab) as ContentRow[], [levelTab, rows]);
  const tabLevels = useMemo(() => [...new Set(rows.map((row) => row.courseLevel))].sort((a, b) => !a ? 1 : !b ? -1 : a.localeCompare(b)), [rows]);
  const cohortName = (id: string) => cohorts.find((row) => row.id === id)?.name || id;

  const saveLevel = async (row: ContentRow, courseLevel: string) => {
    const key = `${row.kind}:${row.id}:level`;
    setBusyKey(key); setError(null);
    try {
      await window.api.patch<unknown>(`/admin/exam-content/${encodeURIComponent(row.kind)}/${encodeURIComponent(row.id)}/level`, { course_level: courseLevel.trim() });
      return await load();
    } catch (caught) {
      const message = messageOf(caught);
      await load();
      setError(message);
      return false;
    }
    finally { setBusyKey(''); }
  };

  const openCohorts = (row: ContentRow) => { setCohortEditor(row); setCohortDraft(row.cohortIds); };
  const saveCohorts = async () => {
    if (!cohortEditor) return;
    const key = `${cohortEditor.kind}:${cohortEditor.id}:cohorts`;
    setBusyKey(key); setError(null);
    try {
      await window.api.patch<unknown>(`/admin/exam-content/${encodeURIComponent(cohortEditor.kind)}/${encodeURIComponent(cohortEditor.id)}/cohorts`, { cohort_ids: cohortDraft });
      if (await load()) setCohortEditor(null);
    } catch (caught) {
      const message = messageOf(caught);
      await load();
      setError(message);
    }
    finally { setBusyKey(''); }
  };

  const release = async (row: ContentRow) => {
    if (!window.confirm(`Trả “${row.code || row.title || row.id}” về thư viện luyện tập? Học viên có thể luyện lại đề từng dùng cho kỳ thi đã lưu trữ.`)) return;
    const key = `${row.kind}:${row.id}:release`;
    setBusyKey(key); setError(null);
    try {
      if (row.kind === 'reading') {
        await window.api.post<unknown>(`/admin/reading/content/tests/${encodeURIComponent(row.code || row.id)}/exam-only`, { exam_only: false });
      } else if (row.kind === 'listening') {
        await window.api.patch<unknown>(`/admin/listening/tests/${encodeURIComponent(row.id)}`, { exam_only: false });
      } else {
        await window.api.patch<unknown>(`/admin/writing/prompts/${encodeURIComponent(row.id)}`, { exam_only: false });
      }
      await load();
    } catch (caught) {
      const message = messageOf(caught);
      await load();
      setError(message);
    }
    finally { setBusyKey(''); }
  };

  return (
    <section className="mex-card mex-content">
      <div className="mex-section-head"><div><p className="mex-kicker">Exam library</p><h2>Đề kỳ thi · cấp khóa & lớp</h2></div><button className="adm-btn-secondary" type="button" onClick={() => void load()} disabled={loading}>Tải lại</button></div>
      <p className="mex-help">Kho hợp nhất Reading, Listening và Writing. Backend quyết định đề có thể trả về thư viện hay còn bị kỳ thi giữ.</p>
      <div className="mex-toolbar">
        <label><span>Kỹ năng</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="">Tất cả</option><option value="reading">Reading</option><option value="listening">Listening</option><option value="writing">Writing</option></select></label>
        <label><span>Cấp khóa</span><select value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}><option value="">Tất cả</option>{levels.map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
        <label><span>Lớp</span><select value={cohortFilter} onChange={(event) => setCohortFilter(event.target.value)}><option value="">Tất cả</option>{cohorts.map((row) => <option key={row.id} value={row.id}>{row.name || row.id}</option>)}</select></label>
        <label className="mex-check"><input type="checkbox" checked={examOnly} onChange={(event) => setExamOnly(event.target.checked)} /><span>Chỉ đề kỳ thi</span></label>
      </div>
      {failedKinds.length > 0 && <div className="mex-alert is-error" role="alert">Không tải được: {failedKinds.map((item) => KIND_LABEL[item as keyof typeof KIND_LABEL] || item).join(', ')}. Danh sách đang thiếu; không chọn đề cho tới khi tải lại đủ.</div>}
      {error && <div className="mex-alert is-error" role="alert">{error}</div>}
      <div className="mex-level-tabs" role="tablist" aria-label="Lọc nhanh theo cấp khóa">
        <button type="button" className={levelTab === null ? 'is-active' : ''} onClick={() => setLevelTab(null)}>Tất cả <small>{rows.length}</small></button>
        {tabLevels.map((level) => <button type="button" key={level || '__empty__'} className={levelTab === level ? 'is-active' : ''} onClick={() => setLevelTab(level)}>{level || 'Chưa đặt'} <small>{rows.filter((row) => row.courseLevel === level).length}</small></button>)}
      </div>
      <div className="mex-table-wrap">
        {loading && !rows.length ? <p role="status">Đang tải kho đề…</p> : !visible.length ? <p>Không có đề khớp bộ lọc.</p> : <table className="mex-table"><thead><tr><th>Kỹ năng</th><th>Mã / tiêu đề</th><th>Trạng thái</th><th>Cấp khóa</th><th>Lớp</th><th>Thao tác</th></tr></thead><tbody>{visible.map((row) => {
          const prefix = `${row.kind}:${row.id}`;
          return <tr key={prefix}><td>{KIND_LABEL[row.kind]}</td><td><strong>{row.code || '—'}</strong><small>{row.title}</small></td><td><span className="mex-pill">{row.status || '—'}</span></td><td><input aria-label={`Cấp khóa ${row.code || row.title}`} defaultValue={row.courseLevel} key={`${prefix}:${row.courseLevel}`} onBlur={(event) => { const input = event.currentTarget; if (input.value.trim() !== row.courseLevel) void saveLevel(row, input.value).then((confirmed) => { if (!confirmed) input.value = row.courseLevel; }); }} disabled={busyKey === `${prefix}:level`} /></td><td><div className="mex-chip-list">{row.cohortIds.length ? row.cohortIds.map((id) => <span key={id}>{cohortName(id)}</span>) : <em>Chưa gán</em>}</div></td><td><div className="mex-inline-actions"><button className="adm-btn-secondary" type="button" onClick={() => openCohorts(row)}>Sửa lớp</button>{row.examOnly ? <button className="adm-btn-secondary" type="button" onClick={() => void release(row)} disabled={busyKey === `${prefix}:release`}>Trả về thư viện</button> : <span>Đang ở thư viện</span>}</div></td></tr>;
        })}</tbody></table>}
      </div>
      {cohortEditor && <div className="mex-dialog-backdrop" role="presentation"><section className="mex-dialog is-small" role="dialog" aria-modal="true" aria-labelledby="mex-cohort-title"><div className="mex-dialog-head"><div><p className="mex-kicker">Replace set</p><h2 id="mex-cohort-title">Lớp dùng đề · {cohortEditor.code || cohortEditor.title}</h2></div><button className="adm-btn-secondary" type="button" onClick={() => setCohortEditor(null)}>Đóng</button></div><p className="mex-help">Lựa chọn này thay thế toàn bộ tập lớp hiện tại.</p><div className="mex-cohort-list">{cohorts.map((row) => <label key={row.id}><input type="checkbox" checked={cohortDraft.includes(row.id)} onChange={(event) => setCohortDraft((current) => event.target.checked ? [...new Set([...current, row.id])] : current.filter((id) => id !== row.id))} /><span>{row.name || row.id}</span></label>)}</div><div className="mex-dialog-actions"><button className="adm-btn-primary" type="button" onClick={() => void saveCohorts()} disabled={busyKey.endsWith(':cohorts')}>{busyKey.endsWith(':cohorts') ? 'Đang lưu…' : 'Lưu toàn bộ lớp'}</button></div></section></div>}
    </section>
  );
}

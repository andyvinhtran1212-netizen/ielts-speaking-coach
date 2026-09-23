'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { buildExamCreatePayload } from '@/lib/admin-mock-exams-model.mjs';

type Picker = { id: string; title?: string; test_id?: string; task_type?: string; name?: string; is_public?: boolean };
type PickerKind = 'reading' | 'listening' | 'writing-task1' | 'writing-task2';
type Props = {
  cohorts: Picker[];
  disabled: boolean;
  onCreate: (payload: Record<string, unknown>) => Promise<boolean>;
  onError: (message: string) => void;
};

const INITIAL = {
  code: '', title: '', examMode: 'sequential', cohortId: '', listeningTestId: '', readingTestId: '',
  listeningIsPublic: false, readingIsPublic: false,
  writingTask1PromptId: '', writingTask2PromptId: '', readingMinutes: '60', writingMinutes: '60', totalMinutes: '150',
  webExplanationMode: 'with_result', postTestCaptureRequired: true,
};

function SearchablePicker({ label, kind, value, onChange, onStatus, optionLabel, children }: {
  label: string;
  kind: PickerKind;
  value: string;
  onChange: (value: string, selected?: Picker) => void;
  onStatus: (kind: PickerKind, ready: boolean) => void;
  optionLabel: (row: Picker) => string;
  children?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<Picker[]>([]);
  const [selected, setSelected] = useState<Picker | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ kind, q: query.trim(), limit: '25', offset: String(offset) });
        const page = await window.api.get<unknown>(`/admin/mock-exams/picker?${params}`);
        if (cancelled) return;
        if (!page || typeof page !== 'object' || !Array.isArray((page as { items?: unknown }).items) ||
            !Number.isInteger((page as { total?: unknown }).total) || (page as { total: number }).total < 0 ||
            !(page as { items: unknown[] }).items.every((row) => row && typeof row === 'object' && typeof (row as Picker).id === 'string')) {
          throw new Error('Kho đề trả về dữ liệu không hợp lệ.');
        }
        const result = page as { items: Picker[]; total: number };
        setRows(result.items);
        setTotal(result.total);
        setError('');
        onStatus(kind, true);
      } catch {
        if (cancelled) return;
        setRows([]);
        setError('Không tải được kho đề. Thử tìm lại hoặc tải lại trang.');
        onStatus(kind, false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 250 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [kind, query, offset, onStatus]);
  const options = selected && value && !rows.some((row) => row.id === value) ? [selected, ...rows] : rows;
  return <div className="mex-picker-field">
    <label><span>{label} · tìm toàn bộ kho</span><input type="search" maxLength={100} value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} placeholder={`Tìm ${label.toLocaleLowerCase('vi')}…`} /></label>
    <label><span>{label}</span><select value={value} onChange={(event) => { const row = options.find((item) => item.id === event.target.value); setSelected(row || null); onChange(event.target.value, row); }}><option value="">Không dùng</option>{options.map((row) => <option key={row.id} value={row.id}>{optionLabel(row)}</option>)}</select></label>
    {loading ? <small role="status">Đang tìm trong kho đề…</small> : error ? <small className="mex-blocked-copy" role="alert">{error}</small> : <div className="mex-picker-pages"><small>{total ? `${offset + 1}–${Math.min(offset + rows.length, total)} / ${total}` : 'Không có nội dung phù hợp.'}</small><button type="button" className="adm-btn-secondary" onClick={() => setOffset(Math.max(0, offset - 25))} disabled={offset === 0}>Trước</button><button type="button" className="adm-btn-secondary" onClick={() => setOffset(offset + 25)} disabled={offset + rows.length >= total}>Tiếp</button></div>}
    {children}
  </div>;
}

export function ExamCreateForm({ cohorts, disabled, onCreate, onError }: Props) {
  const [form, setForm] = useState(INITIAL);
  const [pickerReady, setPickerReady] = useState<Record<PickerKind, boolean | null>>({ reading: null, listening: null, 'writing-task1': null, 'writing-task2': null });
  const onPickerStatus = useCallback((kind: PickerKind, ready: boolean) => setPickerReady((current) => current[kind] === ready ? current : { ...current, [kind]: ready }), []);
  const allPickersReady = Object.values(pickerReady).every((ready) => ready === true);
  const set = <K extends keyof typeof INITIAL>(key: K, value: (typeof INITIAL)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const paperCount = [form.listeningTestId, form.readingTestId, form.writingTask1PromptId, form.writingTask2PromptId].filter(Boolean).length;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = buildExamCreatePayload(form);
    if (!result.ok || !result.value) return onError(result.error || 'Dữ liệu tạo đề không hợp lệ.');
    if (await onCreate(result.value as Record<string, unknown>)) setForm((current) => ({ ...INITIAL, examMode: current.examMode }));
  };

  const option = (row: Picker) => row.title || row.name || row.test_id || row.id;
  const selectPaper = (skill: 'listening' | 'reading', id: string, selected?: Picker) => {
    setForm((current) => ({
      ...current,
      [`${skill}TestId`]: id,
      [`${skill}IsPublic`]: selected?.is_public === true,
    }));
  };
  return (
    <form className="mex-card mex-create" onSubmit={submit}>
      <div className="mex-section-head">
        <div><p className="mex-kicker">01 · Soạn đề</p><h2>Tạo đề nháp</h2><p className="mex-section-copy">Hoàn tất lần lượt thông tin, nội dung và thời lượng trước khi publish.</p></div>
        <div className="mex-create-summary"><strong>{paperCount}/4</strong><span>nội dung đã chọn</span></div>
      </div>
      <div className="mex-create-layout">
        <div className="mex-create-steps">
          <fieldset className="mex-form-step"><legend><b>1</b><span><strong>Thông tin & đối tượng</strong><small>Định danh và cách giao đề</small></span></legend><div className="mex-form-grid is-two">
            <label><span>Mã đề *</span><input value={form.code} onChange={(event) => set('code', event.target.value)} placeholder="MOCK-2026-08A" required /></label>
            <label><span>Tiêu đề *</span><input value={form.title} onChange={(event) => set('title', event.target.value)} placeholder="IELTS Mock 2026-08A" required /></label>
            <label><span>Hình thức giao</span><select value={form.examMode} onChange={(event) => set('examMode', event.target.value)}><option value="sequential">Cả lớp · theo thứ tự phần thi</option><option value="retake">Test lại · theo từng học viên</option></select></label>
            <label><span>Lớp {form.examMode === 'sequential' ? '*' : ''}</span><select value={form.cohortId} onChange={(event) => set('cohortId', event.target.value)} disabled={form.examMode === 'retake'}><option value="">{form.examMode === 'retake' ? 'Gán theo học viên sau khi publish' : 'Chọn lớp tham gia'}</option>{cohorts.map((row) => <option key={row.id} value={row.id}>{option(row)}</option>)}</select></label>
          </div></fieldset>
          <fieldset className="mex-form-step"><legend><b>2</b><span><strong>Chọn nội dung thi</strong><small>Chỉ hiển thị nội dung đã publish</small></span></legend><div className="mex-form-grid is-two">
            <SearchablePicker label="Listening" kind="listening" value={form.listeningTestId} onChange={(value, row) => selectPaper('listening', value, row)} onStatus={onPickerStatus} optionLabel={option}>{form.listeningTestId && <label className="mex-picker-check"><input type="checkbox" checked={form.listeningIsPublic} onChange={(event) => set('listeningIsPublic', event.target.checked)} /> <span>Hiện đề Listening công khai</span></label>}</SearchablePicker>
            <SearchablePicker label="Reading" kind="reading" value={form.readingTestId} onChange={(value, row) => selectPaper('reading', value, row)} onStatus={onPickerStatus} optionLabel={(row) => `${option(row)}${row.test_id ? ` · ${row.test_id}` : ''}`}>{form.readingTestId && <label className="mex-picker-check"><input type="checkbox" checked={form.readingIsPublic} onChange={(event) => set('readingIsPublic', event.target.checked)} /> <span>Hiện đề Reading công khai</span></label>}</SearchablePicker>
            <SearchablePicker label="Writing Task 1" kind="writing-task1" value={form.writingTask1PromptId} onChange={(value) => set('writingTask1PromptId', value)} onStatus={onPickerStatus} optionLabel={(row) => `${option(row)}${row.task_type ? ` · ${row.task_type}` : ''}`} />
            <SearchablePicker label="Writing Task 2" kind="writing-task2" value={form.writingTask2PromptId} onChange={(value) => set('writingTask2PromptId', value)} onStatus={onPickerStatus} optionLabel={(row) => `${option(row)}${row.task_type ? ` · ${row.task_type}` : ''}`} />
          </div></fieldset>
          <fieldset className="mex-form-step"><legend><b>3</b><span><strong>Thời lượng & rà soát</strong><small>Listening = audio + 2 phút</small></span></legend><div className="mex-form-grid is-three">
            <label><span>Reading · phút</span><input type="number" min="1" value={form.readingMinutes} onChange={(event) => set('readingMinutes', event.target.value)} /></label>
            <label><span>Writing · phút</span><input type="number" min="1" value={form.writingMinutes} onChange={(event) => set('writingMinutes', event.target.value)} /></label>
            <label><span>Tổng thời gian ước tính</span><input type="number" min="1" value={form.totalMinutes} onChange={(event) => set('totalMinutes', event.target.value)} /></label>
            <label><span>Web explanation</span><select value={form.webExplanationMode} onChange={(event) => set('webExplanationMode', event.target.value)}><option value="with_result">Theo lúc admin trả kết quả</option><option value="admin_release">Admin mở sau</option><option value="disabled">Không hiện</option></select><small>Bật lời giải đồng thời xác nhận duyệt 40 objects của từng đề Reading/Listening đã chọn.</small></label>
            <label><input type="checkbox" checked={form.postTestCaptureRequired} onChange={(event) => set('postTestCaptureRequired', event.target.checked)} /> Thu confidence trước khi trả kết quả</label>
          </div></fieldset>
        </div>
        <aside className="mex-create-aside"><p className="aop-section-label">Bước tiếp theo</p><h3>Lưu thành bản nháp</h3><p>Đề chưa hiển thị cho học viên. Sau khi rà soát, publish để giao đề và mở phòng thi.</p><dl><div><dt>Hình thức</dt><dd>{form.examMode === 'retake' ? 'Test lại cá nhân' : 'Thi theo lớp'}</dd></div><div><dt>Nội dung</dt><dd>{paperCount ? `${paperCount} mục đã chọn` : 'Chưa chọn'}</dd></div><div><dt>Ước tính</dt><dd>{form.totalMinutes || '—'} phút</dd></div></dl><button className="adm-btn-primary" type="submit" disabled={disabled || !allPickersReady}>{disabled ? 'Đang tạo…' : Object.values(pickerReady).some((ready) => ready === false) ? 'Kho đề chưa sẵn sàng' : !allPickersReady ? 'Đang xác nhận kho đề…' : 'Lưu đề nháp'}</button><p className="mex-help">Bạn vẫn có thể rà soát trước khi publish.</p></aside>
      </div>
    </form>
  );
}

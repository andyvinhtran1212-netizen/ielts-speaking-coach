'use client';

import { useState, type FormEvent } from 'react';

import { buildExamCreatePayload } from '@/lib/admin-mock-exams-model.mjs';

type Picker = { id: string; title?: string; test_id?: string; task_type?: string; name?: string };
type Props = {
  readings: Picker[];
  listenings: Picker[];
  prompts: Picker[];
  cohorts: Picker[];
  disabled: boolean;
  onCreate: (payload: Record<string, unknown>) => Promise<boolean>;
  onError: (message: string) => void;
};

const INITIAL = {
  code: '', title: '', examMode: 'sequential', cohortId: '', listeningTestId: '', readingTestId: '',
  writingTask1PromptId: '', writingTask2PromptId: '', readingMinutes: '60', writingMinutes: '60', totalMinutes: '150',
};

export function ExamCreateForm({ readings, listenings, prompts, cohorts, disabled, onCreate, onError }: Props) {
  const [form, setForm] = useState(INITIAL);
  const task1 = prompts.filter((row) => String(row.task_type || '').startsWith('task1'));
  const task2 = prompts.filter((row) => row.task_type === 'task2');
  const set = (key: keyof typeof INITIAL, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const paperCount = [form.listeningTestId, form.readingTestId, form.writingTask1PromptId, form.writingTask2PromptId].filter(Boolean).length;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = buildExamCreatePayload(form);
    if (!result.ok || !result.value) return onError(result.error || 'Dữ liệu tạo đề không hợp lệ.');
    if (await onCreate(result.value as Record<string, unknown>)) setForm((current) => ({ ...INITIAL, examMode: current.examMode }));
  };

  const option = (row: Picker) => row.title || row.name || row.test_id || row.id;
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
            <label><span>Listening</span><select value={form.listeningTestId} onChange={(event) => set('listeningTestId', event.target.value)}><option value="">Không dùng</option>{listenings.map((row) => <option key={row.id} value={row.id}>{option(row)}</option>)}</select></label>
            <label><span>Reading</span><select value={form.readingTestId} onChange={(event) => set('readingTestId', event.target.value)}><option value="">Không dùng</option>{readings.map((row) => <option key={row.id} value={row.id}>{option(row)}{row.test_id ? ` · ${row.test_id}` : ''}</option>)}</select></label>
            <label><span>Writing Task 1</span><select value={form.writingTask1PromptId} onChange={(event) => set('writingTask1PromptId', event.target.value)}><option value="">Không dùng</option>{(task1.length ? task1 : prompts).map((row) => <option key={row.id} value={row.id}>{option(row)}{row.task_type ? ` · ${row.task_type}` : ''}</option>)}</select></label>
            <label><span>Writing Task 2</span><select value={form.writingTask2PromptId} onChange={(event) => set('writingTask2PromptId', event.target.value)}><option value="">Không dùng</option>{(task2.length ? task2 : prompts).map((row) => <option key={row.id} value={row.id}>{option(row)}{row.task_type ? ` · ${row.task_type}` : ''}</option>)}</select></label>
          </div></fieldset>
          <fieldset className="mex-form-step"><legend><b>3</b><span><strong>Thời lượng & rà soát</strong><small>Listening = audio + 2 phút</small></span></legend><div className="mex-form-grid is-three">
            <label><span>Reading · phút</span><input type="number" min="1" value={form.readingMinutes} onChange={(event) => set('readingMinutes', event.target.value)} /></label>
            <label><span>Writing · phút</span><input type="number" min="1" value={form.writingMinutes} onChange={(event) => set('writingMinutes', event.target.value)} /></label>
            <label><span>Tổng thời gian ước tính</span><input type="number" min="1" value={form.totalMinutes} onChange={(event) => set('totalMinutes', event.target.value)} /></label>
          </div></fieldset>
        </div>
        <aside className="mex-create-aside"><p className="aop-section-label">Bước tiếp theo</p><h3>Lưu thành bản nháp</h3><p>Đề chưa hiển thị cho học viên. Sau khi rà soát, publish để giao đề và mở phòng thi.</p><dl><div><dt>Hình thức</dt><dd>{form.examMode === 'retake' ? 'Test lại cá nhân' : 'Thi theo lớp'}</dd></div><div><dt>Nội dung</dt><dd>{paperCount ? `${paperCount} mục đã chọn` : 'Chưa chọn'}</dd></div><div><dt>Ước tính</dt><dd>{form.totalMinutes || '—'} phút</dd></div></dl><button className="adm-btn-primary" type="submit" disabled={disabled}>{disabled ? 'Đang tạo…' : 'Lưu đề nháp'}</button><p className="mex-help">Bạn vẫn có thể rà soát trước khi publish.</p></aside>
      </div>
    </form>
  );
}

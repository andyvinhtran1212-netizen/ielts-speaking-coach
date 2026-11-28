import { postBrowserJsonAt, postBrowserJsonAtWith } from '@/lib/browser-api';
import type { components, paths } from '@/types/api';

type Schemas = components['schemas'];
type ExtraTimeBody = Schemas['ExtraTimeBody'];
type MakeUpBody = paths['/admin/mock-exams/{exam_id}/assignments']['post']['requestBody']['content']['application/json'];

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requireAck(confirmed: unknown) {
  if (!confirmed) throw new Error('Chưa nhận được xác nhận từ máy chủ. Kiểm tra trạng thái trước khi gửi lại.');
}

const examPath = (examId: string) => `/admin/mock-exams/${encodeURIComponent(examId)}`;

export async function setMockExamRoomOpen(examId: string, isOpen: boolean): Promise<void> {
  const body: Schemas['OpenBody'] = { is_open: isOpen };
  const ack = object(await postBrowserJsonAt('/admin/mock-exams/{exam_id}/open', `${examPath(examId)}/open`, body));
  requireAck(ack?.id === examId && ack.is_open === isOpen);
}

export async function advanceMockExamRoom(examId: string, from: string, next: string): Promise<void> {
  const body: Schemas['AdvanceBody'] = { from_section: from };
  const ack = object(await postBrowserJsonAt('/admin/mock-exams/{exam_id}/advance', `${examPath(examId)}/advance`, body));
  requireAck(ack?.id === examId && ack.active_section === next);
}

export async function collectMockExamRoom(examId: string, from: string): Promise<void> {
  const query = new URLSearchParams({ from_section: from });
  const ack = object(await postBrowserJsonAtWith(
    '/admin/mock-exams/{exam_id}/collect', `${examPath(examId)}/collect?${query}`,
  ));
  requireAck(ack?.queued === true && ack.section === from);
}

export async function addMockExamTime(examId: string, body: ExtraTimeBody): Promise<boolean> {
  const ack = object(await postBrowserJsonAt('/admin/mock-exams/{exam_id}/extra-time', `${examPath(examId)}/extra-time`, body));
  const total = object(ack?.extra_seconds)?.[body.section];
  requireAck(ack?.sitting_id === body.sitting_id && typeof total === 'number' && total >= body.seconds
    && typeof ack.event_logged === 'boolean');
  return ack?.event_logged === true;
}

export async function setMockExamRetestFlags(sittingId: string, flags: Record<string, boolean>): Promise<void> {
  const body: Schemas['RetestFlagsBody'] = { retest_flags: flags };
  const ack = object(await postBrowserJsonAt(
    '/admin/mock-exams/sittings/{sitting_id}/retest-flags',
    `/admin/mock-exams/sittings/${encodeURIComponent(sittingId)}/retest-flags`,
    body,
  ));
  const stored = object(ack?.retest_flags);
  requireAck(ack?.sitting_id === sittingId && stored && Object.entries(flags).every(([skill, flag]) => stored[skill] === flag));
}

export async function assignMockExamMakeUp(examId: string, assignment: Schemas['AssignRow'], sourceExamId: string): Promise<void> {
  const body: MakeUpBody = { assignments: [assignment], source_exam_id: sourceExamId };
  const ack = object(await postBrowserJsonAt('/admin/mock-exams/{exam_id}/assignments', `${examPath(examId)}/assignments`, body));
  if (Array.isArray(ack?.skipped) && ack.skipped.includes(assignment.user_id)) {
    throw new Error('Chưa giao được kỳ thi bù cho học viên này.');
  }
  requireAck(Array.isArray(ack?.assigned) && ack.assigned.includes(assignment.user_id));
  if (Array.isArray(ack?.locked) && ack.locked.includes(assignment.user_id)) {
    throw new Error('Đã lưu lượt thi bù. Lượt thi đang diễn ra chưa nhận thay đổi.');
  }
  if (Array.isArray(ack?.refresh_failed) && ack.refresh_failed.includes(assignment.user_id)) {
    throw new Error('Đã lưu lượt thi bù nhưng chưa cập nhật được lượt đang mở. Kiểm tra lại trước khi gửi lại.');
  }
}

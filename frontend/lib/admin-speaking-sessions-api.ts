import 'client-only';

import { getBrowserJson, getBrowserJsonAt, postBrowserJsonAt } from '@/lib/browser-api';
import type { ApiGetJson, ApiPostJson } from '@/lib/openapi-contract';

export type AdminSpeakingSessionListWire = ApiGetJson<'/admin/sessions'>;
export type AdminSpeakingSessionDetailWire = ApiGetJson<'/admin/sessions/{session_id}'>;
export type AdminResponseRegradeWire = ApiPostJson<'/admin/responses/{response_id}/regrade'>;
export type AdminSessionRegradeWire = ApiPostJson<'/admin/sessions/{session_id}/regrade'>;
export type AdminSummaryRebuildWire = ApiPostJson<'/admin/sessions/{session_id}/rebuild-summary'>;

export function getAdminSpeakingSessions(query: URLSearchParams) {
  return getBrowserJson('/admin/sessions', query);
}

export function getAdminSpeakingSessionDetail(sessionId: string) {
  return getBrowserJsonAt(
    '/admin/sessions/{session_id}',
    `/admin/sessions/${encodeURIComponent(sessionId)}`,
  );
}

export function regradeAdminSpeakingResponse(responseId: string) {
  return postBrowserJsonAt(
    '/admin/responses/{response_id}/regrade',
    `/admin/responses/${encodeURIComponent(responseId)}/regrade`,
  );
}

export function regradeAdminSpeakingSession(sessionId: string, force: boolean) {
  const suffix = force ? '?force=true' : '';
  return postBrowserJsonAt(
    '/admin/sessions/{session_id}/regrade',
    `/admin/sessions/${encodeURIComponent(sessionId)}/regrade${suffix}`,
  );
}

export function rebuildAdminSpeakingSummary(
  sessionId: string,
  p2Id: string | null,
  p3Id: string | null,
) {
  const query = new URLSearchParams();
  if (p2Id) query.set('p2_id', p2Id);
  if (p3Id) query.set('p3_id', p3Id);
  return postBrowserJsonAt(
    '/admin/sessions/{session_id}/rebuild-summary',
    `/admin/sessions/${encodeURIComponent(sessionId)}/rebuild-summary${query.size ? `?${query}` : ''}`,
  );
}

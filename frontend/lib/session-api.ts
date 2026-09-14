import 'client-only';

import { getBrowserJson, getBrowserJsonAt } from '@/lib/browser-api';
import type { ApiGetJson } from '@/lib/openapi-contract';
import {
  normalizeSessionAudioUrls,
  normalizeSessionDetail,
  normalizeSessionHistory,
} from '@/lib/session-wire-model.mjs';

export type SessionHistoryWire = ApiGetJson<'/sessions'>;
export type SessionStatsWire = ApiGetJson<'/sessions/stats'>;
export type SessionDetailWire = ApiGetJson<'/sessions/{session_id}'>;
export type SessionAudioUrlsWire = ApiGetJson<'/sessions/{session_id}/audio-urls'>;

export async function getSessionHistory(
  query: URLSearchParams,
  signal?: AbortSignal,
): Promise<SessionHistoryWire> {
  const normalized = normalizeSessionHistory(await getBrowserJson('/sessions', query, signal));
  if (!normalized) throw new Error('Backend trả lịch sử Speaking không đúng định dạng.');
  return normalized as SessionHistoryWire;
}

export async function getSessionDetail(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionDetailWire> {
  const encoded = encodeURIComponent(sessionId);
  const normalized = normalizeSessionDetail(await getBrowserJsonAt(
    '/sessions/{session_id}', `/sessions/${encoded}`, signal,
  ));
  if (!normalized) throw new Error('Backend trả chi tiết Speaking không đúng định dạng.');
  return normalized as SessionDetailWire;
}

export async function getSessionAudioUrls(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionAudioUrlsWire> {
  const encoded = encodeURIComponent(sessionId);
  const normalized = normalizeSessionAudioUrls(await getBrowserJsonAt(
    '/sessions/{session_id}/audio-urls', `/sessions/${encoded}/audio-urls`, signal,
  ));
  if (!normalized) throw new Error('Backend trả liên kết ghi âm không đúng định dạng.');
  return normalized as SessionAudioUrlsWire;
}

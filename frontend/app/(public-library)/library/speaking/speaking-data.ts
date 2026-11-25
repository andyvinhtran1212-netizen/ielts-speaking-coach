// Data of the Speaking shelf (LIBRARY-0061 T013): shapes of
// `GET /api/library/speaking*` and an uncached server fetch, like the hub.
// Library JSON is read with `no-store`, so a question withdrawn from the shelf
// disappears from these pages on the next request.
import { API_BASE, ABORT_MS } from '@/lib/backend';

export type AnswerKind = 'video' | 'audio' | 'text';

export type SpeakingItem = {
  slug: string;
  part: 1 | 2 | 3;
  title_en: string;
  title_vi: string | null;
  topic_slug: string | null;
  answer_kind: AnswerKind;
  duration_s: number | null;
  voice: 'synthetic';
};

export type SpeakingTopic = { slug: string; label_vi: string | null };

export type SpeakingList = {
  items: SpeakingItem[];
  total: number;
  facets: { part: Record<string, number>; topic: Record<string, number>; video: number };
  topics: SpeakingTopic[];
};

export type TranscriptMark = { kind: 'vocab' | 'structure'; start: number; end: number; note: string | null };
export type TranscriptLine = { start_ms: number | null; text: string; marks: TranscriptMark[] };

export type SpeakingDetail = SpeakingItem & {
  topic_label_vi: string | null;
  topic_id: string | null;
  cue_card: { prompt?: string; bullets?: string[]; reflection?: string; questions?: string[] } | null;
  media: {
    video_source: 'youtube' | 'self_hosted' | null;
    youtube_id: string | null;
    video_url: string | null;
    audio_url: string | null;
  };
  sample_text: string;
  transcript: TranscriptLine[];
  timed: boolean;
  outline: string[];
  vocabulary: { term: string; meaning_vi: string | null; note: string | null }[];
  related_part3: string[];
  published_at: string | null;
  updated_at: string | null;
  prev: { slug: string; title_en: string } | null;
  next: { slug: string; title_en: string } | null;
};

export type Fetched<T> = { ok: true; data: T } | { ok: false; status: number };

/** GET a Library endpoint, uncached. Network failures read as status 0. */
export async function getLibrary<T>(path: string): Promise<Fetched<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(ABORT_MS) });
    if (!res.ok) {
      if (res.status !== 404) console.error(`[library] ${path} → HTTP ${res.status}`);
      return { ok: false, status: res.status };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (error) {
    console.error(`[library] ${path} failed`, error);
    return { ok: false, status: 0 };
  }
}

export const SPEAKING_PATH = '/library/speaking';

export function speakingHref(slug: string): string {
  return `${SPEAKING_PATH}/${encodeURIComponent(slug)}`;
}

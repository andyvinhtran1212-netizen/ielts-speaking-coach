'use client';

import { useEffect, useRef, useState } from 'react';
import { useListeningSource } from '@/lib/use-listening-source';
import { useAuth } from '@/lib/auth/auth-provider';
import type { ApiGetJson } from '@/lib/openapi-contract';

type AudioResponse = ApiGetJson<'/api/listening/source-collections/80-days/days/{day_number}/audio'>;

export function ListeningSourceAudio({ day }: { day: number }) {
  const { state, retry } = useListeningSource<AudioResponse>(`/api/listening/source-collections/80-days/days/${day}/audio`);
  const { status, user } = useAuth();
  const scope = `${day}:${status}:${user?.id || ''}`;
  const [choice, setChoice] = useState<{ scope: string; id: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const variants = state.status === 'ready' ? state.data.variants || [] : [];
  const selected = variants.find((variant) => variant.variant_id === (choice?.scope === scope ? choice.id : 'original')) || variants[0];
  const mediaKey = `${scope}:${selected?.variant_id}:${selected?.url}`;
  useEffect(() => {
    const media = audio.current;
    setFailed(null);
    return () => { media?.pause(); if (media) { media.removeAttribute('src'); media.load(); } };
  }, [mediaKey]);
  return <section className="source-study" aria-label="Nghe audio theo phiên bản">
    <h2>Nghe theo phiên bản</h2>
    <p>Nghe tự do trên trang này không tạo lượt luyện. Bài luyện bên dưới dùng bản ghi gốc.</p>
    {state.status === 'loading' ? <p role="status">Đang tải audio…</p> : state.status === 'error' ? <><p role="alert">Chưa tải được các phiên bản audio.</p><button type="button" onClick={retry}>Thử lại audio</button></> : <>
      <label>Phiên bản audio <select value={selected?.variant_id || ''} onChange={(event) => { audio.current?.pause(); setChoice({ scope, id: event.target.value }); }}>
        {variants.map((variant) => <option key={variant.variant_id} value={variant.variant_id}>{variant.label_vi}</option>)}
      </select></label>
      {selected ? <><p>{selected.note_vi}</p>{selected.url ? <audio key={mediaKey} ref={audio} controls preload="none" src={selected.url} style={{ width: '100%' }} aria-label={selected.label_vi} onError={() => setFailed(mediaKey)} /> : <p role="status">Bản audio này chưa sẵn sàng để phát.</p>}
        {failed === mediaKey ? <p role="alert">Chưa phát được audio. Hãy thử tải lại.</p> : null}
        {!selected.url || failed === mediaKey ? <button type="button" onClick={retry}>Tải lại audio</button> : null}</> : null}
    </>}
  </section>;
}

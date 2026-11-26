'use client';

/**
 * Browser-only parts of a Vocabulary entry: the "Báo lỗi" control (anonymous
 * feedback to the canonical inbox) and the one `vocab_wiki_viewed` event per
 * entry view. Both keep the contracts the wiki had before T015.
 */
import { useEffect, useState } from 'react';

import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import styles from './vocabulary.module.css';

export function EntryFlag({ category, slug }: { category: string; slug: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function send(reason: 'content' | 'audio') {
    setStatus('sending');
    try {
      const ready = await whenGlobalReady(() => !!window.api?.post, 'window.api (vocabulary feedback)');
      if (!ready) throw new Error('api-not-ready');
      await window.api.post('/api/feedback', {
        type: 'report', skill: 'vocabulary', vocab_slug: slug,
        vocab_category: category,
        category: reason === 'audio' ? 'audio_issue' : 'content_issue',
      });
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className={styles.flag}>
      <button type="button" className={styles.flagButton} aria-expanded={open}
        aria-label="Báo lỗi mục từ này" onClick={() => { setOpen((value) => !value); setStatus('idle'); }}>
        Báo lỗi
      </button>
      {open ? (
        <div className={styles.flagMenu} role="group" aria-label="Báo lỗi về">
          {status === 'sent' ? <span role="status">Đã gửi, cảm ơn bạn.</span> : (
            <>
              <span>Báo lỗi về:</span>
              <button type="button" disabled={status === 'sending'} onClick={() => void send('content')}>Nội dung</button>
              <button type="button" disabled={status === 'sending'} onClick={() => void send('audio')}>Âm thanh</button>
              {status === 'error' ? <span role="alert">Không gửi được, thử lại.</span> : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

const viewed = new Set<string>();

export function EntryViewBeacon({ category, slug }: { category: string; slug: string }) {
  useEffect(() => {
    const key = `${category}\u0000${slug}`;
    if (viewed.has(key)) return;
    viewed.add(key);
    try {
      const sessionId = sessionStorage.getItem('vocab_session_id') || crypto.randomUUID();
      sessionStorage.setItem('vocab_session_id', sessionId);
      void whenGlobalReady(() => !!window.api?.post, 'window.api (vocabulary analytics)').then((ready) => {
        if (ready) void window.api.post('/api/analytics/events', {
          event_name: 'vocab_wiki_viewed',
          event_data: { slug, category },
          session_id: sessionId,
        }).catch(() => undefined);
      });
    } catch { /* analytics is best effort */ }
  }, [category, slug]);
  return null;
}

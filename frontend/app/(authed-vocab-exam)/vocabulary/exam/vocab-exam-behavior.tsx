'use client';

// `/api/vocabulary/exam` là endpoint public, read-only. Component không tự
// phát minh auth gate; nó chỉ đưa request/render vào React lifecycle để soft
// navigation chạy lại đúng và request cũ bị hủy khi rời trang.
import { useEffect, useState } from 'react';

import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

interface ExamListPayload {
  slug?: unknown;
  title?: unknown;
  description?: unknown;
  count?: unknown;
}

interface ExamFamilyPayload {
  family?: unknown;
  title?: unknown;
  lists?: unknown;
}

interface ExamList {
  slug: string;
  title: string;
  description: string | null;
  count: number;
}

interface ExamFamily {
  key: string;
  title: string;
  icon: string;
  lists: ExamList[];
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; families: ExamFamily[] }
  | { status: 'error' };

const FAMILY_ICON: Record<string, string> = {
  awl: '🎓',
  toeic: '💼',
  thpt: '🏫',
};

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveCount(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function normalizeFamilies(payload: unknown): ExamFamily[] {
  if (!Array.isArray(payload)) return [];

  return payload.flatMap((rawFamily: ExamFamilyPayload, familyIndex) => {
    const family = textValue(rawFamily?.family);
    const familyTitle = textValue(rawFamily?.title) || family;
    const rawLists = Array.isArray(rawFamily?.lists) ? rawFamily.lists : [];
    const lists = rawLists.flatMap((rawList: ExamListPayload) => {
      const slug = textValue(rawList?.slug);
      const count = positiveCount(rawList?.count);
      if (!slug || count <= 0) return [];
      return [{
        slug,
        title: textValue(rawList?.title) || slug,
        description: textValue(rawList?.description) || null,
        count,
      }];
    });

    if (!lists.length) return [];
    return [{
      key: `${family || 'family'}-${familyIndex}`,
      title: familyTitle || 'Danh sách luyện thi',
      icon: FAMILY_ICON[family] || '📚',
      lists,
    }];
  });
}

export function VocabExamBehavior() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setState({ status: 'loading' });

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (vocabulary exam)',
      );
      if (!ready || disposed) {
        if (!disposed) setState({ status: 'error' });
        return;
      }

      try {
        const payload = await window.api.getWith<unknown>(
          '/api/vocabulary/exam',
          undefined,
          { signal: controller.signal },
        );
        if (!disposed) {
          setState({ status: 'ready', families: normalizeFamilies(payload) });
        }
      } catch (caught: unknown) {
        if (!disposed && !(caught instanceof DOMException && caught.name === 'AbortError')) {
          setState({ status: 'error' });
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, []);

  if (state.status === 'loading') {
    return <p className="vx-status">Đang tải…</p>;
  }
  if (state.status === 'error') {
    return <p className="vx-status is-error">Không tải được danh sách luyện thi. Vui lòng thử lại sau.</p>;
  }
  if (!state.families.length) {
    return <p className="vx-status">Chưa có danh sách luyện thi nào. Vui lòng quay lại sau.</p>;
  }

  return (
    <div>
      {state.families.map((family) => (
        <section className="vx-family" key={family.key}>
          <h2 className="vx-family-title">
            <span aria-hidden="true">{family.icon}</span>{' '}{family.title}
          </h2>
          <div className="modes-grid">
            {family.lists.map((list) => (
              <a
                className="mode-card"
                href={`/pages/flashcard-study.html?stack=examlist:${encodeURIComponent(list.slug)}`}
                key={list.slug}
              >
                <div className="head">
                  <div className="icon" aria-hidden="true">🗂️</div>
                  <span className="arrow" aria-hidden="true">→</span>
                </div>
                <h3>{list.title}</h3>
                <p className="lede vx-meta">
                  <span className="vx-count">{list.count} từ</span>
                  {list.description ? <> · {list.description}</> : null}
                </p>
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

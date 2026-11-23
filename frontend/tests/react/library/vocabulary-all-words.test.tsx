// LIBRARY-0061 T015 (FR-051): "Kết quả tra" runs over the whole catalogue, so a
// page that fails must fail the read; a partial list would make an existing
// word look absent.
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const pages = new Map<number, unknown>();
vi.mock('@/lib/backend', () => ({
  getPublicJson: vi.fn(async (path: string) => {
    const offset = Number(new URL(path, 'http://x').searchParams.get('offset'));
    const page = pages.get(offset);
    if (page instanceof Error) throw page;
    return page ?? null;
  }),
}));

const word = (n: number) => ({ slug: `w${n}`, category: 'education', headword: `word ${n}` });

describe('getAllVocabularyWords', () => {
  it('reads every page of the directory', async () => {
    pages.clear();
    pages.set(0, { items: Array.from({ length: 100 }, (_, n) => word(n)), total: 150 });
    pages.set(100, { items: Array.from({ length: 50 }, (_, n) => word(100 + n)), total: 150 });
    const { getAllVocabularyWords } = await import('@/lib/vocabulary-api');
    expect(await getAllVocabularyWords()).toHaveLength(150);
  });

  it('a failed page rejects instead of returning the pages read so far', async () => {
    vi.resetModules();
    pages.clear();
    pages.set(0, { items: Array.from({ length: 100 }, (_, n) => word(n)), total: 150 });
    pages.set(100, new Error('backend 503'));
    const { getAllVocabularyWords } = await import('@/lib/vocabulary-api');
    await expect(getAllVocabularyWords()).rejects.toThrow();
  });

  it('a missing page (null) rejects too', async () => {
    vi.resetModules();
    pages.clear();
    pages.set(0, { items: Array.from({ length: 100 }, (_, n) => word(n)), total: 150 });
    const { getAllVocabularyWords } = await import('@/lib/vocabulary-api');
    await expect(getAllVocabularyWords()).rejects.toThrow();
  });
});

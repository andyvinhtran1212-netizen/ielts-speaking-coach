import type { ApiGetJson } from '@/lib/openapi-contract';

type Assert<Condition extends true> = Condition;
type Directory = ApiGetJson<'/api/vocabulary/directory'>;

/** Compile-time gate: this endpoint must stay explicitly modeled in FastAPI. */
type _VocabularyDirectoryIsModeled = Assert<
  Directory extends {
    categories: Array<{ slug: string; title: string; article_count: number }>;
    items: Array<{ slug: string; category: string; headword: string }>;
    total: number;
    offset: number;
    limit: number;
  } ? true : false
>;

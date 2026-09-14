import type { ApiGetJson } from '@/lib/openapi-contract';

type Assert<Condition extends true> = Condition;
type Directory = ApiGetJson<'/api/vocabulary/directory'>;
type CurrentUser = ApiGetJson<'/auth/me'>;

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

/** Compile-time gate: authorization-critical identity fields cannot regress to unknown. */
type _CurrentUserIsModeled = Assert<
  CurrentUser extends {
    id: string;
    role: string;
    is_active: boolean;
    permissions: string[];
    onboarding_completed: boolean;
    d1_enabled: boolean;
    flashcard_enabled: boolean;
    vocab_curated_enabled: boolean;
  } ? true : false
>;

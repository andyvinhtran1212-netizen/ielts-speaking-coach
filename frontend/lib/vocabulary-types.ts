export type VocabularyWord = {
  slug: string;
  category: string;
  headword: string;
  level: string;
  partOfSpeech: string;
  pronunciation: string;
  glossVi: string;
  audioHeadword: string;
};

export type VocabularyCategory = {
  slug: string;
  title: string;
  articleCount: number;
};

export type VocabularyDirectory = {
  categories: VocabularyCategory[];
  items: VocabularyWord[];
  total: number;
  offset: number;
  limit: number;
};

export type VocabularyArticle = VocabularyWord & {
  syllables: string;
  audioExample: string;
  definitionEn: string;
  definitionVi: string;
  example: string;
  collocations: string[];
  synonyms: string[];
  antonyms: string[];
  relatedWords: string[];
  wordFamily: string[];
  commonError: string;
  memoryHook: string;
  register: string;
  source: string;
  html: string;
};

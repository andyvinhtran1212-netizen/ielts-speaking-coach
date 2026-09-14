// Hermetic server-side bootstrap fixture for the permanent Next browser gate.
// Browser requests are fulfilled by each verifier; this server only covers
// data fetched by React Server Components, which Playwright cannot intercept.
import { createServer } from 'node:http';

const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.NEXT_NATIVE_FIXTURE_PORT || '3999', 10);
const GRAMMAR_DELAY_MS = Math.max(0, Number.parseInt(process.env.NEXT_NATIVE_GRAMMAR_DELAY_MS || '0', 10) || 0);

const summaries = [
  { slug: 'academic-growth', category: 'education', headword: 'academic growth', level: 'B2', part_of_speech: 'noun phrase', pronunciation: '', gloss_vi: 'sự tiến bộ học thuật', audio_headword: '' },
  { slug: 'lifelong-learning', category: 'education', headword: 'lifelong learning', level: 'B2', part_of_speech: 'noun phrase', pronunciation: '', gloss_vi: 'học tập suốt đời', audio_headword: '' },
  { slug: 'carbon-footprint', category: 'environment', headword: 'carbon footprint', level: 'B2', part_of_speech: 'noun phrase', pronunciation: '', gloss_vi: 'dấu chân carbon', audio_headword: '' },
  ...Array.from({ length: 62 }, (_, index) => ({
    slug: `fixture-word-${index + 1}`,
    category: index % 2 ? 'environment' : 'education',
    headword: `fixture word ${String(index + 1).padStart(2, '0')}`,
    level: 'B1',
    part_of_speech: 'noun',
    pronunciation: '',
    gloss_vi: `mục từ kiểm thử ${index + 1}`,
    audio_headword: '',
  })),
];

const categories = [
  { slug: 'education', title: 'Education', articles: summaries.filter((item) => item.category === 'education') },
  { slug: 'environment', title: 'Environment', articles: summaries.filter((item) => item.category === 'environment') },
].map((category) => ({
  ...category,
  article_count: category.articles.length,
}));

function directory(url) {
  const category = (url.searchParams.get('category') || '').trim();
  const query = (url.searchParams.get('q') || '').trim().toLocaleLowerCase('vi');
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '60', 10) || 60));
  const items = summaries.filter((item) => (!category || item.category === category)
    && (!query || item.headword.toLocaleLowerCase('vi').includes(query)
      || item.gloss_vi.toLocaleLowerCase('vi').includes(query)));
  return {
    categories: categories.map(({ articles: _articles, ...item }) => item),
    items: items.slice(offset, offset + limit),
    total: items.length,
    offset,
    limit,
  };
}

function article(category, slug) {
  const summary = summaries.find((item) => item.category === category && item.slug === slug);
  if (!summary) return null;
  return {
    ...summary,
    syllables: '',
    definition_en: `Fixture definition for ${summary.headword}.`,
    definition_vi: `Định nghĩa kiểm thử cho ${summary.headword}.`,
    example: `Use ${summary.headword} in context.`,
    collocations: ['browser fixture'],
    synonyms: [],
    antonyms: [],
    related_words: [],
    word_family: [],
    common_error: '',
    memory_hook: 'Keep the server contract stable.',
    audio_example: '',
    register: 'neutral',
    source: 'Next-native fixture',
    html: '',
  };
}

function grammarArticle(category, slug) {
  if (category !== 'tenses' || slug !== 'present-simple') return null;
  return {
    slug,
    category,
    title: 'Present Simple',
    summary: 'Fixture article for streamed loading verification.',
    level: 'A2',
    difficulty: 'beginner',
    band_relevance: ['5.0+'],
    speaking_relevance: 'Use it for habits and facts.',
    writing_relevance: 'Use it for general statements.',
    pathways: ['foundation'],
    common_error_tags: [],
    tags: ['tenses'],
    order: 1,
    reading_time: 4,
    last_updated: '2026-09-14',
    status: 'complete',
    html: '<h2 id="overview">Overview</h2><p>The present simple describes habits and facts.</p>',
    word_count: 12,
    toc: [{ id: 'overview', name: 'Overview', depth: 2 }],
    anchors: [{ id: 'overview', location: 'Overview', type: 'heading' }],
    learning_blocks: [],
    prerequisites: [],
    compare_with: [],
    related_pages: [],
    next_articles: [],
    prev_article: null,
    next_article: null,
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${HOST}:${PORT}`);
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');

  if (request.method === 'GET' && url.pathname === '/health') {
    response.writeHead(200).end(JSON.stringify({ ok: true }));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/vocabulary/categories') {
    response.writeHead(200).end(JSON.stringify(categories));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/vocabulary/directory') {
    response.writeHead(200).end(JSON.stringify(directory(url)));
    return;
  }
  const match = url.pathname.match(/^\/api\/vocabulary\/articles\/([^/]+)\/([^/]+)$/);
  if (request.method === 'GET' && match) {
    const value = article(decodeURIComponent(match[1]), decodeURIComponent(match[2]));
    response.writeHead(value ? 200 : 404).end(JSON.stringify(value || { detail: 'Not found' }));
    return;
  }
  const grammarMatch = url.pathname.match(/^\/api\/grammar\/article\/([^/]+)\/([^/]+)$/);
  if (request.method === 'GET' && grammarMatch) {
    const value = grammarArticle(decodeURIComponent(grammarMatch[1]), decodeURIComponent(grammarMatch[2]));
    if (GRAMMAR_DELAY_MS) await new Promise((resolve) => setTimeout(resolve, GRAMMAR_DELAY_MS));
    response.writeHead(value ? 200 : 404).end(JSON.stringify(value || { detail: 'Not found' }));
    return;
  }
  response.writeHead(404).end(JSON.stringify({ detail: 'No server fixture for this endpoint' }));
});

server.listen(PORT, HOST, () => {
  console.log(`Next-native fixture API listening on http://${HOST}:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

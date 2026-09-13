// Hermetic server-side bootstrap fixture for the permanent Next browser gate.
// Browser requests are fulfilled by each verifier; this server only covers
// data fetched by React Server Components, which Playwright cannot intercept.
import { createServer } from 'node:http';

const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.NEXT_NATIVE_FIXTURE_PORT || '3999', 10);

const summaries = [
  { slug: 'academic-growth', category: 'education', headword: 'academic growth', level: 'B2', part_of_speech: 'noun phrase', pronunciation: '', gloss_vi: 'sự tiến bộ học thuật', audio_headword: '' },
  { slug: 'lifelong-learning', category: 'education', headword: 'lifelong learning', level: 'B2', part_of_speech: 'noun phrase', pronunciation: '', gloss_vi: 'học tập suốt đời', audio_headword: '' },
  { slug: 'carbon-footprint', category: 'environment', headword: 'carbon footprint', level: 'B2', part_of_speech: 'noun phrase', pronunciation: '', gloss_vi: 'dấu chân carbon', audio_headword: '' },
];

const categories = [
  { slug: 'education', title: 'Education', article_count: 2, articles: summaries.slice(0, 2) },
  { slug: 'environment', title: 'Environment', article_count: 1, articles: summaries.slice(2) },
];

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

const server = createServer((request, response) => {
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
  const match = url.pathname.match(/^\/api\/vocabulary\/articles\/([^/]+)\/([^/]+)$/);
  if (request.method === 'GET' && match) {
    const value = article(decodeURIComponent(match[1]), decodeURIComponent(match[2]));
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

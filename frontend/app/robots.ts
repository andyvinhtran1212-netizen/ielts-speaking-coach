import type { MetadataRoute } from 'next';

const PRIVATE_PREFIXES = [
  '/admin',
  '/api',
  '/core-player',
  '/course/',
  '/exercises',
  '/home',
  '/instructor',
  '/listening',
  '/login',
  '/mock-exam', // G07-T11: '/mock' bỏ theo spec; '/mock-exam' giữ tới đợt 7b (T12b) vì tiền tố '/mock' từng chặn cả nó
  '/next-probe',
  '/onboarding',
  '/pages/',
  '/practice',
  '/pricing',
  '/profile',
  '/quiz',
  '/reading',
  '/recorder-spike',
  '/result',
  '/speaking',
  '/tests',
  '/vocabulary/exam',
  '/vocabulary/fill-in',
  '/vocabulary/flashcards',
  '/vocabulary/hub',
  '/vocabulary/learn',
  '/writing',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/grammar/', '/vocabulary'],
      disallow: PRIVATE_PREFIXES,
    },
    sitemap: 'https://www.averlearning.com/sitemap.xml',
    host: 'https://www.averlearning.com',
  };
}

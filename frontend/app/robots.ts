import type { MetadataRoute } from 'next';

const PRIVATE_PREFIXES = [
  '/account',
  '/admin',
  '/api',
  '/core-player',
  '/course/',
  '/exercises',
  '/help',
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
  '/progress',
  '/quiz',
  '/reading',
  '/recorder-spike',
  '/result',
  '/speaking',
  '/start',
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
      allow: ['/', '/grammar/', '/vocabulary', '/library'],
      disallow: PRIVATE_PREFIXES,
    },
    sitemap: 'https://www.averlearning.com/sitemap.xml',
    host: 'https://www.averlearning.com',
  };
}

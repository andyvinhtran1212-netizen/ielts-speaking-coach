import type { MetadataRoute } from 'next';

const PRIVATE_PREFIXES = [
  '/account',
  '/admin',
  '/api',
  '/core-player',
  '/course-exercises',
  '/exam',
  '/exercises',
  '/full-test',
  '/full-test-result',
  '/help',
  '/home',
  '/instructor',
  '/listening',
  '/login',
  '/mock',
  '/my-class',
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

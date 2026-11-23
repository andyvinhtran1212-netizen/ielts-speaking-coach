import type { MetadataRoute } from 'next';

const PRIVATE_PREFIXES = [
  '/admin',
  '/api',
  '/core-player',
  '/course/',
  '/exam',
  '/exercises',
  '/full-test',
  '/home',
  '/instructor',
  '/listening',
  '/login',
  '/mock',
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

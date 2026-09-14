import type { MetadataRoute } from 'next';

const PRIVATE_PREFIXES = [
  '/admin',
  '/api',
  '/core-player',
  '/course-exercises',
  '/d1-exercise',
  '/exam',
  '/exercises',
  '/flashcard-study',
  '/flashcards',
  '/full-test',
  '/full-test-result',
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
  '/quiz',
  '/reading',
  '/recorder-spike',
  '/result',
  '/speaking',
  '/vocabulary/exam',
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
    sitemap: 'https://averlearning.com/sitemap.xml',
    host: 'https://averlearning.com',
  };
}

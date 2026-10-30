import { notFound } from 'next/navigation';

// Rewrite target of proxy.ts for an unknown `/grammar/:category/:slug`.
// Deliberately STATIC: notFound() at prerender ships a prerendered 404 with a
// real 404 status, rendered by grammar/not-found.tsx inside the Grammar layout.
export default function GrammarArticleNotFoundPage() {
  notFound();
}

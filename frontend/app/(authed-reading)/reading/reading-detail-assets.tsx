import { RouteScriptChain } from '@/components/route-script-chain';

const READING_DETAIL_SCRIPTS = [
  { src: 'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js' },
  { src: 'https://cdn.jsdelivr.net/npm/dompurify@3.4.8/dist/purify.min.js' },
  { src: '/js/markdown.js' },
  { src: '/js/feedback-widgets.js' },
] as const;

export function ReadingDetailAssets() {
  return (
    <>
      <link rel="stylesheet" href="/css/markdown.css" />
      <link rel="stylesheet" href="/css/feedback.css" />
      <RouteScriptChain scripts={READING_DETAIL_SCRIPTS} />
    </>
  );
}

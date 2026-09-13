import { RouteScriptChain } from '@/components/route-script-chain';

const READING_DETAIL_SCRIPTS = [
  { src: '/vendor/marked.min.js' },
  { src: '/vendor/purify.min.js' },
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

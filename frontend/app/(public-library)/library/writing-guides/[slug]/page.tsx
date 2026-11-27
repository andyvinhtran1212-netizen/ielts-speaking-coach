// `/library/writing-guides/[slug]` — one Kiến thức Writing guide (LIBRARY-0061
// T011 = G06-T11; tờ KienThucWriting §2–3; FR-021, FR-022, FR-023).
//
// - Public: no login, no activation gate (FR-001). The article is in the
//   server HTML; only the "đang đọc" contents tracking runs in the browser.
// - Body HTML comes from the API, rendered from Markdown on the server with
//   raw HTML escaped and unsafe link schemes removed (services/library_guides.py).
//   Sample citations are already resolved there from published
//   `writing_samples`; a withdrawn sample is absent from the HTML (FR-022).
// - "cập nhật" is the guide's `updated_at`, not its publish date (FR-023).
// - Course link once, at the end above "Bài trước / Bài sau" (FR-003).
// - A guide the API does not have: noindex metadata and a "không có bài này"
//   body inside the Library shell. notFound() is not used: thrown behind this
//   streamed Suspense boundary it renders the root 404 card (its own <main>
//   and the legacy tokens) inside the shell, and the status is 200 anyway
//   under cacheComponents (see the grammar article route). The API answers
//   404 for the guide either way.
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Breadcrumb } from '@/components/ui';
import { routeFor } from '@/lib/route-registry.mjs';
import { guideHref } from '@/lib/writing-guides-model.mjs';

import { loadGuide } from '../guides-data';
import { GuidesError } from '../guides-list';
import styles from '../writing-guides.module.css';
import { GuideArticle, GuideMissing } from './guide-article';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadGuide(slug);
  if (loaded.state === 'missing') {
    return { title: 'Không có bài này | Kiến thức Writing · Aver Learning', robots: { index: false } };
  }
  if (loaded.state !== 'ok') return { title: 'Kiến thức Writing | Thư viện Aver Learning' };
  return {
    title: `${loaded.data.title} | Kiến thức Writing · Aver Learning`,
    alternates: { canonical: guideHref(loaded.data.slug) },
  };
}

async function GuideBody({ params }: Params) {
  const { slug } = await params;
  const loaded = await loadGuide(slug);
  if (loaded.state === 'missing') return <GuideMissing />;
  if (loaded.state !== 'ok') return <GuidesError reloadHref={guideHref(slug)} what="bài này" />;
  // Citations link to a sample's page only once T010 serves it (no link to a 404).
  const sampleLive = routeFor('/library/writing-samples/x')?.status === 'live';
  return (
    <>
      <Breadcrumb
        className={styles.crumbs}
        items={[
          { label: 'Thư viện', href: '/library' },
          { label: 'Kiến thức Writing', href: '/library/writing-guides' },
          { label: loaded.data.title },
        ]}
      />
      <GuideArticle guide={loaded.data} sampleLive={sampleLive} />
    </>
  );
}

export default function WritingGuidePage({ params }: Params) {
  return (
    <div className={styles.page}>
      <Suspense fallback={<p className={styles.meta} aria-busy="true">Đang tải bài…</p>}>
        <GuideBody params={params} />
      </Suspense>
    </div>
  );
}

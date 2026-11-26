import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';

import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';
import { av2FontClass } from '@/styles/av2/fonts';
import { AV2_VIEWPORT, ThemeMenu, ThemeScript } from '@/components/ui';
import { uiLibraryEnabled } from '@/lib/diagnostic-routes.mjs';
import { UI_LIBRARY_SECTIONS } from '@/lib/ui-library-sections.mjs';

import {
  ButtonSection, ChoiceGroupSection, IconButtonSection, SearchFieldSection, SelectSection,
  StatusBadgeSection, TextAreaSection, TextFieldSection,
} from './component-sections';
import {
  ConfirmDialogSection, DialogSection, MediaPlaceholderSection, NoticeSection, PageStateSection,
} from './feedback-sections';
import {
  BreadcrumbSection, PaginationSection, ProgressBarSection, StepperSection, TabsSection,
} from './nav-sections';
import { DataTableSection, StatCardSection } from './data-sections';
import { ChartSection, DateFieldsSection, FileUploadSection } from './data-sections-2';
import { AudioPlayerSection, VideoFrameSection } from './media-sections';
import { LearnerShellSection } from './shell-sections';
import { FocusShellSection } from './focus-demo';
import {
  AnnotatedTextSection, BandScoreSection, FigureSection, QuestionPaletteSection, TimerSection, VocabEntrySection,
} from './learning-sections';
import { StaffShellSection } from './staff-sections';
import { ThemeSection } from './theme-sections';
import { IconSection } from './icon-sections';
import styles from './ui-library.module.css';

// Gate the metadata too, like /next-probe (BL-01): a disabled build ships the
// site's own 404 head, not this page's title.
export function generateMetadata(): Metadata {
  if (!uiLibraryEnabled()) notFound();
  return {
    title: 'Thư viện giao diện',
    robots: { index: false, follow: false },
  };
}

// Two theme-color metas, one per OS mode (FR-026); ThemeMenu re-points them.
export function generateViewport(): Viewport {
  return AV2_VIEWPORT;
}

const COLOUR_TOKENS = [
  ['paper', styles.swPaper], ['surface', styles.swSurface], ['ink', styles.swInk], ['muted', styles.swMuted],
  ['rule', styles.swRule], ['accent', styles.swAccent], ['accent-hover', styles.swAccentHover], ['link', styles.swLink],
  ['mark', styles.swMark], ['danger', styles.swDanger], ['ok', styles.swOk], ['tint', styles.swTint],
  ['off', styles.swOff], ['on-accent', styles.swOnAccent], ['control-border', styles.swControlBorder],
  ['highlight', styles.swHighlight], ['warn-bg', styles.swWarnBg], ['error-bg', styles.swErrorBg], ['ok-bg', styles.swOkBg],
  ['logo-mark', styles.swLogoMark], ['qr-bg', styles.swQrBg], ['qr-ink', styles.swQrInk],
] as const;

const TYPE_SIZES = [
  ['12', styles.fs12], ['13', styles.fs13], ['14', styles.fs14], ['15', styles.fs15], ['16', styles.fs16],
  ['18', styles.fs18], ['20', styles.fs20], ['24', styles.fs24], ['40', styles.fs40],
  ['band-phone 72', styles.fsBandPhone], ['band-lg 96', styles.fsBandLg],
] as const;

const SPACE_STEPS = [
  ['1', styles.sp1], ['2', styles.sp2], ['3', styles.sp3], ['4', styles.sp4], ['5', styles.sp5], ['6', styles.sp6],
  ['7', styles.sp7], ['8', styles.sp8], ['9', styles.sp9], ['10', styles.sp10], ['11', styles.sp11], ['12', styles.sp12],
] as const;

const VI_SAMPLE = 'Ước lượng · Thử thách · Nguyễn Thị Hằng';
const IPA_SAMPLE = 'ə ʃ ʒ θ ð ŋ ˈ ˌ ː — /ˈθɔːt/ /ˌɪntəˈnæʃənəl/';

const title = (id: string) => UI_LIBRARY_SECTIONS.find((s) => s.id === id)?.title ?? id;

// The page runs on the new "Bản in" tree only. There is deliberately no group
// layout.tsx: route-group layouts must carry product telemetry
// (telemetry-coverage.test.mjs), which an engineering page must not emit. No
// AuthedShell either, so none of the legacy <link> cascade is emitted. Fonts
// attach to .av2-root, not <html>, so legacy pages never download them (FR-004).
//
// Engineering-only (FR-013): 404 on every deployment unless `next dev`,
// AVER_ENABLE_DIAGNOSTIC_ROUTES=1 or AVER_ENABLE_UI_LIBRARY=1 at build time.
// Static on purpose (same reason as /next-probe): a request-time gate would
// stream behind the root Suspense shell and turn notFound() into a 200.
export default function UiLibraryPage() {
  if (!uiLibraryEnabled()) notFound();
  return (
    <>
      {/* Before the page root, so a stored or device dark never flashes light (FR-020). */}
      <ThemeScript />
      <div className={`av2-root ${av2FontClass}`}>
        <main className={styles.page}>
          <header className={styles.head}>
            <div className={styles.headRow}>
              <h1>Thư viện giao diện</h1>
              <ThemeMenu />
            </div>
            <p className={styles.lead}>Token và thành phần của giao diện &ldquo;Bản in&rdquo; (UIBASE-0056). Trang nội bộ cho kỹ sư, không có trên staging và production.</p>
          </header>

          <section id="tokens-colour" className={styles.section} aria-labelledby="tokens-colour-h">
            <h2 id="tokens-colour-h">{title('tokens-colour')}</h2>
            <ul className={styles.swatches}>
              {COLOUR_TOKENS.map(([name, cls]) => (
                <li key={name} className={styles.swatch}>
                  <span className={`${styles.chip} ${cls}`} aria-hidden="true" />
                  <code>--av2-{name}</code>
                </li>
              ))}
            </ul>
          </section>

          <section id="tokens-type" className={styles.section} aria-labelledby="tokens-type-h">
            <h2 id="tokens-type-h">{title('tokens-type')}</h2>
            <div className={styles.typeGrid}>
              <div>
                <h3>Source Sans 3</h3>
                {TYPE_SIZES.map(([size, cls]) => (
                  <p key={size} className={`${styles.sample} ${styles.sans} ${cls}`}><span className={styles.tag}>{size}</span> Bài viết</p>
                ))}
              </div>
              <div>
                <h3>Source Serif 4</h3>
                {TYPE_SIZES.map(([size, cls]) => (
                  <p key={size} className={`${styles.sample} ${styles.serif} ${cls}`}><span className={styles.tag}>{size}</span> Bài viết</p>
                ))}
              </div>
            </div>
            <p className={`${styles.sans} ${styles.fs16}`}>Thường (400) · <strong className={styles.strong}>Đậm (600)</strong></p>
            <p className={`${styles.serif} ${styles.fs16}`}>Thường (400) · <strong className={styles.strong}>Đậm (600)</strong></p>
          </section>

          <section id="tokens-vietnamese" className={styles.section} aria-labelledby="tokens-vietnamese-h">
            <h2 id="tokens-vietnamese-h">{title('tokens-vietnamese')}</h2>
            {(['13', '14', '16', '24', '40'] as const).map((size) => {
              const cls = TYPE_SIZES.find(([s]) => s === size)![1];
              return (
                <div key={size} className={styles.viRow}>
                  <span className={styles.tag}>{size}px</span>
                  <p className={`${styles.sans} ${cls}`}>{VI_SAMPLE}</p>
                  <p className={`${styles.sans} ${styles.strong} ${cls}`}>{VI_SAMPLE}</p>
                  <p className={`${styles.serif} ${cls}`}>{VI_SAMPLE}</p>
                  <p className={`${styles.serif} ${styles.strong} ${cls}`}>{VI_SAMPLE}</p>
                </div>
              );
            })}
            <p className={`${styles.serif} ${styles.strong} ${styles.fsBandLg}`}>Ước 6.5</p>
            <p className={`av2-ipa ${styles.fs20}`}>{IPA_SAMPLE}</p>
          </section>

          <section id="tokens-space" className={styles.section} aria-labelledby="tokens-space-h">
            <h2 id="tokens-space-h">{title('tokens-space')}</h2>
            <ul className={styles.spaces}>
              {SPACE_STEPS.map(([step, cls]) => (
                <li key={step} className={styles.spaceRow}>
                  <code>--av2-space-{step}</code>
                  <span className={`${styles.bar} ${cls}`} aria-hidden="true" />
                </li>
              ))}
            </ul>
            <div className={styles.shapes}>
              <div className={styles.box}>bo góc 2px · kẻ 1px</div>
              <div className={`${styles.box} ${styles.boxStrong}`}>kẻ đậm 2px</div>
              <a href="#tokens-space" className={styles.focusDemo}>Liên kết có vòng focus</a>
            </div>
          </section>

          <IconSection title={title('icons')} />

          <ButtonSection title={title('button')} />
          <IconButtonSection title={title('icon-button')} />
          <TextFieldSection title={title('text-field')} />
          <TextAreaSection title={title('text-area')} />
          <SelectSection title={title('select')} />
          <SearchFieldSection title={title('search-field')} />
          <ChoiceGroupSection title={title('choice-group')} />
          <StatusBadgeSection title={title('status-badge')} />
          <NoticeSection title={title('notice')} />
          <DialogSection title={title('dialog')} />
          <ConfirmDialogSection title={title('confirm-dialog')} />
          <PageStateSection title={title('page-state')} />
          <MediaPlaceholderSection title={title('media-placeholder')} />
          <TabsSection title={title('tabs')} />
          <BreadcrumbSection title={title('breadcrumb')} />
          <PaginationSection title={title('pagination')} />
          <ProgressBarSection title={title('progress-bar')} />
          <StepperSection title={title('stepper')} />
          <DataTableSection title={title('data-table')} />
          <StatCardSection title={title('stat-card')} />
          <ChartSection title={title('chart')} />
          <FileUploadSection title={title('file-upload')} />
          <DateFieldsSection title={title('date-fields')} />
          <ThemeSection title={title('theme')} />
          <LearnerShellSection title={title('learner-shell')} />
          <FocusShellSection title={title('focus-shell')} />
          <StaffShellSection title={title('staff-shell')} />
          <BandScoreSection title={title('band-score')} />
          <TimerSection title={title('timer')} />
          <QuestionPaletteSection title={title('question-palette')} />
          <VocabEntrySection title={title('vocab-entry')} />
          <AnnotatedTextSection title={title('annotated-text')} />
          <FigureSection title={title('figure')} />
          {/* Last on purpose: 16:9 frames give fractional heights, which would shift the text of later sections by a subpixel and break their baselines. */}
          <AudioPlayerSection title={title('audio-player')} />
          <VideoFrameSection title={title('video-frame')} />
        </main>
      </div>
    </>
  );
}

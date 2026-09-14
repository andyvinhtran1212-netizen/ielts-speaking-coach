export default function Loading() {
  return (
    <>
      {/* @ts-ignore custom element is registered by the public-content layout */}
      <aver-chrome active="grammar" />
      <nav
        className="gw-subnav sticky top-0 z-20 border-b border-white/5"
        aria-label="Grammar Wiki"
        style={{ background: 'var(--av-surface-sunken)', backdropFilter: 'blur(12px)' }}
      >
        <div className="av-w-page h-12 flex items-center">
          <div className="skeleton h-4 w-64 rounded" aria-hidden="true" />
        </div>
      </nav>
      <main className="av-w-page py-8" aria-busy="true">
        <p className="sr-only" role="status">Đang tải bài Grammar…</p>
        <div className="flex gap-8 items-start justify-center">
          <article className="min-w-0 w-full" style={{ maxWidth: 'var(--av-width-read)' }}>
            <div className="mb-8" aria-hidden="true">
              <div className="skeleton h-3 w-28 rounded mb-4" />
              <div className="skeleton h-6 w-20 rounded-full mb-3" />
              <div className="skeleton h-10 w-4/5 rounded-lg mb-3" />
              <div className="skeleton h-4 w-56 rounded" />
            </div>
            <div className="space-y-4" aria-hidden="true">
              <div className="skeleton h-7 w-2/3 rounded" />
              <div className="skeleton h-4 w-full rounded" />
              <div className="skeleton h-4 w-11/12 rounded" />
              <div className="skeleton h-4 w-4/5 rounded" />
              <div className="skeleton h-32 w-full rounded-2xl" />
              <div className="skeleton h-4 w-full rounded" />
              <div className="skeleton h-4 w-3/4 rounded" />
            </div>
          </article>
          <aside className="hidden lg:block w-56 shrink-0" aria-hidden="true">
            <div className="skeleton h-5 w-24 rounded mb-4" />
            <div className="space-y-3">
              <div className="skeleton h-4 w-full rounded" />
              <div className="skeleton h-4 w-5/6 rounded" />
              <div className="skeleton h-4 w-3/4 rounded" />
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}

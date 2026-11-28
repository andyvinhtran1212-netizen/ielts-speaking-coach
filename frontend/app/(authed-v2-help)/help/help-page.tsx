'use client';

// /help: six fixed groups of short answers (lib/help-faq.mjs), a search box
// that is case- and accent-insensitive over question and answer, and a "no
// answer" state (FR-062). Every question is a button with aria-expanded; many
// can be open at once; each has its own address (`/help#<id>`), opened on load.
// The contact block is G05-T23's shared component: not merged yet, so the page
// has no contact block (FR-062 says so), and no link here points at a route
// that is not live.
import { useEffect, useId, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { liveHref } from '@/components/ui/shell/learner-sections';
import { HELP_GROUPS, type HelpItem } from '@/lib/help-faq.mjs';
import { filterHelp } from '@/lib/help-search-model.mjs';

import styles from './help.module.css';

const TOTAL = HELP_GROUPS.reduce((sum, group) => sum + group.items.length, 0);

function Answer({ item, open, onToggle }: { item: HelpItem; open: boolean; onToggle: () => void }) {
  const panelId = `${item.id}-tra-loi`;
  const href = item.href ? liveHref({ href: item.href, today: null }) : null;
  return (
    <li id={item.id} className={styles.item}>
      <h3 className={styles.question}>
        <button type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle} className={styles.toggle}>
          <span>{item.q}</span>
          <span aria-hidden="true" className={styles.mark}>{open ? '−' : '+'}</span>
        </button>
      </h3>
      <div id={panelId} hidden={!open} className={styles.answer}>
        <p>{item.a}</p>
        {href && item.link ? <p><a href={href}>{item.link}</a></p> : null}
      </div>
    </li>
  );
}

export function HelpPage() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const statusId = useId();

  // A shared address (`/help#<id>`) opens that answer and scrolls to it.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id || !HELP_GROUPS.some((g) => g.items.some((it) => it.id === id))) return;
    setOpen((prev) => ({ ...prev, [id]: true }));
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
  }, []);

  const result = useMemo(() => filterHelp(HELP_GROUPS, query), [query]);
  const status = result.searching
    ? result.hits
      ? `Tìm thấy ${result.hits} câu trả lời.`
      : 'Không có câu trả lời nào khớp.'
    : `${HELP_GROUPS.length} nhóm, ${TOTAL} câu hỏi.`;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Trợ giúp</h1>
        <p className={styles.lead}>Câu trả lời ngắn cho những việc hay gặp.</p>
      </header>

      <div className={styles.search} role="search">
        <TextField
          label="Tìm trong Trợ giúp"
          value={query}
          onChange={(value) => setQuery(value)}
          aria-describedby={statusId}
          autoComplete="off"
        />
        <p id={statusId} className={styles.status} role="status">{status}</p>
      </div>

      {result.searching && result.hits === 0 ? (
        <section className={styles.empty} aria-labelledby="help-empty-title">
          <h2 id="help-empty-title" className={styles.emptyTitle}>Chưa có câu trả lời cho “{query.trim()}”</h2>
          <p>Thử từ ngắn hơn hoặc từ khác, ví dụ “lượt”, “micro”, “chấm lại”.</p>
          <Button variant="secondary" onClick={() => setQuery('')}>Xoá ô tìm, xem mọi nhóm</Button>
        </section>
      ) : (
        result.groups.map((group) => (
          <section key={group.id} className={styles.group} aria-labelledby={`nhom-${group.id}`}>
            <h2 id={`nhom-${group.id}`} className={styles.groupTitle}>{group.name}</h2>
            <ul className={styles.items}>
              {group.items.map((item) => (
                <Answer
                  key={item.id}
                  item={item}
                  // While searching, the matching answers are shown open.
                  open={result.searching || Boolean(open[item.id])}
                  onToggle={() => setOpen((prev) => ({ ...prev, [item.id]: !(result.searching || prev[item.id]) }))}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

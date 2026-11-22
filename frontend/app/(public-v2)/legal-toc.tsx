'use client';

import { useEffect, useId, useState } from 'react';

import { Icon } from '@/components/ui';

import styles from './legal.module.css';

export type LegalTocItem = { id: string; n: number; title: string };

/**
 * Table of contents of a long legal page (PhapLy.dc.html §1, §4). From 1024px
 * it is sticky beside the text; below 768px it is a 48px open/close block at
 * the top, closed by default, and picking an entry closes it. The article in
 * view gets a 3px left rule and bold text (`aria-current="location"`).
 * Entries are plain #dieu-N anchors, so they work and can be shared without JS.
 */
export function LegalToc({ items }: { items: readonly LegalTocItem[] }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const listId = useId();

  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting);
      if (visible.length) setCurrent((visible[0].target as HTMLElement).id);
    }, { rootMargin: '0px 0px -70% 0px' });
    for (const item of items) {
      const section = document.getElementById(item.id);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label="Mục lục" className={styles.toc}>
      <button
        type="button"
        className={styles.tocToggle}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((was) => !was)}
      >
        Mục lục
        <Icon name="chev-down" className={open ? styles.tocChevOpen : undefined} />
      </button>
      <p className={styles.tocHeading} aria-hidden="true">Mục lục</p>
      <ol id={listId} className={styles.tocList} data-open={open ? 'true' : 'false'}>
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={current === item.id ? 'location' : undefined}
              onClick={() => setOpen(false)}
            >
              <span className={styles.tocN}>{item.n}</span>
              {item.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

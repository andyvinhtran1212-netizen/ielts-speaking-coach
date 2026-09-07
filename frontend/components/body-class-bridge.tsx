'use client';

import { useLayoutEffect } from 'react';

const OWNER_ATTRIBUTE = 'data-aver-route-body-classes';

function classTokens(value: string) {
  return Array.from(new Set(value.trim().split(/\s+/).filter(Boolean)));
}

/** Keep nested-layout body classes truthful across App Router navigations. */
export function BodyClassBridge({ className }: { className: string }) {
  useLayoutEffect(() => {
    const body = document.body;
    const tokens = classTokens(className);
    const ownershipKey = tokens.join(' ');
    const previous = classTokens(body.getAttribute(OWNER_ATTRIBUTE) || '');

    previous.forEach((token) => body.classList.remove(token));
    tokens.forEach((token) => body.classList.add(token));
    body.setAttribute(OWNER_ATTRIBUTE, ownershipKey);

    return () => {
      // A newer route may mount before React finishes this cleanup. Never let
      // the old owner remove classes already claimed by the new route.
      if (body.getAttribute(OWNER_ATTRIBUTE) !== ownershipKey) return;
      tokens.forEach((token) => body.classList.remove(token));
      body.removeAttribute(OWNER_ATTRIBUTE);
    };
  }, [className]);

  return null;
}

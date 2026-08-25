'use client';

import { useEffect } from 'react';

import { VocabModuleMount } from '@/components/vocab-module-mount';
import { useAuth } from '@/lib/auth/auth-provider';

export function FlashcardsBehavior() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);

  if (status !== 'signed-in' || !user?.id) {
    return (
      <main id="mount" className="vocab-module-mount">
        <div className="state-msg"><div className="spinner" /></div>
      </main>
    );
  }

  return (
    <VocabModuleMount
      moduleName="flashcards"
      embedded={false}
      accountKey={user.id}
      as="main"
      id="mount"
      className="vocab-module-mount"
    />
  );
}

'use client';

// Mount/unmount harness for the recorder spike: React's REAL lifecycle is the
// risk under test (StrictMode double-invoke in dev, cleanup on route change),
// so the test needs a button that removes the component from the tree the way
// a navigation would.
import { useState } from 'react';

import { RecorderSpike } from './recorder';

export function SpikeHarness() {
  const [mounted, setMounted] = useState(true);

  return (
    <div>
      <p style={{ maxWidth: 640, margin: '16px auto 0', fontFamily: 'monospace', padding: '0 16px' }}>
        <button data-testid="btn-toggle-mount" onClick={() => setMounted((m) => !m)}>
          {mounted ? 'Unmount component' : 'Mount component'}
        </button>
      </p>
      {mounted ? <RecorderSpike /> : <p data-testid="unmounted-marker" style={{ textAlign: 'center' }}>component unmounted</p>}
    </div>
  );
}

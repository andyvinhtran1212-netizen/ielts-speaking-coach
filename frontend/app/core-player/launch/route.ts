import { type NextRequest, NextResponse } from 'next/server';

import { resolveCorePlayerAdmission } from '@/lib/core-player-affinity.mjs';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
};

function invalidAdmission() {
  return NextResponse.json(
    { error: 'invalid-core-player-admission' },
    { status: 400, headers: NO_STORE_HEADERS },
  );
}

export function GET(request: NextRequest) {
  const entries = [...request.nextUrl.searchParams.entries()];
  const seen = new Set<string>();
  const hasDuplicate = entries.some(([key]) => {
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  const surfaces = request.nextUrl.searchParams.getAll('surface');
  if (hasDuplicate || surfaces.length !== 1) return invalidAdmission();

  const [surface] = surfaces;
  const query = Object.fromEntries(
    entries.filter(([key]) => key !== 'surface'),
  );

  try {
    const destination = resolveCorePlayerAdmission(surface, query);
    return new NextResponse(null, {
      status: 307,
      headers: { Location: destination, ...NO_STORE_HEADERS },
    });
  } catch {
    return invalidAdmission();
  }
}

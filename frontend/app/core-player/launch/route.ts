import { type NextRequest, NextResponse } from 'next/server';

import { resolveCorePlayerAdmissionFromParams } from '@/lib/core-player-affinity.mjs';

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
  try {
    const destination = resolveCorePlayerAdmissionFromParams(request.nextUrl.searchParams);
    return new NextResponse(null, {
      status: 307,
      headers: { Location: destination, ...NO_STORE_HEADERS },
    });
  } catch {
    return invalidAdmission();
  }
}

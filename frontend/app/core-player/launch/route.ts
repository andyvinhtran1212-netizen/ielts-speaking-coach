import { type NextRequest, NextResponse } from 'next/server';

import {
  resolveCorePlayerAdmissionFromParamsForDeployment,
} from '@/lib/core-player-affinity.mjs';

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
    const destination = resolveCorePlayerAdmissionFromParamsForDeployment(
      request.nextUrl.searchParams,
      {
        vercelEnv: process.env.VERCEL_ENV,
        gitRef: process.env.VERCEL_GIT_COMMIT_REF,
      },
    );
    return new NextResponse(null, {
      status: 307,
      headers: { Location: destination, ...NO_STORE_HEADERS },
    });
  } catch {
    return invalidAdmission();
  }
}

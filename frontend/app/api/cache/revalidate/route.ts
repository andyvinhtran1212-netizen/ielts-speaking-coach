import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import {
  MAX_INVALIDATION_BODY_BYTES,
  verifyCacheInvalidation,
} from '@/lib/cache-invalidation.mjs';

const NO_STORE = { 'Cache-Control': 'no-store' };

async function readBoundedBody(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_INVALIDATION_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_INVALIDATION_BODY_BYTES) {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400, headers: NO_STORE });
  }

  const rawBody = await readBoundedBody(request);
  if (!rawBody) {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400, headers: NO_STORE });
  }
  const verification = verifyCacheInvalidation({
    rawBody,
    signature: request.headers.get('x-aver-signature'),
    secret: process.env.AVER_CACHE_REVALIDATION_SECRET || '',
  });
  if ('error' in verification) {
    return NextResponse.json({ error: verification.error }, {
      status: verification.status,
      headers: NO_STORE,
    });
  }

  for (const tag of verification.tags) revalidateTag(tag, 'max');
  return NextResponse.json({ revalidated: verification.tags }, { headers: NO_STORE });
}

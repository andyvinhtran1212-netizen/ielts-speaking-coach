// Implicit Suspense boundary — cacheComponents requires runtime data
// (params → article fetch) to stream under Suspense. Minimal fallback:
// the legacy page also starts blank until its client JS injects content.
export default function Loading() {
  return null;
}

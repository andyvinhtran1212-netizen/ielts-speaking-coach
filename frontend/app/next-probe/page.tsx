// Dark-launch probe (plan Phase 1 Gate B: "một dark-launch Next route có thể
// deploy mà không ảnh hưởng legacy root"). Namespaced route — no canonical
// URL is owned by Next yet. Server Component, static, zero data access.
export default function NextProbePage() {
  return (
    <main style={{ fontFamily: 'monospace', padding: '2rem' }}>
      <h1>next-probe</h1>
      <p>implementation: next</p>
      <p>release: {process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev'}</p>
      <p>env: {process.env.VERCEL_ENV ?? 'local'}</p>
    </main>
  );
}

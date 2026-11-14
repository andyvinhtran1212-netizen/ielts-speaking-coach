/** Only the canonical schema gate can declare these tools unavailable. */
export async function readCuratedAvailability(request) {
  try {
    const result = await request();
    if (result?.available !== true) throw new Error('Invalid curated availability response');
    return 'ready';
  } catch (caught) {
    if (caught?.detail?.error_code === 'feature_unavailable') return 'unavailable';
    throw caught;
  }
}

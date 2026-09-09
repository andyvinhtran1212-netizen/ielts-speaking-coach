// A rejected fetch is not the only network failure: a transport may never
// settle. Bound both each write and the user's flush wait without treating a
// timeout as proof that the server did not receive an idempotent PATCH.
export function boundedExamSave(operation, timeoutMs = 15000) {
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error('answer-save-timeout'), { status: 408 }));
      controller.abort();
    }, timeoutMs);
    try {
      Promise.resolve(operation(controller.signal)).then(resolve, reject).finally(() => clearTimeout(timer));
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

export async function boundedExamFlush(writes, timeoutMs = 20000) {
  let timer;
  try {
    return await Promise.race([
      Promise.all(writes).then(() => true, () => false),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

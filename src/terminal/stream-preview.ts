export function createStreamPreview(publish: (text: string) => void, delayMs = 50) {
  let pending: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function cancel() {
    clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  }

  function flush() {
    const text = pending;
    cancel();
    if (text !== undefined) publish(text);
  }

  return {
    update(text: string) {
      pending = text;
      timer ??= setTimeout(flush, delayMs);
    },
    flush,
    cancel,
  };
}

interface TimeoutOptions<T> {
  onTimeout?: () => void;
  onLateResolve?: (value: T) => void;
  onLateReject?: (error: unknown) => void;
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  options: TimeoutOptions<T> = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let didTimeout = false;
    let isSettled = false;

    const timeoutId = window.setTimeout(() => {
      if (isSettled) {
        return;
      }

      didTimeout = true;
      isSettled = true;
      options.onTimeout?.();
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timeoutId);

        if (didTimeout) {
          options.onLateResolve?.(value);
          return;
        }

        if (isSettled) {
          return;
        }

        isSettled = true;
        resolve(value);
      })
      .catch((error: unknown) => {
        window.clearTimeout(timeoutId);

        if (didTimeout) {
          options.onLateReject?.(error);
          return;
        }

        if (isSettled) {
          return;
        }

        isSettled = true;
        reject(error);
      });
  });
}

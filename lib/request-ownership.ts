export class RequestOwnership {
  private generation = 0;

  activate() {
    this.generation += 1;
    return this.generation;
  }

  invalidate() {
    this.generation += 1;
  }

  owns(generation: number, signal?: AbortSignal) {
    return this.generation === generation && !signal?.aborted;
  }
}

export class OwnedAbortRequestSlot {
  private active: {
    owner: number;
    controller: AbortController;
    promise: Promise<void>;
  } | null = null;

  get promise() {
    return this.active?.promise || null;
  }

  start(owner: number, task: (signal: AbortSignal) => Promise<void>) {
    if (this.active) return this.active.promise;
    const controller = new AbortController();
    const promise = task(controller.signal).finally(() => {
      if (this.active?.promise === promise) this.active = null;
    });
    this.active = { owner, controller, promise };
    return promise;
  }

  cancel(owner?: number) {
    const request = this.active;
    if (!request || (owner !== undefined && request.owner !== owner)) return;
    this.active = null;
    request.controller.abort();
  }
}

export type HydrationOutcome =
  | { status: "completed"; attempts: number }
  | { status: "cancelled"; attempts: number; reason: string }
  | { status: "abort-retries-exhausted"; attempts: number };

export function isAbortError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError",
  );
}

export class HydrationSession {
  private active = true;
  private controller: AbortController | null = null;
  private cancelReason = "activation-ended";
  readonly activation: number;

  constructor(activation: number) {
    this.activation = activation;
  }

  async run(
    task: (signal: AbortSignal, requestNumber: number) => Promise<void>,
    maxUnexpectedAbortRetries = 1,
  ): Promise<HydrationOutcome> {
    let retryCount = 0;
    let attempts = 0;

    while (this.active) {
      attempts += 1;
      const controller = new AbortController();
      this.controller = controller;
      try {
        await task(controller.signal, attempts);
        return { status: "completed", attempts };
      } catch (error) {
        if (!this.active || controller.signal.aborted) {
          return {
            status: "cancelled",
            attempts,
            reason: this.cancelReason,
          };
        }
        if (!isAbortError(error)) throw error;
        if (retryCount >= maxUnexpectedAbortRetries) {
          return { status: "abort-retries-exhausted", attempts };
        }
        retryCount += 1;
      } finally {
        if (this.controller === controller) this.controller = null;
      }
    }

    return { status: "cancelled", attempts, reason: this.cancelReason };
  }

  cancel(reason: string) {
    if (!this.active) return;
    this.active = false;
    this.cancelReason = reason;
    this.controller?.abort(reason);
  }
}

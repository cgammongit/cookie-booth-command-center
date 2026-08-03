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

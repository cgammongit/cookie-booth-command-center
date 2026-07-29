declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    BOOTH_LIVE_ROOMS: DurableObjectNamespace<
      import("./worker/booth-live-room").BoothLiveRoom
    >;
    RATE_LIMITER: DurableObjectNamespace<
      import("./worker/rate-limit-coordinator").RateLimitCoordinator
    >;
  }
}

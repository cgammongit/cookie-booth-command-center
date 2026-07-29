declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    SUPER_ADMIN_CLERK_USER_IDS?: string;
    BOOTH_LIVE_ROOMS: DurableObjectNamespace<
      import("./worker/booth-live-room").BoothLiveRoom
    >;
    RATE_LIMITER: DurableObjectNamespace<
      import("./worker/rate-limit-coordinator").RateLimitCoordinator
    >;
  }
}

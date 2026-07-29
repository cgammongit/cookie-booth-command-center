import { logServerEvent } from "./security";

export type RateLimitClass =
  | "authenticated_read"
  | "sale"
  | "inventory"
  | "lifecycle"
  | "administrative"
  | "invitation"
  | "websocket"
  | "unauthenticated"
  | "clerk_webhook";

export type RateLimitPolicy = {
  limit: number;
  periodSeconds: number;
  failClosed: boolean;
};

export const RATE_LIMIT_POLICIES: Readonly<Record<RateLimitClass, RateLimitPolicy>> = {
  authenticated_read: { limit: 240, periodSeconds: 60, failClosed: false },
  sale: { limit: 60, periodSeconds: 60, failClosed: false },
  inventory: { limit: 40, periodSeconds: 60, failClosed: false },
  lifecycle: { limit: 12, periodSeconds: 60, failClosed: false },
  administrative: { limit: 20, periodSeconds: 60, failClosed: true },
  invitation: { limit: 10, periodSeconds: 60, failClosed: true },
  websocket: { limit: 12, periodSeconds: 60, failClosed: false },
  unauthenticated: { limit: 60, periodSeconds: 60, failClosed: false },
  clerk_webhook: { limit: 120, periodSeconds: 60, failClosed: true },
};

export type RateLimitEnv = {
  RATE_LIMITER: DurableObjectNamespace<
    import("../worker/rate-limit-coordinator").RateLimitCoordinator
  >;
};

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
  backendFailure?: boolean;
};

async function digestKey(value: string) {
  const bytes = new TextEncoder().encode(`cookie-command-center:rate-limit:v1:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function minimizedIpIdentity(request: Request) {
  const address =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  return digestKey(`ip:${address}`);
}

export async function consumeRateLimit({
  env,
  routeClass,
  identity,
  requestId,
  route,
  policy = RATE_LIMIT_POLICIES[routeClass],
}: {
  env: RateLimitEnv;
  routeClass: RateLimitClass;
  identity: string;
  requestId: string;
  route: string;
  policy?: RateLimitPolicy;
}): Promise<RateLimitDecision> {
  try {
    const key = await digestKey(`${routeClass}:${identity}`);
    const stub = env.RATE_LIMITER.getByName(key);
    const response = await stub.fetch("https://rate-limit.internal/consume", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-rate-limit-class": routeClass,
      },
      body: JSON.stringify({
        limit: policy.limit,
        periodSeconds: policy.periodSeconds,
      }),
    });
    if (!response.ok) throw new Error("limiter_backend_response");
    const decision = await response.json<RateLimitDecision>();
    if (!decision.allowed) {
      logServerEvent("warn", "rate_limit.decision", {
        requestId,
        route,
        routeClass,
        decision: "rejected",
        retryAfterSeconds: decision.retryAfterSeconds,
      });
    }
    return decision;
  } catch {
    logServerEvent("error", "rate_limit.failure", {
      requestId,
      route,
      routeClass,
      decision: policy.failClosed ? "fail_closed" : "fail_open",
      errorCategory: "limiter_unavailable",
    });
    return {
      allowed: !policy.failClosed,
      retryAfterSeconds: policy.failClosed ? policy.periodSeconds : 0,
      backendFailure: true,
    };
  }
}

export function rateLimitedResponse(
  requestId: string,
  retryAfterSeconds: number,
) {
  const retryAfter = Math.max(1, Math.ceil(retryAfterSeconds));
  return Response.json(
    {
      error: "Too many requests. Please wait before trying again.",
      code: "rate_limited",
      retryAfterSeconds: retryAfter,
    },
    {
      status: 429,
      headers: {
        "retry-after": String(retryAfter),
        "x-request-id": requestId,
      },
    },
  );
}

export async function enforceVerifiedClerkWebhookRateLimit({
  env,
  verifiedEventId,
  requestId,
}: {
  env: RateLimitEnv;
  verifiedEventId: string;
  requestId: string;
}) {
  const checks = [
    {
      identity: `clerk:event:${verifiedEventId}`,
      policy: { ...RATE_LIMIT_POLICIES.clerk_webhook, limit: 20 },
    },
    {
      identity: "clerk:verified-provider",
      policy: { ...RATE_LIMIT_POLICIES.clerk_webhook, limit: 600 },
    },
  ];
  for (const check of checks) {
    const decision = await consumeRateLimit({
      env,
      routeClass: "clerk_webhook",
      identity: check.identity,
      requestId,
      route: "/api/webhooks/clerk",
      policy: check.policy,
    });
    if (!decision.allowed) {
      return rateLimitedResponse(requestId, decision.retryAfterSeconds);
    }
  }
  return null;
}

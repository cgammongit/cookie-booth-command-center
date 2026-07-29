import { authorizeBoothLiveAccess } from "../lib/booth-live-access";
import {
  consumeRateLimit,
  rateLimitedResponse,
  RATE_LIMIT_POLICIES,
  type RateLimitEnv,
} from "../lib/rate-limit";
import { safeRoute } from "../lib/security";

export type BoothLiveEnv = RateLimitEnv & {
  DB: D1Database;
  BOOTH_LIVE_ROOMS: DurableObjectNamespace<
    import("./booth-live-room").BoothLiveRoom
  >;
};

export type AuthenticateBoothLiveRequest = (
  request: Request,
) => Promise<string | null>;

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function handleBoothLiveRequest({
  request,
  rawBoothId,
  env,
  authenticate,
}: {
  request: Request;
  rawBoothId: string;
  env: BoothLiveEnv;
  authenticate: AuthenticateBoothLiveRequest;
}): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return errorResponse("WebSocket upgrade required", 426);
  }

  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!origin || origin !== requestUrl.origin) {
    return errorResponse("WebSocket origin is not allowed", 403);
  }

  const boothId = Number(rawBoothId);
  if (!Number.isInteger(boothId) || boothId < 1) {
    return errorResponse("Invalid booth", 400);
  }

  try {
    const clerkUserId = await authenticate(request);
    if (!clerkUserId) {
      return errorResponse("Authentication required", 401);
    }

    const access = await authorizeBoothLiveAccess(env.DB, clerkUserId, boothId);
    if (!access) {
      return errorResponse("You do not have access to this booth", 403);
    }

    const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
    const identities = [
      {
        value: `org:${access.organizationId}:user:${access.userId}:booth:${boothId}`,
        policy: RATE_LIMIT_POLICIES.websocket,
      },
      {
        value: `org:${access.organizationId}:booth:${boothId}:aggregate`,
        policy: { ...RATE_LIMIT_POLICIES.websocket, limit: 120 },
      },
    ];
    for (const identity of identities) {
      const decision = await consumeRateLimit({
        env,
        routeClass: "websocket",
        identity: identity.value,
        requestId,
        route: safeRoute(request),
        policy: identity.policy,
      });
      if (!decision.allowed) {
        return rateLimitedResponse(requestId, decision.retryAfterSeconds);
      }
    }

    const room = env.BOOTH_LIVE_ROOMS.getByName(
      `${access.organizationId}:${boothId}`,
    );
    const roomHeaders = new Headers({
      upgrade: "websocket",
      "x-live-organization-id": String(access.organizationId),
      "x-live-booth-id": String(boothId),
      "x-live-user-id": String(access.userId),
    });
    return await room.fetch(
      new Request("https://booth-live.internal/connect", {
        method: "GET",
        headers: roomHeaders,
      }),
    );
  } catch {
    return errorResponse("Live updates are temporarily unavailable", 503);
  }
}

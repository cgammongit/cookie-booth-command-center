/** Cloudflare Worker entry point for the vinext-starter template. */
import { createClerkClient } from "@clerk/backend";
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  applySecurityHeaders,
  createRequestId,
  hasAllowedMutationOrigin,
  logServerEvent,
  safeRoute,
  shouldCheckCsrf,
} from "../lib/security";
import { handleBoothLiveRequest } from "./booth-live-handler";
import { enforceWorkerRateLimit } from "./rate-limit-handler";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BOOTH_LIVE_ROOMS: DurableObjectNamespace<
    import("./booth-live-room").BoothLiveRoom
  >;
  RATE_LIMITER: DurableObjectNamespace<
    import("./rate-limit-coordinator").RateLimitCoordinator
  >;
  CLERK_SECRET_KEY?: string;
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type AppHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
};

type WorkerDependencies = {
  appHandler?: AppHandler;
  clerkClientFactory?: ClerkClientFactory;
};

type ClerkClientFactory = (options: {
  secretKey: string;
  publishableKey: string;
}) => {
  users: {
    getUser(userId: string): Promise<{ twoFactorEnabled?: boolean }>;
  };
  authenticateRequest(
    request: Request,
    options: {
      acceptsToken: "session_token";
      authorizedParties: string[];
    },
  ): Promise<{
    isAuthenticated: boolean;
    toAuth(): unknown;
  }>;
};

const BOOTH_LIVE_PATH = /^\/api\/booths\/([^/]+)\/live\/?$/;

async function authenticateClerkLiveRequest(
  request: Request,
  env: Env,
  clerkClientFactory: ClerkClientFactory,
) {
  if (
    !env.CLERK_SECRET_KEY ||
    !env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  ) {
    return null;
  }
  const requestState = await clerkClientFactory({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  }).authenticateRequest(request, {
    acceptsToken: "session_token",
    authorizedParties: [new URL(request.url).origin],
  });
  if (!requestState.isAuthenticated) return null;
  const authObject = requestState.toAuth();
  if (
    !authObject ||
    typeof authObject !== "object" ||
    !("userId" in authObject)
  ) {
    return null;
  }
  return typeof authObject.userId === "string"
    ? authObject.userId
    : null;
}

async function getClerkMfaUser(
  clerkUserId: string,
  env: Env,
  clerkClientFactory: ClerkClientFactory,
) {
  if (!env.CLERK_SECRET_KEY || !env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    throw new Error("Clerk configuration unavailable");
  }
  return clerkClientFactory({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  }).users.getUser(clerkUserId);
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

export function createWorker({
  appHandler = handler,
  clerkClientFactory = createClerkClient,
}: WorkerDependencies = {}) {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(request.url);
      const requestId = createRequestId();
      const startedAt = Date.now();
      const route = safeRoute(request);
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-request-id", requestId);
      const securedRequest = new Request(request, { headers: requestHeaders });

      if (shouldCheckCsrf(securedRequest) && !hasAllowedMutationOrigin(securedRequest)) {
        logServerEvent("warn", "request.rejected", {
          requestId,
          route,
          method: request.method,
          status: 403,
          errorCategory: "csrf_origin",
        });
        const headers = applySecurityHeaders(new Headers(), requestId);
        headers.set("content-type", "application/json");
        return new Response(JSON.stringify({ error: "Request origin is not allowed" }), {
          status: 403,
          headers,
        });
      }

      try {
        const liveMatch = url.pathname.match(BOOTH_LIVE_PATH);
        const limited = liveMatch
          ? null
          : await enforceWorkerRateLimit({
              request: securedRequest,
              env,
              requestId,
              authenticate: (rateLimitedRequest) =>
                authenticateClerkLiveRequest(
                  rateLimitedRequest,
                  env,
                  clerkClientFactory,
                ),
            });
        if (limited) {
          const headers = applySecurityHeaders(
            new Headers(limited.headers),
            requestId,
          );
          return new Response(limited.body, {
            status: limited.status,
            headers,
          });
        }
        const response = liveMatch
          ? await handleBoothLiveRequest({
              request: securedRequest,
              rawBoothId: liveMatch[1],
              env,
              authenticate: (liveRequest) =>
                authenticateClerkLiveRequest(
                  liveRequest,
                  env,
                  clerkClientFactory,
                ),
              getClerkUser: (clerkUserId) =>
                getClerkMfaUser(clerkUserId, env, clerkClientFactory),
            })
          : url.pathname === "/_vinext/image"
            ? await handleImageOptimization(
                securedRequest,
                {
                  fetchAsset: (path) =>
                    env.ASSETS.fetch(new Request(new URL(path, request.url))),
                  transformImage: async (body, { width, format, quality }) => {
                    const result = await env.IMAGES.input(body)
                      .transform(width > 0 ? { width } : {})
                      .output({ format, quality });
                    return result.response();
                  },
                },
                [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES],
              )
            : await appHandler.fetch(securedRequest, env, ctx);
        logServerEvent("info", "request.completed", {
          requestId,
          route,
          method: request.method,
          status: response.status,
          durationMs: Date.now() - startedAt,
        });
        if (response.status === 101) return response;
        const headers = applySecurityHeaders(new Headers(response.headers), requestId);
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch {
        logServerEvent("error", "request.failed", {
          requestId,
          route,
          method: request.method,
          status: 500,
          durationMs: Date.now() - startedAt,
          errorCategory: "unhandled",
        });
        throw new Error(`Request ${requestId} failed`);
      }
    },
  };
}

const worker = createWorker();

export { BoothLiveRoom } from "./booth-live-room";
export { RateLimitCoordinator } from "./rate-limit-coordinator";
export {
  classifyRateLimitedRoute,
  enforceWorkerRateLimit,
} from "./rate-limit-handler";
export { enforceVerifiedClerkWebhookRateLimit } from "../lib/rate-limit";
export default worker;

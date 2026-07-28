/** Cloudflare Worker entry point for the vinext-starter template. */
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

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BOOTH_LIVE_ROOMS: DurableObjectNamespace;
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

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
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
      const response =
        url.pathname === "/_vinext/image"
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
          : await handler.fetch(securedRequest, env, ctx);
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

export { BoothLiveRoom } from "./booth-live-room";
export default worker;

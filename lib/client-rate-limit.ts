"use client";

type ApiErrorPayload = {
  error?: string;
  code?: string;
  retryAfterSeconds?: number;
};

const retryUntilByScope = new Map<string, number>();

export class ApiRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "ApiRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function rateLimitWaitSeconds(scope: string, now = Date.now()) {
  return Math.max(0, Math.ceil(((retryUntilByScope.get(scope) || 0) - now) / 1000));
}

export function assertRateLimitRetryAllowed(scope: string) {
  const seconds = rateLimitWaitSeconds(scope);
  if (seconds > 0) {
    throw new ApiRateLimitError(
      `Please wait ${seconds} seconds before trying again. Your entered information has been preserved.`,
      seconds,
    );
  }
}

export function throwApiResponseError(
  response: Response,
  payload: ApiErrorPayload,
  fallback: string,
  scope: string,
): never {
  if (response.status === 429 || payload.code === "rate_limited") {
    const headerSeconds = Number(response.headers.get("retry-after"));
    const payloadSeconds = Number(payload.retryAfterSeconds);
    const seconds = Math.max(
      1,
      Number.isFinite(headerSeconds)
        ? Math.ceil(headerSeconds)
        : Number.isFinite(payloadSeconds)
          ? Math.ceil(payloadSeconds)
          : 60,
    );
    retryUntilByScope.set(scope, Date.now() + seconds * 1000);
    throw new ApiRateLimitError(
      `Too many requests. Try again in ${seconds} seconds. Your entered information has been preserved.`,
      seconds,
    );
  }
  throw new Error(payload.error || fallback);
}

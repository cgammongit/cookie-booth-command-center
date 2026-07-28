const SENSITIVE_KEY =
  /authorization|cookie|token|secret|password|credential|email|clerk|signature|body|payload|notes?/i;

export type LogLevel = "info" | "warn" | "error";
export type SafeLogValue = string | number | boolean | null | undefined;
export type SafeLogContext = Record<string, SafeLogValue>;

export const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://*.clerk.accounts.dev https://*.clerk.com https://clerk.cookie-command-center.com",
  "script-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev https://*.clerk.com https://clerk.cookie-command-center.com https://*.protect.clerk.com https://challenges.cloudflare.com https://js.stripe.com https://*.js.stripe.com https://maps.googleapis.com https://maps.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://img.clerk.com https://images.clerkstage.dev https://*.clerk.com https://maps.gstatic.com https://maps.googleapis.com",
  "connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://clerk.cookie-command-center.com https://clerk-telemetry.com https://*.clerk-telemetry.com https://*.protect.clerk.com https://api.stripe.com https://img.clerk.com https://images.clerkstage.dev wss://*.clerk.accounts.dev wss://*.clerk.com wss://clerk.cookie-command-center.com https://maps.googleapis.com",
  "frame-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://clerk.cookie-command-center.com https://challenges.cloudflare.com https://*.protect.clerk.com https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com",
  "worker-src 'self' blob:",
].join("; ");

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy-Report-Only": CSP_REPORT_ONLY,
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=86400",
  "X-Content-Type-Options": "nosniff",
};

export function createRequestId() {
  return crypto.randomUUID();
}

export function applySecurityHeaders(headers: Headers, requestId: string) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  headers.set("x-request-id", requestId);
  return headers;
}

export function isUnsafeMethod(method: string) {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

export function hasAllowedMutationOrigin(request: Request) {
  if (!isUnsafeMethod(request.method)) return true;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

export function shouldCheckCsrf(request: Request) {
  const pathname = new URL(request.url).pathname;
  return pathname.startsWith("/api/") && pathname !== "/api/webhooks/clerk";
}

export function safeRoute(request: Request) {
  return new URL(request.url).pathname.replace(/\/\d+(?=\/|$)/g, "/:id");
}

export function redactLogContext(context: Record<string, unknown>): SafeLogContext {
  const safe: SafeLogContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_KEY.test(key)) {
      safe[key] = "[redacted]";
    } else if (
      value === null ||
      value === undefined ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      safe[key] = typeof value === "string" ? value.slice(0, 200) : value;
    } else {
      safe[key] = "[redacted]";
    }
  }
  return safe;
}

export function logServerEvent(
  level: LogLevel,
  event: string,
  context: Record<string, unknown> = {},
) {
  const record = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...redactLogContext(context),
  });
  if (level === "error") console.error(record);
  else if (level === "warn") console.warn(record);
  else console.log(record);
}

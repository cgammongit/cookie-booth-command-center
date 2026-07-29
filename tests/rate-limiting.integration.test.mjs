import assert from "node:assert/strict";
import test from "node:test";

const sourceNonce = `${process.pid}-${Date.now()}`;
const handlerUrl = new URL("../dist/server/index.js", import.meta.url);
handlerUrl.searchParams.set("rate-limit-test", sourceNonce);
const {
  classifyRateLimitedRoute,
  enforceWorkerRateLimit,
  enforceVerifiedClerkWebhookRateLimit,
  RateLimitCoordinator,
  createWorker,
} = await import(handlerUrl.href);
const clientUrl = new URL("../lib/client-rate-limit.ts", import.meta.url);
clientUrl.searchParams.set("rate-limit-test", sourceNonce);
const {
  assertRateLimitRetryAllowed,
  rateLimitWaitSeconds,
  throwApiResponseError,
} = await import(clientUrl.href);

function createLimiter({ fail = false } = {}) {
  const counters = new Map();
  return {
    counters,
    namespace: {
      getByName(key) {
        return {
          async fetch(_url, init) {
            if (fail) throw new Error("limiter unavailable");
            const policy = JSON.parse(init.body);
            const count = counters.get(key) || 0;
            if (count >= policy.limit) {
              return Response.json({ allowed: false, retryAfterSeconds: 37 });
            }
            counters.set(key, count + 1);
            return Response.json({ allowed: true, retryAfterSeconds: 0 });
          },
        };
      },
    },
  };
}

function createCoordinator() {
  const values = new Map();
  const ctx = {
    storage: {
      async get(key) {
        return values.get(key);
      },
      async put(key, value) {
        values.set(key, structuredClone(value));
      },
    },
    blockConcurrencyWhile(callback) {
      return callback();
    },
  };
  return new RateLimitCoordinator(ctx, {});
}

function createDb() {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.includes("FROM booths")) {
                const boothId = Number(values[0]);
                return { organizationId: boothId === 9 ? 2 : 1 };
              }
              if (sql.includes("FROM organization_invitations")) {
                return { organizationId: 1 };
              }
              return { organizationId: Number(values[0]) };
            },
          };
        },
      };
    },
  };
}

function saleRequest(boothId = 8, ip = "203.0.113.7") {
  return new Request(`https://app.example/api/booths/${boothId}/sales`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": ip,
    },
    body: JSON.stringify({ items: [{ productId: 1, quantity: 1 }] }),
  });
}

async function check(request, {
  user = "clerk-user-one",
  limiter = createLimiter(),
} = {}) {
  return enforceWorkerRateLimit({
    request,
    env: { DB: createDb(), RATE_LIMITER: limiter.namespace },
    requestId: "request-test-123",
    authenticate: async () => user,
  });
}

test("route inventory uses operation-specific classes", () => {
  const cases = [
    ["GET", "/api/booths?organizationId=1", "authenticated_read"],
    ["POST", "/api/booths/8/sales", "sale"],
    ["PUT", "/api/admin/booth-inventory", "inventory"],
    ["POST", "/api/admin/troop-inventory", "inventory"],
    ["POST", "/api/booths/8/reconciliation", "lifecycle"],
    ["POST", "/api/admin/booths/8/archive", "lifecycle"],
    ["POST", "/api/organization-invitations", "invitation"],
    ["PATCH", "/api/admin/people/3", "administrative"],
  ];
  for (const [method, path, expected] of cases) {
    const body = method === "GET" ? undefined : JSON.stringify({ organizationId: 1 });
    assert.equal(
      classifyRateLimitedRoute(new Request(`https://app.example${path}`, {
        method,
        body,
        headers: body ? { "content-type": "application/json" } : undefined,
      })),
      expected,
    );
  }
  assert.equal(
    classifyRateLimitedRoute(new Request("https://app.example/api/webhooks/clerk", {
      method: "POST",
    })),
    null,
    "verified webhooks are limited inside their route",
  );
});

test("Durable Object counter returns an atomic fixed-window decision", async () => {
  const coordinator = createCoordinator();
  const request = () => new Request("https://rate-limit.internal/consume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ limit: 3, periodSeconds: 60 }),
  });
  for (let count = 0; count < 3; count += 1) {
    assert.deepEqual(await (await coordinator.fetch(request())).json(), {
      allowed: true,
      retryAfterSeconds: 0,
    });
  }
  const rejected = await (await coordinator.fetch(request())).json();
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.retryAfterSeconds > 0, true);
});

test("normal polling and a legitimate busy sales burst remain allowed", async () => {
  const limiter = createLimiter();
  for (let index = 0; index < 120; index += 1) {
    const read = new Request("https://app.example/api/booths?organizationId=1");
    assert.equal(await check(read, { limiter }), null);
  }
  for (let index = 0; index < 30; index += 1) {
    assert.equal(await check(saleRequest(), { limiter }), null);
  }
});

test("excessive sales are rejected with safe 429 metadata before mutation", async () => {
  const limiter = createLimiter();
  let mutationCount = 0;
  for (let index = 0; index < 61; index += 1) {
    const response = await check(saleRequest(), { limiter });
    if (!response) mutationCount += 1;
    if (index === 60) {
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("retry-after"), "37");
      assert.equal(response.headers.get("x-request-id"), "request-test-123");
      assert.deepEqual(await response.json(), {
        error: "Too many requests. Please wait before trying again.",
        code: "rate_limited",
        retryAfterSeconds: 37,
      });
    }
  }
  assert.equal(mutationCount, 60);
});

test("raw Worker rejects before the application mutation and broadcast boundary", async () => {
  const limiter = createLimiter();
  let applicationMutations = 0;
  let broadcasts = 0;
  const worker = createWorker({
    appHandler: {
      async fetch() {
        applicationMutations += 1;
        broadcasts += 1;
        return Response.json({ sale: { id: applicationMutations } });
      },
    },
    clerkClientFactory: () => ({
      async authenticateRequest() {
        return {
          isAuthenticated: true,
          toAuth: () => ({ userId: "clerk-user-one" }),
        };
      },
    }),
  });
  const env = {
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    DB: createDb(),
    RATE_LIMITER: limiter.namespace,
    BOOTH_LIVE_ROOMS: {},
    CLERK_SECRET_KEY: "configured",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "configured",
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  for (let index = 0; index < 60; index += 1) {
    assert.equal((await worker.fetch(saleRequest(), env, ctx)).status, 200);
  }
  const rejected = await worker.fetch(saleRequest(), env, ctx);
  assert.equal(rejected.status, 429);
  assert.equal(applicationMutations, 60);
  assert.equal(broadcasts, 60);
});

test("authenticated counters isolate shared IP users, organizations, and booths", async () => {
  const limiter = createLimiter();
  for (let index = 0; index < 60; index += 1) {
    assert.equal(await check(saleRequest(8), { limiter, user: "user-a" }), null);
  }
  assert.equal((await check(saleRequest(8), { limiter, user: "user-a" })).status, 429);
  assert.equal(await check(saleRequest(8), { limiter, user: "user-b" }), null);
  assert.equal(await check(saleRequest(9), { limiter, user: "user-a" }), null);
  assert.equal(await check(saleRequest(10), { limiter, user: "user-a" }), null);
});

test("unauthenticated abuse uses a minimized IP counter", async () => {
  const limiter = createLimiter();
  for (let index = 0; index < 60; index += 1) {
    assert.equal(await check(saleRequest(), { limiter, user: null }), null);
  }
  assert.equal((await check(saleRequest(), { limiter, user: null })).status, 429);
  assert.equal(await check(saleRequest(8, "203.0.113.8"), {
    limiter,
    user: null,
  }), null);
  for (const key of limiter.counters.keys()) {
    assert.doesNotMatch(key, /203\.0\.113/);
  }
});

test("backend failures fail open for booth traffic and closed for sensitive actions", async () => {
  const limiter = createLimiter({ fail: true });
  assert.equal(await check(saleRequest(), { limiter }), null);
  const admin = new Request("https://app.example/api/admin/people/3", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId: 1 }),
  });
  assert.equal((await check(admin, { limiter })).status, 429);
});

test("verified Clerk deliveries and ordinary retries remain functional", async () => {
  const limiter = createLimiter();
  for (let retry = 0; retry < 5; retry += 1) {
    assert.equal(
      await enforceVerifiedClerkWebhookRateLimit({
        env: { RATE_LIMITER: limiter.namespace },
        verifiedEventId: "verified_clerk_event_123",
        requestId: `webhook-${retry}`,
      }),
      null,
    );
  }
});

test("client 429 handling preserves caller-owned form state and blocks rapid retry", () => {
  const form = { quantity: 4, paymentMethod: "cash" };
  const response = new Response(JSON.stringify({ code: "rate_limited" }), {
    status: 429,
    headers: { "retry-after": "12" },
  });
  assert.throws(
    () => throwApiResponseError(response, { code: "rate_limited" }, "failed", "sale:test"),
    /entered information has been preserved/,
  );
  assert.deepEqual(form, { quantity: 4, paymentMethod: "cash" });
  assert.equal(rateLimitWaitSeconds("sale:test") > 0, true);
  assert.throws(() => assertRateLimitRetryAllowed("sale:test"), /Please wait/);
});

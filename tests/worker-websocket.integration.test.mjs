import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("worker-websocket-test", `${process.pid}-${Date.now()}`);
const { createWorker } = await import(workerUrl.href);

const boothRows = new Map([
  [
    8,
    {
      organizationId: 1,
      userId: 11,
      organizationRole: "admin",
      assignmentRole: null,
      status: "live",
      archivedAt: null,
    },
  ],
  [
    9,
    {
      organizationId: 2,
      userId: 22,
      organizationRole: "admin",
      assignmentRole: null,
      status: "live",
      archivedAt: null,
    },
  ],
]);

function createDatabase({ fail = false, rowOverride } = {}) {
  return {
    prepare(sql) {
      if (fail) throw new Error("database unavailable");
      return {
        bind(clerkUserId, boothId) {
          return {
            async first() {
              if (sql.includes("m.role = 'admin'")) {
                if (rowOverride?.organizationRole !== undefined) {
                  return rowOverride.organizationRole === "admin"
                    ? { is_admin: 1 }
                    : null;
                }
                return clerkUserId === "clerk-user-one" ||
                  clerkUserId === "clerk-user-two"
                  ? { is_admin: 1 }
                  : null;
              }
              if (rowOverride !== undefined) return rowOverride;
              const row = boothRows.get(Number(boothId));
              if (!row) return null;
              const expectedUser =
                row.organizationId === 1 ? "clerk-user-one" : "clerk-user-two";
              return clerkUserId === expectedUser ? row : null;
            },
          };
        },
      };
    },
  };
}

function createHarness({
  userId = "clerk-user-one",
  database = createDatabase(),
  roomFailure = false,
  mfaEnabled = true,
  mfaLookupFailure = false,
} = {}) {
  const webSocket = { readyState: 1 };
  const upgradeResponse = {
    body: null,
    headers: new Headers(),
    status: 101,
    statusText: "Switching Protocols",
    webSocket,
  };
  let appHandlerCalls = 0;
  let authenticateOptions;
  let clerkClientOptions;
  let roomName = "";
  const rateLimitCounters = new Map();
  const worker = createWorker({
    appHandler: {
      async fetch() {
        appHandlerCalls += 1;
        return new Response(null, { status: 500 });
      },
    },
    clerkClientFactory: (options) => {
      clerkClientOptions = options;
      return {
        users: {
          async getUser() {
            if (mfaLookupFailure) throw new Error("Clerk unavailable");
            return { twoFactorEnabled: mfaEnabled };
          },
        },
        async authenticateRequest(_request, options) {
          authenticateOptions = options;
          return {
            isAuthenticated: Boolean(userId),
            toAuth: () => ({ userId }),
          };
        },
      };
    },
  });
  const env = {
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    DB: database,
    CLERK_SECRET_KEY: "configured",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "configured",
    BOOTH_LIVE_ROOMS: {
      getByName(name) {
        roomName = name;
        return {
          async fetch() {
            if (roomFailure) throw new Error("room unavailable");
            return upgradeResponse;
          },
        };
      },
    },
    RATE_LIMITER: {
      getByName(name) {
        return {
          async fetch(_url, init) {
            const { limit } = JSON.parse(init.body);
            const count = rateLimitCounters.get(name) || 0;
            if (count >= limit) {
              return Response.json({ allowed: false, retryAfterSeconds: 41 });
            }
            rateLimitCounters.set(name, count + 1);
            return Response.json({ allowed: true, retryAfterSeconds: 0 });
          },
        };
      },
    },
  };
  return {
    appHandlerCalls: () => appHandlerCalls,
    authenticateOptions: () => authenticateOptions,
    clerkClientOptions: () => clerkClientOptions,
    env,
    roomName: () => roomName,
    upgradeResponse,
    webSocket,
    worker,
  };
}

function websocketRequest(boothId, origin = "https://app.example") {
  return new Request(`https://app.example/api/booths/${boothId}/live`, {
    headers: { origin, upgrade: "websocket" },
  });
}

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
};

test("authorized raw Worker request preserves the original 101 WebSocket response", async () => {
  const harness = createHarness();
  const response = await harness.worker.fetch(
    websocketRequest(8),
    harness.env,
    ctx,
  );

  assert.equal(response.status, 101);
  assert.equal(response.webSocket, harness.webSocket);
  assert.equal(response, harness.upgradeResponse);
  assert.equal(harness.roomName(), "1:8");
  assert.equal(harness.appHandlerCalls(), 0, "vinext must not process the upgrade");
  assert.deepEqual(harness.authenticateOptions(), {
    acceptsToken: "session_token",
    authorizedParties: ["https://app.example"],
  });
  assert.deepEqual(harness.clerkClientOptions(), {
    secretKey: "configured",
    publishableKey: "configured",
  });
});

test("WebSocket reconnect attempts respect the authorized connection limit", async () => {
  const harness = createHarness();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await harness.worker.fetch(
      websocketRequest(8),
      harness.env,
      ctx,
    );
    assert.equal(response.status, 101);
  }
  const limited = await harness.worker.fetch(
    websocketRequest(8),
    harness.env,
    ctx,
  );
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "41");
  assert.match(limited.headers.get("x-request-id") || "", /^[0-9a-f-]{36}$/);
});

test("raw Worker rejects missing authentication", async () => {
  const harness = createHarness({ userId: null });
  const response = await harness.worker.fetch(
    websocketRequest(8),
    harness.env,
    ctx,
  );
  assert.equal(response.status, 401);
  assert.equal(harness.appHandlerCalls(), 0);
});

test("raw Worker fails closed for an administrator without authoritative MFA", async () => {
  for (const harness of [
    createHarness({ mfaEnabled: false }),
    createHarness({ mfaLookupFailure: true }),
  ]) {
    const response = await harness.worker.fetch(
      websocketRequest(8),
      harness.env,
      ctx,
    );
    assert.equal(response.status, 403);
    assert.equal(harness.roomName(), "");
    assert.deepEqual(await response.json(), {
      error: "Administrator MFA enrollment is required",
    });
  }
});

test("raw Worker rejects cross-organization booth access", async () => {
  const harness = createHarness();
  const response = await harness.worker.fetch(
    websocketRequest(9),
    harness.env,
    ctx,
  );
  assert.equal(response.status, 403);
  assert.equal(harness.roomName(), "");
});

test("raw Worker rejects an unassigned booth operator", async () => {
  const harness = createHarness({
    database: createDatabase({
      rowOverride: {
        ...boothRows.get(8),
        organizationRole: "volunteer",
        assignmentRole: null,
      },
    }),
  });
  const response = await harness.worker.fetch(
    websocketRequest(8),
    harness.env,
    ctx,
  );
  assert.equal(response.status, 403);
  assert.equal(harness.roomName(), "");
});

test("raw Worker rejects invalid Origin and non-upgrade requests", async () => {
  const harness = createHarness();
  const invalidOrigin = await harness.worker.fetch(
    websocketRequest(8, "https://hostile.example"),
    harness.env,
    ctx,
  );
  assert.equal(invalidOrigin.status, 403);

  const nonUpgrade = await harness.worker.fetch(
    new Request("https://app.example/api/booths/8/live", {
      headers: { origin: "https://app.example" },
    }),
    harness.env,
    ctx,
  );
  assert.equal(nonUpgrade.status, 426);
  assert.equal(harness.appHandlerCalls(), 0);
});

test("raw Worker returns a safe error when the Durable Object fails", async () => {
  const harness = createHarness({ roomFailure: true });
  const response = await harness.worker.fetch(
    websocketRequest(8),
    harness.env,
    ctx,
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Live updates are temporarily unavailable",
  });
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
});

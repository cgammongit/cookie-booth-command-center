import assert from "node:assert/strict";
import test from "node:test";

const state = {
  user: {
    clerkUserId: "clerk-test-user",
    userId: 11,
    organizationId: 1,
    membershipId: 21,
    role: "admin",
    status: "active",
    canInviteUsers: false,
  },
  assigned: true,
  businessCalls: 0,
  roomCalls: 0,
};

globalThis.__CLERK_TEST_AUTH__ = { userId: state.user.clerkUserId };
globalThis.__CLERK_TEST_CLIENT__ = {};

function normalized(sql) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

class TestStatement {
  constructor(sql) {
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async raw() {
    const sql = normalized(this.sql);
    if (sql.includes('from "users" inner join "memberships"')) {
      const targetsActorOrganization =
        Number(this.params[0]) === state.user.organizationId;
      const targetsActor = this.params.includes(state.user.clerkUserId);
      if (!targetsActorOrganization || !targetsActor) return [];
      return [[
        state.user.userId,
        state.user.membershipId,
        state.user.organizationId,
        state.user.role,
        state.user.status,
        state.user.canInviteUsers,
      ]];
    }
    if (sql.includes('from "booths"') && !sql.includes(" join ")) {
      const boothId = Number(this.params[0]);
      const booth = booths.get(boothId);
      return booth
        ? [[booth.id, booth.organizationId, booth.status, booth.archivedAt]]
        : [];
    }
    if (sql.includes('from "assignments"')) {
      return state.assigned ? [[state.user.role]] : [];
    }
    if (sql.includes('from "organization_invitations"')) return [];
    throw new Error(`Unexpected authorization query: ${sql}`);
  }

  async first() {
    const sql = normalized(this.sql);
    if (sql.includes("from booths b") && sql.includes("inner join memberships m")) {
      const [clerkUserId, boothId] = this.params;
      const booth = booths.get(Number(boothId));
      if (
        clerkUserId !== state.user.clerkUserId ||
        !booth ||
        booth.organizationId !== state.user.organizationId
      ) {
        return null;
      }
      return {
        organizationId: booth.organizationId,
        userId: state.user.userId,
        organizationRole: state.user.role,
        assignmentRole: state.assigned ? state.user.role : null,
        status: booth.status,
        archivedAt: booth.archivedAt,
      };
    }
    state.businessCalls += 1;
    return null;
  }

  async all() {
    state.businessCalls += 1;
    return { results: [], success: true, meta: {} };
  }

  async run() {
    state.businessCalls += 1;
    return { success: true, meta: { changes: 0 } };
  }
}

class TestD1 {
  prepare(sql) {
    return new TestStatement(sql);
  }

  async batch() {
    state.businessCalls += 1;
    return [];
  }
}

const booths = new Map([
  [100, { id: 100, organizationId: 1, status: "scheduled", archivedAt: null }],
  [200, { id: 200, organizationId: 2, status: "scheduled", archivedAt: null }],
]);

globalThis.__CLOUDFLARE_ENV__ = {
  DB: new TestD1(),
  BOOTH_LIVE_ROOMS: {
    getByName(name) {
      state.roomCalls += 1;
      return {
        async fetch() {
          return new Response(JSON.stringify({ connected: true, room: name }), {
            status: 200,
          });
        },
      };
    },
  },
};

const [
  boothRoute,
  liveRoute,
  boothInventoryRoute,
  troopInventoryRoute,
  salesRoute,
  reconciliationRoute,
  invitationsRoute,
  scoutsRoute,
  boothScoutsRoute,
  scoutCreditRoute,
] = await Promise.all([
  import("../app/api/booths/[boothId]/route.ts"),
  import("../app/api/booths/[boothId]/live/route.ts"),
  import("../app/api/admin/booth-inventory/route.ts"),
  import("../app/api/admin/troop-inventory/route.ts"),
  import("../app/api/booths/[boothId]/sales/route.ts"),
  import("../app/api/booths/[boothId]/reconciliation/route.ts"),
  import("../app/api/organization-invitations/route.ts"),
  import("../app/api/admin/scouts/route.ts"),
  import("../app/api/admin/booth-scouts/route.ts"),
  import("../app/api/booths/[boothId]/scout-credit/route.ts"),
]);

function asRole(role, { canInviteUsers = false, assigned = true } = {}) {
  state.user.role = role;
  state.user.canInviteUsers = canInviteUsers;
  state.assigned = assigned;
  state.businessCalls = 0;
  state.roomCalls = 0;
}

function jsonRequest(url, method, body) {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      origin: new URL(url).origin,
    },
    body: JSON.stringify(body),
  });
}

function boothContext(boothId) {
  return { params: Promise.resolve({ boothId: String(boothId) }) };
}

function websocketRequest(boothId) {
  return new Request(`https://app.example/api/booths/${boothId}/live`, {
    headers: { origin: "https://app.example", upgrade: "websocket" },
  });
}

async function expectStatus(responsePromise, expected, label) {
  const response = await responsePromise;
  assert.equal(response.status, expected, label);
  return response;
}

test("actual API and WebSocket boundaries reject authenticated cross-organization attempts", async () => {
  asRole("admin");

  await expectStatus(
    boothRoute.GET(
      new Request("https://app.example/api/booths/200"),
      boothContext(200),
    ),
    403,
    "booth access",
  );
  await expectStatus(
    liveRoute.GET(websocketRequest(200), boothContext(200)),
    403,
    "WebSocket access",
  );
  await expectStatus(
    boothInventoryRoute.PUT(
      jsonRequest("https://app.example/api/admin/booth-inventory", "PUT", {
        organizationId: 2,
        boothId: 200,
        allocations: [],
      }),
    ),
    403,
    "booth inventory mutation",
  );
  await expectStatus(
    troopInventoryRoute.POST(
      jsonRequest("https://app.example/api/admin/troop-inventory", "POST", {
        organizationId: 2,
        productId: 1,
        type: "replenishment",
        quantity: 1,
      }),
    ),
    403,
    "troop inventory mutation",
  );
  await expectStatus(
    salesRoute.POST(
      jsonRequest("https://app.example/api/booths/200/sales", "POST", {
        paymentMethod: "cash",
        items: [{ productId: 1, quantity: 1 }],
      }),
      boothContext(200),
    ),
    403,
    "sales mutation",
  );
  await expectStatus(
    reconciliationRoute.POST(
      jsonRequest("https://app.example/api/booths/200/reconciliation", "POST", {
        cashTurnedIn: 0,
        finalCounts: [],
      }),
      boothContext(200),
    ),
    403,
    "reconciliation mutation",
  );
  await expectStatus(
    invitationsRoute.POST(
      jsonRequest("https://app.example/api/organization-invitations", "POST", {
        organizationId: 2,
        email: "cross-tenant@example.invalid",
        role: "volunteer",
        canInviteUsers: false,
      }),
    ),
    403,
    "invitation mutation",
  );
  await expectStatus(
    scoutsRoute.POST(jsonRequest("https://app.example/api/admin/scouts", "POST", { organizationId: 2, name: "Cross Tenant Scout", ageLevel: "Junior" })),
    403,
    "scout directory mutation",
  );
  await expectStatus(
    boothScoutsRoute.PUT(jsonRequest("https://app.example/api/admin/booth-scouts", "PUT", { organizationId: 2, boothId: 200, revision: "", assignments: [] })),
    403,
    "scout attendance mutation",
  );

  assert.equal(state.businessCalls, 0, "authorization must fail before business queries");
  assert.equal(state.roomCalls, 0, "authorization must fail before opening a room");
});

test("actual route boundaries enforce volunteer restrictions and assignment", async () => {
  asRole("volunteer");
  await expectStatus(
    salesRoute.POST(
      jsonRequest("https://app.example/api/booths/100/sales", "POST", {
        paymentMethod: "cash",
        items: [{ productId: 1, quantity: 1 }],
      }),
      boothContext(100),
    ),
    409,
    "assigned volunteers may pass the sales authorization boundary",
  );
  await expectStatus(
    reconciliationRoute.POST(
      jsonRequest("https://app.example/api/booths/100/reconciliation", "POST", {
        cashTurnedIn: 0,
        finalCounts: [],
      }),
      boothContext(100),
    ),
    403,
    "volunteers cannot reconcile",
  );
  await expectStatus(
    boothInventoryRoute.PUT(
      jsonRequest("https://app.example/api/admin/booth-inventory", "PUT", {
        organizationId: 1,
        boothId: 100,
        allocations: [],
      }),
    ),
    403,
    "volunteers cannot change booth inventory",
  );
  await expectStatus(
    invitationsRoute.GET(
      new Request("https://app.example/api/organization-invitations?organizationId=1"),
    ),
    403,
    "volunteers cannot manage invitations",
  );
  await expectStatus(
    scoutsRoute.POST(jsonRequest("https://app.example/api/admin/scouts", "POST", { organizationId: 1, name: "Restricted Scout", ageLevel: "Daisy" })),
    403,
    "volunteers cannot mutate the scout directory",
  );
  await expectStatus(
    boothScoutsRoute.PUT(jsonRequest("https://app.example/api/admin/booth-scouts", "PUT", { organizationId: 1, boothId: 100, revision: "", assignments: [] })),
    403,
    "volunteers cannot manage scout attendance",
  );
  await expectStatus(
    scoutCreditRoute.GET(new Request("https://app.example/api/booths/100/scout-credit"), boothContext(100)),
    403,
    "volunteers cannot inspect reconciliation credit",
  );
  await expectStatus(
    liveRoute.GET(websocketRequest(100), boothContext(100)),
    200,
    "assigned volunteers may connect to their booth",
  );

  asRole("volunteer", { assigned: false });
  await expectStatus(
    liveRoute.GET(websocketRequest(100), boothContext(100)),
    403,
    "unassigned volunteers cannot connect",
  );
});

test("actual route boundaries enforce lead and auditor restrictions", async () => {
  asRole("lead", { canInviteUsers: true });
  await expectStatus(
    boothInventoryRoute.PUT(
      jsonRequest("https://app.example/api/admin/booth-inventory", "PUT", {
        organizationId: 1,
        boothId: 100,
        allocations: [],
      }),
    ),
    403,
    "leads cannot administer booth allocations",
  );
  await expectStatus(
    troopInventoryRoute.POST(
      jsonRequest("https://app.example/api/admin/troop-inventory", "POST", {
        organizationId: 1,
        productId: 1,
        type: "replenishment",
        quantity: 1,
      }),
    ),
    403,
    "leads cannot change troop inventory",
  );
  await expectStatus(
    reconciliationRoute.POST(
      jsonRequest("https://app.example/api/booths/100/reconciliation", "POST", {
        cashTurnedIn: 0,
        finalCounts: [],
      }),
      boothContext(100),
    ),
    409,
    "assigned leads may pass reconciliation authorization",
  );
  await expectStatus(
    invitationsRoute.GET(
      new Request("https://app.example/api/organization-invitations?organizationId=1"),
    ),
    200,
    "delegated leads may view their invitation scope",
  );
  await expectStatus(
    invitationsRoute.POST(
      jsonRequest("https://app.example/api/organization-invitations", "POST", {
        organizationId: 1,
        email: "admin-target@example.invalid",
        role: "admin",
        canInviteUsers: false,
      }),
    ),
    403,
    "delegated leads cannot invite administrators",
  );

  asRole("auditor");
  await expectStatus(
    salesRoute.POST(
      jsonRequest("https://app.example/api/booths/100/sales", "POST", {
        paymentMethod: "cash",
        items: [{ productId: 1, quantity: 1 }],
      }),
      boothContext(100),
    ),
    403,
    "auditors cannot record sales",
  );
  await expectStatus(
    reconciliationRoute.POST(
      jsonRequest("https://app.example/api/booths/100/reconciliation", "POST", {
        cashTurnedIn: 0,
        finalCounts: [],
      }),
      boothContext(100),
    ),
    403,
    "auditors cannot reconcile",
  );
  await expectStatus(
    liveRoute.GET(websocketRequest(100), boothContext(100)),
    200,
    "auditors may use the read-only booth connection",
  );
});

test("actual route boundaries allow administrators to reach organization business queries", async () => {
  asRole("admin");
  await expectStatus(
    boothInventoryRoute.PUT(
      jsonRequest("https://app.example/api/admin/booth-inventory", "PUT", {
        organizationId: 1,
        boothId: 100,
        allocations: [],
      }),
    ),
    404,
    "administrators pass booth inventory authorization",
  );
  await expectStatus(
    troopInventoryRoute.POST(
      jsonRequest("https://app.example/api/admin/troop-inventory", "POST", {
        organizationId: 1,
        productId: 1,
        type: "replenishment",
        quantity: 1,
      }),
    ),
    404,
    "administrators pass troop inventory authorization",
  );
  await expectStatus(
    salesRoute.POST(
      jsonRequest("https://app.example/api/booths/100/sales", "POST", {
        paymentMethod: "cash",
        items: [{ productId: 1, quantity: 1 }],
      }),
      boothContext(100),
    ),
    409,
    "administrators pass sales authorization",
  );
  await expectStatus(
    reconciliationRoute.POST(
      jsonRequest("https://app.example/api/booths/100/reconciliation", "POST", {
        cashTurnedIn: 0,
        finalCounts: [],
      }),
      boothContext(100),
    ),
    409,
    "administrators pass reconciliation authorization",
  );
  await expectStatus(
    invitationsRoute.GET(
      new Request("https://app.example/api/organization-invitations?organizationId=1"),
    ),
    200,
    "administrators pass invitation authorization",
  );
  await expectStatus(
    liveRoute.GET(websocketRequest(100), boothContext(100)),
    200,
    "administrators pass WebSocket authorization",
  );
  assert.ok(state.businessCalls >= 4, "allowed routes should reach business data queries");
  assert.equal(state.roomCalls, 1);
});

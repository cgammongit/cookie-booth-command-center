import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
  assert.match(
    response.headers.get("content-security-policy-report-only") ?? "",
    /default-src 'self'/,
  );
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("strict-transport-security"), "max-age=86400");
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);

  const clientAssets = await readdir(
    new URL("../dist/client/assets", import.meta.url),
  );
  const authAsset = clientAssets.find((name) => name.startsWith("auth-panels-"));
  assert.ok(authAsset, "built Clerk sign-in asset should be present");
  const authSource = await readFile(
    new URL(`../dist/client/assets/${authAsset}`, import.meta.url),
    "utf8",
  );
  assert.match(authSource, /Sign in securely/);
  assert.match(authSource, /Access is invitation-only/);
});

test("troop inventory removals update an existing nonnegative balance", async () => {
  const route = await readFile(
    new URL("../app/api/admin/troop-inventory/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    route,
    /!positive[\s\S]*Number\(balance\.available\) < parsed\.data\.quantity/,
  );
  assert.match(
    route,
    /: env\.DB\.prepare\(`\s*UPDATE troop_inventory_balances/,
  );
});

test("troop inventory shows expandable active-booth allocation details", async () => {
  const [route, inventory] = await Promise.all([
    readFile(
      new URL("../app/api/admin/troop-inventory/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/troop-inventory.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(route, /AND b\.status != 'closed'/);
  assert.match(route, /AND b\.archived_at IS NULL/);
  assert.match(route, /\(i\.opening \+ i\.adjusted - i\.sold\) AS quantity/);
  assert.match(route, /atBooths: boothBreakdown\.reduce/);
  assert.match(inventory, /At all booths/);
  assert.match(inventory, /<details className="boothAllocationBreakdown">/);
  assert.match(inventory, /booth\.boothName/);
  assert.match(inventory, /booth\.quantity/);
});

test("troop inventory history uses the movement display dimension helper", async () => {
  const troopInventory = await readFile(
    new URL("../app/troop-inventory.tsx", import.meta.url),
    "utf8",
  );
  const displayHelper = await readFile(
    new URL("../lib/inventory-movement-display.ts", import.meta.url),
    "utf8",
  );

  assert.match(troopInventory, /getInventoryMovementDisplayQuantity\(movement\)/);
  assert.match(troopInventory, /formatInventoryMovementDisplayQuantity\(movement\)/);
  assert.doesNotMatch(
    troopInventory,
    /className=\{Number\(movement\.totalDelta\)/,
  );
  assert.match(
    displayHelper,
    /"booth_allocation"[\s\S]*"booth_return"/,
  );
  assert.match(displayHelper, /movement\.availableDelta[\s\S]*movement\.totalDelta/);
});

test("member access options exclude Pending while invitations retain pending actions", async () => {
  const peopleRoles = await readFile(
    new URL("../app/people-roles.tsx", import.meta.url),
    "utf8",
  );
  const invitations = peopleRoles.slice(
    peopleRoles.indexOf("<h2>Organization invitations</h2>"),
    peopleRoles.indexOf("<h2>Organization members</h2>"),
  );
  const members = peopleRoles.slice(
    peopleRoles.indexOf("<h2>Organization members</h2>"),
    peopleRoles.indexOf('<section className="auditPanel">'),
  );

  assert.match(members, /<option value="active">Active<\/option>/);
  assert.match(members, /value="suspended"[\s\S]*Suspended/);
  assert.doesNotMatch(members, /value="pending"[\s\S]*Pending/);
  assert.match(invitations, /invitation\.status === "pending"/);
  assert.match(invitations, />\s*Resend\s*</);
  assert.match(invitations, />\s*Cancel\s*</);
});

test("scout management UI uses a semantic table and is available on authorized live booths", async () => {
  const [directory, dashboard, attendance] = await Promise.all([
    readFile(new URL("../app/scout-directory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/booth-scout-attendance.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(directory, /<table className="peopleTable scoutDirectoryTable">/);
  assert.match(directory, /<thead><tr><th>Scout<\/th><th>Age level<\/th><th>Status<\/th><th>Action<\/th><\/tr><\/thead>/);
  assert.match(directory, /<tbody>/);
  assert.match(directory, /<tr key=\{scout\.id\}>/);
  assert.match(directory, /colSpan=\{4\}>No scouts have been added yet/);
  assert.match(directory, />\{scout\.archivedAt \? "Restore" : "Archive"\}<\/button>/);
  assert.match(dashboard, /permissions\.canCreateBooths \|\| role === "volunteer"[\s\S]*<BoothScoutAttendance key=\{selected\.scoutAssignmentRevision\} organizationId=\{organizationId\} booth=\{selected\}/);
  assert.match(attendance, /Save scout changes/);
  assert.doesNotMatch(attendance, /type="datetime-local"/);
});

test("reports expose four naturally sized tabs without assigning scout sales the flexible grid track", async () => {
  const [reports, styles] = await Promise.all([
    readFile(new URL("../app/reports.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(reports, /Gross Sales/);
  assert.match(reports, /Itemized Cookie Sales/);
  assert.match(reports, />Reconciliation<\/button>/);
  assert.match(reports, /Total Cookie Sales per Scout<\/button>/);
  assert.match(styles, /\.reportTabs\{display:flex;flex-wrap:wrap/);
  assert.match(styles, /\.reportTabs>button\{flex:0 0 auto\}/);
  assert.doesNotMatch(styles, /\.reportTabs\{display:grid;grid-template-columns:auto auto auto 1fr/);
});

test("inventory allocation UI validates activity minimums without locking active booths", async () => {
  const inventoryManagement = await readFile(
    path.join(process.cwd(), "app", "inventory-management.tsx"),
    "utf8",
  );
  const route = await readFile(
    path.join(
      process.cwd(),
      "app",
      "api",
      "admin",
      "booth-inventory",
      "route.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(
    inventoryManagement,
    /disabled=\{[^}]*item\.sold[^}]*item\.adjusted/,
  );
  assert.match(inventoryManagement, /min=\{minimum\}/);
  assert.match(inventoryManagement, /a lower allocation would make remaining inventory negative/);
  assert.match(inventoryManagement, /inventory_conflict/);
  assert.match(inventoryManagement, /preserveUnrelatedDrafts/);
  assert.match(route, /expectedRevision/);
  assert.match(route, /buildInventorySnapshotGuard/);
  assert.match(route, /broadcastBoothEvent[\s\S]*\["inventory"\]/);
});

test("booth sales are server-priced, payment-separated, and inventory-protected", async () => {
  const [route, migration] = await Promise.all([
    readFile(
      new URL("../app/api/booths/[boothId]/sales/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0010_booth_sales.sql", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(route, /paymentMethod: z\.enum\(\["cash", "credit_card", "venmo_paypal"\]\)/);
  assert.match(route, /totalAmount \+= quantity \* Number\(product\.price\)/);
  assert.match(route, /UPDATE inventory SET sold = sold \+ \?/);
  assert.match(route, /\(opening \+ adjusted - sold\) >= \?/);
  assert.match(route, /UPDATE troop_inventory_balances[\s\S]*total_remaining = total_remaining - \?/);
  assert.match(route, /total_remaining >= \?/);
  assert.match(route, /movement_type[\s\S]*'booth_sale'/);
  assert.doesNotMatch(migration, /CREATE TRIGGER/);
});

test("booth lifecycle derives live and pending-closure sales windows", async () => {
  const [lifecycle, boothRoute, saleRoute, dashboard, polling] = await Promise.all([
    readFile(new URL("../lib/booth-status.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/booths/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/booths/[boothId]/sales/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/use-active-polling.ts", import.meta.url), "utf8"),
  ]);

  assert.match(lifecycle, /if \(now < startsAt\) return "scheduled"/);
  assert.match(lifecycle, /if \(now <= endsAt\) return "live"/);
  assert.match(lifecycle, /return "pending_closure"/);
  assert.match(lifecycle, /status === "live" \|\| status === "pending_closure"/);
  assert.match(boothRoute, /getEffectiveBoothStatus\(booth\)/);
  assert.match(saleRoute, /canRecordBoothSales\(effectiveStatus\)/);
  assert.match(dashboard, /useActivePolling\(loadBooths/);
  assert.match(polling, /intervalMs = 15_000/);
  assert.match(dashboard, /selected\.status === "pending_closure"/);
});

test("booth reconciliation returns stock, separates payment totals, and closes manually", async () => {
  const [route, migration, dashboard] = await Promise.all([
    readFile(
      new URL("../app/api/booths/[boothId]/reconciliation/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0011_booth_reconciliation.sql", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(route, /getEffectiveBoothStatus\(booth\) !== "pending_closure"/);
  assert.match(route, /Explain cash or inventory discrepancies before closing the booth/);
  assert.match(route, /available = available \+ \?/);
  assert.match(route, /SET adjusted = sold - opening/);
  assert.match(route, /'booth_return'/);
  assert.match(route, /UPDATE booths SET status = 'closed'/);
  assert.match(route, /credit_card_total/);
  assert.match(route, /venmo_paypal_total/);
  assert.match(migration, /CREATE TABLE `reconciliation_items`/);
  assert.match(dashboard, /Close booth & return inventory/);
  assert.match(dashboard, /selected\.status === "pending_closure"/);
});

test("active pages synchronize booth operations and troop inventory without overlapping polls", async () => {
  const [polling, dashboard, troopInventory] = await Promise.all([
    readFile(new URL("../app/use-active-polling.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/troop-inventory.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(polling, /document\.visibilityState !== "visible"/);
  assert.match(polling, /if \(inFlightRef\.current\) return inFlightRef\.current/);
  assert.match(polling, /document\.addEventListener\("visibilitychange"/);
  assert.match(polling, /controllerRef\.current\?\.abort\(\)/);
  assert.match(polling, /window\.setTimeout/);
  assert.doesNotMatch(polling, /window\.setInterval/);

  assert.match(dashboard, /useActivePolling\(loadBooths/);
  assert.match(dashboard, /useActivePolling\(loadSelectedBooth/);
  assert.match(dashboard, /setSelectedInventory\(payload\.inventory \|\| \[\]\)/);
  assert.match(dashboard, /setPaymentTotals\(payload\.paymentTotals/);
  assert.match(dashboard, /setSelected\(\(current\)[\s\S]*payload\.booth/);
  assert.match(
    dashboard,
    /Promise\.all\(\[refreshBooths\(true\), refreshSelectedBooth\(true\)\]\)/,
  );
  assert.match(dashboard, /Showing the last successfully synchronized data/);
  const boothSync = dashboard.slice(
    dashboard.indexOf("const loadSelectedBooth"),
    dashboard.indexOf("const refreshSelectedBooth"),
  );
  assert.doesNotMatch(boothSync, /setSaleStep|setSaleQuantities|setReconciliation/);

  assert.match(troopInventory, /useActivePolling\(load\)/);
  assert.match(troopInventory, /setBalances\(payload\.balances \|\| \[\]\)/);
  assert.match(troopInventory, /setMovements\(payload\.movements \|\| \[\]\)/);
  assert.match(troopInventory, /Showing the last successfully synchronized data/);
});

test("durable booth rooms serialize rapid events for simultaneous users and isolate organizations", async () => {
  globalThis.WebSocketRequestResponsePair = class {
    constructor(request, response) {
      this.request = request;
      this.response = response;
    }
  };
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("durable-room-test", `${process.pid}-${Date.now()}`);
  const { BoothLiveRoom } = await import(workerUrl.href);
  assert.equal(typeof BoothLiveRoom, "function");

  const messages = [[], []];
  const sockets = messages.map((received) => ({
    send(message) {
      received.push(JSON.parse(message));
    },
    close() {},
  }));
  const data = new Map([
    ["identity", { organizationId: 7, boothId: 42 }],
    ["revision", 0],
  ]);
  let gate = Promise.resolve();
  const storage = {
    async get(key) {
      return data.get(key);
    },
    async put(key, value) {
      data.set(key, value);
    },
    async deleteAlarm() {},
    async setAlarm() {},
  };
  const ctx = {
    storage,
    setWebSocketAutoResponse(pair) {
      assert.equal(pair.request, "ping");
      assert.equal(pair.response, "pong");
    },
    blockConcurrencyWhile(callback) {
      const result = gate.then(callback);
      gate = result.then(() => undefined, () => undefined);
      return result;
    },
    getWebSockets() {
      return sockets;
    },
    acceptWebSocket() {},
  };
  const env = {
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                return {
                  status: "closed",
                  startsAt: "2026-01-01T00:00:00.000Z",
                  endsAt: "2026-01-01T01:00:00.000Z",
                  archivedAt: null,
                };
              },
            };
          },
        };
      },
    },
  };
  const room = new BoothLiveRoom(ctx, env);
  await gate;

  const publish = (topics, organizationId = 7, boothId = 42) => room.fetch(
    new Request("https://booth-live.internal/publish", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-live-organization-id": String(organizationId),
        "x-live-booth-id": String(boothId),
      },
      body: JSON.stringify({ topics }),
    }),
  );

  const rapid = await Promise.all([
    publish(["sales", "inventory", "payments"]),
    publish(["sales", "inventory", "payments"]),
    publish(["inventory"]),
  ]);
  assert.deepEqual(
    await Promise.all(rapid.map((response) => response.json())),
    [{ revision: 1 }, { revision: 2 }, { revision: 3 }],
  );
  assert.deepEqual(messages[0].map((event) => event.revision), [1, 2, 3]);
  assert.deepEqual(messages[1], messages[0]);
  assert.deepEqual(messages[0][2].topics, ["inventory"]);

  const isolated = await publish(["sales"], 8, 42);
  assert.equal(isolated.status, 403);
  assert.equal(messages[0].length, 3);

  const closure = await publish([
    "inventory",
    "payments",
    "lifecycle",
    "reconciliation",
    "closure",
  ]);
  assert.deepEqual(await closure.json(), { revision: 4 });
  assert.deepEqual(messages[0][3].topics, [
    "inventory",
    "payments",
    "lifecycle",
    "reconciliation",
    "closure",
  ]);
});

test("websocket authorization is server-derived and booth-scoped", async () => {
  const [route, handler, access, room, config] = await Promise.all([
    readFile(new URL("../app/api/booths/[boothId]/live/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/booth-live-handler.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/booth-live-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/booth-live-room.ts", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  ]);

  assert.match(route, /handleBoothLiveRequest/);
  assert.match(handler, /origin !== requestUrl\.origin/);
  assert.match(handler, /authorizeBoothLiveAccess/);
  assert.match(handler, /access\.organizationId/);
  assert.match(handler, /access\.userId/);
  assert.match(access, /m\.status = 'active'/);
  assert.match(access, /u\.clerk_user_id = \?/);
  assert.match(access, /evaluateBoothPermission/);
  assert.match(room, /Room identity does not match/);
  assert.match(room, /WebSocketRequestResponsePair\("ping", "pong"\)/);
  assert.match(config, /"name": "BOOTH_LIVE_ROOMS"/);
  assert.match(config, /"new_sqlite_classes": \["BoothLiveRoom"\]/);
});

test("websocket clients recover missed revisions and retain polling fallback", async () => {
  const [liveSync, polling, dashboard, troopInventory] = await Promise.all([
    readFile(new URL("../app/use-booth-live-sync.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/use-active-polling.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/troop-inventory.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(liveSync, /event\.revision !== currentRevision \+ 1/);
  assert.match(liveSync, /currentRevision !== event\.revision/);
  assert.match(liveSync, /event\.revision <= currentRevision/);
  assert.match(liveSync, /HEARTBEAT_INTERVAL_MS = 27_500/);
  assert.match(liveSync, /PONG_DEADLINE_MS = 10_000/);
  assert.match(liveSync, /MAX_RECONNECT_DELAY_MS = 30_000/);
  assert.match(liveSync, /RECONNECT_COOLDOWN_MS = 60_000/);
  assert.match(liveSync, /Math\.random\(\)/);
  assert.match(liveSync, /document\.visibilityState === "visible"/);
  assert.match(liveSync, /navigator\.onLine/);
  assert.match(liveSync, /socket\.send\("ping"\)/);
  assert.match(liveSync, /message\.data === "pong"/);
  assert.match(liveSync, /window\.addEventListener\("online"/);
  assert.match(liveSync, /window\.addEventListener\("offline"/);
  assert.match(liveSync, /pendingRevisions\.clear\(\)/);
  assert.match(liveSync, /while \(active && pendingRevisions\.size\)/);
  assert.match(liveSync, /revision <= \(requestedRevisions\.get\(boothId\) \|\| 0\)/);
  assert.match(liveSync, /sockets\.get\(boothId\) !== socket/);
  assert.match(polling, /intervalMs = 15_000/);
  assert.match(polling, /\(!enabled && !force\)/);
  assert.match(dashboard, /liveSyncStatus !== "connected"/);
  assert.match(dashboard, /Live updates connected/);
  assert.match(dashboard, /Reconnecting — polling every 15 seconds/);
  assert.match(dashboard, /Polling only/);
  assert.match(dashboard, /Synchronization paused — showing last valid data/);
  assert.match(dashboard, /refreshSelectedBooth\(true\)/);
  assert.match(troopInventory, /useBoothLiveSync/);

  const boothSync = dashboard.slice(
    dashboard.indexOf("const loadSelectedBooth"),
    dashboard.indexOf("const saleItems"),
  );
  assert.doesNotMatch(boothSync, /setSaleStep|setSaleQuantities|setReconciliation/);
});

test("successful booth mutations broadcast authoritative event topics", async () => {
  const [sale, inventory, reconciliation, archive, attendance] = await Promise.all([
    readFile(new URL("../app/api/booths/[boothId]/sales/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/booth-inventory/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/booths/[boothId]/reconciliation/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/admin/booths/[boothId]/archive/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/api/admin/booth-scouts/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(sale, /await env\.DB\.batch\(statements\)[\s\S]*\["sales", "inventory", "payments"\]/);
  assert.match(inventory, /await env\.DB\.batch\(statements\)[\s\S]*\["inventory"\]/);
  assert.match(
    reconciliation,
    /await env\.DB\.batch\(statements\)[\s\S]*"reconciliation", "closure"/,
  );
  assert.match(archive, /await env\.DB\.batch\(statements\)[\s\S]*\["lifecycle"\]/);
  assert.match(attendance, /await env\.DB\.batch\(statements\)[\s\S]*\["attendance"\]/);
  assert.match(sale, /\.catch\(\(\) => undefined\)/);
  assert.match(reconciliation, /\.catch\(\(\) => undefined\)/);
});

test("booth scout roster renders a time sheet above an accessible compact selector", async () => {
  const source = await readFile(new URL("../app/booth-scout-attendance.tsx", import.meta.url), "utf8");
  const timeSheet = source.indexOf('className="scoutTimeSheet boothScoutPanel"');
  const attendance = source.indexOf('className="scoutAttendance boothScoutPanel"');
  assert.ok(timeSheet >= 0 && attendance > timeSheet);
  assert.match(source, /<th scope="col">Name<\/th><th scope="col">Start Time<\/th><th scope="col">End Time<\/th>/);
  assert.doesNotMatch(source, /type="date"|type="datetime-local"/);
  assert.match(source, /<select aria-label=\{`\$\{item\.name\} start time`\}/);
  assert.match(source, /aria-haspopup="listbox"/);
  assert.match(source, /aria-multiselectable="true"/);
  assert.match(source, /role="option" aria-selected=\{selected\}/);
  assert.match(source, /selected \? "✓" : ""/);
  assert.match(source, /No active scouts are available\. Add scouts in Scout Directory/);
  assert.match(source, /15 \* 60 \* 1000/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  const [lifecycle, boothRoute, saleRoute, dashboard] = await Promise.all([
    readFile(new URL("../lib/booth-status.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/booths/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/booths/[boothId]/sales/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(lifecycle, /if \(now < startsAt\) return "scheduled"/);
  assert.match(lifecycle, /if \(now <= endsAt\) return "live"/);
  assert.match(lifecycle, /return "pending_closure"/);
  assert.match(lifecycle, /status === "live" \|\| status === "pending_closure"/);
  assert.match(boothRoute, /getEffectiveBoothStatus\(booth\)/);
  assert.match(saleRoute, /canRecordBoothSales\(effectiveStatus\)/);
  assert.match(dashboard, /30_000/);
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

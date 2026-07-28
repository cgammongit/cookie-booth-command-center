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

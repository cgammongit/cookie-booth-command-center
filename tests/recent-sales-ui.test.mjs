import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [component, dashboard, styles] = await Promise.all([
  readFile(new URL("../app/recent-sales.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("Recent Sales renders complete safe sale details and explicit UI states", () => {
  assert.match(component, /<h2 id="recent-sales-title">Recent Sales<\/h2>/);
  assert.match(component, /Loading recent sales…/);
  assert.match(component, /No sales have been entered/);
  assert.match(component, /paymentLabels\[sale\.paymentMethod\]/);
  assert.match(component, /sale\.operatorName/);
  assert.match(component, /item\.quantity} × {item\.name/);
  assert.match(component, /canReverse && !boothClosed/);
  assert.match(component, /Undo Sale/);
  assert.match(component, /role="dialog" aria-modal="true"/);
  assert.match(component, /Select a reason/);
  assert.match(component, /reasonCode === "other"/);
});

test("Recent Sales remains booth-scoped, synchronized, responsive, and non-optimistic", () => {
  assert.match(component, /`\/api\/booths\/\$\{boothId}\/sales`/);
  assert.match(component, /`\/api\/booths\/\$\{boothId}\/sales\/\$\{selected\.id}\/reversal`/);
  assert.match(component, /await Promise\.all\(\[refresh\(true\), onReversed\(\)\]\)/);
  assert.match(component, /requestGeneration !== generation\.current/);
  assert.match(dashboard, /<RecentSales/);
  assert.match(dashboard, /setRecentSalesRefreshToken/);
  assert.match(styles, /\.recentSalesList>article\{display:grid/);
  assert.match(styles, /@media\(max-width:700px\)\{\.recentSalesList>article\{grid-template-columns:1fr\}/);
});

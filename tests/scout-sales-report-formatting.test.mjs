import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [reports, styles] = await Promise.all([
  readFile(new URL("../app/reports.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("scout sales report maps four source values to four distinct cells", () => {
  assert.match(reports, /<div className="reportTableHead"><span>Scout<\/span><span>Age level<\/span><span>Credited boxes<\/span><span>Reconciled booths<\/span><\/div>/);
  assert.match(reports, /<summary><strong className="scoutSalesCell"[^>]*>\{scout\.scoutName\}[\s\S]*?<span className="scoutSalesCell"[^>]*>\{scout\.ageLevel\}<\/span><span className="scoutSalesCell scoutSalesNumeric"[^>]*>\{boxes\(scout\.creditedBoxes\)\}<\/span><span className="scoutSalesCell scoutSalesNumeric"[^>]*>\{scout\.reconciledBooths\}<\/span><\/summary>/);
  assert.doesNotMatch(reports, /\{scout\.scoutName\}\{scout\.ageLevel\}\{boxes\(scout\.creditedBoxes\)\}\{scout\.reconciledBooths\}/);
});

test("scout report header and rows share a responsive four-column grid", () => {
  assert.match(reports, /className="reportTable scoutSalesReportTable"/);
  assert.match(reports, /className="scoutSalesRow"/);
  assert.match(styles, /\.reportTable\.scoutSalesReportTable>\.reportTableHead,\.scoutSalesReportTable>\.scoutSalesRow>summary\{display:grid;grid-template-columns:minmax\(260px,2fr\) repeat\(3,minmax\(130px,1fr\)\)/);
  assert.match(styles, /\.scoutSalesNumeric\{text-align:right;font-variant-numeric:tabular-nums\}/);
  assert.match(styles, /\.reportTable\{overflow-x:auto\}/);
});

test("scout report preserves empty, expandable, accessible, and print behavior", () => {
  assert.match(reports, /No finalized scout credit is available for this report scope\./);
  assert.match(reports, /<details className="scoutSalesRow"/);
  assert.match(reports, /aria-label=\{`Scout: /);
  assert.match(reports, /aria-label=\{`Age level: /);
  assert.match(reports, /aria-label=\{`Credited boxes: /);
  assert.match(reports, /aria-label=\{`Reconciled booths: /);
  assert.match(styles, /\.scoutSalesReportTable>\.scoutSalesRow\{min-width:0;break-inside:avoid\}/);
  assert.match(styles, /\.reportTable\{overflow:visible\}/);
});

test("scout CSV remains four separately escaped columns", () => {
  assert.match(reports, /\["Scout", "Age level", "Finalized credited boxes", "Reconciled booths"\]/);
  assert.match(reports, /\[scout\.scoutName, scout\.ageLevel, boxes\(scout\.creditedBoxes\), scout\.reconciledBooths\]/);
  assert.match(reports, /replaceAll\('\"', '\"\"'\)/);
  assert.match(reports, /row\.map\(csvCell\)\.join\(","\)/);
});

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type BoothOption = {
  id: number;
  name: string;
  startsAt: string;
  status: string;
  archivedAt: string | null;
};

type Report = {
  generatedAt: string;
  filters: { boothIds: number[]; from: string | null; to: string | null };
  totals: {
    saleCount: number;
    boxCount: number;
    gross: number;
    cash: number;
    creditCard: number;
    venmoPaypal: number;
    averageSale: number;
  };
  boothSales: Array<{
    boothId: number; boothName: string; saleCount: number; boxCount: number;
    gross: number; cash: number; creditCard: number; venmoPaypal: number;
  }>;
  itemSales: Array<{
    productId: number; productName: string; boxCount: number; gross: number;
  }>;
  reconciliations: Array<{
    boothId: number; boothName: string; closedAt: string;
    expectedCash: number; cashTurnedIn: number; cashDiscrepancy: number;
    inventoryDiscrepancy: number; notes: string | null;
  }>;
  scoutSales: Array<{
    scoutId: number; scoutName: string; ageLevel: string; archived: boolean;
    creditedBoxes: number; reconciledBooths: number;
    booths: Array<{ boothId: number; boothName: string; creditedBoxes: number; products: Array<{ productId: number; productName: string; creditedBoxes: number }> }>;
  }>;
};

type ReportView = "gross" | "items" | "reconciliation" | "scouts";

function boxes(value: number) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function boothDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        month: "short", day: "numeric", year: "numeric",
      }).format(date);
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function Reports({
  organizationId,
  organizationName,
  role,
  onBack,
}: {
  organizationId: number;
  organizationName: string;
  role: string;
  onBack: () => void;
}) {
  const [booths, setBooths] = useState<BoothOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [view, setView] = useState<ReportView>("gross");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (boothIds: number[], start = from, end = to) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        organizationId: String(organizationId),
        boothIds: boothIds.join(","),
      });
      if (start) params.set("from", start);
      if (end) params.set("to", end);
      const response = await fetch(`/api/reports/booth-sales?${params}`, {
        cache: "no-store",
      });
      const payload = await response.json() as {
        booths?: BoothOption[]; report?: Report | null; error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Unable to generate report");
      const options = payload.booths || [];
      setBooths(options);
      setReport(payload.report || null);
      return options;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to generate report");
      return [];
    } finally {
      setLoading(false);
    }
  }, [from, organizationId, to]);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      const options = await load([]);
      if (!active || !options.length) return;
      const allIds = options.map((booth) => Number(booth.id));
      setSelectedIds(allIds);
      await load(allIds);
    };
    void initialize();
    return () => { active = false; };
    // Initial report load is intentionally scoped to the organization.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const selectedNames = useMemo(() => {
    const selected = new Set(selectedIds);
    return booths.filter((booth) => selected.has(Number(booth.id)));
  }, [booths, selectedIds]);

  function toggleBooth(boothId: number) {
    setSelectedIds((current) =>
      current.includes(boothId)
        ? current.filter((id) => id !== boothId)
        : [...current, boothId],
    );
  }

  function exportCsv() {
    if (!report) return;
    let rows: Array<Array<string | number>>;
    let suffix: string;
    if (view === "items") {
      suffix = "itemized-cookie-sales";
      rows = [
        ["Cookie", "Boxes sold", "Gross sales"],
        ...report.itemSales.map((item) => [
          item.productName, item.boxCount, Number(item.gross).toFixed(2),
        ]),
      ];
    } else if (view === "scouts") {
      suffix = "total-cookie-sales-per-scout";
      rows = [
        ["Scout", "Age level", "Finalized credited boxes", "Reconciled booths"],
        ...report.scoutSales.map((scout) => [scout.scoutName, scout.ageLevel, boxes(scout.creditedBoxes), scout.reconciledBooths]),
      ];
    } else if (view === "reconciliation") {
      suffix = "booth-reconciliation";
      rows = [
        ["Booth", "Closed", "Expected cash", "Cash turned in", "Cash difference", "Inventory difference", "Notes"],
        ...report.reconciliations.map((item) => [
          item.boothName, item.closedAt, Number(item.expectedCash).toFixed(2),
          Number(item.cashTurnedIn).toFixed(2), Number(item.cashDiscrepancy).toFixed(2),
          item.inventoryDiscrepancy, item.notes || "",
        ]),
      ];
    } else {
      suffix = "gross-sales";
      rows = [
        ["Booth", "Transactions", "Boxes sold", "Gross sales", "Cash", "Credit card", "Venmo / PayPal"],
        ...report.boothSales.map((item) => [
          item.boothName, item.saleCount, item.boxCount, Number(item.gross).toFixed(2),
          Number(item.cash).toFixed(2), Number(item.creditCard).toFixed(2),
          Number(item.venmoPaypal).toFixed(2),
        ]),
      ];
    }
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${suffix}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="reportPage">
      <header className="noPrint">
        <button className="back" onClick={onBack}>← Command center</button>
        <div className="brand">COOKIE BOOTH <b>COMMAND CENTER</b></div>
        <span className="roleBadge">{role}</span>
      </header>
      <section className="peopleHero reportHero">
        <div>
          <p className="eyebrow">SALES REPORTING · {organizationName}</p>
          <h1>Booth reports</h1>
          <p>Combine one or more booths, review payment totals, and export season records.</p>
        </div>
        <div className="peopleSummary">
          <strong>{selectedIds.length}</strong><span>booths selected</span>
        </div>
      </section>
      {error && <div className="alert errorAlert noPrint" role="alert">{error}</div>}

      <section className="peoplePanel reportFilters noPrint">
        <div className="panelHeading">
          <div><p className="eyebrow">REPORT SCOPE</p><h2>Select booths</h2></div>
          <div className="sectionActions">
            <button onClick={() => setSelectedIds(booths.map((booth) => Number(booth.id)))}>Select all</button>
            <button onClick={() => setSelectedIds([])}>Clear</button>
          </div>
        </div>
        <div className="reportBoothPicker">
          {booths.map((booth) => (
            <label key={booth.id}>
              <input
                type="checkbox"
                checked={selectedIds.includes(Number(booth.id))}
                onChange={() => toggleBooth(Number(booth.id))}
              />
              <span>
                <strong>{booth.name}</strong>
                <small>{boothDate(booth.startsAt)} · {booth.archivedAt ? "archived" : booth.status}</small>
              </span>
            </label>
          ))}
          {!loading && !booths.length && <p>No booths are available to report.</p>}
        </div>
        <div className="reportDateFilters">
          <label>Sale date from<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>Sale date through<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <button
            className="primary"
            disabled={loading || !selectedIds.length}
            onClick={() => void load(selectedIds)}
          >
            {loading ? "Generating…" : "Generate report"}
          </button>
        </div>
      </section>

      {report && (
        <>
          <section className="reportPrintHeading">
            <p className="eyebrow">{organizationName}</p>
            <h2>{view === "gross" ? "Gross sales report" : view === "items" ? "Itemized cookie sales report" : view === "scouts" ? "Total Cookie Sales per Scout" : "Reconciliation report"}</h2>
            <p>
              {selectedNames.map((booth) => booth.name).join(", ")}
              {report.filters.from || report.filters.to
                ? ` · ${report.filters.from || "Beginning"} through ${report.filters.to || "Present"}`
                : " · All sale dates"}
            </p>
          </section>
          <div className="reportTabs noPrint">
            <button className={view === "gross" ? "active" : ""} onClick={() => setView("gross")}>Gross Sales</button>
            <button className={view === "items" ? "active" : ""} onClick={() => setView("items")}>Itemized Cookie Sales</button>
            <button className={view === "reconciliation" ? "active" : ""} onClick={() => setView("reconciliation")}>Reconciliation</button>
            <button className={view === "scouts" ? "active" : ""} onClick={() => setView("scouts")}>Total Cookie Sales per Scout</button>
            <span />
            <button onClick={exportCsv}>Export CSV</button>
            <button onClick={() => window.print()}>Print / PDF</button>
          </div>

          {view === "gross" && (
            <>
              <section className="stats reportStats">
                <article><span>Gross sales</span><strong>{money.format(Number(report.totals.gross))}</strong><small>all selected booths</small></article>
                <article><span>Boxes sold</span><strong>{Number(report.totals.boxCount).toLocaleString()}</strong><small>{report.totals.saleCount} transactions</small></article>
                <article><span>Average sale</span><strong>{money.format(Number(report.totals.averageSale))}</strong><small>per transaction</small></article>
                <article><span>Cash to troop</span><strong>{money.format(Number(report.totals.cash))}</strong><small>expected cash</small></article>
              </section>
              <section className="paymentStats reportPaymentStats">
                <article><span>Cash</span><strong>{money.format(Number(report.totals.cash))}</strong></article>
                <article><span>Credit card</span><strong>{money.format(Number(report.totals.creditCard))}</strong></article>
                <article><span>Venmo / PayPal</span><strong>{money.format(Number(report.totals.venmoPaypal))}</strong></article>
              </section>
              <section className="peoplePanel reportTablePanel">
                <div className="panelHeading"><div><p className="eyebrow">BOOTH PERFORMANCE</p><h2>Sales by booth</h2></div></div>
                <div className="reportTable">
                  <div className="reportTableHead"><span>Booth</span><span>Transactions</span><span>Boxes</span><span>Gross</span><span>Cash</span><span>Credit card</span><span>Venmo / PayPal</span></div>
                  {report.boothSales.map((booth) => (
                    <div key={booth.boothId}>
                      <strong>{booth.boothName}</strong>
                      <span>{booth.saleCount}</span><span>{booth.boxCount}</span>
                      <span>{money.format(Number(booth.gross))}</span>
                      <span>{money.format(Number(booth.cash))}</span>
                      <span>{money.format(Number(booth.creditCard))}</span>
                      <span>{money.format(Number(booth.venmoPaypal))}</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {view === "items" && (
            <section className="peoplePanel reportTablePanel">
              <div className="panelHeading"><div><p className="eyebrow">PRODUCT MIX</p><h2>Itemized cookie sales</h2></div></div>
              <div className="reportTable itemReportTable">
                <div className="reportTableHead"><span>Cookie</span><span>Boxes sold</span><span>Share of boxes</span><span>Gross sales</span></div>
                {report.itemSales.map((item) => (
                  <div key={item.productId}>
                    <strong>{item.productName}</strong>
                    <span>{item.boxCount}</span>
                    <span>{report.totals.boxCount ? `${((Number(item.boxCount) / report.totals.boxCount) * 100).toFixed(1)}%` : "0%"}</span>
                    <span>{money.format(Number(item.gross))}</span>
                  </div>
                ))}
                {!report.itemSales.length && <p className="loadingState">No cookie sales match this report scope.</p>}
              </div>
            </section>
          )}

          {view === "reconciliation" && (
            <section className="peoplePanel reportTablePanel">
              <div className="panelHeading"><div><p className="eyebrow">CLOSEOUT REVIEW</p><h2>Reconciliation exceptions</h2></div></div>
              <div className="reportTable reconciliationReportTable">
                <div className="reportTableHead"><span>Booth</span><span>Closed</span><span>Expected cash</span><span>Turned in</span><span>Cash difference</span><span>Box difference</span><span>Notes</span></div>
                {report.reconciliations.map((item) => (
                  <div key={item.boothId}>
                    <strong>{item.boothName}</strong>
                    <span>{boothDate(item.closedAt)}</span>
                    <span>{money.format(Number(item.expectedCash))}</span>
                    <span>{money.format(Number(item.cashTurnedIn))}</span>
                    <span className={Number(item.cashDiscrepancy) ? "reportException" : ""}>{money.format(Number(item.cashDiscrepancy))}</span>
                    <span className={Number(item.inventoryDiscrepancy) ? "reportException" : ""}>{item.inventoryDiscrepancy}</span>
                    <span>{item.notes || "—"}</span>
                  </div>
                ))}
                {!report.reconciliations.length && <p className="loadingState">No selected booths have been reconciled yet.</p>}
              </div>
            </section>
          )}
          {view === "scouts" && (
            <section className="peoplePanel reportTablePanel">
              <div className="panelHeading"><div><p className="eyebrow">FINALIZED CREDIT</p><h2>Total Cookie Sales per Scout</h2></div></div>
              <div className="reportTable scoutSalesReportTable">
                <div className="reportTableHead"><span>Scout</span><span>Age level</span><span>Credited boxes</span><span>Reconciled booths</span></div>
                {report.scoutSales.map((scout) => <details className="scoutSalesRow" key={scout.scoutId}>
                  <summary><strong className="scoutSalesCell" aria-label={`Scout: ${scout.scoutName}${scout.archived ? ", archived" : ""}`}>{scout.scoutName}{scout.archived ? " (archived)" : ""}</strong><span className="scoutSalesCell" aria-label={`Age level: ${scout.ageLevel}`}>{scout.ageLevel}</span><span className="scoutSalesCell scoutSalesNumeric" aria-label={`Credited boxes: ${boxes(scout.creditedBoxes)}`}>{boxes(scout.creditedBoxes)}</span><span className="scoutSalesCell scoutSalesNumeric" aria-label={`Reconciled booths: ${scout.reconciledBooths}`}>{scout.reconciledBooths}</span></summary>
                  {scout.booths.map((booth) => <div className="scoutSalesBreakdown" key={booth.boothId}><strong>{booth.boothName}</strong><span className="scoutSalesNumeric">{boxes(booth.creditedBoxes)} boxes</span><span>{booth.products.map((product) => `${product.productName}: ${boxes(product.creditedBoxes)}`).join(" · ")}</span></div>)}
                </details>)}
                {!report.scoutSales.length && <p className="loadingState">No finalized scout credit is available for this report scope.</p>}
              </div>
            </section>
          )}
          <p className="reportGenerated">Generated {new Date(report.generatedAt).toLocaleString()}</p>
        </>
      )}
    </main>
  );
}

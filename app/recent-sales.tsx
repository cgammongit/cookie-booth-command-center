"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { throwApiResponseError } from "../lib/client-rate-limit";
import { useActivePolling } from "./use-active-polling";

type RecentSale = {
  id: string;
  paymentMethod: "cash" | "credit_card" | "venmo_paypal";
  boxCount: number;
  totalAmount: number;
  createdAt: string;
  operatorName: string;
  items: Array<{ productId: number; name: string; quantity: number; amount: number }>;
};

const reasonOptions = [
  ["wrong_cookies", "Wrong cookies"],
  ["wrong_quantity", "Wrong quantity"],
  ["wrong_payment_method", "Wrong payment method"],
  ["duplicate_sale", "Duplicate sale"],
  ["other", "Other"],
] as const;

const paymentLabels = {
  cash: "Cash",
  credit_card: "Credit Card",
  venmo_paypal: "Venmo/PayPal",
};

export function RecentSales({
  boothId,
  boothClosed,
  liveSyncConnected,
  refreshToken,
  onReversed,
}: {
  boothId: number;
  boothClosed: boolean;
  liveSyncConnected: boolean;
  refreshToken: number;
  onReversed(): Promise<void>;
}) {
  const [sales, setSales] = useState<RecentSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [canReverse, setCanReverse] = useState(false);
  const [selected, setSelected] = useState<RecentSale | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [reasonDetail, setReasonDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const generation = useRef(0);
  const undoTrigger = useRef<HTMLButtonElement | null>(null);
  const dialogHeading = useRef<HTMLHeadingElement | null>(null);

  const closeDialog = useCallback(() => {
    if (submitting) return;
    setSelected(null);
    window.setTimeout(() => undoTrigger.current?.focus(), 0);
  }, [submitting]);

  const load = useCallback(async (signal: AbortSignal) => {
    const requestGeneration = ++generation.current;
    try {
      const response = await fetch(`/api/booths/${boothId}/sales`, { cache: "no-store", signal });
      const payload = await response.json() as {
        sales?: RecentSale[]; permissions?: { canReverseSales?: boolean }; error?: string;
      };
      if (signal.aborted || requestGeneration !== generation.current) return;
      if (!response.ok) throwApiResponseError(response, payload, "Unable to load recent sales", `booth-sales:${boothId}`);
      setSales(payload.sales || []);
      setCanReverse(Boolean(payload.permissions?.canReverseSales));
      setError("");
    } catch (reason) {
      if (signal.aborted || requestGeneration !== generation.current) return;
      setError(reason instanceof Error ? reason.message : "Unable to load recent sales");
    } finally {
      if (!signal.aborted && requestGeneration === generation.current) setLoading(false);
    }
  }, [boothId]);

  const refresh = useActivePolling(load, {
    enabled: !liveSyncConnected,
    startImmediately: false,
  });
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(timer); generation.current += 1; controller.abort("booth-view-ended"); };
  }, [boothId, load]);
  useEffect(() => {
    if (!refreshToken) return;
    const timer = window.setTimeout(() => void refresh(true), 0);
    return () => window.clearTimeout(timer);
  }, [refresh, refreshToken]);
  useEffect(() => {
    if (!selected) return;
    dialogHeading.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        closeDialog();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [closeDialog, selected, submitting]);

  async function reverseSale() {
    if (!selected || !reasonCode || (reasonCode === "other" && reasonDetail.trim().length < 3)) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/booths/${boothId}/sales/${selected.id}/reversal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reasonCode, reasonDetail: reasonCode === "other" ? reasonDetail : undefined }),
      });
      const payload = await response.json() as { reversal?: { id: string }; error?: string };
      if (!response.ok || !payload.reversal) {
        throwApiResponseError(response, payload, "Unable to undo sale", `sale-reversal:${boothId}`);
      }
      setSelected(null);
      setReasonCode("");
      setReasonDetail("");
      await Promise.all([refresh(true), onReversed()]);
      undoTrigger.current?.focus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to undo sale");
      await refresh(true);
    } finally {
      setSubmitting(false);
    }
  }

  return <>
    <section className="peoplePanel recentSalesPanel" aria-labelledby="recent-sales-title">
      <div className="panelHeading">
        <div><p className="eyebrow">BOOTH ACTIVITY</p><h2 id="recent-sales-title">Recent Sales</h2></div>
        {boothClosed && <span className="permissionNote">Read only · booth closed</span>}
      </div>
      {error && <div className="alert errorAlert" role="alert">{error} <button onClick={() => void refresh(true)}>Retry</button></div>}
      {loading ? <p className="loadingState">Loading recent sales…</p> : sales.length ? <div className="recentSalesList">
        {sales.map((sale) => <article key={sale.id}>
          <div className="recentSaleSummary">
            <strong>{sale.boxCount} box{sale.boxCount === 1 ? "" : "es"} · ${Number(sale.totalAmount).toFixed(2)}</strong>
            <small>{new Date(sale.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {paymentLabels[sale.paymentMethod]} · {sale.operatorName}</small>
          </div>
          <ul>{sale.items.map((item) => <li key={item.productId}>{item.quantity} × {item.name}</li>)}</ul>
          {canReverse && !boothClosed && <button className="dangerButton" ref={(node) => { if (selected?.id === sale.id || !undoTrigger.current) undoTrigger.current = node; }} onClick={() => { setSelected(sale); setReasonCode(""); setReasonDetail(""); }}>Undo Sale</button>}
        </article>)}
      </div> : <div className="loadingState"><strong>No sales have been entered</strong><p>New booth sales will appear here.</p></div>}
    </section>
    {selected && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
      <section className="saleDialog reversalDialog" role="dialog" aria-modal="true" aria-labelledby="undo-sale-title">
        <div className="saleDialogHeader"><div><p className="eyebrow">AUDITABLE REVERSAL</p><h2 id="undo-sale-title" ref={dialogHeading} tabIndex={-1}>Undo this sale?</h2></div><button className="iconButton" aria-label="Close undo sale" disabled={submitting} onClick={closeDialog}>×</button></div>
        <div className="saleSummary">
          {selected.items.map((item) => <div key={item.productId}><span>{item.quantity} × {item.name}</span><strong>${Number(item.amount).toFixed(2)}</strong></div>)}
          <div className="saleSummaryTotal"><span>{selected.boxCount} boxes · {paymentLabels[selected.paymentMethod]}</span><strong>${Number(selected.totalAmount).toFixed(2)}</strong></div>
          <p className="reversalWarning">This restores its cookies to booth inventory and removes its payment and scout-credit totals. The original sale remains preserved as reversed.</p>
          {error && <p className="alert errorAlert" role="alert">{error}</p>}
          <label className="reversalReason">Reason<select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}><option value="">Select a reason</option>{reasonOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {reasonCode === "other" && <label className="reversalReason">Explanation<textarea maxLength={200} required value={reasonDetail} onChange={(event) => setReasonDetail(event.target.value)} /></label>}
        </div>
        <div className="saleDialogFooter"><button disabled={submitting} onClick={closeDialog}>Cancel</button><button className="dangerButton" aria-live="polite" disabled={submitting || !reasonCode || (reasonCode === "other" && reasonDetail.trim().length < 3)} onClick={() => void reverseSale()}>{submitting ? "Undoing sale…" : "Undo Sale"}</button></div>
      </section>
    </div>}
  </>;
}

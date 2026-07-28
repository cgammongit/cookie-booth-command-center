"use client";

import { useCallback, useMemo, useState } from "react";
import { useActivePolling } from "./use-active-polling";

type Balance = {
  productId: number;
  name: string;
  barcode: string;
  active: number;
  totalRemaining: number;
  available: number;
  atBooths: number;
  boothBreakdown: {
    boothId: number;
    boothName: string;
    quantity: number;
  }[];
  removed: number;
};

type Movement = {
  id: number;
  productName: string;
  boothName: string | null;
  type: string;
  totalDelta: number;
  availableDelta: number;
  boothDelta: number;
  reason: string | null;
  reference: string | null;
  createdAt: string;
  actorName: string | null;
};

const labels: Record<string, string> = {
  initial_order: "Initial season order",
  replenishment: "Midseason replenishment",
  trade_in: "Trade received",
  trade_out: "Trade given",
  council_return: "Returned to council",
  damage: "Damaged",
  loss: "Missing/lost",
  correction_in: "Correction — add",
  correction_out: "Correction — remove",
  booth_allocation: "Allocated to booth",
  booth_return: "Returned from booth",
  legacy_migration: "Existing booth stock migrated",
};

export function TroopInventory({
  organizationId,
  organizationName,
  onBack,
}: {
  organizationId: number;
  organizationName: string;
  onBack: () => void;
}) {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [syncWarning, setSyncWarning] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState({
    productId: "",
    type: "initial_order",
    quantity: "",
    reference: "",
    reason: "",
  });

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch(
        `/api/admin/troop-inventory?organizationId=${organizationId}`,
        { cache: "no-store", signal },
      );
      const payload = await response.json() as {
        balances?: Balance[];
        movements?: Movement[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Unable to load troop inventory");
      setBalances(payload.balances || []);
      setMovements(payload.movements || []);
      setSyncWarning("");
    } catch (loadError) {
      if (signal.aborted) return;
      setSyncWarning(
        loadError instanceof Error
          ? `Live synchronization paused: ${loadError.message}`
          : "Live synchronization is temporarily unavailable.",
      );
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [organizationId]);

  const refresh = useActivePolling(load);

  const totals = useMemo(() => balances.reduce((sum, item) => ({
    total: sum.total + Number(item.totalRemaining),
    available: sum.available + Number(item.available),
    booths: sum.booths + Number(item.atBooths),
    removed: sum.removed + Number(item.removed),
  }), { total: 0, available: 0, booths: 0, removed: 0 }), [balances]);

  async function recordMovement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/troop-inventory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          productId: Number(draft.productId),
          type: draft.type,
          quantity: Number(draft.quantity),
          reference: draft.reference,
          reason: draft.reason,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to record stock movement");
      setDraft((current) => ({ ...current, quantity: "", reference: "", reason: "" }));
      setNotice("Stock movement recorded in the troop inventory ledger.");
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to record stock movement");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main>
      <header>
        <button className="back" onClick={onBack}>← Command center</button>
        <div className="brand">COOKIE BOOTH <b>COMMAND CENTER</b></div>
        <span className="roleBadge">ADMIN</span>
      </header>
      <section className="peopleHero">
        <div>
          <p className="eyebrow">TROOP STOCK · {organizationName}</p>
          <h1>Troop inventory</h1>
          <p>Receive, allocate, and account for every box owned by the troop.</p>
        </div>
        <div className="peopleSummary"><strong>{totals.total}</strong><span>boxes remaining</span></div>
      </section>
      {error && <div className="alert errorAlert" role="alert">{error}</div>}
      {syncWarning && <div className="alert policyAlert" role="status">{syncWarning} Showing the last successfully synchronized data.</div>}
      {notice && <div className="alert successAlert" role="status">{notice}</div>}
      <section className="stats">
        <article><span>Total remaining</span><strong>{totals.total}</strong><small>owned by troop</small></article>
        <article><span>Available</span><strong>{totals.available}</strong><small>ready to allocate</small></article>
        <article><span>At all booths</span><strong>{totals.booths}</strong><small>currently allocated</small></article>
        <article><span>Removed</span><strong>{totals.removed}</strong><small>trades, returns, loss</small></article>
      </section>
      <section className="peoplePanel troopStockPanel">
        <div className="panelHeading">
          <div><p className="eyebrow">AUDITED STOCK ACTION</p><h2>Record inventory movement</h2></div>
        </div>
        <form className="stockMovementForm" onSubmit={(event) => void recordMovement(event)}>
          <label>Product<select required value={draft.productId} onChange={(event) => setDraft({ ...draft, productId: event.target.value })}><option value="">Select product</option>{balances.filter((item) => Boolean(item.active)).map((item) => <option key={item.productId} value={item.productId}>{item.name}</option>)}</select></label>
          <label>Action<select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}>{Object.entries(labels).filter(([key]) => !["booth_allocation", "booth_return", "legacy_migration"].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Boxes<input required min="1" max="100000" type="number" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /></label>
          <label>Order/reference<input maxLength={120} value={draft.reference} onChange={(event) => setDraft({ ...draft, reference: event.target.value })} /></label>
          <label className="stockReason">Reason/notes<textarea maxLength={500} value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /></label>
          <button className="primary" disabled={saving}>{saving ? "Recording…" : "Record movement"}</button>
        </form>
      </section>
      <section className="peoplePanel">
        <div className="panelHeading"><div><p className="eyebrow">CURRENT BALANCES</p><h2>Inventory by product</h2></div></div>
        <div className="stockTable">
          <div className="stockTableHead"><span>Product</span><span>Total</span><span>Available</span><span>At all booths</span><span>Removed</span></div>
          {balances.map((item) => (
            <div key={item.productId} className={item.active ? "" : "inactive"}>
              <span><strong>{item.name}</strong><small>{item.barcode}</small></span>
              <b>{item.totalRemaining}</b>
              <b>{item.available}</b>
              <details className="boothAllocationBreakdown">
                <summary aria-label={`${item.name}: ${item.atBooths} boxes at all booths`}>
                  {item.atBooths}
                </summary>
                {item.boothBreakdown.length ? (
                  <dl>
                    {item.boothBreakdown.map((booth) => (
                      <div key={booth.boothId}>
                        <dt>{booth.boothName}</dt>
                        <dd>{booth.quantity}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <small>No inventory at active booths</small>
                )}
              </details>
              <b>{item.removed}</b>
            </div>
          ))}
          {!loading && !balances.length && <div className="loadingState">Add products before receiving troop inventory.</div>}
        </div>
      </section>
      <section className="peoplePanel">
        <div className="panelHeading"><div><p className="eyebrow">IMMUTABLE HISTORY</p><h2>Recent stock movements</h2></div></div>
        <div className="ledgerList">
          {movements.map((movement) => <article key={movement.id}><div><strong>{movement.productName}</strong><small>{labels[movement.type] || movement.type}{movement.boothName ? ` · ${movement.boothName}` : ""}</small></div><b className={Number(movement.totalDelta) < 0 ? "negative" : ""}>{Number(movement.totalDelta) > 0 ? "+" : ""}{movement.totalDelta}</b><div><span>{movement.reference || movement.reason || "No reference"}</span><small>{new Date(movement.createdAt).toLocaleString()} · {movement.actorName || "System migration"}</small></div></article>)}
        </div>
      </section>
      <aside><b>Inventory rule</b><span>Booth allocations move available stock; they do not change troop-owned totals. Only sales and documented removals reduce total remaining stock.</span></aside>
    </main>
  );
}

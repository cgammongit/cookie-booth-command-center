"use client";

import { UserButton } from "@clerk/nextjs";
import { useCallback, useMemo, useState } from "react";
import { ArchivedBooths } from "./archived-booths";
import { BoothManagement } from "./booth-management";
import { GooglePlaceField, type SelectedPlace } from "./google-place-field";
import { InventoryManagement } from "./inventory-management";
import { PeopleRoles } from "./people-roles";
import { TroopInventory } from "./troop-inventory";
import { useActivePolling } from "./use-active-polling";
import type { BoothLifecycleStatus } from "../lib/booth-status";

type Booth = {
  id: number;
  name: string;
  address: string;
  locationName: string | null;
  googlePlaceId: string | null;
  latitude: number | null;
  longitude: number | null;
  startsAt: string;
  endsAt: string;
  status: BoothLifecycleStatus;
  lead: string | null;
  boxes: number;
  revenue: number;
  low: number;
};

type BoothPermissions = {
  canCreateBooths: boolean;
  canViewReports: boolean;
  assignmentRequired: boolean;
};

type BoothResponse = {
  booths: Booth[];
  permissions: BoothPermissions;
  error?: string;
};

type BoothInventoryItem = {
  productId: number;
  name: string;
  barcode: string;
  price: number;
  opening: number;
  sold: number;
  adjusted: number;
  remaining: number;
};

type PaymentTotals = {
  cash: number;
  creditCard: number;
  venmoPaypal: number;
  gross: number;
};

type SaleStep = "items" | "payment" | null;
type ReconciliationState = {
  finalCounts: Record<number, number>;
  cashTurnedIn: string;
  notes: string;
};

function formatWindow(booth: Booth) {
  const start = new Date(booth.startsAt);
  const end = new Date(booth.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${booth.startsAt}–${booth.endsAt}`;
  }
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(start);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${time.format(start)}–${time.format(end)}`;
}

function toLocalDateTimeInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function Dashboard({
  displayName,
  role,
  canInviteUsers,
  organizationId,
  organizationName,
  googleMapsApiKey,
}: {
  displayName: string;
  role: string;
  canInviteUsers: boolean;
  organizationId: number;
  organizationName: string;
  googleMapsApiKey: string;
}) {
  const [booths, setBooths] = useState<Booth[]>([]);
  const [permissions, setPermissions] = useState<BoothPermissions>({
    canCreateBooths: false,
    canViewReports: false,
    assignmentRequired: false,
  });
  const [selected, setSelected] = useState<Booth | null>(null);
  const [selectedInventory, setSelectedInventory] = useState<BoothInventoryItem[]>([]);
  const [paymentTotals, setPaymentTotals] = useState<PaymentTotals>({
    cash: 0,
    creditCard: 0,
    venmoPaypal: 0,
    gross: 0,
  });
  const [saleStep, setSaleStep] = useState<SaleStep>(null);
  const [saleQuantities, setSaleQuantities] = useState<Record<number, number>>({});
  const [saleSubmitting, setSaleSubmitting] = useState(false);
  const [reconciliation, setReconciliation] = useState<ReconciliationState | null>(null);
  const [reconciliationSubmitting, setReconciliationSubmitting] = useState(false);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryBoothId, setInventoryBoothId] = useState<number | null>(null);
  const [view, setView] = useState<
    "dashboard" | "people" | "booths" | "archives" | "inventory" | "troopInventory"
  >("dashboard");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [boothSyncWarning, setBoothSyncWarning] = useState("");
  const [detailSyncWarning, setDetailSyncWarning] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const now = useMemo(() => new Date(), []);
  const [boothDraft, setBoothDraft] = useState({
    name: "",
    address: "",
    locationName: "",
    googlePlaceId: "",
    latitude: null as number | null,
    longitude: null as number | null,
    startsAt: toLocalDateTimeInput(new Date(now.getTime() + 86_400_000)),
    endsAt: toLocalDateTimeInput(new Date(now.getTime() + 90_000_000)),
  });

  const loadBooths = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch(`/api/booths?organizationId=${organizationId}`, {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json()) as BoothResponse;
      if (!response.ok) throw new Error(payload.error || "Unable to load booths");
      setBooths(payload.booths);
      setSelected((current) => {
        if (!current) return current;
        return payload.booths.find((booth) => booth.id === current.id) || current;
      });
      setPermissions(payload.permissions);
      setBoothSyncWarning("");
    } catch (loadError) {
      if (signal.aborted) return;
      setBoothSyncWarning(
        loadError instanceof Error
          ? `Live synchronization paused: ${loadError.message}`
          : "Live synchronization is temporarily unavailable.",
      );
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [organizationId]);

  const refreshBooths = useActivePolling(loadBooths, {
    enabled: view === "dashboard",
  });

  const totals = useMemo(() => ({
    active: booths.filter((booth) => booth.status === "live").length,
    boxes: booths.reduce((total, booth) => total + Number(booth.boxes), 0),
    revenue: booths.reduce((total, booth) => total + Number(booth.revenue), 0),
    alerts: booths.reduce((total, booth) => total + Number(booth.low), 0),
  }), [booths]);
  const firstName = displayName.split(" ")[0] || "there";
  const mayOpenAccessCenter = role === "admin" || (role === "lead" && canInviteUsers);
  const canOperate = role !== "auditor";
  const canReconcile = role === "admin" || role === "lead";
  const salesOpen = selected
    ? selected.status === "live" || selected.status === "pending_closure"
    : false;
  const handlePlaceSelected = useCallback((place: SelectedPlace) => {
    setBoothDraft((current) => ({ ...current, ...place }));
  }, []);

  const selectedBoothId = selected?.id;
  const loadSelectedBooth = useCallback(async (signal: AbortSignal) => {
    if (!selectedBoothId) return;
    try {
      const response = await fetch(`/api/booths/${selectedBoothId}`, {
        cache: "no-store",
        signal,
      });
      const payload = await response.json() as {
        booth?: Partial<Booth> & { id: number };
        inventory?: BoothInventoryItem[];
        paymentTotals?: PaymentTotals;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Unable to load booth inventory");
      if (payload.booth) {
        setSelected((current) => current?.id === payload.booth?.id
          ? { ...current, ...payload.booth } as Booth
          : current);
      }
      setSelectedInventory(payload.inventory || []);
      setPaymentTotals(payload.paymentTotals || {
        cash: 0,
        creditCard: 0,
        venmoPaypal: 0,
        gross: 0,
      });
      setInventoryLoading(false);
      setDetailSyncWarning("");
    } catch (loadError) {
      if (signal.aborted) return;
      setInventoryLoading(false);
      setDetailSyncWarning(
        loadError instanceof Error
          ? `Live synchronization paused: ${loadError.message}`
          : "Live synchronization is temporarily unavailable.",
      );
    }
  }, [selectedBoothId]);

  const refreshSelectedBooth = useActivePolling(loadSelectedBooth, {
    enabled: view === "dashboard" && Boolean(selectedBoothId),
  });
  const syncWarning = detailSyncWarning || boothSyncWarning;

  const saleItems = useMemo(() => selectedInventory
    .map((product) => ({
      ...product,
      quantity: saleQuantities[product.productId] || 0,
    }))
    .filter((product) => product.quantity > 0), [saleQuantities, selectedInventory]);
  const saleBoxCount = saleItems.reduce((sum, item) => sum + item.quantity, 0);
  const saleTotal = saleItems.reduce((sum, item) => sum + item.quantity * Number(item.price), 0);
  const reconciliationExpectedBoxes = selectedInventory.reduce(
    (sum, item) => sum + Number(item.remaining),
    0,
  );
  const reconciliationActualBoxes = selectedInventory.reduce(
    (sum, item) => sum + (reconciliation?.finalCounts[item.productId] ?? Number(item.remaining)),
    0,
  );
  const inventoryDiscrepancy = reconciliationActualBoxes - reconciliationExpectedBoxes;
  const cashTurnedIn = Number(reconciliation?.cashTurnedIn || 0);
  const cashDiscrepancy = Math.round((cashTurnedIn - Number(paymentTotals.cash)) * 100) / 100;

  function openSale() {
    setSaleQuantities({});
    setError("");
    setSaleStep("items");
  }

  function changeSaleQuantity(product: BoothInventoryItem, delta: number) {
    setSaleQuantities((current) => {
      const next = Math.max(
        0,
        Math.min(Number(product.remaining), (current[product.productId] || 0) + delta),
      );
      return { ...current, [product.productId]: next };
    });
  }

  async function finishSale(paymentMethod: "cash" | "credit_card" | "venmo_paypal") {
    if (!selected || !saleItems.length) return;
    setSaleSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/booths/${selected.id}/sales`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          paymentMethod,
          items: saleItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        }),
      });
      const payload = await response.json() as {
        sale?: { boxCount: number; totalAmount: number };
        error?: string;
      };
      if (!response.ok || !payload.sale) {
        throw new Error(payload.error || "Unable to finish sale");
      }
      setSelectedInventory((current) => current.map((product) => {
        const sold = saleQuantities[product.productId] || 0;
        return sold
          ? { ...product, sold: Number(product.sold) + sold, remaining: Number(product.remaining) - sold }
          : product;
      }));
      setPaymentTotals((current) => ({
        ...current,
        cash: current.cash + (paymentMethod === "cash" ? payload.sale!.totalAmount : 0),
        creditCard: current.creditCard + (paymentMethod === "credit_card" ? payload.sale!.totalAmount : 0),
        venmoPaypal: current.venmoPaypal + (paymentMethod === "venmo_paypal" ? payload.sale!.totalAmount : 0),
        gross: current.gross + payload.sale!.totalAmount,
      }));
      setSelected((current) => current ? {
        ...current,
        boxes: Number(current.boxes) + payload.sale!.boxCount,
        revenue: Number(current.revenue) + payload.sale!.totalAmount,
      } : current);
      setSaleStep(null);
      setSaleQuantities({});
      void Promise.all([refreshBooths(), refreshSelectedBooth()]);
    } catch (saleError) {
      setError(saleError instanceof Error ? saleError.message : "Unable to finish sale");
    } finally {
      setSaleSubmitting(false);
    }
  }

  function openReconciliation() {
    setError("");
    setReconciliation({
      finalCounts: Object.fromEntries(
        selectedInventory.map((item) => [item.productId, Number(item.remaining)]),
      ),
      cashTurnedIn: Number(paymentTotals.cash).toFixed(2),
      notes: "",
    });
  }

  async function closeBooth() {
    if (!selected || !reconciliation) return;
    setReconciliationSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/booths/${selected.id}/reconciliation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cashTurnedIn: Number(reconciliation.cashTurnedIn),
          finalCounts: selectedInventory.map((item) => ({
            productId: item.productId,
            quantity: reconciliation.finalCounts[item.productId] ?? Number(item.remaining),
          })),
          notes: reconciliation.notes,
        }),
      });
      const payload = await response.json() as {
        reconciliation?: { id: number };
        error?: string;
      };
      if (!response.ok || !payload.reconciliation) {
        throw new Error(payload.error || "Unable to close and reconcile booth");
      }
      setReconciliation(null);
      setSelected(null);
      setSelectedInventory([]);
      await refreshBooths();
    } catch (reconciliationError) {
      setError(
        reconciliationError instanceof Error
          ? reconciliationError.message
          : "Unable to close and reconcile booth",
      );
    } finally {
      setReconciliationSubmitting(false);
    }
  }

  async function createBooth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/booths", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          name: boothDraft.name,
          address: boothDraft.address,
          locationName: boothDraft.locationName || null,
          googlePlaceId: boothDraft.googlePlaceId || null,
          latitude: boothDraft.latitude,
          longitude: boothDraft.longitude,
          startsAt: new Date(boothDraft.startsAt).toISOString(),
          endsAt: new Date(boothDraft.endsAt).toISOString(),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to create booth");
      setShowCreate(false);
      setBoothDraft((current) => ({
        ...current,
        name: "",
        address: "",
        locationName: "",
        googlePlaceId: "",
        latitude: null,
        longitude: null,
      }));
      await refreshBooths();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create booth");
    } finally {
      setCreating(false);
    }
  }

  if (view === "people" && mayOpenAccessCenter) {
    return (
      <PeopleRoles
        organizationId={organizationId}
        organizationName={organizationName}
        canManagePeople={role === "admin"}
        onBack={() => {
          setView("dashboard");
          void refreshBooths();
        }}
      />
    );
  }

  if (view === "booths" && role === "admin") {
    return (
      <BoothManagement
        organizationId={organizationId}
        organizationName={organizationName}
        onBack={() => {
          setInventoryBoothId(null);
          setView("dashboard");
          setShowCreate(false);
          void refreshBooths();
        }}
        onCreate={() => {
          setView("dashboard");
          setShowCreate(true);
        }}
      />
    );
  }

  if (view === "archives" && role === "admin") {
    return (
      <ArchivedBooths
        organizationId={organizationId}
        organizationName={organizationName}
        onBack={() => {
          setView("dashboard");
          void refreshBooths();
        }}
      />
    );
  }

  if (view === "inventory" && role === "admin") {
    return (
      <InventoryManagement
        organizationId={organizationId}
        organizationName={organizationName}
        initialBoothId={inventoryBoothId}
        onBack={() => {
          setView("dashboard");
          void refreshBooths();
        }}
      />
    );
  }

  if (view === "troopInventory" && role === "admin") {
    return (
      <TroopInventory
        organizationId={organizationId}
        organizationName={organizationName}
        onBack={() => {
          setView("dashboard");
          void refreshBooths();
        }}
      />
    );
  }

  if (selected) return (
    <main>
      <header>
        <button className="back" onClick={() => {
          setSelected(null);
          setSelectedInventory([]);
        }}>← All booths</button>
        <div className="brand">COOKIE BOOTH <b>COMMAND CENTER</b></div>
        <UserButton />
      </header>
      <section className="boothHero">
        <div>
          <p className="eyebrow">{selected.status.toUpperCase()} BOOTH · {formatWindow(selected)}</p>
          <h1>{selected.name}</h1>
          <p>
            {selected.locationName || selected.address} · Lead: {selected.lead || "Not assigned"}
          </p>
        </div>
        <div className={salesOpen ? "live" : "permissionNote"}>
          {selected.status === "live"
            ? "● Live and syncing"
            : selected.status === "pending_closure"
              ? "Pending Closure"
              : selected.status}
        </div>
      </section>
      {syncWarning && <div className="alert policyAlert" role="status">{syncWarning} Showing the last successfully synchronized data.</div>}
      <div className="boothLocationActions">
        <div>
          <strong>{selected.address}</strong>
          {selected.googlePlaceId && <small>Verified Google location</small>}
        </div>
        <a
          className="directionsButton"
          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selected.address)}${selected.googlePlaceId ? `&destination_place_id=${encodeURIComponent(selected.googlePlaceId)}` : ""}`}
          target="_blank"
          rel="noreferrer"
        >
          Get GPS directions ↗
        </a>
      </div>
      {canOperate && salesOpen ? (
        <section className="scan">
          <div className="saleLaunch">
            <div><label>BOOTH SALES</label><small>Select products, quantities, and the customer&apos;s payment method.</small></div>
            <button className="primary" onClick={openSale}>＋ New Sale</button>
          </div>
        </section>
      ) : (
        <div className="alert policyAlert">
          {role === "auditor"
            ? "Read-only audit access: booth operations are disabled."
            : "Sales can be recorded only while this booth is live or pending closure."}
        </div>
      )}
      <section className="stats">
        <article><span>Boxes sold</span><strong>{selected.boxes}</strong></article>
        <article><span>Gross sales</span><strong>${Number(paymentTotals.gross).toLocaleString()}</strong></article>
        <article><span>Low inventory</span><strong>{selected.low}</strong></article>
        <article><span>Access mode</span><strong className="accessMode">{role === "auditor" ? "Read" : "Operate"}</strong></article>
      </section>
      <section className="paymentStats" aria-label="Sales by payment method">
        <article><span>Cash to turn in</span><strong>${Number(paymentTotals.cash).toFixed(2)}</strong></article>
        <article><span>Credit card</span><strong>${Number(paymentTotals.creditCard).toFixed(2)}</strong></article>
        <article><span>Venmo / PayPal</span><strong>${Number(paymentTotals.venmoPaypal).toFixed(2)}</strong></article>
      </section>
      <div className="sectionHead">
        <div><p className="eyebrow">BOOTH INVENTORY</p><h2>Live counts</h2></div>
        <div className="sectionActions">
          {role === "admin" && (
            <button onClick={() => {
              setInventoryBoothId(selected.id);
              setSelected(null);
              setView("inventory");
            }}>Manage booth products</button>
          )}
          {canReconcile && selected.status === "pending_closure" && (
            <button onClick={openReconciliation}>Close & reconcile booth</button>
          )}
        </div>
      </div>
      <section className="inventory">
        {selectedInventory.map((item, index) => (
          <article className={Number(item.remaining) <= 8 ? "warning" : ""} key={item.productId}>
            <i className={`chip c${index % 5}`}>{item.name.slice(0, 2).toUpperCase()}</i>
            <div><h3>{item.name}</h3><small>{item.opening} opening · {item.sold} sold · {item.adjusted} adjusted</small></div>
            <strong>{item.remaining}<small> left</small></strong>
          </article>
        ))}
        {!inventoryLoading && !selectedInventory.length && (
          <div className="emptyBooths">
            <h3>No products allocated</h3>
            <p>An administrator can configure opening counts under Products & inventory.</p>
          </div>
        )}
        {inventoryLoading && <div className="loadingState">Loading live inventory…</div>}
      </section>
      {saleStep && (
        <div className="modalBackdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saleSubmitting) setSaleStep(null);
        }}>
          <section className="saleDialog" role="dialog" aria-modal="true" aria-labelledby="sale-title">
            <div className="saleDialogHeader">
              <div>
                <p className="eyebrow">{saleStep === "items" ? "NEW TRANSACTION" : "CONFIRM TRANSACTION"}</p>
                <h2 id="sale-title">{saleStep === "items" ? "New Sale" : "Finish Sale"}</h2>
              </div>
              <button className="iconButton" aria-label="Close sale" disabled={saleSubmitting} onClick={() => setSaleStep(null)}>×</button>
            </div>
            {saleStep === "items" ? (
              <>
                <div className="saleProductList">
                  {selectedInventory.filter((product) => Number(product.remaining) > 0).map((product) => (
                    <article key={product.productId}>
                      <div><strong>{product.name}</strong><small>${Number(product.price).toFixed(2)} · {product.remaining} available</small></div>
                      <div className="quantityPicker">
                        <button aria-label={`Remove one ${product.name}`} disabled={!saleQuantities[product.productId]} onClick={() => changeSaleQuantity(product, -1)}>−</button>
                        <output aria-live="polite">{saleQuantities[product.productId] || 0}</output>
                        <button aria-label={`Add one ${product.name}`} disabled={(saleQuantities[product.productId] || 0) >= Number(product.remaining)} onClick={() => changeSaleQuantity(product, 1)}>＋</button>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="saleDialogFooter">
                  <div><span>{saleBoxCount} boxes</span><strong>${saleTotal.toFixed(2)}</strong></div>
                  <button className="primary" disabled={!saleBoxCount} onClick={() => setSaleStep("payment")}>Finish Sale</button>
                </div>
              </>
            ) : (
              <>
                <div className="saleSummary">
                  {saleItems.map((item) => (
                    <div key={item.productId}><span>{item.quantity} × {item.name}</span><strong>${(item.quantity * Number(item.price)).toFixed(2)}</strong></div>
                  ))}
                  <div className="saleSummaryTotal"><span>{saleBoxCount} boxes total</span><strong>${saleTotal.toFixed(2)}</strong></div>
                </div>
                <p className="paymentPrompt">How did the customer pay?</p>
                <div className="paymentButtons">
                  <button disabled={saleSubmitting} onClick={() => void finishSale("cash")}>Cash</button>
                  <button disabled={saleSubmitting} onClick={() => void finishSale("credit_card")}>Credit Card</button>
                  <button disabled={saleSubmitting} onClick={() => void finishSale("venmo_paypal")}>Venmo/PayPal</button>
                </div>
                <div className="saleDialogFooter">
                  <button disabled={saleSubmitting} onClick={() => setSaleStep("items")}>← Edit quantities</button>
                  {saleSubmitting && <span>Recording sale…</span>}
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {reconciliation && (
        <div className="modalBackdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !reconciliationSubmitting) {
            setReconciliation(null);
          }
        }}>
          <section
            className="saleDialog reconciliationDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reconciliation-title"
          >
            <div className="saleDialogHeader">
              <div>
                <p className="eyebrow">FINAL BOOTH HANDOFF</p>
                <h2 id="reconciliation-title">Close & reconcile booth</h2>
              </div>
              <button
                className="iconButton"
                aria-label="Close reconciliation"
                disabled={reconciliationSubmitting}
                onClick={() => setReconciliation(null)}
              >×</button>
            </div>
            <p className="reconciliationIntro">
              Count every unsold box still at the booth. These boxes return to
              troop inventory when the booth closes.
            </p>
            <div className="reconciliationCounts">
              {selectedInventory.map((product) => {
                const finalCount =
                  reconciliation.finalCounts[product.productId] ?? Number(product.remaining);
                const discrepancy = finalCount - Number(product.remaining);
                return (
                  <article key={product.productId}>
                    <div>
                      <strong>{product.name}</strong>
                      <small>
                        Expected {product.remaining}
                        {discrepancy !== 0
                          ? ` · ${discrepancy > 0 ? "+" : ""}${discrepancy} difference`
                          : " · matches"}
                      </small>
                    </div>
                    <label>
                      Final count
                      <input
                        type="number"
                        min="0"
                        max="10000"
                        inputMode="numeric"
                        value={finalCount}
                        onChange={(event) => {
                          const quantity = Math.max(
                            0,
                            Math.min(10000, Number(event.target.value) || 0),
                          );
                          setReconciliation((current) => current ? {
                            ...current,
                            finalCounts: {
                              ...current.finalCounts,
                              [product.productId]: quantity,
                            },
                          } : current);
                        }}
                      />
                    </label>
                  </article>
                );
              })}
            </div>
            <div className="reconciliationMoney">
              <article><span>Expected cash</span><strong>${Number(paymentTotals.cash).toFixed(2)}</strong></article>
              <label>
                Cash turned in
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.01"
                  inputMode="decimal"
                  value={reconciliation.cashTurnedIn}
                  onChange={(event) => setReconciliation((current) => current ? {
                    ...current,
                    cashTurnedIn: event.target.value,
                  } : current)}
                />
              </label>
              <article><span>Credit card</span><strong>${Number(paymentTotals.creditCard).toFixed(2)}</strong></article>
              <article><span>Venmo / PayPal</span><strong>${Number(paymentTotals.venmoPaypal).toFixed(2)}</strong></article>
            </div>
            <div className="reconciliationSummary">
              <div><span>Boxes returning</span><strong>{reconciliationActualBoxes}</strong></div>
              <div className={inventoryDiscrepancy ? "hasDiscrepancy" : ""}>
                <span>Inventory difference</span>
                <strong>{inventoryDiscrepancy > 0 ? "+" : ""}{inventoryDiscrepancy}</strong>
              </div>
              <div className={cashDiscrepancy ? "hasDiscrepancy" : ""}>
                <span>Cash difference</span>
                <strong>{cashDiscrepancy >= 0 ? "+" : "−"}${Math.abs(cashDiscrepancy).toFixed(2)}</strong>
              </div>
            </div>
            <label className="reconciliationNotes">
              Notes {inventoryDiscrepancy !== 0 || cashDiscrepancy !== 0 ? "(required)" : "(optional)"}
              <textarea
                maxLength={1000}
                rows={3}
                placeholder="Explain any cash or box-count difference."
                value={reconciliation.notes}
                onChange={(event) => setReconciliation((current) => current ? {
                  ...current,
                  notes: event.target.value,
                } : current)}
              />
            </label>
            <div className="saleDialogFooter reconciliationFooter">
              <div>
                <span>Gross sales</span>
                <strong>${Number(paymentTotals.gross).toFixed(2)}</strong>
              </div>
              <button
                className="primary"
                disabled={
                  reconciliationSubmitting ||
                  !Number.isFinite(cashTurnedIn) ||
                  cashTurnedIn < 0 ||
                  ((inventoryDiscrepancy !== 0 || cashDiscrepancy !== 0) &&
                    reconciliation.notes.trim().length < 5)
                }
                onClick={() => void closeBooth()}
              >
                {reconciliationSubmitting ? "Closing booth…" : "Close booth & return inventory"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );

  return (
    <main>
      <header>
        <div className="brand">COOKIE BOOTH <b>COMMAND CENTER</b></div>
        <nav>
          {permissions.canViewReports && <button>Reports</button>}
          {role === "admin" && (
            <>
              <button onClick={() => setView("booths")}>Booth management</button>
              <button onClick={() => {
                setInventoryBoothId(null);
                setView("inventory");
              }}>Products & inventory</button>
              <button onClick={() => setView("troopInventory")}>Troop inventory</button>
              <button onClick={() => setView("archives")}>Archived booths</button>
            </>
          )}
          {mayOpenAccessCenter && (
            <button onClick={() => setView("people")}>
              {role === "admin" ? "People & roles" : "Invitations"}
            </button>
          )}
          <span className="roleBadge">{role}</span>
          <UserButton />
        </nav>
      </header>
      <section className="welcome">
        <div>
          <p className="eyebrow">TROOP OPERATIONS · ADULT VOLUNTEERS ONLY</p>
          <h1>Good morning, {firstName}.</h1>
          <p>
            {booths.length
              ? `${totals.active} booth${totals.active === 1 ? " is" : "s are"} live within your authorized scope.`
              : "Your authorized booth directory is ready."}
          </p>
        </div>
        {permissions.canCreateBooths && (
          <button className="primary" onClick={() => setShowCreate((current) => !current)}>
            {showCreate ? "Cancel" : "＋ Create booth"}
          </button>
        )}
      </section>
      {error && <div className="alert errorAlert" role="alert">{error}</div>}
      {syncWarning && <div className="alert policyAlert" role="status">{syncWarning} Showing the last successfully synchronized data.</div>}
      {showCreate && permissions.canCreateBooths && (
        <section className="peoplePanel createBoothPanel">
          <div className="panelHeading">
            <div><p className="eyebrow">ADMINISTRATOR ACTION</p><h2>Schedule a booth</h2></div>
          </div>
          <form className="boothForm" onSubmit={(event) => void createBooth(event)}>
            <label>Name<input required maxLength={120} value={boothDraft.name} onChange={(event) => setBoothDraft({ ...boothDraft, name: event.target.value })} /></label>
            <label className="placeLabel">
              Location
              <GooglePlaceField
                apiKey={googleMapsApiKey}
                value={boothDraft.address}
                onManualChange={(address) =>
                  setBoothDraft((current) => ({
                    ...current,
                    address,
                    locationName: "",
                    googlePlaceId: "",
                    latitude: null,
                    longitude: null,
                  }))
                }
                onPlaceSelected={handlePlaceSelected}
              />
            </label>
            <label>Starts<input required type="datetime-local" value={boothDraft.startsAt} onChange={(event) => setBoothDraft({ ...boothDraft, startsAt: event.target.value })} /></label>
            <label>Ends<input required type="datetime-local" value={boothDraft.endsAt} onChange={(event) => setBoothDraft({ ...boothDraft, endsAt: event.target.value })} /></label>
            <button className="primary" disabled={creating}>{creating ? "Creating…" : "Create booth"}</button>
          </form>
        </section>
      )}
      <section className="stats">
        <article><span>Live booths</span><strong>{totals.active}</strong><small>within your scope</small></article>
        <article><span>Boxes sold</span><strong>{totals.boxes}</strong><small>authorized locations</small></article>
        <article><span>Gross sales</span><strong>${totals.revenue.toLocaleString()}</strong><small>before reconciliation</small></article>
        <article><span>Inventory alerts</span><strong>{totals.alerts}</strong><small>authorized booths</small></article>
      </section>
      <div className="toolbar">
        <div><p className="eyebrow">BOOTH DIRECTORY</p><h2>{role === "admin" || role === "auditor" ? "Organization booths" : "Your assigned booths"}</h2></div>
        <span className="permissionNote">Server-enforced access</span>
      </div>
      {loading ? (
        <div className="emptyBooths">Loading authorized booths…</div>
      ) : booths.length ? (
        <section className="booths">
          {booths.map((booth) => (
            <button className="booth" key={booth.id} onClick={() => {
              setSelectedInventory([]);
              setInventoryLoading(true);
              setSelected(booth);
            }}>
              <div><span className={`pill ${booth.status}`}>{booth.status}</span><h3>{booth.name}</h3><p>{booth.locationName || booth.address}</p><small>{formatWindow(booth)}</small></div>
              <dl><div><dt>Lead</dt><dd>{booth.lead || "Not assigned"}</dd></div><div><dt>Boxes</dt><dd>{booth.boxes}</dd></div><div><dt>Sales</dt><dd>${Number(booth.revenue).toLocaleString()}</dd></div></dl>
              <footer>{booth.status === "live" && canOperate ? "Open command center" : "View booth"} <b>→</b></footer>
            </button>
          ))}
        </section>
      ) : (
        <section className="emptyBooths">
          <h3>{permissions.assignmentRequired ? "No booths are assigned to you yet." : "No booths have been created yet."}</h3>
          <p>{permissions.assignmentRequired ? "Ask an administrator to assign your account to a booth." : "Create the first booth to begin scheduling and assigning adult operators."}</p>
        </section>
      )}
      <aside><b>Privacy boundary</b><span>This system tracks adult operators, booth inventory, and transactions. Scout identities and individual sale-credit allocation are intentionally out of scope.</span></aside>
    </main>
  );
}

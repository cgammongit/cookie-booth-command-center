"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ArchivedBooth = {
  id: number;
  name: string;
  address: string;
  locationName: string | null;
  startsAt: string;
  endsAt: string;
  status: "closed" | "draft" | "scheduled" | "live";
  archivedAt: string | null;
  archiveReason: string | null;
  archiveKind: "manual" | null;
  archivedBy: string | null;
  closedAt: string | null;
  cashTurnedIn: number | null;
  expectedCash: number | null;
  cashDiscrepancy: number | null;
  creditCardTotal: number | null;
  venmoPaypalTotal: number | null;
  returnedBoxCount: number | null;
  inventoryDiscrepancy: number | null;
  reconciliationNotes: string | null;
  boxes: number;
  revenue: number;
  transactionCount: number;
  reconciliationCount: number;
};

type AdminAlert = {
  id: number;
  boothId: number;
  boothName: string;
  status: "open" | "acknowledged" | "review" | "resolved";
  muted: number;
  resolutionNote: string | null;
  createdAt: string;
};

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}

export function ArchivedBooths({
  organizationId,
  organizationName,
  onBack,
}: {
  organizationId: number;
  organizationName: string;
  onBack: () => void;
}) {
  const [booths, setBooths] = useState<ArchivedBooth[]>([]);
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [query, setQuery] = useState("");
  const [showClosed, setShowClosed] = useState(true);
  const [showManual, setShowManual] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/archived-booths?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        booths?: ArchivedBooth[];
        alerts?: AdminAlert[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Unable to load archives");
      setBooths(payload.booths || []);
      setAlerts(payload.alerts || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load archives");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/admin/archived-booths?organizationId=${organizationId}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          booths?: ArchivedBooth[];
          alerts?: AdminAlert[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Unable to load archives");
        if (active) {
          setBooths(payload.booths || []);
          setAlerts(payload.alerts || []);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load archives");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [organizationId]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return booths.filter((booth) => {
      const manual = booth.archiveKind === "manual";
      if (manual && !showManual) return false;
      if (!manual && booth.status === "closed" && !showClosed) return false;
      return (
        !normalized ||
        booth.name.toLowerCase().includes(normalized) ||
        booth.address.toLowerCase().includes(normalized) ||
        booth.locationName?.toLowerCase().includes(normalized)
      );
    });
  }, [booths, query, showClosed, showManual]);

  async function updateAlert(
    alert: AdminAlert,
    action: "acknowledge" | "mute" | "unmute" | "review" | "resolve",
  ) {
    let note: string | undefined;
    if (action === "resolve") {
      note = window.prompt("Enter the resolution note:")?.trim();
      if (!note) return;
    }
    const key = `${alert.id}:${action}`;
    setSaving(key);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/alerts/${alert.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, action, note }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to update alert");
      setNotice(`Alert for ${alert.boothName} was updated.`);
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update alert");
    } finally {
      setSaving("");
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
          <p className="eyebrow">RETAINED OPERATIONS · {organizationName}</p>
          <h1>Archived booths</h1>
          <p>Review naturally closed booths, manual archives, and activity alerts.</p>
        </div>
        <div className="peopleSummary">
          <strong>{filtered.length}</strong><span>visible booths</span>
        </div>
      </section>
      {error && <div className="alert errorAlert" role="alert">{error}</div>}
      {notice && <div className="alert successAlert" role="status">{notice}</div>}

      <section className="peoplePanel archiveAlertsPanel">
        <div className="panelHeading">
          <div>
            <p className="eyebrow">ADMINISTRATOR ATTENTION</p>
            <h2>Archive activity alerts</h2>
          </div>
          <span className="permissionNote">
            {alerts.filter((alert) => alert.status !== "resolved" && !alert.muted).length} active
          </span>
        </div>
        {alerts.length ? (
          <div className="archiveAlertList">
            {alerts.map((alert) => (
              <article className={alert.status === "review" ? "review" : ""} key={alert.id}>
                <div>
                  <span className={`invitationStatus ${alert.status}`}>{alert.status}</span>
                  {Boolean(alert.muted) && <span className="mutedBadge">Muted</span>}
                  <h3>{alert.boothName}</h3>
                  <p>Manually archived after inventory or transaction activity.</p>
                  <small>{formatDate(alert.createdAt)}</small>
                  {alert.resolutionNote && <small>Resolution: {alert.resolutionNote}</small>}
                </div>
                <div className="archiveAlertActions">
                  {alert.status !== "acknowledged" && alert.status !== "resolved" && (
                    <button disabled={Boolean(saving)} onClick={() => void updateAlert(alert, "acknowledge")}>Acknowledge</button>
                  )}
                  {alert.status !== "resolved" && (
                    <button disabled={Boolean(saving)} onClick={() => void updateAlert(alert, "review")}>Flag for review</button>
                  )}
                  <button disabled={Boolean(saving)} onClick={() => void updateAlert(alert, alert.muted ? "unmute" : "mute")}>
                    {alert.muted ? "Unmute" : "Mute"}
                  </button>
                  {alert.status !== "resolved" && (
                    <button className="primary" disabled={Boolean(saving)} onClick={() => void updateAlert(alert, "resolve")}>Resolve</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="loadingState">No archive activity alerts.</div>
        )}
      </section>

      <section className="peoplePanel">
        <div className="panelHeading">
          <div><p className="eyebrow">HISTORY</p><h2>Booth archive</h2></div>
        </div>
        <div className="archiveFilters">
          <input
            type="search"
            value={query}
            placeholder="Search booth name, location, or address"
            onChange={(event) => setQuery(event.target.value)}
          />
          <label><input type="checkbox" checked={showClosed} onChange={(event) => setShowClosed(event.target.checked)} /> Naturally closed</label>
          <label><input type="checkbox" checked={showManual} onChange={(event) => setShowManual(event.target.checked)} /> Manually archived</label>
        </div>
        {loading ? (
          <div className="loadingState">Loading archived booths…</div>
        ) : filtered.length ? (
          <div className="archivedBoothList">
            {filtered.map((booth) => {
              const manual = booth.archiveKind === "manual";
              return (
                <article key={booth.id}>
                  <div>
                    <span className={`archiveType ${manual ? "manual" : "natural"}`}>
                      {manual ? "Manually archived" : "Closed normally"}
                    </span>
                    <h3>{booth.name}</h3>
                    <p>{booth.locationName || booth.address}</p>
                    <small>{booth.address}</small>
                  </div>
                  <dl>
                    <div><dt>Booth window</dt><dd>{formatDate(booth.startsAt)}</dd></div>
                    <div><dt>Boxes</dt><dd>{Number(booth.boxes)}</dd></div>
                    <div><dt>Sales</dt><dd>${Number(booth.revenue).toLocaleString()}</dd></div>
                    {!manual && booth.closedAt && (
                      <>
                        <div><dt>Cash turned in</dt><dd>${Number(booth.cashTurnedIn || 0).toFixed(2)}</dd></div>
                        <div><dt>Digital sales</dt><dd>${(Number(booth.creditCardTotal || 0) + Number(booth.venmoPaypalTotal || 0)).toFixed(2)}</dd></div>
                        <div><dt>Boxes returned</dt><dd>{Number(booth.returnedBoxCount || 0)}</dd></div>
                      </>
                    )}
                  </dl>
                  <footer>
                    <span>
                      {manual
                        ? `Archived ${formatDate(booth.archivedAt)} by ${booth.archivedBy || "an administrator"}`
                        : `Closed ${formatDate(booth.closedAt || booth.endsAt)}`}
                    </span>
                    {booth.archiveReason && <span>Reason: {booth.archiveReason}</span>}
                    {!manual && Number(booth.cashDiscrepancy || 0) !== 0 && (
                      <span>Cash difference: ${Number(booth.cashDiscrepancy).toFixed(2)}</span>
                    )}
                    {!manual && Number(booth.inventoryDiscrepancy || 0) !== 0 && (
                      <span>Inventory difference: {Number(booth.inventoryDiscrepancy)}</span>
                    )}
                    {booth.reconciliationNotes && <span>Reconciliation: {booth.reconciliationNotes}</span>}
                  </footer>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="loadingState">No archived booths match these filters.</div>
        )}
      </section>
      <aside><b>Retention boundary</b><span>Archiving removes booths from active operations without deleting inventory, transactions, assignments, reconciliation, or audit history.</span></aside>
    </main>
  );
}

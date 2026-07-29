"use client";

import { UserButton } from "@clerk/nextjs";
import { useCallback, useEffect, useMemo, useState } from "react";

type OrganizationSummary = {
  id: number;
  name: string;
  memberCount: number;
  productCount: number;
  boothCount: number;
  inventoryTransactionCount: number;
  salesCount: number;
  auditCount: number;
  latestActivityAt: string | null;
};

type AuditEvent = {
  id: number;
  actorDisplayName: string;
  action: string;
  targetOrganizationName: string;
  reason: string | null;
  deletedCountsJson: string;
  outcome: "success" | "failure";
  requestId: string;
  createdAt: string;
};

export function SuperAdminDashboard({ onBack }: { onBack?: () => void }) {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmationName, setConfirmationName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/super-admin/organizations", { cache: "no-store" });
      const payload = await response.json() as {
        organizations?: OrganizationSummary[];
        audit?: AuditEvent[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Unable to load Super Admin data");
      setOrganizations(payload.organizations || []);
      setAudit(payload.audit || []);
      setSelectedId((current) =>
        current && payload.organizations?.some((organization) => organization.id === current)
          ? current
          : payload.organizations?.[0]?.id || null,
      );
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load Super Admin data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  const selected = useMemo(
    () => organizations.find((organization) => organization.id === selectedId) || null,
    [organizations, selectedId],
  );
  const ready = Boolean(
    selected &&
    acknowledged &&
    confirmationName === selected.name &&
    !purging,
  );

  function selectOrganization(id: number) {
    setSelectedId(id);
    setConfirmationName("");
    setAcknowledged(false);
    setReason("");
    setMessage("");
    setError("");
  }

  async function purge() {
    if (!selected || !ready) return;
    if (!window.confirm(
      `Permanently delete all operational data for “${selected.name}”? Members, invitations, roles, and products will be preserved.`,
    )) return;

    setPurging(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/super-admin/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: selected.id,
          confirmationName,
          acknowledged,
          reason,
        }),
      });
      const payload = await response.json() as {
        error?: string;
        requestId?: string;
        deletedCounts?: Record<string, number>;
      };
      if (!response.ok) throw new Error(payload.error || "Unable to purge organization data");
      setMessage(
        `${selected.name} was returned to its base operational state. Audit request: ${payload.requestId}`,
      );
      setConfirmationName("");
      setAcknowledged(false);
      setReason("");
      await load();
    } catch (purgeError) {
      setError(purgeError instanceof Error ? purgeError.message : "Unable to purge organization data");
    } finally {
      setPurging(false);
    }
  }

  return (
    <main className="superAdminPage">
      <header>
        {onBack ? <button className="back" onClick={onBack}>← Command center</button> : <span />}
        <div className="brand">SUPER ADMIN <b>CONTROL CENTER</b></div>
        <UserButton />
      </header>
      <section className="welcome superAdminHero">
        <div>
          <p className="eyebrow">PLATFORM MAINTENANCE · RESTRICTED</p>
          <h1>Organization support</h1>
          <p>Reset demo operations without changing people, access, invitations, or products.</p>
        </div>
        <span className="superAdminBadge">Super Admin</span>
      </section>
      {error && <div className="alert errorAlert" role="alert">{error}</div>}
      {message && <div className="alert policyAlert" role="status">{message}</div>}
      <section className="peoplePanel">
        <div className="panelHeading">
          <div><p className="eyebrow">TARGET ORGANIZATION</p><h2>Operational data purge</h2></div>
        </div>
        {loading ? <div className="loadingState">Loading organizations…</div> : (
          <div className="superAdminPurgeGrid">
            <label>
              Organization
              <select
                value={selectedId || ""}
                onChange={(event) => selectOrganization(Number(event.target.value))}
              >
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>{organization.name}</option>
                ))}
              </select>
            </label>
            {selected && (
              <>
                <div className="purgePreview">
                  <article><span>Members preserved</span><strong>{selected.memberCount}</strong></article>
                  <article><span>Products preserved</span><strong>{selected.productCount}</strong></article>
                  <article><span>Booths deleted</span><strong>{selected.boothCount}</strong></article>
                  <article><span>Sales deleted</span><strong>{selected.salesCount}</strong></article>
                  <article><span>Inventory entries deleted</span><strong>{selected.inventoryTransactionCount}</strong></article>
                  <article><span>Regular audit events deleted</span><strong>{selected.auditCount}</strong></article>
                </div>
                <div className="purgeBoundary">
                  <strong>Preserved:</strong> organization, members, roles, invitations, users, products, prices, barcodes, and this Super Admin audit history.
                </div>
                <label>
                  Reason (optional)
                  <textarea
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Example: Reset after troop-leader demonstration"
                  />
                </label>
                <label>
                  Type <strong>{selected.name}</strong> to confirm
                  <input
                    value={confirmationName}
                    onChange={(event) => setConfirmationName(event.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className="purgeAcknowledgment">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  I understand this permanently deletes this organization&apos;s operational data.
                </label>
                <button className="dangerButton purgeButton" disabled={!ready} onClick={() => void purge()}>
                  {purging ? "Purging operational data…" : "Purge operational data"}
                </button>
              </>
            )}
          </div>
        )}
      </section>
      <section className="peoplePanel superAdminAudit">
        <div className="panelHeading">
          <div><p className="eyebrow">PERMANENT PLATFORM HISTORY</p><h2>Super Admin audit log</h2></div>
          <span className="permissionNote">Append-only</span>
        </div>
        {audit.length ? audit.map((event) => (
          <article key={event.id}>
            <div>
              <strong>{event.targetOrganizationName}</strong>
              <small>{new Date(event.createdAt).toLocaleString()} · {event.actorDisplayName}</small>
              {event.reason && <p>{event.reason}</p>}
            </div>
            <div>
              <span className={`invitationStatus ${event.outcome === "success" ? "accepted" : "open"}`}>
                {event.outcome}
              </span>
              <small>{event.requestId}</small>
            </div>
          </article>
        )) : <div className="loadingState">No Super Admin actions have been recorded.</div>}
      </section>
    </main>
  );
}

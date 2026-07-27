"use client";

import { UserButton } from "@clerk/nextjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BoothManagement } from "./booth-management";
import { GooglePlaceField, type SelectedPlace } from "./google-place-field";
import { PeopleRoles } from "./people-roles";

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
  status: "draft" | "scheduled" | "live" | "closed";
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

const flavors = [
  ["Thin Mints", 16, 42], ["Samoas", 8, 38], ["Tagalongs", 19, 36],
  ["Trefoils", 27, 30], ["Do-Si-Dos", 22, 30], ["Adventurefuls", 13, 24],
  ["Lemon-Ups", 20, 24], ["Toffee-tastic", 5, 12], ["ExploreMores", 18, 24],
];

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
  const [view, setView] = useState<"dashboard" | "people" | "booths">("dashboard");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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

  const loadBooths = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/booths?organizationId=${organizationId}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as BoothResponse;
      if (!response.ok) throw new Error(payload.error || "Unable to load booths");
      setBooths(payload.booths);
      setPermissions(payload.permissions);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load booths");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/booths?organizationId=${organizationId}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as BoothResponse;
        if (!response.ok) throw new Error(payload.error || "Unable to load booths");
        if (active) {
          setBooths(payload.booths);
          setPermissions(payload.permissions);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load booths");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [organizationId]);

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
  const handlePlaceSelected = useCallback((place: SelectedPlace) => {
    setBoothDraft((current) => ({ ...current, ...place }));
  }, []);

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
      await loadBooths();
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
          void loadBooths();
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
          setView("dashboard");
          setShowCreate(false);
          void loadBooths();
        }}
        onCreate={() => {
          setView("dashboard");
          setShowCreate(true);
        }}
      />
    );
  }

  if (selected) return (
    <main>
      <header>
        <button className="back" onClick={() => setSelected(null)}>← All booths</button>
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
        <div className={selected.status === "live" ? "live" : "permissionNote"}>
          {selected.status === "live" ? "● Live and syncing" : selected.status}
        </div>
      </section>
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
      {canOperate && selected.status === "live" ? (
        <section className="scan">
          <label>SCAN COOKIE BARCODE</label>
          <div><input autoFocus placeholder="Scanner ready…" /><button>Record sale</button></div>
          <small>Transaction persistence is the next protected API deliverable.</small>
        </section>
      ) : (
        <div className="alert policyAlert">
          {role === "auditor"
            ? "Read-only audit access: booth operations are disabled."
            : "Sales can be recorded only while this booth is live."}
        </div>
      )}
      <section className="stats">
        <article><span>Boxes sold</span><strong>{selected.boxes}</strong></article>
        <article><span>Gross sales</span><strong>${Number(selected.revenue).toLocaleString()}</strong></article>
        <article><span>Low inventory</span><strong>{selected.low}</strong></article>
        <article><span>Access mode</span><strong className="accessMode">{role === "auditor" ? "Read" : "Operate"}</strong></article>
      </section>
      <div className="sectionHead">
        <div><p className="eyebrow">BOOTH INVENTORY</p><h2>Live counts</h2></div>
        {canReconcile && <button>Close & reconcile booth</button>}
      </div>
      <section className="inventory">
        {flavors.map(([name, left, start], index) => (
          <article className={Number(left) <= 8 ? "warning" : ""} key={String(name)}>
            <i className={`chip c${index % 5}`}>{String(name).slice(0, 2).toUpperCase()}</i>
            <div><h3>{name}</h3><small>{start} opening · {Number(start) - Number(left)} sold</small></div>
            <strong>{left}<small> left</small></strong>
          </article>
        ))}
      </section>
    </main>
  );

  return (
    <main>
      <header>
        <div className="brand">COOKIE BOOTH <b>COMMAND CENTER</b></div>
        <nav>
          {permissions.canViewReports && <button>Reports</button>}
          {role === "admin" && (
            <button onClick={() => setView("booths")}>Booth management</button>
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
            <button className="booth" key={booth.id} onClick={() => setSelected(booth)}>
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

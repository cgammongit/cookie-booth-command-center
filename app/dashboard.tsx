"use client";

import { UserButton } from "@clerk/nextjs";
import { useMemo, useState } from "react";
import { PeopleRoles } from "./people-roles";

type Booth = {
  id: number; name: string; address: string; window: string;
  status: "live" | "scheduled" | "closed";
  lead: string; boxes: number; revenue: number; low: number;
};

const booths: Booth[] = [
  { id: 1, name: "Bristol Food City", address: "Bristol, VA", window: "Today · 10:00 AM–2:00 PM", status: "live", lead: "Booth Lead A", boxes: 148, revenue: 888, low: 2 },
  { id: 2, name: "State Street Market", address: "Bristol, TN", window: "Today · 12:00–4:00 PM", status: "live", lead: "Booth Lead B", boxes: 96, revenue: 576, low: 1 },
  { id: 3, name: "Highlands Shopping Center", address: "Bristol, VA", window: "Tomorrow · 9:00 AM–1:00 PM", status: "scheduled", lead: "Booth Lead C", boxes: 0, revenue: 0, low: 0 },
  { id: 4, name: "Community Center", address: "Bristol, TN", window: "Jul 22 · Closed", status: "closed", lead: "Booth Lead D", boxes: 211, revenue: 1266, low: 0 },
];

const flavors = [
  ["Thin Mints", 16, 42], ["Samoas", 8, 38], ["Tagalongs", 19, 36],
  ["Trefoils", 27, 30], ["Do-Si-Dos", 22, 30], ["Adventurefuls", 13, 24],
  ["Lemon-Ups", 20, 24], ["Toffee-tastic", 5, 12], ["ExploreMores", 18, 24],
];

export function Dashboard({
  displayName,
  role,
  organizationId,
  organizationName,
}: {
  displayName: string;
  role: string;
  organizationId: number;
  organizationName: string;
}) {
  const [selected, setSelected] = useState<Booth | null>(null);
  const [view, setView] = useState<"dashboard" | "people">("dashboard");
  const totals = useMemo(() => ({
    active: booths.filter((booth) => booth.status === "live").length,
    boxes: booths.reduce((total, booth) => total + booth.boxes, 0),
    revenue: booths.reduce((total, booth) => total + booth.revenue, 0),
  }), []);
  const firstName = displayName.split(" ")[0] || "there";

  if (view === "people" && role === "admin") {
    return (
      <PeopleRoles
        organizationId={organizationId}
        organizationName={organizationName}
        onBack={() => setView("dashboard")}
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
        <div><p className="eyebrow">LIVE BOOTH · {selected.window}</p><h1>{selected.name}</h1><p>{selected.address} · Lead: {selected.lead}</p></div>
        <div className="live">● Live and syncing</div>
      </section>
      <section className="scan">
        <label>SCAN COOKIE BARCODE</label>
        <div><input autoFocus placeholder="Scanner ready…" /><button>Record sale</button></div>
        <small>Transactions receive a unique ID and are written to an append-only audit ledger.</small>
      </section>
      <section className="stats">
        <article><span>Boxes sold</span><strong>{selected.boxes}</strong></article>
        <article><span>Gross sales</span><strong>${selected.revenue.toLocaleString()}</strong></article>
        <article><span>Low inventory</span><strong>{selected.low}</strong></article>
        <article><span>Connected devices</span><strong>3</strong></article>
      </section>
      <div className="sectionHead"><div><p className="eyebrow">BOOTH INVENTORY</p><h2>Live counts</h2></div><button>Close & reconcile booth</button></div>
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
          <button>Reports</button>
          {role === "admin" && (
            <button onClick={() => setView("people")}>People & roles</button>
          )}
          <span className="roleBadge">{role}</span>
          <UserButton />
        </nav>
      </header>
      <section className="welcome">
        <div><p className="eyebrow">TROOP OPERATIONS · ADULT VOLUNTEERS ONLY</p><h1>Good morning, {firstName}.</h1><p>Two booths are live. Inventory is healthy, with three low-stock alerts requiring attention.</p></div>
        <button className="primary">＋ Create booth</button>
      </section>
      <section className="stats">
        <article><span>Live booths</span><strong>{totals.active}</strong><small>of 4 scheduled</small></article>
        <article><span>Boxes sold</span><strong>{totals.boxes}</strong><small>across all locations</small></article>
        <article><span>Gross sales</span><strong>${totals.revenue.toLocaleString()}</strong><small>before reconciliation</small></article>
        <article><span>Inventory alerts</span><strong>3</strong><small>across 2 booths</small></article>
      </section>
      <div className="toolbar"><div><p className="eyebrow">BOOTH DIRECTORY</p><h2>Select a booth to operate</h2></div><span className="permissionNote">Access is enforced by your assigned role</span></div>
      <section className="booths">
        {booths.map((booth) => (
          <button className="booth" key={booth.id} onClick={() => setSelected(booth)}>
            <div><span className={`pill ${booth.status}`}>{booth.status}</span><h3>{booth.name}</h3><p>{booth.address}</p><small>{booth.window}</small></div>
            <dl><div><dt>Lead</dt><dd>{booth.lead}</dd></div><div><dt>Boxes</dt><dd>{booth.boxes}</dd></div><div><dt>Sales</dt><dd>${booth.revenue.toLocaleString()}</dd></div></dl>
            <footer>{booth.status === "live" ? "Open command center" : booth.status === "scheduled" ? "Review setup" : "View reconciliation"} <b>→</b></footer>
          </button>
        ))}
      </section>
      <aside><b>Privacy boundary</b><span>This system tracks adult operators, booth inventory, and transactions. Scout identities and individual sale-credit allocation are intentionally out of scope.</span></aside>
    </main>
  );
}

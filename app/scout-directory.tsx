"use client";

import { useCallback, useEffect, useState } from "react";
import { SCOUT_AGE_LEVELS, type ScoutAgeLevel } from "../lib/scout-credit";

type Scout = { id: number; name: string; ageLevel: ScoutAgeLevel; archivedAt: string | null; createdAt: string; updatedAt: string };

export function ScoutDirectory({ organizationId }: { organizationId: number }) {
  const [scouts, setScouts] = useState<Scout[]>([]);
  const [name, setName] = useState("");
  const [ageLevel, setAgeLevel] = useState<ScoutAgeLevel>("Daisy");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/scouts?organizationId=${organizationId}`, { cache: "no-store" });
    const payload = await response.json() as { scouts?: Scout[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "Unable to load scouts");
    setScouts(payload.scouts || []);
  }, [organizationId]);
  useEffect(() => {
    let active = true;
    void fetch(`/api/admin/scouts?organizationId=${organizationId}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { scouts?: Scout[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Unable to load scouts");
        if (active) setScouts(payload.scouts || []);
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load scouts"); });
    return () => { active = false; };
  }, [organizationId]);

  async function create(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/admin/scouts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId, name, ageLevel }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to add scout");
      setName(""); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to add scout"); }
    finally { setSaving(false); }
  }

  async function update(scout: Scout, changes: Partial<Pick<Scout, "name" | "ageLevel">> & { archived?: boolean }) {
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/admin/scouts/${scout.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId, name: changes.name ?? scout.name, ageLevel: changes.ageLevel ?? scout.ageLevel, archived: changes.archived ?? Boolean(scout.archivedAt) }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to update scout");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update scout"); }
    finally { setSaving(false); }
  }

  return <section className="peoplePanel">
    <div className="panelHeading"><div><p className="eyebrow">SCOUT DIRECTORY</p><h2>Scouts</h2><p>Directory records do not require application accounts.</p></div></div>
    {error && <div className="alert errorAlert" role="alert">{error}</div>}
    <form className="boothForm" onSubmit={create}>
      <label>Name<input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Age level<select value={ageLevel} onChange={(event) => setAgeLevel(event.target.value as ScoutAgeLevel)}>{SCOUT_AGE_LEVELS.map((level) => <option key={level}>{level}</option>)}</select></label>
      <button className="primary" disabled={saving}>Add scout</button>
    </form>
    <div className="peopleTable">
      <div className="peopleTableHead"><span>Scout</span><span>Age level</span><span>Status</span><span>Action</span></div>
      {scouts.map((scout) => <div key={scout.id}>
        <input aria-label={`Name for ${scout.name}`} defaultValue={scout.name} disabled={saving} onBlur={(event) => { if (event.target.value.trim() !== scout.name) void update(scout, { name: event.target.value.trim() }); }} />
        <select aria-label={`Age level for ${scout.name}`} value={scout.ageLevel} disabled={saving} onChange={(event) => void update(scout, { ageLevel: event.target.value as ScoutAgeLevel })}>{SCOUT_AGE_LEVELS.map((level) => <option key={level}>{level}</option>)}</select>
        <span>{scout.archivedAt ? "Archived" : "Active"}</span>
        <button disabled={saving} onClick={() => void update(scout, { archived: !scout.archivedAt })}>{scout.archivedAt ? "Restore" : "Archive"}</button>
      </div>)}
      {!scouts.length && <p className="loadingState">No scouts have been added yet.</p>}
    </div>
  </section>;
}

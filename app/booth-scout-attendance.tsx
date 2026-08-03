"use client";

import { useCallback, useEffect, useState } from "react";

type Scout = { id: number; name: string; ageLevel: string; archivedAt: string | null };
type Attendance = { scoutId: number; name: string; ageLevel: string; archivedAt: string | null; attendanceStart: string; attendanceEnd: string; stayedThroughClose: boolean };
function local(value: string) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }

export function BoothScoutAttendance({ organizationId, booth }: { organizationId: number; booth: { id: number; startsAt: string; endsAt: string; status: string } }) {
  const [scouts, setScouts] = useState<Scout[]>([]);
  const [assignments, setAssignments] = useState<Attendance[]>([]);
  const [revision, setRevision] = useState("");
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/booth-scouts?organizationId=${organizationId}&boothId=${booth.id}`, { cache: "no-store" });
    const payload = await response.json() as { scouts?: Scout[]; assignments?: Attendance[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "Unable to load scout attendance");
    setScouts(payload.scouts || []); setAssignments((payload.assignments || []).map((item) => ({ ...item, stayedThroughClose: Boolean(item.stayedThroughClose) }))); setRevision((payload as { booth?: { revision?: string } }).booth?.revision || "");
  }, [booth.id, organizationId]);
  useEffect(() => {
    let active = true;
    void fetch(`/api/admin/booth-scouts?organizationId=${organizationId}&boothId=${booth.id}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { scouts?: Scout[]; assignments?: Attendance[]; booth?: { revision?: string }; error?: string };
        if (!response.ok) throw new Error(payload.error || "Unable to load scout attendance");
        if (active) { setScouts(payload.scouts || []); setAssignments((payload.assignments || []).map((item) => ({ ...item, stayedThroughClose: Boolean(item.stayedThroughClose) }))); setRevision(payload.booth?.revision || ""); }
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load scout attendance"); });
    return () => { active = false; };
  }, [booth.id, organizationId]);
  const locked = booth.status === "closed";
  function toggle(scout: Scout, checked: boolean) { setAssignments((current) => checked ? [...current, { scoutId: scout.id, name: scout.name, ageLevel: scout.ageLevel, archivedAt: scout.archivedAt, attendanceStart: booth.startsAt, attendanceEnd: booth.endsAt, stayedThroughClose: true }] : current.filter((item) => item.scoutId !== scout.id)); }
  async function save() {
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/booth-scouts", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId, boothId: booth.id, revision, assignments: assignments.map((item) => ({ scoutId: item.scoutId, attendanceStart: new Date(item.attendanceStart).toISOString(), attendanceEnd: new Date(item.attendanceEnd).toISOString() })) }) });
      const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error || "Unable to save scout attendance");
      await load(); setNotice("Scout attendance saved. Provisional credit has been recalculated.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save scout attendance"); } finally { setSaving(false); }
  }
  return <section className="archiveBoothControl"><p className="eyebrow">SCOUT ATTENDANCE</p><strong>Assigned scouts</strong><small>Attendance uses start-inclusive, end-exclusive windows. Sales at or after the scheduled close go only to scouts scheduled through close.</small>
    {error && <div className="alert errorAlert" role="alert">{error}</div>}{notice && <div className="alert" role="status">{notice}</div>}
    <div className="staffingList">{scouts.filter((scout) => !scout.archivedAt || assignments.some((item) => item.scoutId === scout.id)).map((scout) => { const assignment = assignments.find((item) => item.scoutId === scout.id); return <div key={scout.id}>
      <label><input type="checkbox" checked={Boolean(assignment)} disabled={locked || saving || Boolean(scout.archivedAt && !assignment)} onChange={(event) => toggle(scout, event.target.checked)} /><span><strong>{scout.name}</strong><small>{scout.ageLevel}{scout.archivedAt ? " · archived" : ""}</small></span></label>
      {assignment && <><label>Starts<input type="datetime-local" value={local(assignment.attendanceStart)} disabled={locked || saving} onChange={(event) => setAssignments((current) => current.map((item) => item.scoutId === scout.id ? { ...item, attendanceStart: new Date(event.target.value).toISOString() } : item))} /></label><label>Ends<input type="datetime-local" value={local(assignment.attendanceEnd)} disabled={locked || saving} onChange={(event) => setAssignments((current) => current.map((item) => item.scoutId === scout.id ? { ...item, attendanceEnd: new Date(event.target.value).toISOString() } : item))} /></label></>}
    </div>; })}</div>
    <button className="primary" disabled={locked || saving} onClick={() => void save()}>{locked ? "Locked after reconciliation" : saving ? "Saving…" : "Save scout attendance"}</button>
  </section>;
}

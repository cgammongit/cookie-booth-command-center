"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { ScoutMultiSelect } from "./scout-multi-select";

type Scout = { id: number; name: string; ageLevel: string; archivedAt: string | null };
type Attendance = { scoutId: number; name: string; ageLevel: string; archivedAt: string | null; attendanceStart: string; attendanceEnd: string; stayedThroughClose: boolean };
type Permissions = { canManageRoster: boolean; canEditTimes: boolean };

function timeOptions(startsAt: string, endsAt: string) {
  const start = Date.parse(startsAt); const end = Date.parse(endsAt); const step = 15 * 60 * 1000;
  const values = new Set<number>([start, end]);
  for (let value = Math.ceil(start / step) * step; value <= end; value += step) values.add(value);
  return [...values].sort((a, b) => a - b).map((value) => new Date(value).toISOString());
}

function timeLabel(value: string, boothStart: string) {
  const date = new Date(value); const start = new Date(boothStart);
  const dayOffset = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() > new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  return `${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${dayOffset ? " (+1 day)" : ""}`;
}

export function BoothScoutAttendance({ organizationId, booth }: { organizationId: number; booth: { id: number; startsAt: string; endsAt: string; status: string } }) {
  const [scouts, setScouts] = useState<Scout[]>([]); const [assignments, setAssignments] = useState<Attendance[]>([]);
  const [permissions, setPermissions] = useState<Permissions>({ canManageRoster: false, canEditTimes: false });
  const [revision, setRevision] = useState(""); const [dirty, setDirty] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [saving, setSaving] = useState(false);
  const menuId = useId();
  const options = [...new Set([...timeOptions(booth.startsAt, booth.endsAt), ...assignments.flatMap((item) => [item.attendanceStart, item.attendanceEnd])])].sort((a, b) => Date.parse(a) - Date.parse(b));
  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/booth-scouts?organizationId=${organizationId}&boothId=${booth.id}`, { cache: "no-store" });
    const payload = await response.json() as { scouts?: Scout[]; assignments?: Attendance[]; permissions?: Permissions; booth?: { revision?: string }; error?: string };
    if (!response.ok) throw new Error(payload.error || "Unable to load scout attendance");
    setScouts(payload.scouts || []); setAssignments((payload.assignments || []).map((item) => ({ ...item, stayedThroughClose: Boolean(item.stayedThroughClose) })));
    setPermissions(payload.permissions || { canManageRoster: false, canEditTimes: false }); setRevision(payload.booth?.revision || ""); setDirty(false);
  }, [booth.id, organizationId]);
  useEffect(() => { let active = true; queueMicrotask(() => { void load().catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load scout attendance"); }); }); return () => { active = false; }; }, [load]);
  const locked = booth.status === "closed";
  function toggle(scout: Scout) {
    const assignment = assignments.find((item) => item.scoutId === scout.id);
    setAssignments((current) => assignment ? current.filter((item) => item.scoutId !== scout.id) : [...current, { scoutId: scout.id, name: scout.name, ageLevel: scout.ageLevel, archivedAt: scout.archivedAt, attendanceStart: booth.startsAt, attendanceEnd: booth.endsAt, stayedThroughClose: true }]);
    setDirty(true); setNotice(""); setError("");
  }
  function changeTime(scoutId: number, field: "attendanceStart" | "attendanceEnd", value: string) {
    setAssignments((current) => current.map((item) => item.scoutId === scoutId ? { ...item, [field]: value, stayedThroughClose: field === "attendanceEnd" ? value === booth.endsAt : item.stayedThroughClose } : item)); setDirty(true); setNotice("");
  }
  async function save() {
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/booth-scouts", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId, boothId: booth.id, revision, assignments: assignments.map((item) => ({ scoutId: item.scoutId, attendanceStart: item.attendanceStart, attendanceEnd: item.attendanceEnd })) }) });
      const payload = await response.json() as { error?: string; code?: string }; if (!response.ok) { if (payload.code === "attendance_conflict") await load(); throw new Error(payload.error || "Unable to save scout attendance"); }
      await load(); setNotice("Scout roster and time sheet saved. Provisional credit has been recalculated.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save scout attendance"); } finally { setSaving(false); }
  }
  return <div className="boothScoutSections">
    <section className="scoutTimeSheet boothScoutPanel" aria-labelledby={`${menuId}-timesheet-title`}>
      <p className="eyebrow">SCOUT TIME SHEET</p><h3 id={`${menuId}-timesheet-title`}>Scout Time Sheet</h3>
      <small>Attendance uses the booth’s scheduled date. End times are exclusive for sales credit.</small>
      <div className="scoutTimeSheetScroll"><table><thead><tr><th scope="col">Name</th><th scope="col">Start Time</th><th scope="col">End Time</th></tr></thead><tbody>
        {assignments.map((item) => <tr key={item.scoutId}><th scope="row">{item.name}{item.archivedAt && <small>Archived</small>}</th><td>{permissions.canEditTimes ? <select aria-label={`${item.name} start time`} value={item.attendanceStart} disabled={locked || saving} onChange={(event) => changeTime(item.scoutId, "attendanceStart", event.target.value)}>{options.map((value) => <option key={value} value={value}>{timeLabel(value, booth.startsAt)}</option>)}</select> : <span>{timeLabel(item.attendanceStart, booth.startsAt)}</span>}</td><td>{permissions.canEditTimes ? <select aria-label={`${item.name} end time`} value={item.attendanceEnd} disabled={locked || saving} onChange={(event) => changeTime(item.scoutId, "attendanceEnd", event.target.value)}>{options.map((value) => <option key={value} value={value}>{timeLabel(value, booth.startsAt)}</option>)}</select> : <span>{timeLabel(item.attendanceEnd, booth.startsAt)}</span>}</td></tr>)}
        {!assignments.length && <tr><td colSpan={3} className="emptyTimeSheet">Select active scouts below to add time-sheet rows.</td></tr>}
      </tbody></table></div>
    </section>
    <section className="scoutAttendance boothScoutPanel" aria-labelledby={`${menuId}-attendance-title`}>
      <p className="eyebrow">SCOUT ATTENDANCE</p><h3 id={`${menuId}-attendance-title`}>Scout Attendance</h3>
      <small>Select the scouts active at this booth. New scouts default to the scheduled start and end.</small>
      {error && <div className="alert errorAlert" role="alert">{error}</div>}{notice && <div className="alert" role="status">{notice}</div>}
      <ScoutMultiSelect options={scouts.map((scout) => ({ id: scout.id, name: scout.name, detail: `${scout.ageLevel}${scout.archivedAt ? " · archived" : ""}`, disabled: Boolean(scout.archivedAt && !assignments.some((item) => item.scoutId === scout.id)) }))} selectedIds={assignments.map((item) => item.scoutId)} onToggle={(option) => { const scout = scouts.find((item) => item.id === option.id); if (scout) toggle(scout); }} triggerLabel="Select active scouts" emptyMessage="No active scouts are available. Add scouts in Scout Directory under People & Roles." disabled={locked || !permissions.canManageRoster} pending={saving} />
      <button type="button" className="primary" disabled={locked || saving || !dirty || !permissions.canManageRoster} onClick={() => void save()}>{locked ? "Locked after reconciliation" : saving ? "Saving…" : dirty ? "Save scout changes" : "Scout changes saved"}</button>
    </section>
  </div>;
}

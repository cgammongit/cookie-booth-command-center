"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type BoothStatus = "draft" | "scheduled" | "live" | "closed";
type ManagedBooth = {
  id: number;
  name: string;
  address: string;
  locationName: string | null;
  startsAt: string;
  endsAt: string;
  status: BoothStatus;
  lead: string | null;
};
type ManagedPerson = {
  userId: number;
  displayName: string;
  email: string;
  role: "admin" | "lead" | "volunteer" | "auditor";
  status: "pending" | "active" | "suspended";
};
type Assignment = {
  boothId: number;
  userId: number;
  role: "lead" | "volunteer" | "auditor";
};

const PAGE_SIZE = 20;

function formatDate(value: string) {
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

export function BoothManagement({
  organizationId,
  organizationName,
  onBack,
  onCreate,
}: {
  organizationId: number;
  organizationName: string;
  onBack: () => void;
  onCreate: () => void;
}) {
  const [booths, setBooths] = useState<ManagedBooth[]>([]);
  const [people, setPeople] = useState<ManagedPerson[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [personQuery, setPersonQuery] = useState("");
  const [status, setStatus] = useState<"all" | BoothStatus>("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [archiveReason, setArchiveReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [boothResponse, peopleResponse] = await Promise.all([
        fetch(`/api/booths?organizationId=${organizationId}`, { cache: "no-store" }),
        fetch(`/api/admin/people?organizationId=${organizationId}`, {
          cache: "no-store",
        }),
      ]);
      const boothPayload = (await boothResponse.json()) as {
        booths?: ManagedBooth[];
        error?: string;
      };
      const peoplePayload = (await peopleResponse.json()) as {
        people?: ManagedPerson[];
        assignments?: Assignment[];
        error?: string;
      };
      if (!boothResponse.ok) {
        throw new Error(boothPayload.error || "Unable to load booths");
      }
      if (!peopleResponse.ok) {
        throw new Error(peoplePayload.error || "Unable to load organization members");
      }
      setBooths(boothPayload.booths || []);
      setPeople(peoplePayload.people || []);
      setAssignments(peoplePayload.assignments || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load booths");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch(`/api/booths?organizationId=${organizationId}`, { cache: "no-store" }),
      fetch(`/api/admin/people?organizationId=${organizationId}`, {
        cache: "no-store",
      }),
    ])
      .then(async ([boothResponse, peopleResponse]) => {
        const boothPayload = (await boothResponse.json()) as {
          booths?: ManagedBooth[];
          error?: string;
        };
        const peoplePayload = (await peopleResponse.json()) as {
          people?: ManagedPerson[];
          assignments?: Assignment[];
          error?: string;
        };
        if (!boothResponse.ok) {
          throw new Error(boothPayload.error || "Unable to load booths");
        }
        if (!peopleResponse.ok) {
          throw new Error(peoplePayload.error || "Unable to load organization members");
        }
        if (active) {
          setBooths(boothPayload.booths || []);
          setPeople(peoplePayload.people || []);
          setAssignments(peoplePayload.assignments || []);
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

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return booths.filter(
      (booth) =>
        (status === "all" || booth.status === status) &&
        (!normalized ||
          booth.name.toLowerCase().includes(normalized) ||
          booth.address.toLowerCase().includes(normalized) ||
          booth.locationName?.toLowerCase().includes(normalized) ||
          booth.lead?.toLowerCase().includes(normalized)),
    );
  }, [booths, query, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleBooths = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selected = booths.find((booth) => booth.id === selectedId) || null;
  const eligiblePeople = useMemo(() => {
    const normalized = personQuery.trim().toLowerCase();
    return people.filter(
      (person) =>
        person.status === "active" &&
        (person.role === "lead" || person.role === "volunteer") &&
        (!normalized ||
          person.displayName.toLowerCase().includes(normalized) ||
          person.email.toLowerCase().includes(normalized)),
    );
  }, [people, personQuery]);

  async function updateAssignment(person: ManagedPerson, assigned: boolean) {
    if (!selected) return;
    const key = `${selected.id}:${person.userId}`;
    setSaving(key);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/booth-assignments", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          boothId: selected.id,
          userId: person.userId,
          assigned,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to update access");
      setNotice(
        `${person.displayName} was ${assigned ? "assigned to" : "removed from"} ${selected.name}.`,
      );
      await load();
    } catch (assignmentError) {
      setError(
        assignmentError instanceof Error
          ? assignmentError.message
          : "Unable to update access",
      );
    } finally {
      setSaving("");
    }
  }

  async function archiveSelected() {
    if (!selected || archiveReason.trim().length < 5) {
      setError("Enter an archive reason of at least 5 characters.");
      return;
    }
    if (!window.confirm(
      `Archive ${selected.name}? It will leave active operations but retain all history.`,
    )) return;
    setSaving(`archive:${selected.id}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/booths/${selected.id}/archive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, reason: archiveReason.trim() }),
      });
      const payload = (await response.json()) as {
        error?: string;
        alertCreated?: boolean;
      };
      if (!response.ok) throw new Error(payload.error || "Unable to archive booth");
      setNotice(
        payload.alertCreated
          ? `${selected.name} was archived and an activity alert was created.`
          : `${selected.name} was archived.`,
      );
      setSelectedId(null);
      setArchiveReason("");
      await load();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Unable to archive booth");
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
          <p className="eyebrow">BOOTH OPERATIONS · {organizationName}</p>
          <h1>Booth management</h1>
          <p>Search, staff, and review booths without loading every assignment at once.</p>
        </div>
        <button className="primary" onClick={onCreate}>＋ Create booth</button>
      </section>
      {error && <div className="alert errorAlert" role="alert">{error}</div>}
      {notice && <div className="alert successAlert" role="status">{notice}</div>}
      <section className="managementLayout">
        <div className="peoplePanel boothDirectoryPanel">
          <div className="panelHeading">
            <div><p className="eyebrow">DIRECTORY</p><h2>{filtered.length} booths</h2></div>
          </div>
          <div className="managementFilters">
            <input
              type="search"
              value={query}
              placeholder="Search name, address, or lead"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as "all" | BoothStatus);
                setPage(1);
              }}
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="live">Live</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          {loading ? (
            <div className="loadingState">Loading booth directory…</div>
          ) : (
            <div className="managedBoothList">
              {visibleBooths.map((booth) => (
                <button
                  className={selectedId === booth.id ? "selected" : ""}
                  key={booth.id}
                  onClick={() => {
                    setSelectedId(booth.id);
                    setPersonQuery("");
                    setNotice("");
                  }}
                >
                  <span className={`pill ${booth.status}`}>{booth.status}</span>
                  <strong>{booth.name}</strong>
                  <small>{booth.locationName || booth.address}</small>
                  <small>{formatDate(booth.startsAt)}</small>
                  <span>{booth.lead ? `Lead: ${booth.lead}` : "Lead needed"}</span>
                </button>
              ))}
              {!visibleBooths.length && (
                <div className="loadingState">No booths match these filters.</div>
              )}
            </div>
          )}
          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
            <span>Page {Math.min(page, pageCount)} of {pageCount}</span>
            <button disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button>
          </div>
        </div>
        <div className="peoplePanel staffingPanel">
          <div className="panelHeading">
            <div>
              <p className="eyebrow">ACCESS</p>
              <h2>{selected ? selected.name : "Select a booth"}</h2>
            </div>
          </div>
          {!selected ? (
            <div className="loadingState">
              Choose a booth to search and manage its assigned operators.
            </div>
          ) : (
            <>
              <div className="selectedBoothSummary">
                <strong>{selected.locationName || selected.name}</strong>
                <span>{selected.address}</span>
                <span>{formatDate(selected.startsAt)}</span>
              </div>
              <div className="managementFilters single">
                <input
                  type="search"
                  value={personQuery}
                  placeholder="Search active leads and volunteers"
                  onChange={(event) => setPersonQuery(event.target.value)}
                />
              </div>
              <div className="staffingList">
                {eligiblePeople.map((person) => {
                  const assigned = assignments.some(
                    (assignment) =>
                      assignment.boothId === selected.id &&
                      assignment.userId === person.userId,
                  );
                  const key = `${selected.id}:${person.userId}`;
                  return (
                    <label key={person.userId}>
                      <input
                        type="checkbox"
                        checked={assigned}
                        disabled={saving === key}
                        onChange={(event) =>
                          void updateAssignment(person, event.target.checked)
                        }
                      />
                      <span><strong>{person.displayName}</strong><small>{person.email}</small></span>
                      <span className={`staffRole ${person.role}`}>{person.role}</span>
                    </label>
                  );
                })}
                {!eligiblePeople.length && (
                  <div className="loadingState">No active operators match your search.</div>
                )}
              </div>
              <div className="archiveBoothControl">
                <p className="eyebrow">BOOTH LIFECYCLE</p>
                <strong>Manually archive this booth</strong>
                <small>
                  Its history will be retained. Any recorded inventory or transaction
                  activity creates an administrator alert.
                </small>
                <textarea
                  maxLength={500}
                  value={archiveReason}
                  placeholder="Required archive reason"
                  onChange={(event) => setArchiveReason(event.target.value)}
                />
                <button
                  className="dangerButton"
                  disabled={saving === `archive:${selected.id}`}
                  onClick={() => void archiveSelected()}
                >
                  {saving === `archive:${selected.id}` ? "Archiving…" : "Archive booth"}
                </button>
              </div>
            </>
          )}
        </div>
      </section>
      <aside><b>Scalable access</b><span>Assignments are managed one booth at a time, with search, filtering, pagination, and an immutable audit entry for every change.</span></aside>
    </main>
  );
}

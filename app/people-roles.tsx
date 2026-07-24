"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Role = "admin" | "lead" | "volunteer" | "auditor";
type Status = "pending" | "active" | "suspended";

type Person = {
  membershipId: number;
  userId: number;
  displayName: string;
  email: string;
  identityStatus: "active" | "disabled";
  role: Role;
  status: Status;
  canInviteUsers: boolean;
  createdAt: string;
  updatedAt: string;
};

type AuditEntry = {
  id: number;
  actorUserId: number;
  targetMembershipId: number;
  action: "role_changed" | "status_changed" | "invitation_rights_changed";
  beforeJson: string;
  afterJson: string;
  createdAt: string;
};

type PeopleResponse = {
  people: Person[];
  audit: AuditEntry[];
  currentUserId: number;
};

const roleLabels: Record<Role, string> = {
  admin: "Administrator",
  lead: "Lead",
  volunteer: "Volunteer",
  auditor: "Auditor",
};

const actionLabels: Record<AuditEntry["action"], string> = {
  role_changed: "changed a role",
  status_changed: "changed access status",
  invitation_rights_changed: "changed invitation rights",
};

function formatDate(value: string) {
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

export function PeopleRoles({
  organizationId,
  organizationName,
  onBack,
}: {
  organizationId: number;
  organizationName: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<PeopleResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Person>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const applyPayload = useCallback((payload: PeopleResponse) => {
    setData(payload);
    setDrafts(
      Object.fromEntries(payload.people.map((person) => [person.membershipId, person])),
    );
  }, []);

  const fetchPeople = useCallback(async () => {
    const response = await fetch(
      `/api/admin/people?organizationId=${organizationId}`,
      { cache: "no-store" },
    );
    const payload = (await response.json()) as PeopleResponse & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Unable to load people");
    return payload;
  }, [organizationId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      applyPayload(await fetchPeople());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load people");
    } finally {
      setLoading(false);
    }
  }, [applyPayload, fetchPeople]);

  useEffect(() => {
    let active = true;
    void fetchPeople()
      .then((payload) => {
        if (active) applyPayload(payload);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load people");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyPayload, fetchPeople]);

  const peopleByMembership = useMemo(
    () =>
      new Map(
        data?.people.map((person) => [person.membershipId, person.displayName]) ?? [],
      ),
    [data],
  );
  const peopleByUser = useMemo(
    () =>
      new Map(data?.people.map((person) => [person.userId, person.displayName]) ?? []),
    [data],
  );

  function updateDraft(membershipId: number, changes: Partial<Person>) {
    setDrafts((current) => ({
      ...current,
      [membershipId]: { ...current[membershipId], ...changes },
    }));
    setNotice("");
  }

  async function save(person: Person) {
    const draft = drafts[person.membershipId];
    if (!draft) return;
    setSavingId(person.membershipId);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/people/${person.membershipId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          role: draft.role,
          status: draft.status,
          canInviteUsers: draft.role === "lead" && draft.canInviteUsers,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to save access");
      setNotice(`${person.displayName}'s access was updated.`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save access");
    } finally {
      setSavingId(null);
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
          <p className="eyebrow">ORGANIZATION ACCESS · {organizationName}</p>
          <h1>People & roles</h1>
          <p>Manage adult operator access without changing identity-provider accounts.</p>
        </div>
        <div className="peopleSummary">
          <strong>{data?.people.length ?? 0}</strong>
          <span>memberships</span>
        </div>
      </section>

      {error && <div className="alert errorAlert" role="alert">{error}</div>}
      {notice && <div className="alert successAlert" role="status">{notice}</div>}

      <section className="peoplePanel">
        <div className="panelHeading">
          <div>
            <p className="eyebrow">ACCESS DIRECTORY</p>
            <h2>Organization members</h2>
          </div>
          <button onClick={() => void load()} disabled={loading}>Refresh</button>
        </div>

        {loading ? (
          <div className="loadingState">Loading organization access…</div>
        ) : (
          <div className="peopleTableWrap">
            <table className="peopleTable">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Access</th>
                  <th>Invitation rights</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data?.people.map((person) => {
                  const draft = drafts[person.membershipId] ?? person;
                  const changed =
                    draft.role !== person.role ||
                    draft.status !== person.status ||
                    (draft.role === "lead" && draft.canInviteUsers) !==
                      (person.role === "lead" && person.canInviteUsers);
                  const isCurrentUser = person.userId === data.currentUserId;
                  return (
                    <tr key={person.membershipId}>
                      <td>
                        <strong>{person.displayName}</strong>
                        {isCurrentUser && <span className="youBadge">You</span>}
                        <small>{person.email}</small>
                        {person.identityStatus === "disabled" && (
                          <small className="identityDisabled">Identity disabled in Clerk</small>
                        )}
                      </td>
                      <td>
                        <select
                          aria-label={`${person.displayName} role`}
                          value={draft.role}
                          onChange={(event) => {
                            const role = event.target.value as Role;
                            updateDraft(person.membershipId, {
                              role,
                              canInviteUsers:
                                role === "lead" ? draft.canInviteUsers : false,
                            });
                          }}
                        >
                          {Object.entries(roleLabels).map(([value, label]) => (
                            <option value={value} key={value}>{label}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          aria-label={`${person.displayName} access status`}
                          value={draft.status}
                          onChange={(event) =>
                            updateDraft(person.membershipId, {
                              status: event.target.value as Status,
                            })
                          }
                        >
                          <option value="active">Active</option>
                          <option value="pending">Pending</option>
                          <option value="suspended">Suspended</option>
                        </select>
                      </td>
                      <td>
                        <label className={`inviteToggle ${draft.role !== "lead" ? "disabled" : ""}`}>
                          <input
                            type="checkbox"
                            checked={draft.role === "lead" && draft.canInviteUsers}
                            disabled={draft.role !== "lead"}
                            onChange={(event) =>
                              updateDraft(person.membershipId, {
                                canInviteUsers: event.target.checked,
                              })
                            }
                          />
                          <span>{draft.role === "lead" ? "May invite volunteers" : "Lead only"}</span>
                        </label>
                      </td>
                      <td>
                        <button
                          className="saveAccess"
                          disabled={!changed || savingId === person.membershipId}
                          onClick={() => void save(person)}
                        >
                          {savingId === person.membershipId ? "Saving…" : "Save"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="auditPanel">
        <div className="panelHeading">
          <div>
            <p className="eyebrow">IMMUTABLE HISTORY</p>
            <h2>Recent access activity</h2>
          </div>
          <span className="permissionNote">Latest 25 changes</span>
        </div>
        {!data?.audit.length ? (
          <div className="emptyAudit">Access changes will appear here.</div>
        ) : (
          <ol className="auditList">
            {data.audit.map((entry) => (
              <li key={entry.id}>
                <span className="auditDot" />
                <div>
                  <strong>{peopleByUser.get(entry.actorUserId) ?? "Former administrator"}</strong>
                  {" "}{actionLabels[entry.action]} for{" "}
                  <strong>
                    {peopleByMembership.get(entry.targetMembershipId) ?? "former member"}
                  </strong>
                  <small>{formatDate(entry.createdAt)}</small>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <aside>
        <b>Safety controls</b>
        <span>
          Invitation rights apply only to leads in this organization. The final
          active administrator cannot be demoted or suspended.
        </span>
      </aside>
    </main>
  );
}

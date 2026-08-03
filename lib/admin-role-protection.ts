export type AdministratorProtectionInput = {
  actorUserId: number;
  targetUserId: number;
  targetRole: unknown;
  targetStatus: unknown;
  nextRole: unknown;
  nextStatus: unknown;
};

export function isAdministratorAccessReduction({
  actorUserId,
  targetUserId,
  targetRole,
  targetStatus,
  nextRole,
  nextStatus,
}: AdministratorProtectionInput) {
  if (actorUserId === targetUserId || targetRole !== "admin") return false;

  return (
    nextRole !== "admin" ||
    (targetStatus === "active" && nextStatus !== "active")
  );
}

export function isAdministratorProtectedFromActor({
  actorUserId,
  targetUserId,
  targetRole,
  actorMayManageProtectedAdministrators,
}: {
  actorUserId: number;
  targetUserId: number;
  targetRole: unknown;
  actorMayManageProtectedAdministrators: boolean;
}) {
  return (
    targetRole === "admin" &&
    actorUserId !== targetUserId &&
    !actorMayManageProtectedAdministrators
  );
}

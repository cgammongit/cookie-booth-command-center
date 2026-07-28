export type BoothLifecycleStatus =
  | "draft"
  | "scheduled"
  | "live"
  | "pending_closure"
  | "closed";

export function getEffectiveBoothStatus(
  booth: {
    status: string;
    startsAt: string;
    endsAt: string;
    archivedAt?: string | null;
  },
  now = new Date(),
): BoothLifecycleStatus {
  if (booth.status === "closed") return "closed";
  if (booth.status === "draft") return "draft";

  const startsAt = new Date(booth.startsAt);
  const endsAt = new Date(booth.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return booth.status === "live" ? "live" : "scheduled";
  }

  if (now < startsAt) return "scheduled";
  if (now <= endsAt) return "live";
  return "pending_closure";
}

export function canRecordBoothSales(status: BoothLifecycleStatus) {
  return status === "live" || status === "pending_closure";
}

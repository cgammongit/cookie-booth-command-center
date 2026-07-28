import { env } from "cloudflare:workers";

export type BoothLiveTopic =
  | "sales"
  | "inventory"
  | "payments"
  | "lifecycle"
  | "reconciliation"
  | "closure";

export type BoothLiveEvent =
  | {
      type: "ready";
      boothId: number;
      revision: number;
    }
  | {
      type: "invalidate";
      boothId: number;
      revision: number;
      topics: BoothLiveTopic[];
    };

export async function broadcastBoothEvent(
  organizationId: number,
  boothId: number,
  topics: BoothLiveTopic[],
) {
  const room = env.BOOTH_LIVE_ROOMS.getByName(`${organizationId}:${boothId}`);
  const response = await room.fetch("https://booth-live.internal/publish", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-live-organization-id": String(organizationId),
      "x-live-booth-id": String(boothId),
    },
    body: JSON.stringify({ topics: [...new Set(topics)] }),
  });
  if (!response.ok) {
    throw new Error(`Live booth broadcast failed with status ${response.status}`);
  }
}

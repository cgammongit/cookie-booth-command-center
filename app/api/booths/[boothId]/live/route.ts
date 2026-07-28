import { env } from "cloudflare:workers";
import { requireBoothAccess } from "../../../../../lib/access";

export async function GET(
  request: Request,
  context: { params: Promise<{ boothId: string }> },
) {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return Response.json({ error: "WebSocket upgrade required" }, { status: 426 });
  }
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!origin || origin !== requestUrl.origin) {
    return Response.json({ error: "WebSocket origin is not allowed" }, { status: 403 });
  }

  const { boothId: rawBoothId } = await context.params;
  const boothId = Number(rawBoothId);
  if (!Number.isInteger(boothId) || boothId < 1) {
    return Response.json({ error: "Invalid booth" }, { status: 400 });
  }

  const authorization = await requireBoothAccess(boothId);
  if (authorization.error) return authorization.error;

  const organizationId = authorization.access.organizationId;
  const room = env.BOOTH_LIVE_ROOMS.getByName(`${organizationId}:${boothId}`);
  const headers = new Headers(request.headers);
  headers.set("x-live-organization-id", String(organizationId));
  headers.set("x-live-booth-id", String(boothId));
  headers.set("x-live-user-id", String(authorization.access.userId));
  return room.fetch(new Request("https://booth-live.internal/connect", {
    method: "GET",
    headers,
  }));
}

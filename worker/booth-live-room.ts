import { DurableObject } from "cloudflare:workers";
import type { BoothLiveEvent, BoothLiveTopic } from "../lib/booth-live";

type RoomIdentity = {
  organizationId: number;
  boothId: number;
};

function readIdentity(request: Request): RoomIdentity | null {
  const organizationId = Number(request.headers.get("x-live-organization-id"));
  const boothId = Number(request.headers.get("x-live-booth-id"));
  if (
    !Number.isInteger(organizationId) ||
    organizationId < 1 ||
    !Number.isInteger(boothId) ||
    boothId < 1
  ) {
    return null;
  }
  return { organizationId, boothId };
}

export class BoothLiveRoom extends DurableObject<Cloudflare.Env> {
  private identity: RoomIdentity | null = null;
  private revision = 0;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
    ctx.blockConcurrencyWhile(async () => {
      const [identity, revision] = await Promise.all([
        ctx.storage.get<RoomIdentity>("identity"),
        ctx.storage.get<number>("revision"),
      ]);
      this.identity = identity || null;
      this.revision = revision || 0;
    });
  }

  private async establishIdentity(request: Request) {
    const requested = readIdentity(request);
    if (!requested) return false;
    if (
      this.identity &&
      (
        this.identity.organizationId !== requested.organizationId ||
        this.identity.boothId !== requested.boothId
      )
    ) {
      return false;
    }
    if (!this.identity) {
      this.identity = requested;
      await this.ctx.storage.put("identity", requested);
    }
    return true;
  }

  private send(socket: WebSocket, event: BoothLiveEvent) {
    try {
      socket.send(JSON.stringify(event));
    } catch {
      try {
        socket.close(1011, "Unable to deliver live update");
      } catch {
        // The socket is already gone.
      }
    }
  }

  private async publish(topics: BoothLiveTopic[]) {
    if (!this.identity) return;
    this.revision += 1;
    await this.ctx.storage.put("revision", this.revision);
    const event: BoothLiveEvent = {
      type: "invalidate",
      boothId: this.identity.boothId,
      revision: this.revision,
      topics,
    };
    for (const socket of this.ctx.getWebSockets()) this.send(socket, event);
  }

  private async scheduleLifecycleAlarm() {
    if (!this.identity) return;
    const booth = await this.env.DB.prepare(`
      SELECT status, starts_at AS startsAt, ends_at AS endsAt, archived_at AS archivedAt
      FROM booths WHERE id = ? AND organization_id = ?
    `).bind(
      this.identity.boothId,
      this.identity.organizationId,
    ).first<{
      status: string;
      startsAt: string;
      endsAt: string;
      archivedAt: string | null;
    }>();

    if (!booth || booth.archivedAt || booth.status === "closed") {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const now = Date.now();
    const boundaries = [
      new Date(booth.startsAt).getTime(),
      new Date(booth.endsAt).getTime() + 1,
    ].filter((boundary) => Number.isFinite(boundary) && boundary > now);
    if (boundaries.length) {
      await this.ctx.storage.setAlarm(Math.min(...boundaries));
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    if (!await this.establishIdentity(request)) {
      return new Response("Room identity does not match", { status: 403 });
    }

    if (url.pathname === "/connect") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket upgrade required", { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      this.send(server, {
        type: "ready",
        boothId: this.identity!.boothId,
        revision: this.revision,
      });
      await this.scheduleLifecycleAlarm();
      const init: ResponseInit & { webSocket: WebSocket } = {
        status: 101,
        webSocket: client,
      };
      return new Response(null, init);
    }

    if (url.pathname === "/publish" && request.method === "POST") {
      const payload = await request.json().catch(() => null) as {
        topics?: BoothLiveTopic[];
      } | null;
      const allowed = new Set<BoothLiveTopic>([
        "sales",
        "inventory",
        "payments",
        "lifecycle",
        "reconciliation",
        "closure",
      ]);
      const topics = [...new Set(payload?.topics || [])].filter(
        (topic): topic is BoothLiveTopic => allowed.has(topic),
      );
      if (!topics.length) return new Response("Event topics are required", { status: 400 });
      await this.ctx.blockConcurrencyWhile(() => this.publish(topics));
      if (topics.includes("lifecycle") || topics.includes("closure")) {
        await this.scheduleLifecycleAlarm();
      }
      return Response.json({ revision: this.revision });
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm() {
    await this.ctx.blockConcurrencyWhile(() => this.publish(["lifecycle"]));
    await this.scheduleLifecycleAlarm();
  }
}

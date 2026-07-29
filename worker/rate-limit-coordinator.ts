import { DurableObject } from "cloudflare:workers";

type CounterState = {
  windowStartedAt: number;
  count: number;
};

export class RateLimitCoordinator extends DurableObject<Cloudflare.Env> {
  async fetch(request: Request) {
    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== "/consume"
    ) {
      return new Response("Not found", { status: 404 });
    }
    const body = await request.json().catch(() => null) as {
      limit?: number;
      periodSeconds?: number;
    } | null;
    const limit = Number(body?.limit);
    const periodSeconds = Number(body?.periodSeconds);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      !Number.isInteger(periodSeconds) ||
      periodSeconds < 1 ||
      periodSeconds > 3600
    ) {
      return Response.json({ error: "Invalid policy" }, { status: 400 });
    }

    const now = Date.now();
    const periodMs = periodSeconds * 1000;
    return this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<CounterState>("counter");
      const counter =
        !stored || now - stored.windowStartedAt >= periodMs
          ? { windowStartedAt: now, count: 0 }
          : stored;
      if (counter.count >= limit) {
        return Response.json({
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((counter.windowStartedAt + periodMs - now) / 1000),
          ),
        });
      }
      counter.count += 1;
      await this.ctx.storage.put("counter", counter);
      return Response.json({ allowed: true, retryAfterSeconds: 0 });
    });
  }
}

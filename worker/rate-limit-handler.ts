import {
  consumeRateLimit,
  minimizedIpIdentity,
  rateLimitedResponse,
  RATE_LIMIT_POLICIES,
  type RateLimitClass,
  type RateLimitEnv,
  type RateLimitPolicy,
} from "../lib/rate-limit";
import { safeRoute } from "../lib/security";

type Identity = {
  clerkUserId: string;
  organizationId?: number;
  boothId?: number;
};

type LimitCheck = {
  identity: string;
  policy?: RateLimitPolicy;
};

const BOOTH_PATH = /^\/api\/booths\/(\d+)(?:\/|$)/;
const INVITATION_PATH = /^\/api\/organization-invitations\/(\d+)(?:\/|$)/;

export function classifyRateLimitedRoute(
  request: Request,
): RateLimitClass | null {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/api/")) return null;
  if (pathname === "/api/webhooks/clerk" || pathname.endsWith("/live")) return null;
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
    return "authenticated_read";
  }
  if (/\/sales\/?$/.test(pathname)) return "sale";
  if (
    pathname === "/api/admin/booth-inventory" ||
    pathname === "/api/admin/troop-inventory"
  ) {
    return "inventory";
  }
  if (
    /\/reconciliation\/?$/.test(pathname) ||
    /\/archive\/?$/.test(pathname) ||
    (pathname === "/api/booths" && request.method === "POST")
  ) {
    return "lifecycle";
  }
  if (pathname.startsWith("/api/organization-invitations")) return "invitation";
  return "administrative";
}

async function readRequestedOrganizationId(request: Request) {
  const url = new URL(request.url);
  const queryValue = Number(url.searchParams.get("organizationId"));
  if (Number.isInteger(queryValue) && queryValue > 0) return queryValue;
  if (["GET", "HEAD"].includes(request.method.toUpperCase())) return null;
  const body = await request.clone().json().catch(() => null) as {
    organizationId?: unknown;
  } | null;
  const bodyValue = Number(body?.organizationId);
  return Number.isInteger(bodyValue) && bodyValue > 0 ? bodyValue : null;
}

async function readRequestedBoothId(request: Request) {
  if (["GET", "HEAD"].includes(request.method.toUpperCase())) return null;
  const body = await request.clone().json().catch(() => null) as {
    boothId?: unknown;
  } | null;
  const boothId = Number(body?.boothId);
  return Number.isInteger(boothId) && boothId > 0 ? boothId : null;
}

async function resolveIdentity(
  request: Request,
  env: { DB: D1Database },
  clerkUserId: string,
): Promise<Identity> {
  const pathname = new URL(request.url).pathname;
  const boothId = Number(pathname.match(BOOTH_PATH)?.[1]);
  if (Number.isInteger(boothId) && boothId > 0) {
    const membership = await env.DB.prepare(`
      SELECT m.organization_id AS organizationId
      FROM booths b
      INNER JOIN memberships m ON m.organization_id = b.organization_id
      INNER JOIN users u ON u.id = m.user_id
      WHERE b.id = ? AND u.clerk_user_id = ?
        AND u.status = 'active' AND m.status = 'active'
      LIMIT 1
    `).bind(boothId, clerkUserId).first<{ organizationId: number }>();
    if (membership) {
      return { clerkUserId, organizationId: membership.organizationId, boothId };
    }
    return { clerkUserId };
  }

  const invitationId = Number(pathname.match(INVITATION_PATH)?.[1]);
  let organizationId = await readRequestedOrganizationId(request);
  if (!organizationId && Number.isInteger(invitationId) && invitationId > 0) {
    const invitation = await env.DB.prepare(`
      SELECT organization_id AS organizationId
      FROM organization_invitations
      WHERE id = ?
      LIMIT 1
    `).bind(invitationId).first<{ organizationId: number }>();
    organizationId = invitation?.organizationId || null;
  }
  if (!organizationId) return { clerkUserId };

  const membership = await env.DB.prepare(`
    SELECT m.organization_id AS organizationId
    FROM memberships m
    INNER JOIN users u ON u.id = m.user_id
    WHERE m.organization_id = ? AND u.clerk_user_id = ?
      AND u.status = 'active' AND m.status = 'active'
    LIMIT 1
  `).bind(organizationId, clerkUserId).first<{ organizationId: number }>();
  if (!membership) return { clerkUserId };
  const requestedBoothId = await readRequestedBoothId(request);
  if (requestedBoothId) {
    const booth = await env.DB.prepare(`
      SELECT id FROM booths WHERE id = ? AND organization_id = ? LIMIT 1
    `).bind(requestedBoothId, membership.organizationId).first<{ id: number }>();
    if (booth) {
      return {
        clerkUserId,
        organizationId: membership.organizationId,
        boothId: requestedBoothId,
      };
    }
  }
  return { clerkUserId, organizationId: membership.organizationId };
}

function checksFor(routeClass: RateLimitClass, identity: Identity): LimitCheck[] {
  const organization = identity.organizationId
    ? `org:${identity.organizationId}`
    : "org:unresolved";
  const user = `user:${identity.clerkUserId}`;
  const booth = identity.boothId ? `booth:${identity.boothId}` : "booth:none";
  const primary = identity.boothId
    ? `${organization}:${user}:${booth}`
    : `${organization}:${user}`;
  const checks: LimitCheck[] = [{ identity: primary }];

  if (routeClass === "sale" && identity.organizationId && identity.boothId) {
    checks.push(
      {
        identity: `${organization}:${booth}:aggregate`,
        policy: { ...RATE_LIMIT_POLICIES.sale, limit: 300 },
      },
      {
        identity: `${organization}:aggregate`,
        policy: { ...RATE_LIMIT_POLICIES.sale, limit: 600 },
      },
    );
  }
  if (routeClass === "inventory" && identity.organizationId) {
    if (identity.boothId) {
      checks.push({
        identity: `${organization}:${booth}:aggregate`,
        policy: { ...RATE_LIMIT_POLICIES.inventory, limit: 120 },
      });
    }
    checks.push({
      identity: `${organization}:aggregate`,
      policy: { ...RATE_LIMIT_POLICIES.inventory, limit: 240 },
    });
  }
  return checks;
}

export async function enforceWorkerRateLimit({
  request,
  env,
  requestId,
  authenticate,
}: {
  request: Request;
  env: RateLimitEnv & { DB: D1Database };
  requestId: string;
  authenticate: (request: Request) => Promise<string | null>;
}): Promise<Response | null> {
  const routeClass = classifyRateLimitedRoute(request);
  if (!routeClass) return null;
  const route = safeRoute(request);
  const clerkUserId = await authenticate(request).catch(() => null);
  if (!clerkUserId) {
    const ipIdentity = await minimizedIpIdentity(request);
    const decision = await consumeRateLimit({
      env,
      routeClass: "unauthenticated",
      identity: `${routeClass}:${ipIdentity}`,
      requestId,
      route,
    });
    return decision.allowed
      ? null
      : rateLimitedResponse(requestId, decision.retryAfterSeconds);
  }

  const identity = await resolveIdentity(request, env, clerkUserId);
  for (const check of checksFor(routeClass, identity)) {
    const decision = await consumeRateLimit({
      env,
      routeClass,
      identity: check.identity,
      requestId,
      route,
      policy: check.policy,
    });
    if (!decision.allowed) {
      return rateLimitedResponse(requestId, decision.retryAfterSeconds);
    }
  }
  return null;
}

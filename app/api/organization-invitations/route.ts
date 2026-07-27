import { clerkClient } from "@clerk/nextjs/server";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../../db";
import { memberships, organizationInvitations, users } from "../../../db/schema";
import { requireInvitationManager } from "../../../lib/access";
import {
  clerkErrorMessage,
  invitationRedirectUrl,
  listOrganizationInvitations,
} from "../../../lib/invitations";

const roleSchema = z.enum(["admin", "lead", "volunteer", "auditor"]);
const querySchema = z.object({
  organizationId: z.coerce.number().int().positive(),
});
const createSchema = z
  .object({
    organizationId: z.number().int().positive(),
    email: z.string().trim().email().max(254),
    role: roleSchema,
    canInviteUsers: z.boolean().default(false),
  })
  .strict();

export async function GET(request: Request) {
  const parsed = querySchema.safeParse({
    organizationId: new URL(request.url).searchParams.get("organizationId"),
  });
  if (!parsed.success) {
    return Response.json({ error: "A valid organization is required" }, { status: 400 });
  }
  const authorization = await requireInvitationManager(parsed.data.organizationId);
  if (authorization.error) return authorization.error;

  const invitations = await listOrganizationInvitations(parsed.data.organizationId);
  return Response.json({
    people: [],
    audit: [],
    currentUserId: authorization.access.userId,
    invitations:
      authorization.access.role === "admin"
        ? invitations
        : invitations.filter(
            (invitation) =>
              invitation.role === "volunteer" &&
              invitation.invitedByUserId === authorization.access.userId,
          ),
  });
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "A valid email address, role, and organization are required" },
      { status: 400 },
    );
  }

  const requested = {
    ...parsed.data,
    email: parsed.data.email.toLowerCase(),
    canInviteUsers: parsed.data.role === "lead" && parsed.data.canInviteUsers,
  };
  const authorization = await requireInvitationManager(requested.organizationId);
  if (authorization.error) return authorization.error;
  if (authorization.access.role === "lead" && requested.role !== "volunteer") {
    return Response.json(
      { error: "Delegated leads may invite volunteers only" },
      { status: 403 },
    );
  }

  const db = getDb();
  const [existingInvitation] = await db
    .select({ id: organizationInvitations.id })
    .from(organizationInvitations)
    .where(
      and(
        eq(organizationInvitations.organizationId, requested.organizationId),
        eq(organizationInvitations.email, requested.email),
        eq(organizationInvitations.status, "pending"),
      ),
    )
    .limit(1);
  if (existingInvitation) {
    return Response.json(
      { error: "A pending invitation already exists for this email address" },
      { status: 409 },
    );
  }

  await env.DB.prepare(`
    INSERT INTO users (clerk_user_id, email, display_name, status, last_synced_at)
    VALUES (NULL, ?, ?, 'active', '')
    ON CONFLICT(email) DO NOTHING
  `).bind(requested.email, requested.email.split("@")[0]).run();

  const [invitee] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, requested.email))
    .limit(1);
  if (!invitee) {
    return Response.json({ error: "Unable to prepare the invited user" }, { status: 500 });
  }

  const [existingMembership] = await db
    .select({ id: memberships.id, status: memberships.status })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, requested.organizationId),
        eq(memberships.userId, invitee.id),
      ),
    )
    .limit(1);
  if (existingMembership) {
    return Response.json(
      {
        error:
          existingMembership.status === "suspended"
            ? "This account is suspended. Restore it from People & roles instead."
            : "This person already has organization access",
      },
      { status: 409 },
    );
  }

  let clerkInvitationId = "";
  try {
    const invitation = await (await clerkClient()).invitations.createInvitation({
      emailAddress: requested.email,
      redirectUrl: invitationRedirectUrl(request),
      publicMetadata: {
        cookieBoothOrganizationId: requested.organizationId,
        cookieBoothRole: requested.role,
      },
    });
    clerkInvitationId = invitation.id;
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO memberships (
          organization_id, user_id, role, status, can_invite_users, created_at, updated_at
        ) VALUES (?, ?, ?, 'pending', ?, ?, ?)
      `).bind(
        requested.organizationId,
        invitee.id,
        requested.role,
        requested.canInviteUsers ? 1 : 0,
        now,
        now,
      ),
      env.DB.prepare(`
        INSERT INTO organization_invitations (
          organization_id, membership_id, email, role, can_invite_users, status,
          clerk_invitation_id, invited_by_user_id, created_at, updated_at
        )
        SELECT ?, id, ?, ?, ?, 'pending', ?, ?, ?, ?
        FROM memberships
        WHERE organization_id = ? AND user_id = ?
      `).bind(
        requested.organizationId,
        requested.email,
        requested.role,
        requested.canInviteUsers ? 1 : 0,
        clerkInvitationId,
        authorization.access.userId,
        now,
        now,
        requested.organizationId,
        invitee.id,
      ),
      env.DB.prepare(`
        INSERT INTO access_audit_log (
          organization_id, actor_user_id, target_membership_id, action,
          before_json, after_json, created_at
        )
        SELECT ?, ?, id, 'invitation_created', '{}', ?, ?
        FROM memberships
        WHERE organization_id = ? AND user_id = ?
      `).bind(
        requested.organizationId,
        authorization.access.userId,
        JSON.stringify({
          email: requested.email,
          role: requested.role,
          canInviteUsers: requested.canInviteUsers,
          status: "pending",
        }),
        now,
        requested.organizationId,
        invitee.id,
      ),
    ]);
  } catch (error) {
    if (clerkInvitationId) {
      try {
        await (await clerkClient()).invitations.revokeInvitation(clerkInvitationId);
      } catch {
        // The database remains authoritative; a failed cleanup is visible in Clerk.
      }
    }
    return Response.json({ error: clerkErrorMessage(error) }, { status: 502 });
  }

  return Response.json(
    { invitation: { email: requested.email, role: requested.role, status: "pending" } },
    { status: 201 },
  );
}

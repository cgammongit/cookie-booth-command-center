import { clerkClient } from "@clerk/nextjs/server";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { organizationInvitations } from "../../../../../db/schema";
import { requireInvitationManager } from "../../../../../lib/access";
import {
  clerkErrorMessage,
  invitationRedirectUrl,
} from "../../../../../lib/invitations";

export async function POST(
  request: Request,
  context: { params: Promise<{ invitationId: string }> },
) {
  const { invitationId: rawInvitationId } = await context.params;
  const invitationId = Number(rawInvitationId);
  const body = (await request.json().catch(() => null)) as
    | { organizationId?: unknown }
    | null;
  const organizationId = Number(body?.organizationId);
  if (!Number.isInteger(invitationId) || !Number.isInteger(organizationId)) {
    return Response.json({ error: "Invalid invitation" }, { status: 400 });
  }

  const authorization = await requireInvitationManager(organizationId);
  if (authorization.error) return authorization.error;
  const [invitation] = await getDb()
    .select()
    .from(organizationInvitations)
    .where(
      and(
        eq(organizationInvitations.id, invitationId),
        eq(organizationInvitations.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!invitation) {
    return Response.json({ error: "Invitation not found" }, { status: 404 });
  }
  if (invitation.status !== "pending") {
    return Response.json(
      { error: "Only pending invitations can be resent" },
      { status: 409 },
    );
  }
  if (
    authorization.access.role === "lead" &&
    (invitation.role !== "volunteer" ||
      invitation.invitedByUserId !== authorization.access.userId)
  ) {
    return Response.json(
      { error: "Delegated leads may manage their volunteer invitations only" },
      { status: 403 },
    );
  }

  try {
    const client = await clerkClient();
    const replacement = await client.invitations.createInvitation({
      emailAddress: invitation.email,
      redirectUrl: invitationRedirectUrl(request),
      ignoreExisting: true,
      publicMetadata: {
        cookieBoothOrganizationId: organizationId,
        cookieBoothRole: invitation.role,
      },
    });
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE organization_invitations
        SET clerk_invitation_id = ?, updated_at = ?
        WHERE id = ? AND organization_id = ? AND status = 'pending'
      `).bind(replacement.id, now, invitationId, organizationId),
      env.DB.prepare(`
        INSERT INTO access_audit_log (
          organization_id, actor_user_id, target_membership_id, action,
          before_json, after_json, created_at
        ) VALUES (?, ?, ?, 'invitation_resent', ?, ?, ?)
      `).bind(
        organizationId,
        authorization.access.userId,
        invitation.membershipId,
        JSON.stringify({ clerkInvitationId: invitation.clerkInvitationId }),
        JSON.stringify({ clerkInvitationId: replacement.id }),
        now,
      ),
    ]);
    try {
      await client.invitations.revokeInvitation(invitation.clerkInvitationId);
    } catch {
      // The replacement is already authoritative; the older link will expire.
    }
  } catch (error) {
    return Response.json({ error: clerkErrorMessage(error) }, { status: 502 });
  }
  return Response.json({ resent: true });
}

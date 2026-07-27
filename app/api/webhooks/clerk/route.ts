import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { env } from "cloudflare:workers";
import type { NextRequest } from "next/server";

type ClerkEmail = { id: string; email_address: string };
type ClerkUserData = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  primary_email_address_id: string | null;
  email_addresses: ClerkEmail[];
  public_metadata?: {
    cookieBoothOrganizationId?: unknown;
    cookieBoothRole?: unknown;
  };
};

export async function POST(request: NextRequest) {
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET) {
    return Response.json({ error: "Webhook is not configured" }, { status: 503 });
  }

  let event;
  try {
    event = await verifyWebhook(request);
  } catch {
    return Response.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  const now = new Date().toISOString();
  if (event.type === "user.deleted") {
    const clerkUserId = event.data.id;
    if (clerkUserId) {
      await env.DB
        .prepare("UPDATE users SET status = ?, last_synced_at = ? WHERE clerk_user_id = ?")
        .bind("disabled", now, clerkUserId)
        .run();
    }
    return Response.json({ received: true });
  }

  if (event.type === "user.created" || event.type === "user.updated") {
    const user = event.data as ClerkUserData;
    const primaryEmail =
      user.email_addresses?.find((email) => email.id === user.primary_email_address_id) ??
      user.email_addresses?.[0];

    // Clerk's generated webhook test payload may not contain an email address.
    // Acknowledge it so Clerk does not retry a non-actionable synthetic event.
    // Real invited users are synchronized once their event includes an email.
    if (!primaryEmail) {
      return Response.json({ received: true, skipped: "user_has_no_email" });
    }

    const displayName =
      [user.first_name, user.last_name].filter(Boolean).join(" ") ||
      primaryEmail.email_address.split("@")[0];

    const normalizedEmail = primaryEmail.email_address.toLowerCase();
    await env.DB
      .prepare(`
        INSERT INTO users (clerk_user_id, email, display_name, status, last_synced_at)
        VALUES (?, ?, ?, 'active', ?)
        ON CONFLICT(email) DO UPDATE SET
          clerk_user_id = excluded.clerk_user_id,
          display_name = excluded.display_name,
          status = 'active',
          last_synced_at = excluded.last_synced_at
      `)
      .bind(user.id, normalizedEmail, displayName, now)
      .run();

    const organizationId = Number(
      user.public_metadata?.cookieBoothOrganizationId,
    );
    if (event.type === "user.created" && Number.isInteger(organizationId)) {
      const invitation = await env.DB
        .prepare(`
          SELECT oi.id, oi.membership_id, m.user_id
          FROM organization_invitations oi
          INNER JOIN memberships m ON m.id = oi.membership_id
          WHERE oi.organization_id = ?
            AND oi.email = ?
            AND oi.status = 'pending'
          ORDER BY oi.created_at DESC
          LIMIT 1
        `)
        .bind(organizationId, normalizedEmail)
        .first<{
          id: number;
          membership_id: number;
          user_id: number;
        }>();

      if (invitation) {
        await env.DB.batch([
          env.DB.prepare(`
            UPDATE memberships
            SET status = 'active', updated_at = ?
            WHERE id = ? AND organization_id = ? AND status = 'pending'
          `).bind(now, invitation.membership_id, organizationId),
          env.DB.prepare(`
            UPDATE organization_invitations
            SET status = 'accepted', accepted_at = ?, updated_at = ?
            WHERE id = ? AND status = 'pending'
          `).bind(now, now, invitation.id),
          env.DB.prepare(`
            INSERT INTO access_audit_log (
              organization_id, actor_user_id, target_membership_id, action,
              before_json, after_json, created_at
            ) VALUES (?, ?, ?, 'invitation_accepted', ?, ?, ?)
          `).bind(
            organizationId,
            invitation.user_id,
            invitation.membership_id,
            JSON.stringify({ status: "pending", email: normalizedEmail }),
            JSON.stringify({ status: "active", email: normalizedEmail }),
            now,
          ),
        ]);
      }
    }
  }

  return Response.json({ received: true });
}

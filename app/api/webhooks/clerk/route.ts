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
      .bind(user.id, primaryEmail.email_address.toLowerCase(), displayName, now)
      .run();
  }

  return Response.json({ received: true });
}

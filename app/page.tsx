import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { memberships, organizations, users } from "../db/schema";
import { PendingAccessPanel, SignInPanel } from "./auth-panels";
import { Dashboard } from "./dashboard";

export const dynamic = "force-dynamic";

function AuthSetupPanel() {
  return (
    <main className="authShell">
      <section className="authCard">
        <p className="eyebrow">MILESTONE 2 · AUTHENTICATION</p>
        <h1>Secure sign-in is ready to connect.</h1>
        <p>The application is waiting for its Clerk development keys. No credential values are stored in the source repository.</p>
        <small>The existing command-center release remains protected while configuration is completed.</small>
      </section>
    </main>
  );
}

export default async function Home() {
  const clerkConfigured = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    process.env.CLERK_SECRET_KEY,
  );

  if (!clerkConfigured) return <AuthSetupPanel />;

  const { userId } = await auth();
  if (!userId) return <SignInPanel />;

  const db = getDb();
  const access = await db
    .select({
      displayName: users.displayName,
      role: memberships.role,
      organizationId: organizations.id,
      organizationName: organizations.name,
    })
    .from(users)
    .innerJoin(
      memberships,
      and(
        eq(memberships.userId, users.id),
        eq(memberships.status, "active"),
        eq(users.status, "active"),
      ),
    )
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(eq(users.clerkUserId, userId))
    .limit(1);

  if (!access[0]) return <PendingAccessPanel />;
  return (
    <Dashboard
      displayName={access[0].displayName}
      role={access[0].role}
      organizationId={access[0].organizationId}
      organizationName={access[0].organizationName}
    />
  );
}

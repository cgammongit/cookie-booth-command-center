import { auth } from "@clerk/nextjs/server";
import { UserProfile } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AccountSecurityPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  return (
    <main className="accountShell">
      <header className="accountHeader">
        <div>
          <p className="eyebrow">ACCOUNT SECURITY</p>
          <h1>Protect your account</h1>
        </div>
        <Link className="secondaryLink" href="/">Return to command center</Link>
      </header>
      <p className="accountIntro">
        Configure multi-factor authentication, review your sign-in methods, or
        sign out through Clerk&apos;s secure account settings.
      </p>
      <UserProfile routing="path" path="/account" />
    </main>
  );
}

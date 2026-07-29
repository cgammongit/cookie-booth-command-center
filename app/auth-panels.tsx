"use client";

import { SignInButton, SignOutButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";

export function SignInPanel() {
  return (
    <main className="authShell">
      <section className="authCard">
        <p className="eyebrow">COOKIE BOOTH COMMAND CENTER</p>
        <h1>Welcome back.</h1>
        <p>Sign in with an invited Google or email account to continue.</p>
        <SignInButton mode="modal"><button className="primary authAction">Sign in securely</button></SignInButton>
        <small>Access is invitation-only. Signing in does not automatically grant booth access.</small>
      </section>
    </main>
  );
}

export function PendingAccessPanel() {
  return (
    <main className="authShell">
      <section className="authCard">
        <div className="authUser"><UserButton /></div>
        <p className="eyebrow">IDENTITY VERIFIED</p>
        <h1>Your access is pending.</h1>
        <p>An organization administrator must assign your account a role before you can open a booth.</p>
        <small>You may safely close this page and return after your invitation has been approved.</small>
      </section>
    </main>
  );
}

export function MfaRequiredPanel({
  statusUnavailable = false,
}: {
  statusUnavailable?: boolean;
}) {
  return (
    <main className="authShell">
      <section className="authCard" aria-labelledby="mfa-required-title">
        <div className="authUser"><UserButton /></div>
        <p className="eyebrow">ADMINISTRATOR SECURITY</p>
        <h1 id="mfa-required-title">MFA Required</h1>
        <p>
          Administrators protect organization access, inventory, and sales
          data. Set up multi-factor authentication before continuing.
        </p>
        {statusUnavailable && (
          <p className="authNotice" role="alert">
            Your MFA status could not be verified. Administrator access remains
            locked until Clerk can confirm enrollment.
          </p>
        )}
        <Link className="primary authAction" href="/account/security">
          Open account security
        </Link>
        <small>
          Use an MFA method enabled for this Clerk instance, such as an
          authenticator app and recovery codes. After enrollment, return here
          and refresh; Clerk may ask you to sign in again.
        </small>
        <SignOutButton>
          <button className="secondary authAction">Sign out</button>
        </SignOutButton>
      </section>
    </main>
  );
}

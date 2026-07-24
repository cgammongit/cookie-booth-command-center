"use client";

import { SignInButton, UserButton } from "@clerk/nextjs";

export function SignInPanel() {
  return (
    <main className="authShell">
      <section className="authCard">
        <p className="eyebrow">COOKIE BOOTH COMMAND CENTER</p>
        <h1>Welcome back.</h1>
        <p>Sign in with an invited Google, Microsoft, or email account to continue.</p>
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

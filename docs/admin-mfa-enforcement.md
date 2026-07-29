# Administrator-only MFA enforcement

## Policy

Cookie Booth Command Center requires multi-factor authentication (MFA) for any
signed-in user who has an active Administrator membership in any accessible
organization. Booth Leads, Volunteers, and Auditors are not blocked when they
have not enrolled, but every signed-in user can voluntarily configure MFA from
**Set up MFA** / **Account security**.

This application policy is intentionally separate from Clerk's instance-wide
**Require multi-factor authentication** setting. Keep that global setting
disabled: enabling it would require MFA for every role.

Clerk remains the identity system of record for enrollment. The server reads
`User.twoFactorEnabled` using the installed Clerk SDK (`@clerk/backend` 3.13.0
and `@clerk/nextjs` 7.6.x). D1 remains authoritative for active organization
memberships and roles. Client role or MFA claims are ignored.

## Enforcement design

- `lib/admin-mfa-policy.ts` contains the dependency-injected, fail-closed
  policy.
- `lib/admin-mfa.ts` resolves active Administrator membership across all
  organizations from D1 and fetches the Clerk user server-side.
- The server-rendered application presents **MFA Required** before rendering
  operational data.
- Shared organization and booth access helpers reject unenrolled
  Administrators before route-specific authorization or business work.
- `/api/me` applies the same gate independently.
- Both the application WebSocket route and raw Worker WebSocket path repeat the
  authoritative check before opening a Durable Object connection.
- `/account/security` hosts Clerk's routed User Profile. It is intentionally
  available to every authenticated user so an Administrator can enroll and a
  non-Administrator can opt in. Signing out remains available.

An Administrator promoted while signed in is gated on the next page request,
API authorization, or WebSocket connection because membership is queried on
each authoritative check. Demotion removes the mandatory gate on the next
check. Organization switching cannot bypass the policy because one active
Administrator membership anywhere triggers it.

If D1 cannot determine Administrator membership, or Clerk cannot return an
authoritative enrollment status for an Administrator, access fails closed. The
UI does not expose raw Clerk errors. No MFA secrets, TOTP material, recovery
codes, tokens, cookies, or user profile payloads are logged.

## Clerk Dashboard release settings

Before release, an authorized Clerk operator must:

1. In the production Clerk instance, enable at least the authenticator-app
   (TOTP) MFA strategy and backup/recovery codes. Enable any additional
   organization-approved MFA strategies only after testing them.
2. Confirm User Profile security settings allow users to enroll and manage
   those methods.
3. Keep the global **Require multi-factor authentication** option disabled.
4. Leave Clerk Client Trust protections enabled and unchanged.
5. Confirm restricted/invitation-only access plus Google and email sign-in
   remain enabled.

No Clerk setting, secret, or production configuration is changed by this PR.

## Enrollment and recovery

An unenrolled Administrator sees the blocking page with a fixed,
same-application link to `/account/security`. The route does not accept a
caller-controlled return URL. After Clerk confirms enrollment, the operator
returns to `/` and refreshes. If Clerk has not refreshed the session or asks
for reauthentication, sign out and sign in again. This fixed flow avoids open
redirects and redirect loops.

Recovery is handled by Clerk using the enabled recovery methods. Operators
must store recovery codes securely and follow the organization's identity
recovery procedure. Application administrators cannot view or recover MFA
secrets.

## Deployment and smoke tests

1. Confirm the reviewed commit and a clean tree.
2. Confirm Clerk strategy settings above in the target Clerk instance.
3. Run lint, TypeScript, the full test suite, production build, artifact
   validation, credential scan, `npm audit`, and Wrangler dry-run.
4. Deploy the compatible Worker version through the normal reviewed process.
5. Test an enrolled Administrator: page, admin mutation, sale, reconciliation,
   and WebSocket connection succeed.
6. Test an unenrolled Administrator: `/` shows **MFA Required** and direct
   privileged API/WebSocket requests return 403.
7. Complete enrollment through `/account/security`, refresh or sign in again,
   and verify access is restored without a redirect loop.
8. Test Lead, Volunteer, and Auditor accounts without MFA; each retains its
   existing authorized access and sees the optional setup link.
9. Promote a test Lead to Administrator and verify the next authoritative
   request is blocked until enrollment.
10. Confirm Google sign-in, email sign-in, Google Places, polling, live sync,
    rate limiting, security headers, and CSP Report-Only remain healthy.

## Rollback

Roll back to the immediately preceding compatible Worker deployment. This
change has no D1 migration, Durable Object migration, secret change, or data
rewrite. Worker rollback does not alter Clerk enrollment or Clerk settings.
If Clerk MFA strategies were enabled specifically for this release, leave them
available for voluntarily enrolled users; do not enable global required MFA.
Document the rollback and investigate before re-releasing the gate.

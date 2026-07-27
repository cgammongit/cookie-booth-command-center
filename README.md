# Cookie Booth Command Center

Production-oriented successor to
[`cookie-booth-inventory`](https://github.com/cgammongit/cookie-booth-inventory).
It models multi-location cookie booth operations with adult volunteer roles,
separate booth inventories, auditable transactions, and closing reconciliation.

## Product foundation

- Organization-scoped booth directory
- Live, scheduled, and closed booth states
- Admin, booth lead, volunteer, and auditor role model
- Per-booth product allocations and inventory
- Append-only sale, correction, and adjustment ledger
- Booth assignments and adult operator attribution
- Closing reconciliation records
- Responsive command-center and booth-operation views
- Explicit privacy boundary excluding scout identities and sales-credit allocation

## Milestone 2: external authentication

- Clerk-powered Google and email-code sign-in
- Restricted, invitation-only enrollment
- Server-side identity and membership checks
- Signed Clerk webhook handling for user lifecycle synchronization
- D1-backed external identity mapping and account status
- Authenticated account controls and access-pending state
- Real roles replace the former client-side role preview

Authentication credentials are runtime configuration and are never committed.
Copy `.env.example` for local development and store real values in protected
hosting environment variables.

## Milestone 3: organization access administration

Milestone 3 organization-access deliverables add:

- Organization-scoped membership status and role administration
- Delegated invitation rights for specifically approved leads
- Retained suspended memberships for historical accountability
- Administrator-only People & Roles APIs
- Protection against removing the final active administrator
- Append-only audit entries for role, status, and invitation-right changes
- A responsive People & Roles administrator interface
- Clerk-powered invitation email delivery
- Role assignment before an invitation is sent
- Delegated leads restricted to volunteer invitations
- Pending membership creation and automatic webhook activation after signup
- Resend and cancellation controls for pending invitations
- Retained invitation history and append-only invitation audit entries
- D1-backed booth directory with administrator-only booth creation
- Organization-wide visibility for administrators and read-only auditors
- Explicit booth assignments for leads and volunteers
- Server-side booth authorization helpers and protected booth endpoints
- Role-aware navigation and operational controls
- Audited booth assignment and removal actions

Apply all D1 migrations before deploying source that depends on them:

```bash
npx wrangler d1 migrations apply cookie-booth-command-center-db --remote
```

## Data boundaries

The platform stores operational information about organizations, adult
operators, locations, inventory, and transactions. It intentionally does not
store child information or allocate sales credit to individual scouts.

## Roadmap

1. Product and inventory administration
2. Atomic scanner transactions and idempotency
3. Real-time booth synchronization
4. Opening and closing workflows
5. Cross-location reporting and automatic exports

## Development

```bash
npm ci
npm run db:generate
npm run dev
```

## Verification

```bash
npm run lint
npm test
```

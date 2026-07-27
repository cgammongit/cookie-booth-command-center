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
- Searchable, paginated booth-centric staffing administration
- Google Places location selection with manual-address fallback
- Stored Google Place IDs and coordinates for stable location identity
- One-tap Google Maps directions for authorized booth users
- Retained booth archives instead of destructive deletion
- Separate views for naturally closed and manually archived booths
- Activity-aware administrator alerts when a booth is manually archived
- Acknowledgement, review, mute, and resolution controls with lifecycle audit history
- Organization product catalog with barcode, price, and active-status controls
- Per-booth opening inventory configuration with searchable booth selection
- Retained product records and auditable before-and-after inventory allocations
- D1-backed live inventory reads in the booth command center

Apply all D1 migrations before deploying source that depends on them:

```bash
npx wrangler d1 migrations apply cookie-booth-command-center-db --remote
```

For the archived-booth lifecycle release, apply
`0006_archived_booth_lifecycle.sql` before deploying or merging the source
that reads its new columns and tables. Manually archiving a booth removes it
from active operations but retains its inventory, transactions, assignments,
and reconciliation history. Naturally closed booths remain separately
identified in the archive.

The product and inventory administration release additionally requires
`0007_product_inventory_administration.sql`. Apply it before deploying source
that uses the Products & inventory administrator interface.

The troop-wide inventory release requires
`0009_troop_inventory_ledger.sql`. It creates the authoritative troop balance
projection and append-only stock ledger. Existing booth counts are preserved
as migrated booth-held stock rather than duplicated as newly available
inventory. After deployment, administrators receive initial and replenishment
orders under **Troop inventory**; booth allocation changes transfer available
stock without reducing total troop-owned inventory.

Google Places autocomplete is optional and activates when
`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is configured in the protected hosting
environment. Restrict the browser key to the production hostname and to the
Maps JavaScript API and Places API (New). Booth creation continues to support
manual address entry when the key is absent or Maps is unavailable.

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

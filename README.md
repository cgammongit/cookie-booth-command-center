# Cookie Booth Command Center

Production-oriented successor to
[`cookie-booth-inventory`](https://github.com/cgammongit/cookie-booth-inventory).
It models multi-location cookie booth operations with adult volunteer roles,
separate booth inventories, auditable transactions, and closing reconciliation.

## First milestone

- Organization-scoped booth directory
- Live, scheduled, and closed booth states
- Admin, booth lead, volunteer, and auditor role model
- Per-booth product allocations and inventory
- Append-only sale, correction, and adjustment ledger
- Booth assignments and adult operator attribution
- Closing reconciliation records
- Responsive command-center and booth-operation views
- Explicit privacy boundary excluding scout identities and sales-credit allocation

## Data boundaries

The platform stores operational information about organizations, adult
operators, locations, inventory, and transactions. It intentionally does not
store child information or allocate sales credit to individual scouts.

## Roadmap

1. Server-enforced authentication and authorization
2. Expiring adult-volunteer invitations
3. Barcode catalog registration
4. Atomic scanner transactions and idempotency
5. Real-time booth synchronization
6. Opening and closing workflows
7. Cross-location reporting and automatic exports

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

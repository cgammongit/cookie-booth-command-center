# Recent sales and sale reversal

Each booth exposes its five newest active sales, ordered by the authoritative
`sales.created_at` value and sale ID. Reversed sales remain in `sales` and
`transactions`, but are excluded from operational totals by the append-only
`sale_reversals` record.

Only the organization `admin` role receives `booth.sales.reverse`. The API
independently verifies authentication, active membership, organization and
booth ownership, the named permission, lifecycle state, reconciliation lock,
reason, and duplicate-reversal constraint. Volunteers with assigned booth
access can view Recent Sales but cannot reverse them.

Reversal restores each original transaction quantity to booth inventory and
troop-owned remaining stock, creates balancing inventory-ledger entries, and
excludes the original sale from payment, report, and provisional scout-credit
totals. Final scout credit exists only after reconciliation, and reconciled
booths cannot be reversed. `booths.sales_revision` plus the reconciliation
insert trigger prevents reconciliation from committing a snapshot made stale
by a sale or reversal. The unique `sale_reversals.sale_id` index makes retries
and concurrent attempts idempotent.

## Deployment

Migration `0014_recent_sales_reversal.sql` is additive for existing sales. The
safest release order is:

1. Capture the production D1 bookmark and confirm only migration 0014 is
   pending.
2. Apply migration 0014 to the configured production `DB` target.
3. Merge/deploy the compatible Worker immediately after the migration.
4. Verify migration history, bindings, version traffic, Recent Sales read-only
   behavior, and unauthorized reversal rejection.

Existing Worker code does not reference the new table before deployment, so
migration-first is compatible. Do not roll the database back destructively.
If the Worker must be rolled back, select the prior compatible Worker version;
the additive table and columns can safely remain unused. Prefer a reviewed
forward fix for data concerns and follow the disaster-recovery runbook before
any Time Travel action.

## Manual smoke test

Use a designated test booth: record one small sale, confirm it appears on two
devices, reverse it as an administrator with a reason, and confirm inventory,
the matching payment total, provisional scout credit, reports, and both clients
refresh. Confirm a volunteer sees the sale without an Undo button and that a
second reversal receives a conflict. Never use a reconciled booth.

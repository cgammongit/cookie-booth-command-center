# Inventory allocation adjustments

## Behavior

Administrators may change booth product allocations while a booth is not closed
or archived. Recorded sales and prior adjustments do not lock the field. The
minimum allocation for a product is:

```text
max(0, boxes sold - inventory adjustments)
```

This preserves the inventory invariant used throughout the application:

```text
remaining = opening allocation + inventory adjustments - boxes sold
```

The form displays the minimum beside products with activity, marks values below
it as invalid, and disables saving only while a value is invalid, a save is in
progress, or the booth is closed or archived.

## Server validation and concurrency

`GET /api/admin/booth-inventory` returns an opaque revision derived from the
authoritative booth lifecycle and inventory rows. A save must return that
revision.

The server:

1. Rechecks Clerk-backed organization administrator authorization and booth
   ownership.
2. Rejects closed and archived booths.
3. Recomputes the minimum from current `opening`, `sold`, and `adjusted` values.
4. Rejects a stale revision before writing.
5. Uses a D1 snapshot guard on every ledger, balance, audit, and allocation
   statement. The final allocation upsert succeeds only if the entire inventory
   snapshot and editable lifecycle are still unchanged.

The guarded statements run in one D1 batch. A sale, reconciliation adjustment,
closure, archive, or allocation change that wins the race causes the batch to
make no changes and returns `409 inventory_conflict`. The UI then refreshes only
the booth allocation data and explains that the latest quantities are shown;
unrelated product forms remain intact.

Successful changes continue to write the existing inventory ledger and
inventory-configuration audit records with organization, booth, product,
quantity delta, actor, and timestamp context. Prior sales, adjustments, and
audit history are never rewritten or deleted. The existing `inventory` live
event is broadcast after a successful save so connected booth sessions refresh.

## Deployment validation

No database migration, Durable Object migration, binding, secret, or Cloudflare
configuration change is required.

Before deployment:

1. Run lint, TypeScript checks, the complete test suite, production build,
   artifact validation, credential scan, and `wrangler deploy --dry-run`.
2. Confirm the dry-run still lists `BOOTH_LIVE_ROOMS`, `DB`, and `ASSETS`.

After an authorized deployment:

1. Open the same active booth in two authenticated sessions and confirm both
   report `Live updates connected`.
2. In Products & inventory, increase an allocation for a product with sales.
   Confirm the second booth session updates without refreshing.
3. Reduce the allocation to its displayed minimum and confirm the same result.
4. Attempt a value below the minimum and confirm both the form and API reject
   it without changing inventory.
5. Open the allocation editor in two administrator sessions. Save in one, then
   save the stale draft in the other. Confirm the stale save returns a conflict,
   refreshes current quantities, and creates no ledger or audit entry.
6. Confirm closed and archived booths remain read-only.
7. Recheck Secure Sign-in, Google Places, security headers, and the booth
   WebSocket HTTP 101 handshake.

## Rollback

Roll back the Worker to production version
`e45d414a-c81a-4281-8e3f-5ddf2ac11477` if allocation saves regress. No schema or
data rollback is required because this change adds no migration and preserves
the existing inventory, ledger, and audit structures. Allocation changes
successfully recorded after deployment remain valid business transactions and
must not be deleted as part of a code rollback.

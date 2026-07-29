# Disaster recovery and backup readiness

This runbook is operational guidance. It does not automate production restore,
deployment, database creation/deletion, migrations, or secret handling.
Production D1 exports contain sensitive operational data and must never be
committed or stored unencrypted.

## Recovery architecture and state classification

| State | Authority and recovery method | Classification |
| --- | --- | --- |
| D1 organizations, users, memberships, invitations, booths, assignments, products, booth inventory, sales, transactions/adjustments, reconciliations, troop balances, inventory ledger, administrative alerts, audit tables, and `d1_migrations` | D1 Time Travel for an emergency in-place restore; timestamped SQL export into a separately created rehearsal database for testing | Durable business data |
| Clerk identities, sessions, MFA state, and Clerk invitations | Clerk is the external identity system of record. D1 contains application mappings and invitation/audit records, but a D1 restore does not restore Clerk | External; reconcile manually/API-assisted after recovery |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Cloudflare Worker secrets/configuration. Confirm names only; never export values into database backups or manifests | External protected configuration |
| Worker source, static source assets, Wrangler bindings, D1/DO migrations | Git and reviewed releases; deployments/versions can be selected for compatible rollback | Recoverable from source and Cloudflare versions |
| Built assets | Rebuild from the reviewed commit. Do not treat local `dist` as the sole backup | Reconstructable |
| `BoothLiveRoom` WebSockets | Connections are ephemeral and re-form on reconnect | Disposable runtime state |
| `BoothLiveRoom` stored `identity` and monotonic `revision` | The class stores room identity and invalidation revision only (`worker/booth-live-room.ts`); business state is re-read from D1 after reconnect/missed revision | Durable operational metadata, not business authority |
| `BoothLiveRoom` lifecycle alarm | Recomputed from authoritative D1 booth lifecycle fields | Reconstructable operational state |
| `RateLimitCoordinator` counter/window | One-minute abuse-control state only (`worker/rate-limit-coordinator.ts`) | Disposable operational state |

Durable Object storage is separate from D1. This runbook does not claim that
D1 Time Travel or a D1 SQL import restores Durable Object storage. Neither
class stores sales, inventory balances, reconciliation data, authorization, or
other durable business facts.

Google Places configuration is a secret-backed integration; booth place IDs and
coordinates already persisted in D1 are recoverable, while the API key itself
is not. Static assets are recovered by rebuilding the source commit.

## Recovery objectives

These are proposed targets, not guaranteed service levels.

| Operating period | Proposed RPO | Proposed RTO | Rationale |
| --- | --- | --- | --- |
| In-season active booth | 5 minutes using D1 Time Travel; retain paper/payment-terminal evidence for any gap | 60 minutes for triage, freeze, approved restore/forward fix, integrity checks, and smoke testing | Sales and cash operations are time-sensitive; volunteers can temporarily record sales offline |
| Off-season administration | 24 hours for scheduled/exported backup evidence, with Time Travel providing a shorter practical window | 1 business day | Administrative changes are lower frequency and can be reconciled manually |

Automatic/reconstructable recovery covers Worker code/assets, WebSocket
connections, lifecycle alarms, polling, and rate-limit counters. D1 recovery
requires an authenticated Cloudflare operator and incident approval. Clerk
identity/session state and protected configuration require Clerk/Cloudflare
administration. Paper sales records, payment processor reports, Clerk records,
and council documents may be needed to reconstruct data outside the retained
D1 recovery window.

## Safe SQL export

The export tool requires an explicit database name, writes into the gitignored
`backups/` directory by default, and runs in plan-only mode unless `--execute`
is supplied.

```powershell
npm run dr:backup -- --database cookie-booth-command-center-db
npm run dr:backup -- --database cookie-booth-command-center-db --execute
```

The executed form runs:

```text
npx wrangler d1 export <explicit-name> --remote --output <timestamped-file>
```

It creates the SQL file, SHA-256 sidecar, and JSON manifest containing only the
database name, UTC timestamp, source commit, Wrangler version, filename,
checksum, and handling warning. It does not archive environment files, logs,
credentials, tokens, or secret values.

Store exports encrypted in an access-controlled repository outside Git. Restrict
access to named recovery operators, log access, and test decryption quarterly.
Suggested retention: daily in-season exports for 35 days, weekly off-season
exports for 90 days, and quarterly rehearsal evidence for one year, subject to
the troop's approved privacy/retention policy. Securely delete expired copies
and their replicated backups.

Cloudflare D1 Time Travel is always enabled on supported production-backend
databases, retaining 30 days on Workers Paid or 7 days on Workers Free.
[Cloudflare Time Travel documentation](https://developers.cloudflare.com/d1/reference/time-travel/)

## Non-production restore rehearsal

An authorized operator must manually create or identify a disposable D1
database. The tooling never creates or deletes Cloudflare resources.

1. Select a target whose explicit name includes `dr`, `rehearsal`, `test`,
   `sandbox`, or `staging`, and does not contain `prod`/`production`.
2. Confirm it is not production name
   `cookie-booth-command-center-db` or production ID
   `086e7e3a-c155-49e7-99f5-ec34e8f195e6`.
3. Review the plan:

   ```powershell
   npm run dr:restore-rehearsal -- --target cookie-command-center-dr-rehearsal --file backups/<export>.sql
   ```

4. Execute only after typing the exact confirmation:

   ```powershell
   npm run dr:restore-rehearsal -- --target cookie-command-center-dr-rehearsal --file backups/<export>.sql --execute --confirm RESTORE_TO_cookie-command-center-dr-rehearsal
   ```

5. Run read-only verification:

   ```powershell
   npm run dr:verify-rehearsal -- --target cookie-command-center-dr-rehearsal
   npm run dr:verify-rehearsal -- --target cookie-command-center-dr-rehearsal --execute --expected-counts <approved-safe-counts.json>
   ```

The rehearsal target validator fails closed for empty/malformed names, UUIDs,
production markers, the known production name/ID, or names without a rehearsal
marker. The import uses only the explicit target. It never invokes Time Travel.

D1 imports use `wrangler d1 execute <target> --remote --file <export.sql>`.
[Cloudflare import/export documentation](https://developers.cloudflare.com/d1/best-practices/import-export-data/)

## Restoration verification

Import exit status is necessary but insufficient. Verification must report:

- every expected table and `d1_migrations`;
- aggregate counts for organizations, users, memberships, invitations, booths,
  assignments, products, booth inventory, sales, adjustments, reconciliations,
  troop balances, ledger, and append-only audit tables;
- foreign-key violations plus explicit orphan membership/booth checks;
- product/inventory organization mismatches;
- negative troop inventory, `available > total_remaining`, and negative booth
  remaining inventory;
- comparison with separately approved safe source aggregate counts when
  available.

Only aggregate labels, counts, and failure codes are printed. Names, email
addresses, booth addresses, notes, transaction bodies, tokens, and row data are
not selected or emitted.

After aggregate verification, perform a test-tenant smoke test against a Worker
bound to the rehearsal database: sign in, verify tenant isolation, view booth
and troop balances, inspect a historical sale/reconciliation/audit entry, and
confirm no production endpoints or credentials are used.

## Emergency D1 Time Travel

Time Travel restore overwrites the target in place, cancels in-flight queries
and transactions, and cannot currently clone production. Never run it as a
routine rehearsal.

1. Declare an incident, name the incident commander, database operator, and
   independent approver. Establish a write freeze/maintenance response before
   restore.
2. Confirm the target:

   ```powershell
   npx wrangler d1 info cookie-booth-command-center-db
   ```

   Stop unless the exact database and `version: production` are confirmed.
3. Record the active Worker deployment/version and current D1 bookmark:

   ```powershell
   npx wrangler deployments list
   npx wrangler d1 time-travel info cookie-booth-command-center-db
   ```

4. Preserve the displayed pre-restore bookmark in the incident record. It is
   the undo point.
5. If the database remains exportable, export the damaged current state before
   overwriting it and securely retain its checksum/manifest.
6. Identify the intended timestamp from evidence, then retrieve its bookmark
   without restoring:

   ```powershell
   npx wrangler d1 time-travel info cookie-booth-command-center-db --timestamp "<RFC3339 UTC timestamp>"
   ```

7. First confirmation: incident commander records
   `APPROVE D1 IN-PLACE RESTORE`, exact database name/ID, pre-restore bookmark,
   intended bookmark/timestamp, reason, and evidence.
8. Second confirmation: independent approver verifies the freeze, target,
   export/checksum when possible, rollback bookmark, and recovery plan.
9. Only the authenticated database operator may then run the reviewed
   `wrangler d1 time-travel restore` command interactively. No script in this
   repository runs it.
10. Record the resulting bookmark and Cloudflare output. Re-run all restoration
    verification queries, then smoke-test sign-in, tenant isolation, booth
    reads, inventory, a controlled sale, reconciliation history, WebSocket 101,
    and rate limiting before lifting the freeze.
11. If the restore point is wrong, use the recorded pre-restore bookmark through
    the same two-approval process to undo it.

## Worker rollback

A Worker rollback creates a new deployment using a prior version; it does not
restore D1, Durable Object storage, or any other connected resource. Before
rollback:

1. Record the active deployment and target version:

   ```powershell
   npx wrangler deployments list
   npx wrangler versions view <target-version-id>
   ```

2. Confirm target code is compatible with current D1 migrations, `DB`,
   `BOOTH_LIVE_ROOMS`, `RATE_LIMITER`, static assets, secrets by name, and
   current DO migrations.
3. Current production includes `BoothLiveRoom` migration v1 and
   `RateLimitCoordinator` migration v2. Use only a compatible post-v2 target.
   Do not assume a pre-v2 Worker can replace it. If no compatible target exists,
   use a separately reviewed forward fix.
4. Confirm the rollback will not cross a Durable Object class lifecycle change.
   Cloudflare can block rollback when one occurred.

Wrangler procedure:

```powershell
npx wrangler rollback <compatible-target-version-id>
```

Dashboard procedure: Workers & Pages → Cookie Booth Command Center →
Deployments → target version menu → Rollback. Cloudflare documents both
procedures and the DO lifecycle restriction.
[Cloudflare Worker rollback documentation](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

After rollback, verify HTTP 200/security headers, Secure Sign-in, Google Places,
tenant/role boundaries, D1 reads, an approved test mutation, WebSocket 101 and
live synchronization, polling fallback, and rate limiting. Preserve incident
evidence and prepare a forward recovery release; do not leave production pinned
to an old version without an owner and deadline.

## Incident-response runbook

### Detect and classify

- **SEV-1:** cross-tenant disclosure, widespread data corruption/deletion,
  inability to record in-season sales, or authentication compromise.
- **SEV-2:** degraded writes, reconciliation/inventory inconsistency,
  significant Clerk/DO/rate-limiter outage with workaround.
- **SEV-3:** isolated administrative defect or non-critical degradation.

Open an incident record with UTC timeline, request IDs, deployment/version,
observed D1 bookmark, affected organizations/features, and named commander.
Never copy tokens, cookies, secrets, personal data, or raw request bodies.

### Stop the bleeding and preserve evidence

- Decide whether to freeze writes, show maintenance guidance, or keep booth
  operations available with paper/offline capture.
- Stop automated deployment/migration activity; do not destroy affected state.
- Preserve sanitized logs, request IDs, relevant commits/diffs, Cloudflare
  version metadata, D1 bookmark, and checksummed current-state export when safe.
- Require the incident commander plus an independent approver for production
  D1 restore, rollback crossing data/schema risk, or secret rotation.

### Scenario response

- **D1 corruption/accidental deletion:** freeze writes, capture bookmark/export,
  identify earliest bad write, choose Time Travel point, obtain two approvals,
  restore and verify.
- **Bad application deployment:** keep D1 unchanged; choose a compatible
  post-v2 Worker rollback or forward fix and run smoke checks.
- **Bad D1 migration:** stop migrations/writes. Prefer a forward corrective
  migration when data can be preserved. Use Time Travel only when approved,
  accepting that later valid writes will also be removed and must be reconciled.
- **Clerk outage/identity mismatch:** do not weaken authentication. Preserve D1
  mappings, compare with Clerk using authorized tooling, repair identities
  deliberately, and verify organization membership/role boundaries.
- **WebSocket/BoothLiveRoom degradation:** polling fallback is the safe mode.
  Connections, revision metadata, and alarms can re-form/recompute; D1 remains
  authoritative.
- **RateLimitCoordinator failure:** ordinary booth activity follows documented
  fail-open policy while sensitive administration/webhooks fail closed.
  Diagnose binding/DO availability; counters are disposable and must not be
  reconstructed from customer data.

### Verify, communicate, close

Before reopening writes, complete database integrity checks and application
smoke tests, reconcile offline sales/payment records, and obtain commander
sign-off. Communicate impact, workaround, data-loss window, and next update
without exposing tenant or security details. At closure record recovery point,
actual RPO/RTO, unresolved reconciliation, owners, and deadlines. Hold a
blameless retrospective within five business days and update this runbook/tests.

## Quarterly rehearsal

Once per quarter and before peak booth season:

1. Produce or select a secure checksummed export.
2. Have a second operator validate the target is disposable/non-production.
3. Import using the rehearsal tool and run aggregate/integrity verification.
4. Exercise compatible Worker rollback planning without changing production.
5. Record elapsed restore/verification time, gaps, actual achievable RPO/RTO,
   and corrective owners.
6. Manually delete the disposable database only under separate authorization
   after retaining sanitized evidence.

## Rollback of this change

These scripts and documents do not alter runtime behavior. Revert their commit
if the process is unsuitable. Keep `/backups/` and `*.d1-backup.*` ignore rules
or replace them with equally protective patterns. Deleting this tooling does
not delete exports, D1 data, DO state, Cloudflare resources, or deployments.


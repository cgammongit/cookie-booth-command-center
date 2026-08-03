# Scout Directory and sales credit

## Behavior

Administrators manage organization-scoped, non-login scout records under People & Roles. The supported age levels are Daisy, Brownie, Junior, Cadette, Senior, and Ambassador. Archiving removes a scout from new assignments while retaining historical attendance and finalized credit.

Booth scout attendance defaults to the booth's scheduled start and end. Attendance windows are half-open: `attendance_start <= sale_timestamp < attendance_end`. A sale exactly at or after the scheduled booth end is a post-close sale and is credited only to assignments whose end originally matched the scheduled close. That intent is stored in `stayed_through_close`, so later schedule changes cannot silently alter eligibility.

Sales retain their existing authoritative server-generated `sales.created_at` timestamp. The browser cannot supply the timestamp or credit. Credit is calculated for each sale transaction line. Each finalized share is stored as an exact integer numerator and denominator; for example, five boxes shared by two scouts is stored as `5 / 2` for each scout. Reports add rational values before formatting them to at most two decimal places.

Credit is provisional until reconciliation. Reconciliation fails when attendance is invalid, a sale line has no eligible scout, or exact allocation does not equal boxes sold. Final credit rows and reconciliation records are inserted in the same D1 batch. Existing reconciliation uniqueness and credit uniqueness make retries non-duplicating. Closed or archived booths lock normal attendance changes.

The Reports tab **Total Cookie Sales per Scout** reads finalized credit only. It includes archived scouts with history, booth and cookie-variety breakdowns, CSV export, and printable output.

## Security and operations

- Directory mutations require the existing `people.manage` permission.
- Attendance mutations require `assignment.manage`.
- Reports require `report.view`.
- Organization, booth, scout, assignment, sale, and credit queries carry authoritative tenant predicates.
- Archived scouts cannot be newly assigned. Optimistic revision tokens prevent stale attendance changes from overwriting newer work.
- The platform Super Admin allowlist remains separate from organization roles.
- Demo-data purge deletes credit, attendance, and directory rows in foreign-key order. Recovery verification validates all three tables and their tenant relationships.

## Deployment

1. Capture the current production D1 bookmark and an export when change-risk policy calls for it.
2. Confirm only `0013_scout_sales_credit.sql` is pending for `cookie-booth-command-center-db`.
3. Apply D1 migrations using the configured `DB` target.
4. Deploy the reviewed Worker commit without changing bindings or secrets.
5. Confirm the migration record, Worker version, 100% traffic, HTTP 200, sign-in, and security headers.
6. Perform the manual Scout Directory, attendance-boundary, provisional-credit, reconciliation, report, CSV, and print checks using only a designated test organization.

## Rollback

The migration is additive. Do not roll back D1 merely to roll back application code. If application rollback is required, select a deployment compatible with the post-v2 Durable Object configuration and the additive schema; the new tables can remain unused. If production data is suspected to be incorrect, freeze writes, preserve a bookmark/export, and follow the disaster-recovery runbook before any D1 Time Travel action. A forward fix is preferred for finalized credit records.

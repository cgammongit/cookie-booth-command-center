# Troop Inventory ledger display quantities

## Ledger dimensions

Inventory ledger rows record changes across three independent dimensions:

- `total_delta`: change to stock owned by the troop.
- `available_delta`: change to troop stock available for booth allocation.
- `booth_delta`: change to stock held at a booth.

The Recent stock movements list selects the dimension that describes the
movement to an administrator. It does not alter accounting data.

| Movement | Stored semantics | Display dimension |
| --- | --- | --- |
| `booth_allocation` | Total unchanged, available decreases, booth increases | `available_delta` |
| `booth_return` | Total unchanged, available increases, booth decreases | `available_delta` |
| `booth_sale` | Total and booth decrease, available unchanged | `total_delta` |
| `initial_order` | Total and available increase | `total_delta` |
| `replenishment` | Total and available increase | `total_delta` |
| `trade_in` | Total and available increase | `total_delta` |
| `trade_out` | Total and available decrease | `total_delta` |
| `council_return` | Total and available decrease | `total_delta` |
| `damage` | Total and available decrease | `total_delta` |
| `loss` | Total and available decrease | `total_delta` |
| `correction_in` | Total increases; reconciliation may change booth stock | `total_delta` |
| `correction_out` | Total decreases; reconciliation may change booth stock | `total_delta` |
| `legacy_migration` | Establishes troop-owned total and booth stock | `total_delta` |

`getInventoryMovementDisplayQuantity` in
`lib/inventory-movement-display.ts` centralizes this selection. Positive values
render with a leading `+`; negative values retain `-`; a relevant zero renders
as `0`.

## Historical reconciliation entries

Booth reconciliation intentionally records returned stock with
`total_delta = 0`, a positive `available_delta`, and a matching negative
`booth_delta`. The display helper reads the existing `available_delta`, so
historical reconciliation returns immediately show the returned quantity
without a backfill or data rewrite.

## Validation and deployment

This repair changes presentation code only. It adds no migration, dependency,
binding, secret, or Cloudflare configuration.

Before an authorized deployment:

1. Run lint, TypeScript checks, the complete test suite and production build.
2. Validate the artifact and run the credential scan.
3. Run `wrangler deploy --dry-run` and confirm the existing
   `BOOTH_LIVE_ROOMS`, `DB`, and `ASSETS` bindings.

After deployment, inspect Recent stock movements and confirm:

- booth returns show `+N`;
- booth allocations show `-N`;
- sales and troop removals remain negative;
- initial orders, replenishments, inbound trades, and positive corrections
  remain positive;
- balances and the API's `totalDelta`, `availableDelta`, and `boothDelta`
  values are unchanged.

## Rollback

Roll back the Worker to the immediately preceding production version if the
ledger display regresses. No data rollback or migration reversal is required.
Existing ledger, balance, sale, reconciliation, and audit records remain
authoritative and must not be rewritten.

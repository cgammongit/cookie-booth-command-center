# Durable Object live synchronization

## Configuration added

`wrangler.jsonc` now declares:

- Durable Object binding: `BOOTH_LIVE_ROOMS`
- Durable Object class: `BoothLiveRoom`
- Durable Object migration tag: `v1`
- Migration operation: `new_sqlite_classes: ["BoothLiveRoom"]`

The room uses Durable Object storage for its monotonically increasing revision
and room identity. This is a Cloudflare Durable Object class migration, not a
D1 schema migration. There are no new files in `drizzle/`, and no database
migration command is required.

## WebSocket handshake repair

Production revision `b46faf6236073a2b5797cd7402553dd4ea0ab7b2` exposed a
vinext `0.0.50` compatibility gap. The booth App Route correctly returned the
Durable Object's Cloudflare `101` response, but vinext applied its ordinary
route/middleware response reconstruction first. Standard `Response`
construction rejects status `101`, so vinext caught the resulting `RangeError`
and returned HTTP 500 before the Worker's existing `response.status === 101`
guard could preserve the WebSocket attachment.

Published vinext releases `0.0.55`, `0.1.8`, `0.2.1`, and
`1.0.0-beta.4` were inspected during this repair. Each still reconstructed App
Route responses without preserving a Cloudflare WebSocket attachment, so no
unverified vinext upgrade was accepted.

The selected repair intercepts only `/api/booths/:boothId/live` in the raw
Worker before vinext. It:

- requires an Upgrade request and exact same-origin `Origin`;
- authenticates the Clerk session with `@clerk/backend`'s
  `authenticateRequest()` and an authorized-party restriction;
- resolves active user, membership, booth organization, role, and assignment
  from D1;
- applies the same pure `evaluateBoothPermission(..., "view")` policy used by
  the application authorization layer;
- constructs organization/booth room identity only from authoritative server
  results; and
- returns the Durable Object's original `101` response without reconstruction.

The existing App Route calls the same shared booth-live handler for route-level
tests and non-Worker environments. `@clerk/backend` `3.13.0` is now an explicit
runtime dependency because the raw Worker uses its supported request
authentication API. vinext remains pinned at `0.0.50`.

After connection, the client sends an application heartbeat every 27.5
seconds. The room uses `WebSocketRequestResponsePair("ping", "pong")` so
hibernating Durable Objects can answer without waking. A missing pong closes
the unhealthy socket, polling remains authoritative, and reconnect attempts
use jittered exponential backoff followed by a one-minute cooldown. Hidden or
offline pages stop connecting and resume on visibility/online events.

## Production deployment

Do not run these steps until deployment is explicitly authorized.

1. Merge the reviewed pull request.
2. From the merged commit, install dependencies with `npm ci`.
3. Run:
   - `npm audit`
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm test`
   - the focused Worker WebSocket integration test
   - `npm run validate:artifact`
   - `npm run build`
   - `npx wrangler deploy --dry-run`
4. Confirm the Cloudflare target account and Worker name shown by Wrangler.
5. With separate explicit production authorization, run:

   ```sh
   npx wrangler deploy
   ```

The first authorized deployment applies Durable Object migration tag `v1` and
creates/binds the `BOOTH_LIVE_ROOMS` namespace. Later deploys retain the same
namespace and stored room revisions.

This repair adds no Wrangler binding, Durable Object migration, D1 migration,
secret, Clerk setting, or other production configuration. The existing Clerk
secret names and `BOOTH_LIVE_ROOMS`/`DB` bindings must remain present.

After an authorized deployment:

1. Sign in and open an authorized booth.
2. Confirm the `/api/booths/:boothId/live` handshake returns `101`, not 500.
3. Confirm the page reports **Live updates connected** after the first pong.
4. Make a sale from a second authorized session and confirm the first session
   refreshes without a manual reload.
5. Temporarily block WebSockets and confirm the page reports reconnecting or
   polling-only state while 15-second polling continues.
6. Restore connectivity and confirm the socket reconnects and performs an
   authoritative refresh without clearing an active New Sale or reconciliation
   form.
7. Confirm structured logs contain the normalized route, request ID, status,
   duration, and no credentials, cookies, Clerk identifiers, or request bodies.

## Rollback

If sign-in, authorization, the `101` handshake, or booth synchronization
regresses after an authorized deployment:

1. Keep booth operations on the existing 15-second polling fallback.
2. Roll back the Worker to the immediately preceding known-good version using
   the approved Cloudflare version rollback procedure.
3. Verify Secure Sign-in and booth sales/inventory polling.
4. Do not remove the Durable Object binding or migration tag; they predate this
   repair and retain room revision state.
5. Do not rotate Clerk secrets or alter D1 data as part of this code rollback.

Because the change has no schema or remote-configuration mutation, rollback is
limited to the Worker version and dependency artifact.

## Manual production checks

- The deploy credential needs permission to edit Workers and Durable Objects.
- The existing `DB` D1 binding must remain attached.
- The existing `app.cookie-command-center.com` custom domain must continue to
  route to this Worker so WebSocket upgrades stay same-origin with Clerk
  session cookies.
- No new secret, environment variable, Clerk setting, or manually created
  namespace is required when deployment is performed through Wrangler.
- If a separate Cloudflare dashboard or CI deployment system ignores
  `wrangler.jsonc`, configure the `BOOTH_LIVE_ROOMS` binding and apply the
  `BoothLiveRoom` SQLite-class migration there before sending production
  traffic. Prefer updating that pipeline to honor `wrangler.jsonc`.

No remote Cloudflare configuration or migration is applied by this change.

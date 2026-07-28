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

## Production deployment

Do not run these steps until deployment is explicitly authorized.

1. Merge the reviewed pull request.
2. From the merged commit, install dependencies with `npm ci`.
3. Run:
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm test`
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

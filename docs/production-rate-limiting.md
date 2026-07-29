# Production rate limiting

## Selected implementation

Rate limiting is enforced by the Worker before vinext handles ordinary API
requests and before any application mutation. `RateLimitCoordinator` is a
Durable Object addressed by a SHA-256-minimized identity and operation class.
Each object serializes updates to one fixed-window counter, so multiple Worker
isolates cannot race the same counter. This avoids process-local state and does
not add D1 writes to polling traffic.

Cloudflare's native Rate Limiting binding was considered. It is fast and
multi-isolate, but its counters are intentionally permissive, eventually
consistent, and local to a Cloudflare location. The Durable Object design was
selected because mutation-loop protection benefits from an atomic decision.

The client never supplies the effective organization, user, or booth identity.
Clerk authenticates the request and D1 resolves active organization membership
and booth ownership. Application authorization and role checks still run after
an allowed decision and remain authoritative.

## Route inventory

| Routes | Methods | Exposure | Class |
| --- | --- | --- | --- |
| `/api/me` | GET | Authenticated read | authenticated_read |
| `/api/booths`, `/api/booths/:boothId` | GET | Authenticated organization/booth read and polling | authenticated_read |
| `/api/admin/archived-booths`, `/api/admin/people`, `/api/admin/products`, `/api/admin/troop-inventory`, `/api/admin/booth-inventory` | GET | Authenticated administrator reads | authenticated_read |
| `/api/organization-invitations` | GET | Authenticated invitation-manager read | authenticated_read |
| `/api/booths/:boothId/sales` | POST | Booth sale mutation | sale |
| `/api/admin/booth-inventory` | PUT | Booth inventory mutation | inventory |
| `/api/admin/troop-inventory` | POST | Troop inventory mutation | inventory |
| `/api/booths` | POST | Booth creation/lifecycle | lifecycle |
| `/api/booths/:boothId/reconciliation` | POST | Reconciliation and closure | lifecycle |
| `/api/admin/booths/:boothId/archive` | POST | Booth archival | lifecycle |
| `/api/organization-invitations`, `/:invitationId/resend`, `/:invitationId/cancel` | POST | Invitation mutation | invitation |
| `/api/admin/alerts/:alertId` | PATCH | Administrative mutation | administrative |
| `/api/admin/booth-assignments` | PUT | Administrative assignment | administrative |
| `/api/admin/people/:membershipId` | PATCH | Administrative access mutation | administrative |
| `/api/admin/products`, `/api/admin/products/:productId` | POST/PATCH | Administrative catalog mutation | administrative |
| `/api/webhooks/clerk` | POST | Public signed webhook | clerk_webhook after signature verification |
| `/api/booths/:boothId/live` | GET upgrade | Authenticated WebSocket handshake | websocket after origin, authentication, tenant, role, and assignment checks |

All `/api` traffic without a valid Clerk session first uses the
`unauthenticated` class keyed by a SHA-256-minimized Cloudflare connecting
address and route class. The raw address is never stored or logged.
Authenticated users sharing a public address have independent counters.

There is no health/operational endpoint. Google Places is loaded by the browser
from the CSP-approved Google hosts; this application exposes no Google Places
proxy route. Static assets and page documents are not counted by the
application API limiter.

## Thresholds

All windows are 60 seconds.

| Class/scope | Limit | Reason |
| --- | ---: | --- |
| Authenticated read: organization + user | 240 | Supports several tabs and 15-second fallback polling with ample headroom. |
| Sale: organization + user + booth | 60 | One sale/second permits scanner bursts but stops loops. |
| Sale: organization + booth | 300 | Supports several simultaneous sellers. |
| Sale: organization | 600 | Contains organization-wide automation. |
| Inventory: organization + user (+ booth when applicable) | 40 | Normal adjustments are infrequent but small bursts remain safe. |
| Inventory: organization + booth | 120 | Allows multiple administrators without an unbounded loop. |
| Inventory: organization | 240 | Organization-wide containment. |
| Lifecycle: organization + user (+ booth) | 12 | Lifecycle operations are sensitive and infrequent. |
| Administrative: organization + user | 20 | Protects access/catalog administration. |
| Invitation: organization + user | 10 | Protects a sensitive external side effect. |
| WebSocket: organization + user + booth | 12 | Accommodates the five fast reconnects and subsequent cooldown. |
| WebSocket: organization + booth | 120 | Accommodates many simultaneous booth clients. |
| Unauthenticated: minimized IP + route class | 60 | Contains public API abuse without grouping authenticated volunteers. |
| Verified Clerk event | 20 | Permits legitimate provider retries of one event. |
| Verified Clerk provider aggregate | 600 | Broad safety ceiling after signature verification. |

## Responses and clients

Rejected requests return HTTP 429 with `Retry-After`, `x-request-id`, and the
sanitized code `rate_limited`. Counter keys, thresholds, tenant activity, and
infrastructure details are not returned or logged.

Mutation forms retain their React draft state, display the retry duration, and
block rapid user retries for that operation. Polling records `Retry-After` and
delays its next attempt while retaining the last valid data. WebSocket failures
continue through the existing exponential backoff and 60-second cooldown;
ordinary 15-second polling remains available whenever the socket is not open.

Only rejections and limiter failures produce structured rate-limit logs. Events
contain request ID, normalized route, class, decision, and retry duration—never
raw IPs, cookies, tokens, request bodies, personal data, or hashed counter keys.

## Failure policy

Ordinary authenticated reads, sales, inventory, lifecycle, WebSocket
connections, and unauthenticated traffic fail open if the limiter is
temporarily unavailable. Authentication, authorization, revision guards, and
all mutation validation still run, so no false success is returned.

Administrative, invitation, and verified Clerk webhook operations fail closed
with 429 because their external/security impact is higher. A sanitized
`rate_limit.failure` event identifies the policy decision. Clerk signature
verification always happens before its limiter, and invalid signatures never
consume a verified-provider allowance.

## Binding and deployment prerequisite

`wrangler.jsonc` adds the `RATE_LIMITER` Durable Object binding and migration
`v2`, creating `RateLimitCoordinator`. No D1 migration, secret, or manual
Dashboard setting is required. The reviewed deployment must include this
Wrangler configuration; do not deploy application code without the binding.

The migration is applied only by an explicitly authorized `wrangler deploy`.
This change does not modify remote Cloudflare configuration.

## Staged validation

1. Deploy to a non-production Worker with the D1 and Clerk environment expected
   by that environment.
2. Confirm sign-in, Google Places, an authorized WebSocket 101, a sale, an
   inventory adjustment, reconciliation, and invitation behavior.
3. Exercise a disposable test identity until a 429 is returned. Confirm
   `Retry-After`, request ID, preserved form fields, no ledger/audit/broadcast,
   and a successful retry after the window.
4. Confirm two users on one network, two booths, and two organizations do not
   share authenticated allowances.
5. Inspect structured logs for `rate_limit.decision` and
   `rate_limit.failure`; verify no sensitive fields appear.
6. Monitor 429s by route class during a real busy-booth window before lowering
   any threshold. High sale volume spread across users with valid request IDs
   is likely legitimate; repeated single-user bursts at the exact ceiling,
   especially across failures, indicate automation or a submission loop.

## Rollback

Roll back to the prior Worker version if sign-in, live connections, or valid
mutations are disrupted. The prior version ignores the new binding. Do not
delete the Durable Object class or binding during an emergency rollback;
removing a migrated class requires a separately reviewed deleted-class
migration. Counter data expires operationally with its one-minute window and
contains only minimized keys and counts.

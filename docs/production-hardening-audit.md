# Milestone 5 production-hardening audit

Audit date: 2026-07-28

Audited revision: `main` at `af90934add90341ac5b68b3dfe6069b69ebc6909`

Method: read-only source, lockfile, production-response-header, CORS preflight, and Cloudflare D1 metadata checks.

## Phase 5A implementation update

Status as of the Phase 5A feature branch:

- **Implemented:** patched compatible Next.js, React, React Server DOM, Vite, Cloudflare Vite plugin, Wrangler, Workers Types, PostCSS, Sharp, and related transitive releases; the original 13 High advisories were reduced substantially without a major-version downgrade/upgrade.
- **Implemented:** a centralized, pure authorization policy with executable role and cross-organization tests, plus route-contract coverage for sales, inventory, reconciliation, invitations, and WebSockets. Existing server-side database authorization remains authoritative.
- **Implemented:** per-request UUID correlation, structured JSON Worker logs, route normalization, error categories, bounded primitive context, and default redaction of authorization, cookies, Clerk fields, email/PII, credentials, request bodies, payloads, signatures, and notes.
- **Implemented:** CSP in Report-Only mode, frame denial, Referrer-Policy, Permissions-Policy, `nosniff`, one-day staged HSTS, and response request IDs.
- **Implemented, deliberately non-disruptive:** unsafe application API requests with a supplied cross-origin `Origin` are rejected. Missing-Origin requests continue to follow Clerk authentication and server authorization; Clerk webhooks remain signature-protected and exempt.
- **Deferred by scope:** MFA, rate limiting, CSP enforcement, external monitoring, sale idempotency, webhook replay persistence, and strict rejection of all missing-Origin mutations.

Deployment validation, CSP inspection, rollback, and remaining advisory details are in `docs/phase-5a-production-hardening.md`.

## Executive summary

No Critical finding was identified. The application has a sound baseline: authorization is checked server-side, organization identifiers are included in sensitive database queries, booth WebSockets are authenticated and same-origin, inventory writes use transactional/conditional D1 operations, and live synchronization falls back to polling.

Production hardening is nevertheless incomplete. The most urgent risks are:

1. **High — vulnerable framework/tooling dependencies:** `npm audit` reports 18 vulnerable packages (13 high, 4 moderate, 1 low). Directly affected packages include Next.js 16.2.6, React Server DOM 19.2.6, Vite 8.0.13, Wrangler 4.92.0, and the Cloudflare Vite plugin 1.37.1.
2. **High — no rate limiting:** authentication-adjacent, invitation, webhook, transactional mutation, and WebSocket endpoints have no application or configured binding-based limiter.
3. **High — no explicit browser security-header policy:** neither source configuration nor the live response supplies CSP, HSTS, Referrer-Policy, Permissions-Policy, or frame protections.
4. **High — no operational telemetry:** there are no structured application logs, correlation IDs, redaction policy, alerting configuration, or enabled Workers observability configuration in the repository.
5. **High — inadequate security regression coverage:** tests are largely rendered-source assertions. There are no executable API authorization, cross-tenant/IDOR, CSRF, accessibility, browser, or load tests.
6. **High — admin MFA is not enforced:** application admin roles live in D1, while the application only checks Clerk identity plus the local role. The repository contains no MFA/session-assurance check. Current Clerk configuration cannot be verified from source.

The recommended first phase is a focused, low-data-risk security baseline: upgrade patched dependencies, add authorization/tenant-isolation tests, introduce correlation-aware redacted logging, and add carefully staged security headers. Rate limiting should follow immediately, initially in observe mode, because incorrect thresholds can interrupt booth sales and sign-in.

## Severity model

- **Critical:** exploitable condition likely to expose or corrupt production data, bypass tenant isolation, or cause broad outage without meaningful prerequisites.
- **High:** material confidentiality, integrity, availability, financial, or operational risk that should be addressed before wider production use.
- **Medium:** defense-in-depth or workflow risk requiring planned remediation.
- **Low:** limited-impact improvement.
- **Already implemented:** control is present in the audited revision; this is not a certification that configuration outside the repository is correct.

## Prioritized findings

### Critical

No Critical finding was confirmed.

### High

#### H1. Known vulnerable dependencies

**Phase 5A status: substantially remediated; remaining tooling-only advisories documented.**

`npm audit --json` against the committed lockfile reported 18 vulnerabilities: 13 high, 4 moderate, 1 low, 0 critical. Important direct packages and available non-major fixes include:

- Next.js 16.2.6 → 16.2.12 (authorization bypass, SSRF, denial-of-service, cache-confusion, and disclosure advisories).
- `react-server-dom-webpack` 19.2.6 → 19.2.8 (Server Functions denial of service).
- Vite 8.0.13 → 8.1.5 (Windows file disclosure/dev-server issues).
- `@cloudflare/vite-plugin` 1.37.1 → 1.47.0 and associated Miniflare/Wrangler dependency fixes.

Evidence: `package.json`, `package-lock.json`. The audit was read-only; no packages were changed.

Risk: some advisories are development-only or may not be reachable through this vinext deployment, but the Next.js/React Server Components findings affect the production dependency graph and should not be dismissed without an explicit reachability review.

#### H2. No rate limiting

No rate-limit middleware, Worker rate-limit binding, or endpoint-specific limiter exists in `wrangler.jsonc`, `worker/index.ts`, `app/api`, or `lib`.

Affected surfaces:

- Clerk-backed application entry points and `/api/me`.
- Invitation create/resend/cancel routes under `app/api/organization-invitations`.
- Clerk webhook at `app/api/webhooks/clerk/route.ts`.
- Sales, inventory allocation/adjustment, reconciliation, booth lifecycle, product, people, and alert mutations under `app/api`.
- WebSocket upgrades at `app/api/booths/[boothId]/live/route.ts`.

Risk: invitation/email abuse, webhook verification resource exhaustion, mutation floods, rapid duplicate sales, D1 contention, and unbounded socket connection attempts. Authentication is not a substitute for abuse controls.

Recommended control: Cloudflare edge/WAF limits for unauthenticated and webhook traffic, plus a Workers Rate Limiting binding keyed by authenticated user + organization + route/resource. The Workers API is intentionally permissive/eventually consistent, so it must not be used for exact accounting ([Cloudflare Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)).

#### H3. Missing explicit security headers

**Phase 5A status: implemented in staged form.** CSP is report-only and HSTS is limited to one day. Enforcement must not be enabled until Clerk, Google Places, images, and WebSocket behavior are validated.

`next.config.ts` contains no headers. `worker/index.ts` passes application responses through unchanged. A read-only `HEAD https://app.cookie-command-center.com` on 2026-07-28 returned HTTP 200 through Cloudflare but did not return:

- `Content-Security-Policy`
- `Strict-Transport-Security`
- `Referrer-Policy`
- `Permissions-Policy`
- `X-Frame-Options`

There is also no `frame-ancestors` policy in source. Risk includes clickjacking and reduced containment of script/style injection. CSP will require Clerk and Google Places domains/nonces to be tested; an overly strict policy can break Secure Sign-in.

#### H4. Missing structured observability and incident signals

**Phase 5A status: application baseline implemented.** Structured console events and request correlation are now Cloudflare-compatible. Enabling/sampling Workers Logs or traces remains a separate remote configuration decision.

No application logger, request/correlation ID generation, redaction helper, error-reporting integration, or alert thresholds were found. `wrangler.jsonc` has no `observability` block. Several post-commit live-sync publications intentionally swallow errors (search for `.catch(() => undefined)` in API routes), which is acceptable for polling recovery but invisible operationally.

Recommended minimum fields: timestamp, severity, event name, request ID, route, status, duration, organization/booth numeric IDs, Clerk user identifier hash, D1/DO outcome, and retry count. Never log session tokens, cookies, Clerk secrets, webhook bodies/signatures, invitation URLs, full email addresses, card data, reconciliation notes, or sale payloads.

Cloudflare supports Workers Logs, automatic traces for bindings/handlers, metrics, Logpush, Tail Workers, and OpenTelemetry export ([Workers observability](https://developers.cloudflare.com/workers/observability/), [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), [Workers traces](https://developers.cloudflare.com/workers/observability/traces/)).

#### H5. Security and tenant-isolation tests are missing

**Phase 5A status: partially implemented.** Executable policy and route-contract tests now cover the named high-value surfaces. Full D1-backed integration tests with Clerk test identities remain a later phase.

The only test entry point is `tests/rendered-html.test.mjs`, and `npm test` rebuilds before making rendered/source assertions. It does not execute authenticated API routes against D1 or Clerk test identities.

Missing regression cases:

- anonymous, suspended, wrong-role, wrong-organization, and unassigned-booth access for every API method;
- ID substitution for booth, product, membership, invitation, alert, and organization IDs;
- WebSocket missing/forged Origin, wrong organization, wrong booth, and revoked membership;
- CSRF/cross-origin state changes;
- webhook invalid signature, replay/duplicate delivery, and out-of-order delivery;
- concurrent sales, retries, closure during sale, and inventory/reconciliation contention.

This gap makes otherwise well-scoped authorization code vulnerable to regression.

#### H6. Administrator MFA is not enforced or observable

`lib/access.ts:20-47` verifies a Clerk user and active local membership; `lib/access.ts:50-66` requires the local `admin` role. It does not inspect authentication factor/session assurance. Application roles are stored in D1, not Clerk Organizations, so the code cannot currently require MFA only for those local admins.

As of February 2026 Clerk can require MFA for every application user from the Dashboard, using enabled TOTP or SMS methods ([Clerk required MFA](https://clerk.com/changelog/2026-02-20-require-mfa)). Repository inspection cannot determine whether that production toggle, factor methods, account lockout, or client-trust protection is enabled.

Options:

- Configuration-only: require MFA globally in the Clerk production instance. This is simplest and strongest, but affects every booth user and can disrupt sign-in until each user enrolls.
- Code plus configuration: add server-verified step-up/session assurance for local D1 admin actions. Do not trust a client flag. Confirm the exact supported Clerk session claims/API for the installed SDK before implementation.

Recovery: enable backup codes and document verified admin recovery. Clerk account lockout can require manual Dashboard unlock; configure it deliberately and ensure at least two trained break-glass administrators ([Clerk user lockout](https://clerk.com/docs/guides/secure/user-lockout)).

### Medium

#### M1. State-changing routes lack an explicit CSRF control

**Phase 5A status: partially implemented.** Supplied cross-origin Origins are rejected centrally for unsafe application API methods. Missing-Origin rejection and token-based CSRF were deferred to avoid breaking non-browser or framework requests without first inventorying them.

All ordinary mutations rely on Clerk session authentication and same-site browser behavior. No route checks Origin/Referer, requires a CSRF token, or uses a centralized mutation guard. The live WebSocket route is the exception: `app/api/booths/[boothId]/live/route.ts:10-14` requires an exact same-origin Origin.

The production hostile-origin preflight returned `204` with `Allow: GET, HEAD, OPTIONS` and no `Access-Control-Allow-Origin`, which prevents ordinary cross-origin JavaScript reads/writes with non-simple requests. However, CORS is not a complete CSRF defense, especially for simple content types or future route changes.

Add a centralized exact-origin check for unsafe methods, retain Clerk’s secure session behavior, and regression-test every mutation. Webhooks must be exempted from CSRF and continue to rely on signatures.

#### M2. Sale creation has no idempotency key

`app/api/booths/[boothId]/sales/route.ts` uses conditional inventory updates and a D1 batch, which protects consistency, but no client-generated idempotency key is stored. A client/network retry can create a second legitimate-looking sale when sufficient inventory remains.

Add an organization/booth-scoped unique idempotency key and replay the original result. Validate rapid double scans, retry after timeout, and concurrent users.

#### M3. Webhook replay/idempotency and failure handling need strengthening

`app/api/webhooks/clerk/route.ts:17-27` correctly requires and verifies Clerk’s webhook signature. Updates use upserts and status predicates, providing partial idempotency. However, processed event IDs are not persisted, and no rate limit, structured failure log, dead-letter workflow, or alert exists. A database exception produces an unobserved 500 and depends on Clerk retries.

Persist event IDs with a unique constraint, return success for known duplicates, and alert on terminal/repeated failures. Keep payload retention minimal.

#### M4. Mobile navigation hides actions

`app/globals.css` hides `header nav button` below 620 px with no visible replacement navigation. This can remove essential administrative and booth navigation on common phones. Tables intentionally use large minimum widths with horizontal scrolling (`.peopleTable`, `.stockTable`), which is functional but burdensome on touch devices.

Add a keyboard-accessible mobile menu, card/table alternatives for core booth operations, and browser tests at 320, 375, 390, 768, 820, and 1024 CSS pixels.

#### M5. Dialog focus management is incomplete

The New Sale and reconciliation overlays have `role="dialog"` and `aria-modal="true"` (`app/dashboard.tsx:601`, `app/dashboard.tsx:658-661`), and quantities announce through `aria-live` (`app/dashboard.tsx:617`). No focus trap, initial focus placement, Escape handling, background inertness, or focus restoration was found. Synchronization deliberately preserves form state, which is already implemented, but does not solve focus behavior.

Implement and test focus entry, cycling, Escape/cancel semantics, destructive-action confirmation, and restoration to the launcher.

#### M6. Form errors are not consistently associated with controls

Many inputs use visible wrapping labels, which is positive, but page-level `.errorAlert` messages are generally not tied to inputs with `aria-describedby`/`aria-invalid`, and dynamic errors are not consistently `role="alert"` or `aria-live`. Perform automated axe checks plus manual screen-reader testing (NVDA/Chrome and VoiceOver/Safari).

#### M7. Scanner workflow is not implemented as scanner-first input

Products contain barcodes, but booth sale UI selects products and quantity buttons; no barcode key-stream listener, scanner input field, terminator handling, duplicate/debounce behavior, or retained focus logic was found. Test USB/Bluetooth scanners that emulate keyboards, camera scanning if planned, rapid repeated codes, unknown/inactive products, dialog transitions, and mobile virtual-keyboard interference.

#### M8. Backup/restore is capable but untested operationally

Read-only `wrangler d1 info cookie-booth-command-center-db` confirmed the production D1 database exists on the current service (20 tables, 287 kB on the audit date). D1 Time Travel provides point-in-time recovery to any minute in its retention window ([D1 overview](https://developers.cloudflare.com/d1/)).

No recovery runbook, recovery-time objective (RTO), recovery-point objective (RPO), restore drill evidence, or post-restore integrity checklist exists. A restore was **not** performed because it would modify remote state.

Safe exercise:

1. Record a Time Travel bookmark and encrypted schema/data export from production using a least-privilege operator.
2. Create a separately named, access-restricted non-production D1 database.
3. Restore/import only into that isolated database.
4. run row-count, foreign-key/invariant, organization isolation, and sample reconciliation checks;
5. delete the drill database only under explicit authorization and document timing/results.

Never test restore against the production binding. Treat exports as sensitive production data.

#### M9. Durable Object recovery is implicit, not runbook-tested

`worker/booth-live-room.ts:22-37` persists room identity and monotonically increasing revision; it uses the hibernation WebSocket API and reconstructs state after eviction. Clients refresh authoritative D1 state after revision gaps and retain polling fallback. These are strong controls.

The Durable Object stores invalidation revision, not financial truth; D1 remains authoritative. If DO storage/state is reset or a deployment changes namespaces, revisions may restart and clients must full-refresh. Document namespace/migration rollback constraints and test deployment interruption, object eviction, overload errors, and revision reset. A room is single-threaded and has a soft limit around 1,000 requests/second; load-test realistic room fan-out rather than assuming that ceiling ([Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/)).

#### M10. D1 contention and retry behavior are not load-tested

Sales, inventory, and reconciliation use D1 batches and guarded updates, but there is no standardized retry/backoff policy for transient D1 errors or overload. The UI may surface a failure while leaving the user uncertain whether a timed-out sale committed; idempotency is therefore prerequisite to automatic retries.

Load scenarios should include:

- 5, 20, and 50 users in one booth room, and many independent booth rooms;
- 10–100 rapid sales/minute with simultaneous allocation edits;
- two scanners selling the final box;
- reconciliation/closure while sales are in flight;
- socket reconnect storms plus 15-second polling fallback;
- D1 latency, transient errors, DO overload, and deployment disconnects.

Measure p50/p95/p99 mutation latency, error/409/429 rates, inventory invariants, duplicate-sale count, D1 rows read/written, DO CPU, sockets, reconnects, and full-refresh rate. Use synthetic non-production organizations only.

#### M11. Operational documentation is incomplete

Only `docs/durable-object-live-sync.md` exists. Missing:

- incident response: severity, detection, containment, evidence preservation, communications, Clerk/Cloudflare/GitHub escalation, and postmortem;
- data retention/deletion: user identity, invitations, audit records, booth/sale/reconciliation data, logs, backups, legal holds, and verified deletion;
- backup/recovery: RPO/RTO, Time Travel/export commands, restore authorization, integrity checks, failback;
- security contact: primary/secondary on-call, vendor account owners, credential recovery, and external reporting address.

Assign named roles outside the public repository; publish only the appropriate security contact.

### Low

#### L1. CORS behavior is implicit

No application CORS headers are set. The live hostile-origin OPTIONS check returned no allow-origin header, which is a safe same-origin default. Document this invariant and test it so future integrations do not accidentally use wildcard/credentialed CORS.

#### L2. Color contrast and touch sizes need formal verification

Core foreground/background combinations appear intentionally high contrast, and quantity/close controls are 42×42 px. Some muted text, 10–11 px labels, status colors, and compact invitation/archive controls need measured WCAG contrast and 44×44 touch-target review. Do not rely on color alone for status. Test zoom to 200% and text spacing.

#### L3. Secret scanning is manual

No obvious live Clerk/webhook/private-key pattern was found in tracked files; `.env.example` is tracked and contains placeholders. `wrangler.jsonc` appropriately contains resource IDs but no secret values. There is no repository-visible GitHub Actions, Dependabot, CodeQL, secret-scanning, or push-protection policy. Dashboard settings were not inspected.

## Already implemented controls

### Authorization and tenant isolation

- `lib/access.ts:20-47` derives the user from Clerk server-side and requires active user plus active organization membership.
- `lib/access.ts:50-80` enforces administrator and delegated invitation-manager roles.
- `lib/access.ts:98-158` resolves the booth’s organization server-side, requires booth assignment for lead/volunteer users, and derives operation/manage/reconcile/report permissions.
- Resource mutation queries consistently pair resource IDs with `organization_id`; examples include products (`app/api/admin/products/[productId]/route.ts:39-68`), alerts (`app/api/admin/alerts/[alertId]/route.ts:44-79`), memberships (`app/api/admin/people/[membershipId]/route.ts:55-65,135-143`), booth inventory (`app/api/admin/booth-inventory/route.ts:20-24`), and invitations (`app/api/organization-invitations/[invitationId]/*`).
- The last-active-admin guard exists in `app/api/admin/people/[membershipId]/route.ts:84-104`.

Residual risk: these controls lack executable negative/cross-tenant regression tests. The booth lookup in `getBoothAccess` begins by global booth ID and then derives organization access; this is safe with globally unique IDs but deserves an IDOR test.

### WebSocket isolation and recovery

- Exact same-origin validation and server-side booth access are enforced before obtaining a DO stub: `app/api/booths/[boothId]/live/route.ts:8-27`.
- The room name is derived server-side from authorized organization and booth IDs; client authorization data is not trusted.
- `worker/booth-live-room.ts:39-58` permanently binds a room to its first valid organization/booth identity and rejects mismatch.
- `worker/booth-live-room.ts:71-84` persists monotonic revisions and broadcasts invalidations; clients use authoritative refresh and polling fallback.
- Hibernatable sockets are used, aligning with Cloudflare’s recommended Durable Object WebSocket API ([Cloudflare WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)).

### Data integrity and safe errors

- API bodies are generally parsed with Zod and invalid inputs receive 400 responses.
- Sales/inventory/reconciliation use bound SQL, guarded quantities, organization scoping, and D1 batches.
- Client synchronization keeps the last valid display and preserves active New Sale/reconciliation state.
- Most API errors are generic and avoid stack traces. However, there is no centralized redaction or exception reporting policy.

### Clerk webhook verification

`app/api/webhooks/clerk/route.ts:17-27` fails closed when its signing secret is absent and verifies the webhook signature before processing.

### Responsive foundations

`app/globals.css` includes breakpoints at 1100, 1050, 900, 700, 620, and 480 px; dialogs constrain viewport height and scroll; wide tables use explicit overflow. These are useful foundations, not a substitute for device/assistive-technology testing.

## Configuration changes versus code changes

### Application/code changes

- dependency upgrades and lockfile refresh;
- centralized security-header and unsafe-method Origin policy;
- rate-limit calls and consistent 429 responses;
- request IDs, structured/redacted logging, error taxonomy;
- sale idempotency and webhook event deduplication;
- API/tenant/CSRF/WebSocket tests;
- dialog focus, error announcements, mobile navigation, and scanner behavior;
- operational runbooks in `docs/`.

### Cloudflare configuration changes

- Workers Rate Limiting binding and/or WAF rate-limit rules;
- enable sampled Workers Logs/traces and alerting/export;
- validate SSL/TLS mode, Always Use HTTPS, minimum TLS, HSTS rollout, bot/WAF rules, and log retention;
- establish non-production load/drill resources and D1 restore permissions;
- document DO namespace/migration rollback procedure.

These require deployment/configuration authorization. Start HSTS with a short `max-age`; only add `includeSubDomains`/preload after domain inventory.

### Clerk configuration changes

- confirm and potentially enable global required MFA;
- enable preferred factors (TOTP recommended; SMS as a recovery trade-off), backup codes, lockout, and client trust;
- document manual unlock and MFA reset controls;
- review session lifetime, inactivity timeout, allowed origins/domains, restricted/invitation-only access, and webhook retry health.

Required MFA can interrupt every user’s next sign-in/enrollment. Test in a Clerk development instance first.

### GitHub configuration changes

- Dependabot version/security updates;
- dependency review and `npm audit` policy in CI;
- CodeQL or equivalent SAST;
- secret scanning and push protection;
- branch protection, required reviews/checks, least-privilege Actions permissions, pinned third-party actions;
- documented security advisories/contact ownership.

Repository settings were not queried, so absence from source does not prove a dashboard feature is disabled.

## Implementation phases

### Phase 1 — patched baseline, tests, telemetry, and report-only headers

Scope:

1. Upgrade direct patched dependencies in a dedicated branch; review all transitive changes.
2. Add executable negative authorization/tenant tests for the highest-value mutation routes and WebSocket handshake.
3. Add request IDs and redacted structured error/audit events.
4. Add security headers, initially CSP `Report-Only`; stage HSTS with a short lifetime.
5. Add CI audit, secret scan, and security-test checks.

Validation:

- lint, complete tests, TypeScript, artifact validation, production build, local Wrangler validation;
- Clerk development-instance sign-in/sign-out/MFA enrollment;
- CSP report review for Clerk, Google Places, assets, WebSocket, and image paths;
- cross-tenant matrix and hostile-origin tests;
- staging smoke test on phone/tablet and supported browsers.

Rollback:

- revert dependency/headers commit and redeploy the previous known-good Worker version;
- disable CSP report-only/observability config independently if volume or compatibility is problematic;
- no database migration is required for this phase.

Disruption risk: dependency changes and CSP can break sign-in/build/deployment. Do not promote until Secure Sign-in and Google Places are exercised in staging.

### Phase 2 — abuse controls and transaction idempotency

Scope: edge plus per-user/resource rate limits, sale idempotency, webhook deduplication, safe retry/backoff, and dashboards for 409/429/5xx.

Validation: observe-only traffic baselines first; non-production rapid-sale/reconnect tests; verify legitimate scanner bursts and invitation workflows.

Rollback: disable/bypass individual rate-limit rules or bindings; retain idempotency records because removing uniqueness after use can re-enable duplicates.

Disruption risk: overly strict limits can block sign-in, booth sales, invitations, webhooks, and reconnects. Idempotency requires a D1 migration; take a recovery bookmark/export and use expand-first deployment sequencing. No remote migration without explicit authorization.

### Phase 3 — identity assurance and accessible mobile operations

Scope: choose global versus admin-only MFA; configure recovery/lockout; implement focus management, error associations, mobile navigation, scanner input, and automated browser/accessibility tests.

Validation: Clerk development instance, two break-glass admins, recovery drill, NVDA/VoiceOver, keyboard-only, 200% zoom, scanner hardware, phone/tablet matrix.

Rollback: preserve a documented Clerk break-glass path; revert UI changes independently. Do not disable MFA casually during an incident without identity-owner approval.

Disruption risk: MFA configuration can lock out all users; navigation/scanner changes can block booth operation. Roll out to internal accounts before volunteers.

### Phase 4 — resilience, load, and operations

Scope: non-production load suite, D1 restore drill, DO deployment/revision-reset exercise, alerts/SLOs, incident response, retention/deletion, recovery, and security responsibility runbooks.

Validation: verify invariants and RPO/RTO during a tabletop plus technical drill; produce signed drill evidence without production data in logs.

Rollback: tests target isolated resources; remove test bindings/resources only with authorization. Runbooks are versioned and reversible.

Disruption risk: never bind a drill Worker/database/DO namespace to the production hostname. D1 restore and DO migration operations can irreversibly affect production and require explicit approval.

## Recommended first implementation phase

Start with **Phase 1**. Within it, patch Next.js/React Server DOM and Cloudflare/Vite tooling first, then add the negative tenant-access test harness before broader refactoring. Introduce CSP as report-only and HSTS with a short staged lifetime, not as an immediate strict production policy. Add correlation-aware redacted telemetry alongside the tests so subsequent rate-limit tuning is evidence-based.

Do not combine the first phase with MFA enforcement, a D1 schema migration, remote restore, strict CSP, permanent HSTS/preload, or production rate-limit enforcement. Those controls can disrupt Secure Sign-in, deployment, or booth operations and should follow verified staging exercises and explicit authorization.

## Audit limitations

- No source, dependency, secret, remote configuration, production data, branch, commit, PR, migration, or deployment was changed. This report is the only workspace change.
- Clerk Dashboard, Cloudflare dashboard rules, and GitHub repository settings were not available for inspection; configuration findings are therefore “not evidenced in repository,” not proof of disabled dashboard settings.
- No authenticated production requests, mutation requests, WebSocket connections, load traffic, scanners, assistive technologies, or production restore were exercised.
- The header and OPTIONS checks were unauthenticated and read-only. Cookie/session attributes could not be safely assessed from an authenticated browser; Clerk defaults and dashboard session settings require a separate authorized review.
- `npm audit` reflects advisory data on the audit date and does not establish exploitability in this deployment.

# Milestone 5 Phase 5A production hardening

## Implemented controls

- Compatible security updates for the production framework and Cloudflare toolchain.
- Pure authorization policies used by production access checks and executable role/tenant tests.
- Worker-generated UUID request IDs, returned as `x-request-id`.
- Structured JSON completion, rejection, and failure events suitable for Workers Logs.
- Conservative logging allowlist/redaction: no headers or bodies are logged; sensitive key names and non-primitive values are redacted.
- CSP Report-Only, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options`, and staged one-day HSTS.
- Exact-origin rejection when an unsafe application API request supplies `Origin`; Clerk’s signed webhook is exempt.

No Durable Object or D1 migration is included. No Cloudflare, Clerk, GitHub, secret, MFA, rate-limit, or production setting is changed by the branch.

## Dependency advisory disposition

The baseline audit reported 18 package findings (13 High, 4 Moderate, 1 Low). Phase 5A reviewed each advisory family and selected patched releases without unnecessary major changes:

- Next.js application advisories: upgraded 16.2.6 → 16.2.12.
- React/React Server DOM denial of service: upgraded the aligned React packages 19.2.6 → 19.2.8.
- Vite Windows disclosure/development-server issues: upgraded 8.0.13 → 8.1.5.
- Cloudflare plugin/Miniflare/Wrangler, `ws`, `undici`, and associated Sharp issues: upgraded the plugin 1.37.1 → 1.47.0, Wrangler 4.92.0 → 4.114.0, and Workers Types to the required v5 peer.
- PostCSS and Sharp: pinned patched compatible transitive overrides, 8.5.24 and 0.35.3.
- `fast-uri`, `js-yaml`, `@babel/core`, and brace-expansion: refreshed to patched compatible transitive releases where available.

Final `npm audit` reports 13 findings (9 High, 4 Moderate, 0 Critical). All are in development tooling; npm counts one vulnerable minimatch/brace-expansion path repeatedly through its ESLint dependents:

- ESLint 9 dependencies use a vulnerable minimatch range. npm proposes ESLint 10, a major change; defer until Next’s lint stack is verified compatible.
- Drizzle Kit 0.31.10 retains a legacy `@esbuild-kit`/esbuild development-server advisory. npm’s proposed “fix” is a downgrade to Drizzle Kit 0.18.1, which is unsafe and unrelated to the deployed runtime.

These packages are not imported by the production Worker. CI and local development should not process attacker-controlled glob patterns, source maps, or expose development servers to untrusted networks. Recheck advisories regularly and remove the deferral when compatible upstream releases exist.

## Structured log contract

Example:

```json
{"timestamp":"2026-07-28T12:00:00.000Z","level":"info","event":"request.completed","requestId":"uuid","route":"/api/booths/:id/sales","method":"POST","status":201,"durationMs":42}
```

Permitted operational context is limited to event, request ID, normalized path, method, status, duration, numeric organization/booth IDs when explicitly supplied by trusted server code, and error category. The logger redacts keys matching authorization, cookie, token, secret, password, credential, email, Clerk, signature, body, payload, or notes. Objects/arrays are redacted by default. Do not pass raw `Request`, `Headers`, `Error`, Clerk user data, invitation data, sale/reconciliation bodies, or database rows.

Logs use `console.log`, `console.warn`, and `console.error`; Cloudflare can ingest these without an external provider. This branch does not enable paid/sampled Workers observability remotely.

## CSP inspection before enforcement

The policy is emitted only as `Content-Security-Policy-Report-Only`; it cannot block content.

1. Deploy to a non-production Worker/hostname first.
2. In browser developer tools, clear the console and network log.
3. Exercise signed-out Secure Sign-in, sign-in/sign-out, session refresh, organization switching, Google Places booth creation, images, New Sale, reconciliation, and WebSocket reconnect/fallback.
4. Filter console messages for `Content Security Policy` and inspect blocked/report-only URLs.
5. Confirm response headers include Report-Only and do **not** include enforced `Content-Security-Policy`.
6. If centralized reports are later required, add an approved same-origin report endpoint or Cloudflare-supported reporting destination with rate limits and a retention/redaction plan. CSP reports can contain page URLs; treat them as potentially sensitive.
7. Tighten sources and remove `'unsafe-inline'` only after nonce/hash support is proven. Enforcing the current policy requires a separate authorized change.

The Clerk allowances follow Clerk's current CSP guidance, including the application Frontend API host, fraud protection, Cloudflare challenges, telemetry, and optional Stripe-backed component flows. Reconfirm the production Frontend API hostname in Clerk before enforcement.

## Deployment validation

Before any production deployment:

1. Confirm the branch diff contains no secrets, `.env` files, generated logs, or Wrangler state.
2. Run `npm audit`, lint, `npx tsc --noEmit`, complete tests, artifact validation, production build, and `npx wrangler deploy --dry-run`.
3. Inspect the built sign-in HTML for the Secure Sign-in content and required Clerk client assets/config without printing key values.
4. Search source and generated artifacts for known secret formats and sensitive sample values.
5. Deploy to staging and complete the CSP workflow above.
6. Verify same-origin POST/PATCH/PUT requests succeed and a hostile supplied Origin receives 403.
7. Verify unauthenticated and cross-organization API/WebSocket access still fails.
8. Check structured logs by request ID and confirm they contain no cookies, authorization values, email addresses, Clerk identifiers, or request bodies.
9. Confirm WebSocket upgrade and polling fallback; 101 responses intentionally are not reconstructed to avoid losing Cloudflare’s WebSocket attachment.
10. Only with explicit authorization, deploy the saved version to production and repeat sign-in plus booth smoke tests.

No manual Cloudflare or Clerk configuration is required for the code to run. Enabling Workers Logs/traces, CSP reporting collection, MFA, rate limiting, or changing edge HSTS is explicitly outside this phase.

## Rollback

If sign-in, assets, API mutations, image optimization, or synchronization regress:

1. Use Cloudflare Worker version rollback to the last known-good production version.
2. Do not change Clerk secrets, D1, Durable Object migrations/namespaces, or DNS; this phase has no data migration.
3. If only browser warnings are unexpected, Report-Only cannot block requests. Investigate before removing it.
4. If a legitimate client supplies a non-production Origin and receives 403, roll back the Worker or issue a reviewed allowlist change; do not disable server authorization.
5. The one-day HSTS header expires naturally after 86,400 seconds. Do not add `includeSubDomains` or preload during this phase.
6. Revert the Phase 5A commit and rebuild from the prior lockfile if dependency behavior is the cause.

Rollback does not undo any production data because Phase 5A performs no schema or data migration.

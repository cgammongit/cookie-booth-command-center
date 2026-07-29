# Production pre-deployment checklist

Owner: ____________________  
Rollback decision deadline (UTC): ____________________  
Current deployment/version: ____________________  
Compatible rollback target: ____________________

- [ ] Working tree is clean; commit and review scope are recorded.
- [ ] Required D1 and Durable Object migrations are explicitly identified.
- [ ] Current D1 database identity and `version: production` are confirmed.
- [ ] Current D1 Time Travel bookmark is captured in the change record.
- [ ] Risk decision recorded: Time Travel only, or additional checksummed SQL export.
- [ ] Current and target `DB`, `BOOTH_LIVE_ROOMS`, `RATE_LIMITER`, assets, and DO migration compatibility are confirmed.
- [ ] Rollback target is post-v2 and compatible with the current D1 schema.
- [ ] Required secret names are present; no values were displayed or logged.
- [ ] npm audit results and accepted pre-existing advisories are recorded.
- [ ] Lint, TypeScript, complete tests, production build, artifact validation, credential scan, and Wrangler dry-run passed.
- [ ] Migration and deployment operator/approver are named.
- [ ] Incident/write-freeze threshold and rollback deadline are agreed.
- [ ] Post-deployment HTTP 200 and security headers pass.
- [ ] Secure Sign-in and tenant/role isolation pass.
- [ ] Google Places passes.
- [ ] D1 booth/troop inventory reads and an approved test mutation pass.
- [ ] WebSocket 101, heartbeat/live updates, and polling fallback pass.
- [ ] Rate limiting and sanitized structured logs pass.
- [ ] Roll forward/rollback decision is recorded by the named owner before the deadline.

See [disaster-recovery-runbook.md](./disaster-recovery-runbook.md) for backup,
restore, verification, incident, and rollback procedures.

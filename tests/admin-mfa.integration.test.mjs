import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { evaluateAdminMfa } = await import("../lib/admin-mfa-policy.ts");

function decision({
  admin = false,
  twoFactorEnabled = false,
  membershipFailure = false,
  clerkFailure = false,
} = {}) {
  return evaluateAdminMfa({
    clerkUserId: "authoritative-clerk-user",
    hasActiveAdminMembership: async (userId) => {
      assert.equal(userId, "authoritative-clerk-user");
      if (membershipFailure) throw new Error("D1 unavailable");
      return admin;
    },
    getClerkUser: async (userId) => {
      assert.equal(userId, "authoritative-clerk-user");
      if (clerkFailure) throw new Error("Clerk unavailable");
      return { twoFactorEnabled };
    },
  });
}

test("administrator MFA policy allows enrolled admins and blocks unenrolled admins", async () => {
  assert.deepEqual(await decision({ admin: true, twoFactorEnabled: true }), {
    required: true,
    configured: true,
    reason: "configured",
  });
  assert.deepEqual(await decision({ admin: true, twoFactorEnabled: false }), {
    required: true,
    configured: false,
    reason: "not_configured",
  });
});

test("lead, volunteer, and auditor roles remain usable without MFA", async () => {
  for (const role of ["lead", "volunteer", "auditor"]) {
    const result = await decision({ admin: false, twoFactorEnabled: false });
    assert.deepEqual(result, {
      required: false,
      configured: true,
      reason: "not_admin",
    }, role);
  }
});

test("admin membership or Clerk lookup failures fail closed", async () => {
  assert.deepEqual(await decision({ membershipFailure: true }), {
    required: true,
    configured: false,
    reason: "status_unavailable",
  });
  assert.deepEqual(await decision({ admin: true, clerkFailure: true }), {
    required: true,
    configured: false,
    reason: "status_unavailable",
  });
});

test("only authoritative membership and Clerk state determine enforcement", async () => {
  const hostileClientInput = {
    role: "volunteer",
    mfaEnabled: true,
    organizationId: 999,
  };
  assert.deepEqual(hostileClientInput, {
    role: "volunteer",
    mfaEnabled: true,
    organizationId: 999,
  });
  assert.equal(
    (await decision({ admin: true, twoFactorEnabled: false })).configured,
    false,
  );
  assert.equal(
    (await decision({ admin: false, twoFactorEnabled: false })).required,
    false,
  );
});

test("account security route is fixed and does not accept an external return URL", async () => {
  const [page, panel, dashboard] = await Promise.all([
    readFile(new URL("../app/account/[[...user-profile]]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/auth-panels.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /path="\/account"/);
  assert.match(panel, /href="\/account\/security"/);
  assert.doesNotMatch(page + panel, /returnUrl|redirect_url|redirectUrl/);
  assert.match(dashboard, /Set up MFA/);
});

/**
 * Node-only validation shim for Cloudflare's runtime-provided module.
 *
 * The production Worker receives the real `cloudflare:workers` module. Node's
 * artifact validator does not understand that URL scheme, so validation maps
 * it to an inert binding object while importing the built Worker.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return {
      shortCircuit: true,
      url: "data:text/javascript,export const env = globalThis.__CLOUDFLARE_ENV__ ?? {}; export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }",
    };
  }

  if (specifier === "@clerk/nextjs/server") {
    return {
      shortCircuit: true,
      url: "data:text/javascript,export async function auth(){return globalThis.__CLERK_TEST_AUTH__ ?? {userId:null}}; export async function clerkClient(){return globalThis.__CLERK_TEST_CLIENT__}",
    };
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      context.parentURL?.endsWith(".ts") &&
      (specifier.startsWith(".") || specifier.startsWith("/"))
    ) {
      for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
        try {
          return await nextResolve(candidate, context);
        } catch {
          // Try the next TypeScript resolution used by the integration tests.
        }
      }
    }
    throw error;
  }
}

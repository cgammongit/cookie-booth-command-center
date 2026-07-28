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

  return nextResolve(specifier, context);
}

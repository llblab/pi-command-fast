/** Domain: Fast command. Owns: session-scoped provider dispatch. Excludes: UI status, auth and persisted Fast values. */
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface FastProviderRegistration {
  provider: string;
  toggle(ctx: ExtensionCommandContext): Promise<void> | void;
}
type Registry = { providers: Map<string, FastProviderRegistration> };
const KEY = Symbol.for("@llblab/pi-command-fast/registry/v1");
const globals = globalThis as typeof globalThis & { [KEY]?: WeakMap<object, Registry> };
const registries = globals[KEY] ??= new WeakMap<object, Registry>();

/** Call from session_start; call the returned release function from session_shutdown. */
export function registerFastProvider(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  registration: FastProviderRegistration,
): () => void {
  const session = ctx.sessionManager;
  let registry = registries.get(session);
  if (!registry) {
    registry = { providers: new Map() };
    registries.set(session, registry);
    try {
      pi.registerCommand("fast", {
        description: "Toggle Fast mode for the current provider/model",
        getArgumentCompletions: () => null,
        handler: async (args, invocation) => {
          if (args.trim()) {
            invocation.ui.notify("Usage: /fast", "warning");
            return;
          }
          const provider = invocation.model?.provider;
          const handler = provider && registries.get(invocation.sessionManager)?.providers.get(provider);
          if (!handler) {
            invocation.ui.notify("Fast mode is not supported for the current provider", "warning");
            return;
          }
          try {
            await handler.toggle(invocation);
          } catch (error) {
            invocation.ui.notify(error instanceof Error ? error.message : String(error), "error");
          }
        },
      });
    } catch (error) {
      registries.delete(session);
      throw error;
    }
  }
  if (registry.providers.has(registration.provider))
    throw new Error(`Fast provider already registered: ${registration.provider}`);
  registry.providers.set(registration.provider, registration);
  const owned = registry;
  return () => {
    if (registries.get(session) !== owned || owned.providers.get(registration.provider) !== registration) return;
    owned.providers.delete(registration.provider);
    // Reload retains the sessionManager, but destroys all commands: reset after last release.
    if (owned.providers.size === 0) registries.delete(session);
  };
}

# pi-command-fast

`@llblab/pi-command-fast` is a shared library for coordinating one `/fast` command across multiple Pi extensions. **It is not a Pi extension and should not be installed as one.**

Register provider-level handlers; keep model capability checks inside the owning consumer, not this command registry. Consumers define Fast semantics and eligibility; each model owns its persisted override in Pi's `models.json`. The library itself has no model-ID allowlists, status, auth, provider transport, timers or separate config.

```ts
import { registerFastProvider, toggleModelOverrideValue } from "@llblab/pi-command-fast";

let release: (() => void) | undefined;
pi.on("session_start", (_event, ctx) => {
  release = registerFastProvider(pi, ctx, {
    provider: "my-provider",
    toggle(commandCtx) {
      toggleModelOverrideValue({
        provider: commandCtx.model!.provider,
        id: commandCtx.model!.id,
        property: "providerNativeField",
        enabledValue: "providerNativeValue",
      });
      redrawExistingUsageStatus(commandCtx); // Consumer-owned, no quota request.
    },
  });
});
pi.on("session_shutdown", () => { release?.(); release = undefined; });
```

Public API: `registerFastProvider`, `modelsJsonPath`, `isModelOverrideValue`, `toggleModelOverrideValue`. OFF deletes only the property. Reads fail closed; writes report concrete errors. Edits preserve JSONC, BOM, unrelated fields and object order, re-read before toggling, and replace via a sibling temporary file/atomic rename. This is corruption protection, not cross-process transaction isolation.

Duplicate installed library copies discover a versioned `Symbol.for` WeakMap keyed by `ctx.sessionManager`. Invocation resolves the current session and provider, independent of load order. Release all registrations on shutdown: Pi reload keeps the session manager but replaces command maps. Late releases cannot delete a fresh registry. The command handler never captures a current model or Fast boolean.

Requires Node ≥22.19.0 and Pi ≥1.0.0, with dynamic command registration. Pi 1.0.0 has no public unregister/conditional-visibility API: `/fast` stays listed while consumers are loaded and rejects unrelated providers. It is registered during session_start; Pi builds interactive autocomplete after extension binding. `npm run validate` builds ESM/declarations, tests duplicate-copy/session/config behavior, checks import, audit and package contents.

Packed-consumer integration in an actual Pi host (offline, synthetic credentials, no paid requests):

```bash
npm run test:pi -- /path/to/pi-coding-agent fast.tgz codex-usage.tgz claude-usage.tgz
```

This extracts both consumers, installs the packed library into separate physical dependency directories, and exercises single/dual load order, dispatch, arbitrary Codex model IDs and supported/rejected Claude model eligibility, session isolation, reload, restart, statuses and native HTTP assembly. All fetches are intercepted before network access; it does not prove provider-side Fast availability or real terminal rendering. The HTTP inspection needs Node ≥22.15 for zstd decompression when Pi compresses a request.

[Agent Notes](./AGENTS.md) · [Backlog](./BACKLOG.md) · [Changelog](./CHANGELOG.md)

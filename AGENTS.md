# Agent Notes

- `Pi baseline`: All declared Pi peers require ≥1.0.0; keep lockfile identity aligned and verify packed consumers offline. Do not claim compatibility with earlier hosts.
- `Library only`: No Pi extension factory, Pi resource metadata, provider semantics, model IDs, status, auth, or background work.
- `Command ownership`: Register from session_start; release on session_shutdown. A process-global versioned Symbol owns only a WeakMap of sessionManager identities, never current-provider or Fast state.
- `Model state`: models.json is authoritative. Enabled is exact configured value; OFF deletes the property. Always re-read; preserve user JSONC and unrelated data; use atomic replacement without quota mutexes.
- `Domain DAG`: index is exports only; command and models-json are independent owners. Tests mirror domain names. Pack ESM and declarations; test physically separate copies.

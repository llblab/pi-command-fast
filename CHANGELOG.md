# Changelog

## 0.1.0 (unreleased)

- Requires Pi ≥1.0.0 for a consistent host baseline across the library and usage consumers.
- Added session-scoped provider registration for exactly one argument-free `/fast`, including duplicate installed library copies and shutdown/reload reset.
- Added generic per-model JSONC override reads and atomic toggles using Pi's canonical models.json path. No provider request logic or Pi extension entrypoint.

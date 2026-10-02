/** Domain: model overrides. Owns: targeted JSONC reads/toggles and atomic replacement. Excludes: provider semantics and locking. */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

export interface ModelOverrideTarget {
  provider: string;
  id: string;
  property: string;
  enabledValue: string;
}
export function modelsJsonPath(): string {
  return join(getAgentDir(), "models.json");
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function readConfig(path: string, target: ModelOverrideTarget) {
  let text: string;
  let mode = 0o600;
  try {
    text = readFileSync(path, "utf8");
    mode = statSync(path).mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    text = "{}\n";
  }
  const errors: ParseError[] = [];
  const source = text.replace(/^\uFEFF/, "");
  const config: unknown = parse(source, errors, { allowTrailingComma: true });
  if (errors.length || !isRecord(config)) throw new Error("Invalid models.json");
  // Missing containers are valid edit targets; existing non-object containers are not.
  let current: unknown = config;
  for (const key of ["providers", target.provider, "modelOverrides", target.id]) {
    if (!isRecord(current)) throw new Error("Invalid model override structure in models.json");
    current = Object.hasOwn(current, key) ? current[key] : undefined;
    if (current === undefined) return { text, source, mode, value: undefined };
  }
  if (!isRecord(current)) throw new Error("Invalid model override structure in models.json");
  return { text, source, mode, value: Object.hasOwn(current, target.property) ? current[target.property] : undefined };
}
export function isModelOverrideValue(target: ModelOverrideTarget, path = modelsJsonPath()): boolean {
  try {
    return readConfig(path, target).value === target.enabledValue;
  } catch {
    return false; // Failure is local to Fast; usage polling must continue.
  }
}
/** Re-read at every toggle; OFF is property absence, never a sentinel value. */
export function toggleModelOverrideValue(target: ModelOverrideTarget, path = modelsJsonPath()): boolean {
  let temporary: string | undefined;
  try {
    const { text, source, mode, value } = readConfig(path, target);
    const enabled = value === target.enabledValue;
    const edits = modify(source, ["providers", target.provider, "modelOverrides", target.id, target.property],
      enabled ? undefined : target.enabledValue,
      { formattingOptions: { insertSpaces: true, tabSize: 2, eol: source.includes("\r\n") ? "\r\n" : "\n" } });
    const next = applyEdits(source, edits);
    const errors: ParseError[] = [];
    parse(next, errors, { allowTrailingComma: true });
    if (errors.length) throw new Error("Could not safely edit JSONC");
    mkdirSync(dirname(path), { recursive: true });
    temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, (text.startsWith("\uFEFF") ? "\uFEFF" : "") + next, { flag: "wx", mode });
    renameSync(temporary, path);
    temporary = undefined;
    return !enabled;
  } catch (error) {
    throw new Error(`Could not update models.json: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (temporary) {
      try { unlinkSync(temporary); } catch { /* Preserve the original write failure. */ }
    }
  }
}

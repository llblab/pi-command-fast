import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
test("normal ESM library declares the Pi 1.0.0 host floor, not Pi extension resources", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.pi, undefined);
  assert.equal(pkg.peerDependencies["@earendil-works/pi-coding-agent"], ">=1.0.0");
  assert.equal(pkg.exports["."].import, "./dist/index.js");
  assert.equal(pkg.exports["."].types, "./dist/index.d.ts");
});

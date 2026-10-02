import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
test("canonical models.json path comes from Pi's PI_CODING_AGENT_DIR override",()=>{
  const dir=join(tmpdir(),"pi-fast-canonical-only");
  const output=execFileSync(process.execPath,["--input-type=module","-e",'import { modelsJsonPath } from "./dist/index.js"; console.log(modelsJsonPath());'],{
    cwd:new URL("../",import.meta.url),env:{...process.env,PI_CODING_AGENT_DIR:dir},encoding:"utf8",
  });
  assert.equal(output.trim(),join(dir,"models.json"));
});

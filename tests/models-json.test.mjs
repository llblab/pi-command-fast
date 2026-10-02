import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "jsonc-parser";
import { isModelOverrideValue, toggleModelOverrideValue } from "../dist/index.js";
const a={provider:"provider-a",id:"future-model-a",property:"arbitraryField",enabledValue:"enabled"};
const b={...a,id:"future-model-b"};
function fixture(fn) { const dir=mkdtempSync(join(tmpdir(),"fast-config-")); try{fn(join(dir,"models.json"));}finally{rmSync(dir,{recursive:true,force:true});} }
test("missing intermediate objects and file are created; enabled value toggles to property absence",()=>fixture(path=>{
  for(const source of [null,"{}","{\"providers\":{}}","{\"providers\":{\"provider-a\":{}}}","{\"providers\":{\"provider-a\":{\"modelOverrides\":{}}}}"]) {
    if(source===null) { } else writeFileSync(path,source);
    assert.equal(toggleModelOverrideValue(a,path),true);
    assert.equal(isModelOverrideValue(a,path),true);
    assert.equal(isModelOverrideValue(b,path),false);
    assert.equal(toggleModelOverrideValue(a,path),false);
    assert.equal(isModelOverrideValue(a,path),false);
    assert.equal(Object.hasOwn(parse(readFileSync(path,"utf8")).providers[a.provider].modelOverrides[a.id],a.property),false);
  }
}));
test("JSONC/BOM/order, unknown fields, provider/model siblings and latest external edits survive",()=>fixture(path=>{
  writeFileSync(path,'\uFEFF{\n  // note\n  "unknown": {"future": true},\n  "providers": { "other": { "unrecognized": 42 }, "provider-a": { "modelOverrides": { "future-model-a": { "reasoning": true, }, "future-model-b": {"arbitraryField":"enabled"} } } },\n}\n');
  toggleModelOverrideValue(a,path);
  assert.equal(isModelOverrideValue(a,path),true);
  let text=readFileSync(path,"utf8");
  assert.match(text,/^\uFEFF/); assert.ok(text.includes("// note"));
  writeFileSync(path,text.replace('"reasoning": true','"reasoning": true, "manualEdit": 123'));
  toggleModelOverrideValue(a,path);
  const data=parse(readFileSync(path,"utf8").slice(1));
  assert.deepEqual(data.unknown,{future:true});
  assert.equal(data.providers.other.unrecognized,42);
  assert.deepEqual(data.providers[a.provider].modelOverrides[a.id],{reasoning:true,manualEdit:123});
  assert.equal(isModelOverrideValue(b,path),true);
}));
test("empty, malformed and non-object containers fail without truncation or leftover temp files",()=>fixture(path=>{
  for(const text of ["", "{", "[]", '{"providers":null}', '{"providers":{"provider-a":{"modelOverrides":[]}}}']) {
    writeFileSync(path,text);
    assert.equal(isModelOverrideValue(a,path),false);
    assert.throws(()=>toggleModelOverrideValue(a,path),/Could not update models.json/);
    assert.equal(readFileSync(path,"utf8"),text);
    assert.deepEqual(readdirSync(join(path,"..")),["models.json"]);
  }
}));
test("write/read failure remains local",()=>fixture(path=>{
  mkdirSync(path);
  assert.equal(isModelOverrideValue(a,path),false);
  assert.throws(()=>toggleModelOverrideValue(a,path),/Could not update models.json/);
  assert.deepEqual(readdirSync(path),[]);
}));

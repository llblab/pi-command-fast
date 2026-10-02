import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { registerFastProvider } from "../dist/index.js";

function host(session = {}) {
  const commands = [];
  const notices = [];
  return { commands, notices, pi: { registerCommand: (name, options) => commands.push({ name, ...options }) },
    ctx: { sessionManager: session, model: { provider: "openai-codex", id: "future-codex-model" },
      ui: { notify: text => notices.push(text) } } };
}
test("one command, either provider alone and both loading orders; no model-name filtering", async () => {
  for (const order of [["openai-codex"], ["anthropic"], ["openai-codex","anthropic"], ["anthropic","openai-codex"]]) {
    const h = host(), calls = [];
    const release = order.map(provider => registerFastProvider(h.pi, h.ctx, { provider, toggle: ctx => calls.push(ctx.model.provider) }));
    assert.equal(h.commands.length, 1);
    assert.equal(h.commands[0].name, "fast");
    for (const provider of order) {
      h.ctx.model = { provider, id: "fictional-future-model" };
      await h.commands[0].handler("", h.ctx);
    }
    assert.deepEqual(calls, order);
    assert.equal(h.notices.length, 0);
    await h.commands[0].handler("priority", h.ctx);
    assert.equal(h.notices.at(-1), "Usage: /fast");
    h.ctx.model = { provider: "deepseek", id: "anything" };
    await h.commands[0].handler("", h.ctx);
    assert.equal(h.notices.at(-1), "Fast mode is not supported for the current provider");
    assert.deepEqual(calls, order);
    release.forEach(fn => fn());
  }
});
test("duplicate physical library copies share one command without leaking across sessions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fast-copies-"));
  try {
    cpSync(new URL("../dist/command.js", import.meta.url), join(dir,"first.mjs"));
    cpSync(new URL("../dist/command.js", import.meta.url), join(dir,"second.mjs"));
    const a = await import(pathToFileURL(join(dir,"first.mjs")));
    const b = await import(pathToFileURL(join(dir,"second.mjs")));
    const h = host(), other = host(), calls = [];
    const ra = a.registerFastProvider(h.pi,h.ctx,{provider:"openai-codex",toggle:()=>calls.push("A")});
    const rb = b.registerFastProvider(h.pi,h.ctx,{provider:"anthropic",toggle:()=>calls.push("B")});
    const rc = b.registerFastProvider(other.pi,other.ctx,{provider:"openai-codex",toggle:()=>calls.push("other")});
    assert.equal(h.commands.length,1); assert.equal(other.commands.length,1);
    h.ctx.model.provider = "anthropic";
    await h.commands[0].handler("",h.ctx);
    await other.commands[0].handler("",other.ctx);
    assert.deepEqual(calls,["B","other"]);
    ra(); rb(); rc();
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test("reload reuses sessionManager but releases stale ownership; old cleanup cannot remove new registrations", async () => {
  const session = {}, first = host(session), next = host(session);
  const release = registerFastProvider(first.pi,first.ctx,{provider:"openai-codex",toggle:()=>{}});
  release(); release();
  let toggled = false;
  const cleanup = registerFastProvider(next.pi,next.ctx,{provider:"anthropic",toggle:()=>{toggled=true;}});
  release();
  assert.equal(next.commands.length,1);
  next.ctx.model.provider="anthropic";
  await next.commands[0].handler("",next.ctx);
  assert.equal(toggled,true);
  cleanup();
});
test("duplicate provider registration is explicit, and command registration failures do not poison a session", () => {
  const h=host();
  assert.throws(()=>registerFastProvider({registerCommand:()=>{throw Error("inactive");}},h.ctx,{provider:"a",toggle:()=>{}}),/inactive/);
  const release=registerFastProvider(h.pi,h.ctx,{provider:"a",toggle:()=>{}});
  assert.equal(h.commands.length,1);
  assert.throws(()=>registerFastProvider(h.pi,h.ctx,{provider:"a",toggle:()=>{}}),/already registered/);
  release();
});

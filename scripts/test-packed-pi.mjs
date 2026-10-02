// Offline release-preparation smoke: real Pi loader/runner, packed consumers, separate library copies.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import * as zlib from "node:zlib";
import { parse } from "jsonc-parser";

const [hostPath, libraryPack, codexPack, claudePack] = process.argv.slice(2).map(value => resolve(value));
if (!hostPath || !libraryPack || !codexPack || !claudePack)
  throw new Error("Usage: node scripts/test-packed-pi.mjs PI_PACKAGE FAST_TGZ CODEX_TGZ CLAUDE_TGZ");
const { ModelRuntime, SessionManager, SettingsManager, DefaultResourceLoader, createAgentSession } = await import(pathToFileURL(join(hostPath, "dist/index.js")));
const { InMemoryCredentialStore } = await import(pathToFileURL(join(hostPath, "node_modules/@earendil-works/pi-ai/dist/index.js")));
const codexToken = `synthetic.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "offline-account" } })).toString("base64")}.synthetic`;
const root = mkdtempSync(join(tmpdir(), "pi-fast-packed-"));
const priorAgentDir = process.env.PI_CODING_AGENT_DIR;
const priorFetch = globalThis.fetch;
const active = new Set();
const errors = [];
const wire = [];
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  let bytes = Buffer.from(await request.arrayBuffer());
  const encoding = request.headers.get("content-encoding");
  if (encoding === "zstd") bytes = zlib.zstdDecompressSync(bytes);
  else if (encoding === "gzip") bytes = gunzipSync(bytes);
  wire.push({ url: request.url, body: JSON.parse(bytes.toString()), headers: Object.fromEntries(request.headers) });
  throw new Error("OFFLINE_SMOKE_STOP_BEFORE_NETWORK");
};
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
const paths = {};
try {
  for (const [name, pack] of [["codex", codexPack], ["claude", claudePack]]) {
    const consumer = join(root, name);
    mkdirSync(consumer);
    execFileSync("tar", ["-xzf", pack, "--strip-components=1", "-C", consumer]);
    const packageJson = JSON.parse(readFileSync(join(consumer, "package.json"), "utf8"));
    for (const [peer, range] of Object.entries(packageJson.peerDependencies))
      if (peer.startsWith("@earendil-works/")) assert.equal(range, ">=1.0.0", `${name}: ${peer}`);
    execFileSync("npm", ["install", "--offline", "--ignore-scripts", "--legacy-peer-deps", "--no-save", "--package-lock=false", "--no-audit", libraryPack], { cwd: consumer, stdio: "pipe" });
    mkdirSync(join(consumer, "node_modules", "@earendil-works"), { recursive: true });
    symlinkSync(hostPath, join(consumer, "node_modules", "@earendil-works", "pi-coding-agent"), "dir");
    const libraryJson = JSON.parse(readFileSync(join(consumer, "node_modules", "@llblab", "pi-command-fast", "package.json"), "utf8"));
    assert.equal(libraryJson.peerDependencies["@earendil-works/pi-coding-agent"], ">=1.0.0");
    paths[name] = join(consumer, "index.ts");
  }
  const physical = name => realpathSync(join(dirname(paths[name]), "node_modules", "@llblab", "pi-command-fast", "dist/index.js"));
  assert.notEqual(physical("codex"), physical("claude"));
  const configPath = join(process.env.PI_CODING_AGENT_DIR, "models.json");
  const config = () => parse(readFileSync(configPath, "utf8"));
  const seed = () => {
    writeFileSync(configPath, '{\n // user comment\n "unrelated": true,\n "providers": { "other": {"opaque": 123} },\n}\n');
    for (const [name, report] of [["codex", { snapshots: [{ limitId: "codex", secondary: { usedPercent: 33 } }] }], ["claude", { secondary: { usedPercent: 33 } }]]) {
      const dir = join(process.env.PI_CODING_AGENT_DIR, "tmp", `pi-${name}-usage`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "usage.json"), JSON.stringify({ owner: "fixture", claimedAt: Date.now(), updatedAt: Date.now(), report }));
    }
  };
  async function start(names, modelProvider) {
    const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, transport: "sse" });
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("openai-codex", async () => ({ type: "oauth", access: codexToken, refresh: "synthetic", expires: Date.now() + 86400000 }));
    await credentials.modify("anthropic", async () => ({ type: "oauth", access: "sk-ant-oat-synthetic-offline", refresh: "synthetic", expires: Date.now() + 86400000 }));
    await credentials.modify("deepseek", async () => ({ type: "api_key", key: "synthetic-offline-unrelated" }));
    const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
    const model = provider => provider === "anthropic"
      ? modelRuntime.getModel(provider, "claude-opus-5-5")
      : ({ ...modelRuntime.getModels(provider)[0], provider, id: `future-${provider}-model`, name: "Future smoke model" });
    const resourceLoader = new DefaultResourceLoader({ cwd: root, agentDir: process.env.PI_CODING_AGENT_DIR, settingsManager, additionalExtensionPaths: names.map(name => paths[name]), noSkills: true, noPromptTemplates: true, noThemes: true });
    await resourceLoader.reload();
    assert.deepEqual(resourceLoader.getExtensions().errors, []);
    const statuses = new Map(), notices = [];
    const { session } = await createAgentSession({ cwd: root, agentDir: process.env.PI_CODING_AGENT_DIR, modelRuntime, resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(root), model: model(modelProvider), tools: [] });
    active.add(session);
    await session.bindExtensions({ mode: "interactive", uiContext: {
      theme: { fg: (_, value) => value, bg: (_, value) => value },
      setStatus: (key, value) => statuses.set(key, value),
      notify: value => notices.push(value),
      setWidget: () => {}, setWorkingMessage: () => {},
    }, onError: error => errors.push(error) });
    assert.equal(session.extensionRunner.getRegisteredCommands().filter(c => c.name === "fast").length, 1);
    return { session, statuses, notices, model, modelRuntime };
  }
  async function close(h) {
    await h.session.extensionRunner.emit({ type: "session_shutdown", reason: "exit" });
    h.session.dispose(); active.delete(h.session);
  }
  async function toggle(h) {
    const before = wire.length;
    await h.session.prompt("/fast"); // Real command parsing and live current-provider dispatch.
    assert.equal(wire.length, before, "toggle must not request quota or inference");
  }
  for (const order of [["codex"], ["claude"], ["codex", "claude"], ["claude", "codex"]]) {
    seed();
    const first = order[0] === "codex" ? "openai-codex" : "anthropic";
    const h = await start(order, first);
    const providerCases = order.map(name => name === "codex" ? ["openai-codex", "serviceTier", "priority", "service_tier", "aa-codex-usage"] : ["anthropic", "speed", "fast", "speed", "aa-claude-usage"]);
    for (const [provider, property, value, wireProperty, statusKey] of providerCases) {
      await h.session.setModel(h.model(provider));
      await toggle(h);
      const current = h.session.model;
      assert.equal(config().providers[provider].modelOverrides[current.id][property], value);
      assert.match(h.statuses.get(statusKey), / fast$/);
      const body = await h.session.extensionRunner.emitBeforeProviderRequest({ model: current.id, betas: ["existing-beta"] });
      assert.equal(body[wireProperty], value);
      if (provider === "anthropic") assert.deepEqual(body.betas, ["existing-beta", "fast-mode-2026-02-01"]);
      const explicit = { model: current.id, [wireProperty]: "explicit" };
      assert.deepEqual(await h.session.extensionRunner.emitBeforeProviderRequest(explicit), explicit);
      const changed = provider === "anthropic" ? h.modelRuntime.getModel(provider, "claude-opus-4-8") : { ...current, id: current.id + "-second" };
      await h.session.setModel(changed);
      assert.doesNotMatch(h.statuses.get(statusKey), / fast$/);
      await toggle(h);
      assert.equal(config().providers[provider].modelOverrides[changed.id][property], value);
      assert.equal(config().providers[provider].modelOverrides[current.id][property], value);
      if (provider === "anthropic") {
        const unsupported = h.modelRuntime.getModel(provider, "claude-sonnet-5-5");
        await h.session.setModel(unsupported);
        const before = readFileSync(configPath, "utf8");
        await toggle(h);
        assert.equal(h.notices.pop(), "Fast mode is supported only for Opus");
        assert.equal(readFileSync(configPath, "utf8"), before);
        assert.doesNotMatch(h.statuses.get(statusKey), / fast$/);
        const body = { model: unsupported.id };
        assert.deepEqual(await h.session.extensionRunner.emitBeforeProviderRequest(body), body);
      }
      await h.session.setModel(current);
    }
    const manager = h.session.sessionManager, runner = h.session.extensionRunner;
    await h.session.reload(); // Disposable SDK session only, never the operator's running Pi.
    assert.equal(h.session.sessionManager, manager);
    assert.notEqual(h.session.extensionRunner, runner);
    assert.equal(h.session.extensionRunner.getRegisteredCommands().filter(c => c.name === "fast").length, 1);
    await toggle(h);
    const [provider, property, , , statusKey] = providerCases.at(-1);
    assert.equal(Object.hasOwn(config().providers[provider].modelOverrides[h.session.model.id], property), false);
    assert.doesNotMatch(h.statuses.get(statusKey), / fast$/);
    await toggle(h);
    assert.equal(h.notices.length, 0);
    const second = await start(["claude"], "anthropic");
    await second.session.setModel(second.model("openai-codex"));
    const bytes = readFileSync(configPath, "utf8");
    await toggle(second);
    assert.equal(second.notices.at(-1), "Fast mode is not supported for the current provider");
    assert.equal(readFileSync(configPath, "utf8"), bytes);
    await close(second);
    await h.session.prompt("/fast enabled");
    assert.equal(h.notices.at(-1), "Usage: /fast");
    await h.session.setModel(h.model("deepseek"));
    await toggle(h);
    assert.equal(h.notices.at(-1), "Fast mode is not supported for the current provider");
    await close(h);
    const restarted = await start(order, provider);
    assert.match(restarted.statuses.get(statusKey), / fast$/);
    assert.equal(config().unrelated, true);
    assert.equal(config().providers.other.opaque, 123);
    assert.match(readFileSync(configPath, "utf8"), /user comment/);
    // Exercise native providers offline, proving final HTTP body/header assembly without a paid request.
    const nativeRequest = async () => {
      const stream = restarted.modelRuntime.streamSimple(restarted.session.model, { messages: [{ role: "user", content: "Offline smoke", timestamp: Date.now() }] }, {
        transport: "sse", apiKey: provider === "anthropic" ? "sk-ant-oat-synthetic-offline" : codexToken,
        onPayload: payload => restarted.session.extensionRunner.emitBeforeProviderRequest(payload),
        onHeaders: headers => restarted.session.extensionRunner.emitBeforeProviderHeaders(headers),
      });
      const before = wire.length;
      const outcome = await stream.result();
      assert.equal(wire.length, before + 1, outcome.errorMessage);
      return wire.at(-1);
    };
    await toggle(restarted);
    const normal = await nativeRequest();
    await toggle(restarted);
    const sent = await nativeRequest();
    if (provider === "anthropic") {
      assert.equal(sent.body.speed, "fast");
      const betas = sent.headers["anthropic-beta"].split(",");
      assert.equal(betas.filter(beta => beta === "fast-mode-2026-02-01").length, 1);
      assert.ok(betas.includes("oauth-2025-04-20"));
      assert.deepEqual(new Set(betas), new Set([...(normal.headers["anthropic-beta"] ?? "").split(",").filter(Boolean), "fast-mode-2026-02-01"]));
      assert.equal(normal.body.speed, undefined);
      // Explicit configured beta headers are also preserved through native HTTP assembly.
      await restarted.session.setModel({ ...restarted.session.model, headers: { "Anthropic-Beta": "custom-existing-beta,second-existing-beta" } });
      const configured = await nativeRequest();
      assert.deepEqual(new Set(configured.headers["anthropic-beta"].split(",")), new Set(["custom-existing-beta", "second-existing-beta", "fast-mode-2026-02-01"]));
    } else {
      assert.equal(sent.body.service_tier, "priority");
      assert.equal(normal.body.service_tier, undefined);
    }
    await close(restarted);
    console.log(`PASS packed Pi ${order.join(" → ")}: command, persistence, provider/model eligibility, status, isolation, reload, restart, native wire`);
  }
  assert.deepEqual(errors, []);
  console.log(`PASS ${wire.length} intercepted native requests; zero external requests or quota fetches; distinct library copies.`);
} finally {
  for (const session of active) {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "exit" });
    session.dispose();
  }
  globalThis.fetch = priorFetch;
  if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
  rmSync(root, { recursive: true, force: true });
}

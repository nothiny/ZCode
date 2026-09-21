import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSqliteSessionStore } from "@zcode/adapters/storage";
import { SessionEventType } from "@zcode/contracts";
import { ProviderRegistry } from "@zcode/provider";
import { createZCodeApp, listZCodeSessions, resolveLatestSession } from "../dist/index.js";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "zcode-session-test-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const dbPath = join(root, "state.sqlite");
  const stores = [];
  const closedStores = new Set();
  const apps = [];
  const openStore = () => {
    const store = createSqliteSessionStore({ dbPath });
    stores.push(store);
    return store;
  };
  const closeStore = (store) => {
    if (closedStores.has(store)) return;
    store.close();
    closedStores.add(store);
  };
  t.after(async () => {
    for (const app of apps) await app.close();
    for (const store of stores) closeStore(store);
    await rm(root, { recursive: true, force: true });
  });
  const createApp = async (store, sessionId) => {
    const app = await createZCodeApp({
      providerRegistry: new ProviderRegistry(),
      sessionStore: store,
      sessionId,
      resume: true,
      skipUserConfig: true,
      env: {
        ...process.env,
        ZCODE_STORAGE_ROOT: join(root, "storage"),
        ZCODE_LOG_LEVEL: "error",
        ZCODE_LOG_CONSOLE_LEVEL: "error",
      },
      runtimeConfig: { workingDirectory: workspace },
      officialPluginRoots: [],
      pluginStorageRoot: join(root, "plugins"),
    });
    apps.push(app);
    return app;
  };
  return { root, workspace, openStore, closeStore, createApp };
}

async function createSession(store, directory, id, updated, parentID) {
  return store.createSession({
    id,
    projectID: "project-terminal-test",
    slug: id,
    directory,
    title: `Terminal session ${id}`,
    version: "test",
    ...(parentID ? { parentID } : {}),
    time: { created: updated, updated },
  });
}

async function saveConversation(store, sessionID, workspace) {
  await store.saveMessage({
    id: "user-1", sessionID, role: "user", agent: "test", time: { created: 100 },
  });
  await store.savePart({
    id: "user-text", sessionID, messageID: "user-1", type: "text", text: "Read hello.txt",
  });
  await store.saveMessage({
    id: "assistant-1", sessionID, role: "assistant", parentID: "user-1",
    mode: "default", agent: "test", path: { cwd: workspace, root: workspace },
    cost: 0, tokens: { input: 8, output: 4, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 101, completed: 102 },
  });
  await store.savePart({
    id: "tool-1", sessionID, messageID: "assistant-1", type: "tool", callID: "read-1", tool: "Read",
    state: { status: "completed", input: { file_path: "hello.txt" }, output: "Hello from disk",
      title: "Read hello.txt", metadata: {}, time: { start: 101, end: 102 } },
  });
  const answer = { id: "assistant-text", sessionID, messageID: "assistant-1", type: "text" };
  await store.savePart({ ...answer, text: "First persisted draft" });
  await store.savePart({ ...answer, text: "The file contains Hello from disk." });
}

test("session queries survive database reopen and latest is isolated by workspace", async (t) => {
  const f = await fixture(t);
  const store = f.openStore();
  await createSession(store, f.workspace, "root-old", 10);
  await createSession(store, f.workspace, "root-latest", 20);
  await createSession(store, f.workspace, "child", 40, "root-latest");
  await createSession(store, join(f.root, "other-workspace"), "other-root", 50);
  f.closeStore(store);
  const reopened = f.openStore();
  const sessions = await listZCodeSessions({ sessionStore: reopened, directory: f.workspace });
  assert.deepEqual(sessions.map((session) => session.id), ["root-latest", "root-old"]);
  const latest = await resolveLatestSession({ sessionStore: reopened, directory: f.workspace });
  assert.equal(latest.id, "root-latest");
  assert.equal(await resolveLatestSession({ sessionStore: reopened, directory: join(f.root, "empty") }), null);
});

test("real bootstrap resume hydrates SQLite transcript and emits SessionResumed", async (t) => {
  const f = await fixture(t);
  const store = f.openStore();
  await createSession(store, f.workspace, "resume-session", 10);
  await saveConversation(store, "resume-session", f.workspace);
  f.closeStore(store);
  const reopened = f.openStore();
  const app = await f.createApp(reopened, "resume-session");
  const events = [];
  const resumed = await app.resume({ onEvent: (event) => events.push(event) });
  assert.equal(resumed.directory, f.workspace);
  assert.equal(events.filter((event) => event.type === SessionEventType.SessionResumed).length, 1);
  assert.ok(events.every((event) => event.sessionId === "resume-session"));
  const transcript = await app.loadSessionTranscript();
  assert.equal(transcript.length, 2);
  assert.equal(transcript[0].role, "user");
  assert.equal(transcript[0].content, "Read hello.txt");
  assert.equal(transcript[1].content, "The file contains Hello from disk.");
  assert.deepEqual(transcript[1].parts.map((part) => part.type), ["tool", "text"]);
  assert.equal(transcript[1].parts[0].status, "completed");
  assert.equal(transcript[1].parts[0].output, "Hello from disk");
  const persisted = await reopened.messages({ sessionID: "resume-session" });
  assert.equal(persisted[1].parts.filter((part) => part.id === "assistant-text").length, 1);
  assert.equal(events.some((event) => event.type === SessionEventType.ModelRequest), false);
});

test("missing session resume rejects without creating a replacement conversation", async (t) => {
  const f = await fixture(t);
  const store = f.openStore();
  const app = await f.createApp(store, "missing-session");
  await assert.rejects(app.resume(), /session.*not found|session.*does not exist/i);
  assert.equal(await store.getSession("missing-session"), null);
  assert.deepEqual(await listZCodeSessions({ sessionStore: store }), []);
});

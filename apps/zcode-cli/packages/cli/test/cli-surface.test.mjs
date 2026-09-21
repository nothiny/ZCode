import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(packageRoot, "dist", "zcode.cjs");
const run = (...args) => {
  const options = args.at(-1);
  const envOverrides = options && options.env ? args.pop().env : {};
  return execFileSync(process.execPath, [entry, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, ...envOverrides },
    stdio: ["ignore", "pipe", "pipe"],
  });
};

function runIsolated(...args) {
  const home = mkdtempSync(join(tmpdir(), "zcode-cli-surface-"));
  try {
    return run(...args, {
      env: {
        HOME: home,
        USERPROFILE: home,
        APPDATA: home,
        LOCALAPPDATA: home,
        ZCODE_DATA_BASE_DIR: join(home, "data"),
        ZCODE_STORAGE_DIR: join(home, "storage"),
        ZCODE_LOG_DIR: join(home, "logs"),
        NODE_ENV: "test",
      },
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("public command surface is discoverable", () => {
  const help = runIsolated("--help");
  assert.match(help, /zcode \[prompt\]/);
  assert.match(help, /run\s+Run one prompt/);
  assert.match(help, /sessions\s+List persisted sessions/);
  assert.match(help, /--model <id>/);
});

test("sessions is machine-readable and does not start the TUI", () => {
  const output = runIsolated("sessions", "--json");
  assert.deepEqual(JSON.parse(output), []);
});

test("default invocation keeps the terminal safety gate", () => {
  assert.throws(() => runIsolated(), /TUI requires an interactive terminal/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { prepareWindowsTerminal } from "../src/windows-terminal.ts";

function fakeSpawn(calls, current = 936) {
  return (command, args) => {
    calls.push([command, ...args]);
    if (args[2] === "chcp") return { status: 0, stdout: `Active code page: ${current}\r\n` };
    return { status: 0, stdout: "" };
  };
}

test("Windows TUI switches a legacy code page to UTF-8 and restores it once", () => {
  const calls = [];
  const preparation = prepareWindowsTerminal({
    platform: "win32",
    isTTY: true,
    commandShell: "cmd.exe",
    spawn: fakeSpawn(calls),
  });

  assert.equal(preparation.changed, true);
  preparation.restore();
  preparation.restore();
  assert.deepEqual(calls.map((call) => call.slice(1)), [
    ["/d", "/c", "chcp"],
    ["/d", "/c", "chcp 65001 >nul"],
    ["/d", "/c", "chcp 936 >nul"],
  ]);
});

test("non-Windows and non-TTY paths are no-ops", () => {
  let called = false;
  const spawn = () => {
    called = true;
    return { status: 0, stdout: "Active code page: 936" };
  };
  assert.equal(prepareWindowsTerminal({ platform: "linux", isTTY: true, spawn }).changed, false);
  assert.equal(prepareWindowsTerminal({ platform: "win32", isTTY: false, spawn }).changed, false);
  assert.equal(called, false);
});

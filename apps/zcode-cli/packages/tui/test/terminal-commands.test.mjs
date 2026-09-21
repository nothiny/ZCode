import { createCtrlCExitGuard, resolveCtrlCAction } from "../src/app-keyboard-helpers.ts";
import assert from "node:assert/strict";
import test from "node:test";
import {
  handleTerminalCommand,
  resolveTerminalAlias,
  terminalSlashCommands,
} from "../src/app-terminal-commands.ts";

function state(overrides = {}) {
  const calls = [];
  return {
    calls,
    input: {
      busy: false,
      model: "provider/model",
      sessionId: "sess_demo",
      workspaceDirectory: "D:/project",
      contextUsage: { contextUsed: 25, contextWindow: 100 },
      usage: { totalTokens: 42 },
      commands: [{ name: "help", usage: "/help", summary: "Help" }],
      clear: () => calls.push("clear"),
      clearDraft: () => calls.push("clear-draft"),
      show: (text) => calls.push(["show", text]),
      cancel: () => calls.push("cancel"),
      exit: () => calls.push("exit"),
      ...overrides,
    },
  };
}

test("terminal commands own presentation state and never submit a prompt", () => {
  const current = state();
  assert.equal(handleTerminalCommand("/clear", current.input), true);
  assert.deepEqual(current.calls, ["clear"]);
  assert.equal(resolveTerminalAlias("/models"), "/model list");
  assert.equal(resolveTerminalAlias("/sessions"), "/resume");
});

test("clear is rejected while streaming and exit cancels before lifecycle exit", () => {
  const current = state({ busy: true });
  assert.equal(handleTerminalCommand("/clear", current.input), true);
  assert.equal(current.calls[0][0], "show");
  assert.equal(handleTerminalCommand("/exit", current.input), true);
  assert.deepEqual(current.calls.slice(1), ["cancel", "exit"]);
});

test("status reports unavailable metrics instead of inventing values", () => {
  const current = state({ contextUsage: {}, usage: undefined });
  assert.equal(handleTerminalCommand("/status", current.input), true);
  assert.match(current.calls[0][1], /Context: unavailable/);
  assert.match(current.calls[0][1], /Tokens \(last completed turn\): unavailable/);
});

test("local commands replace conflicting completion entries", () => {
  const commands = terminalSlashCommands([
    { name: "new", aliases: ["clear"], usage: "/new", summary: "New" },
    { name: "model", usage: "/model", summary: "Model" },
  ]);
  assert.equal(
    commands.some((command) => command.name === "clear"),
    true,
  );
  assert.equal(
    commands.find((command) => command.name === "new")?.aliases?.includes("clear"),
    false,
  );
  assert.equal(
    commands.some((command) => command.name === "status"),
    true,
  );
});


test("Ctrl-C aborts a busy turn before allowing confirmed exit", () => {
  const guard = createCtrlCExitGuard();
  assert.equal(
    resolveCtrlCAction({ busy: true, draftValue: "", guard, nowMs: 100 }),
    "cancel",
  );
  assert.equal(
    resolveCtrlCAction({ busy: false, draftValue: "new draft", guard, nowMs: 500 }),
    "confirm_exit",
  );
});

test("Ctrl-C clears an idle draft and resets the exit guard", () => {
  const guard = createCtrlCExitGuard();
  assert.equal(
    resolveCtrlCAction({ busy: false, draftValue: "draft", guard, nowMs: 100 }),
    "clear_draft",
  );
  assert.equal(
    resolveCtrlCAction({ busy: false, draftValue: "", guard, nowMs: 200 }),
    "show_prompt",
  );
});

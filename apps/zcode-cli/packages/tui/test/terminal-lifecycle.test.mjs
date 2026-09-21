import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";
import React from "react";
import { testRender } from "@mbears/opentui-react/test-utils";
import { createTestRenderer } from "@mbears/opentui-core/testing";

register();
const { TuiApp } = await import("../src/app.tsx");
const { runTuiWithRenderer } = await import("../src/tui.tsx");

const nextTick = () => new Promise((resolve) => setImmediate(resolve));

async function renderApp(submitPrompt) {
  const exits = [];
  const options = {
    workspaceDirectory: process.cwd(),
    version: "test",
    locale: "en-US",
    initialModel: "fixture/model",
    submitPrompt,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  };
  const terminal = await testRender(
    React.createElement(TuiApp, {
      options,
      onExit: (code) => exits.push(code),
      copySelection: () => false,
      hasCopyableSelection: () => false,
    }),
    { width: 100, height: 30, exitOnCtrlC: false },
  );
  await terminal.flush();
  return { ...terminal, exits };
}

test("native Ctrl+C cancels the submitted signal and the next Ctrl+C exits", async () => {
  let receivedSignal;
  const terminal = await renderApp(async (_input, { abortSignal }) => {
    receivedSignal = abortSignal;
    await new Promise((_resolve, reject) => {
      abortSignal.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
    });
  });
  try {
    await terminal.mockInput.typeText("cancel this turn");
    terminal.mockInput.pressEnter();
    await terminal.waitFor(() => Boolean(receivedSignal));
    terminal.mockInput.pressKey("c", { ctrl: true });
    await nextTick();
    assert.equal(receivedSignal.aborted, true);
    assert.deepEqual(terminal.exits, []);
    terminal.mockInput.pressKey("c", { ctrl: true });
    await terminal.flush();
    assert.deepEqual(terminal.exits, [0]);
  } finally {
    terminal.renderer.destroy();
  }
});


test("startup failure destroys the renderer and restores terminal resources", async () => {
  const setup = await createTestRenderer({ width: 80, height: 20, exitOnCtrlC: false });
  let restored = 0;
  await assert.rejects(
    runTuiWithRenderer(
      {
        locale: "en-US",
        loadStartupOptions: async () => {
          throw new Error("startup fixture failed");
        },
        stdin: { isTTY: true },
        stdout: { isTTY: true },
        stderr: { write() {} },
        workspaceDirectory: process.cwd(),
        version: "test",
      },
      setup.renderer,
      () => {
        restored += 1;
      },
    ),
    /startup fixture failed/,
  );
  assert.equal(restored, 1);
  assert.equal(setup.renderer.isDestroyed, true);
});

import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";

register();
const { createCommandCenter } = await import("../src/command-center/create.ts");
const { buildLoginSelection, parseApiKeyLoginArgs } =
  await import("../src/command-center/login-flow.ts");
const { recordSlashCommandInHistory } = await import("../src/command-center/history.ts");
const { parseSlashCommand } = await import("../src/command-center/slash-commands.ts");

test("DeepSeek API key login is parsed and routed without exposing the key", async () => {
  assert.deepEqual(parseApiKeyLoginArgs("deepseek-api-key sk-test"), {
    kind: "deepseek-api-key",
    providerId: "deepseek",
    apiKey: "sk-test",
  });

  let received;
  const center = createCommandCenter({
    configureDeepseekApiKey: async (options) => {
      received = options;
      return {
        configPath: "C:/test/provider_config.json",
        model: "deepseek/deepseek-v4-pro",
        providerId: "deepseek",
      };
    },
    getApp: async () => ({ sessionId: "session", traceId: "trace" }),
  });
  const result = await center({ text: "/login deepseek-api-key sk-test" }, {});

  assert.deepEqual(received, { apiKey: "sk-test", providerId: "deepseek" });
  assert.equal(result.model, "deepseek/deepseek-v4-pro");
  assert.match(result.response, /Configured DeepSeek/);
  assert.doesNotMatch(result.response, /sk-test/);
});

test("login picker includes a masked DeepSeek API key option", () => {
  const selection = buildLoginSelection("en-US");
  const item = selection.items.find((entry) => entry.id === "deepseek-api-key");
  assert.ok(item);
  assert.equal(item.input?.mask, true);
  assert.equal(item.command, "/login deepseek-api-key");
});

test("DeepSeek API key commands are not persisted in input history", async () => {
  let recorded = false;
  await recordSlashCommandInHistory(
    { recordInputHistory: async () => { recorded = true; } },
    { text: "/login deepseek-api-key sk-test" },
    parseSlashCommand("/login deepseek-api-key sk-test"),
  );
  assert.equal(recorded, false);
});

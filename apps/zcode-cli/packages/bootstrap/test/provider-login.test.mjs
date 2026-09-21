import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { register } from "tsx/esm/api";

register();
const { configureDeepseekApiKey, ZCodeCliLoginError } = await import("../dist/index.js");

test("configureDeepseekApiKey writes a template overlay and default model atomically", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zcode-deepseek-login-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, ".zcode", "v2", "provider_config.json");

  const result = await configureDeepseekApiKey({
    apiKey: "deepseek-test-key",
    env: { ZCODE_DATA_BASE_DIR: root },
    personalProviderConfigPath: configPath,
  });

  assert.equal(result.providerId, "deepseek");
  assert.equal(result.model, "deepseek/deepseek-v4-pro");
  assert.equal(result.configPath, configPath);
  const stored = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(stored.config.defaultModelSelection, {
    providerId: "deepseek",
    modelId: "deepseek-v4-pro",
  });
  assert.deepEqual(stored.config.providerConfigRules.providerRules[0], {
    providerId: "deepseek",
    providerName: "DeepSeek",
    templateId: "deepseek",
    config: {
      group: "standard-personal",
      access: { type: "api-key", apiKey: "deepseek-test-key" },
    },
  });
});

test("configureDeepseekApiKey rejects an empty key before creating config", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-deepseek-login-empty-"));
  try {
    await assert.rejects(
      () =>
        configureDeepseekApiKey({
          apiKey: "   ",
          personalProviderConfigPath: join(root, "provider_config.json"),
        }),
      (error) => error instanceof ZCodeCliLoginError && error.code === "config_update_failed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

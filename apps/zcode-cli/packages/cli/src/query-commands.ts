import { createConfig } from "@zcode/adapters/config";
import { formatJson } from "@zcode/core";
import type { RunContext, GlobalOptions } from "@zcode/shared-types";
import type { RunDependencies } from "./cli-types.js";
import { loadBootstrapModule } from "./bootstrap-loader.js";

export function runConfigCommand(
  ctx: RunContext,
  options: GlobalOptions,
  deps: RunDependencies,
  workingDirectory: string,
): number {
  const result = createConfig({
    env: deps.env,
    userConfigPath: deps.userConfigPath,
    projectConfigPath: deps.projectConfigPath,
    skipUserConfig: deps.skipUserConfig,
    workingDirectory,
  });
  // Never print the merged object: MCP/provider entries may contain credentials
  // or headers. This command is an inspect surface, not a secret dump.
  const payload = {
    cwd: workingDirectory,
    user: {
      path: result.sources.user.path,
      loaded: result.sources.user.loaded,
      hasMcpServers: result.sources.user.hasMcpServers,
      mcpServerNames: result.sources.user.mcpServerNames,
    },
    project: {
      loaded: result.sources.project.loaded,
      paths: result.sources.project.paths,
      hasMcpServers: result.sources.project.hasMcpServers,
      mcpServerNames: result.sources.project.mcpServerNames,
    },
    sources: {
      environment: result.sources.env,
      cli: result.sources.cli,
      mcp: result.sources.mcp.serverSources,
    },
    effective: {
      locale: result.config.ui.locale,
      theme: result.config.ui.theme,
      permissionMode: result.config.permission.mode,
      logLevel: result.config.logging.level,
      logFormat: result.config.logging.format,
      storageDir: result.config.storage.dir,
      sessionDbPath: result.config.storage.sessionDbPath,
      featureFlags: result.config.features,
    },
  };
  if (options.json) {
    ctx.stdout.write(`${formatJson(payload)}\n`);
    return 0;
  }
  ctx.stdout.write(`workspace: ${payload.cwd}\n`);
  ctx.stdout.write(
    `user config: ${payload.user.path} (${payload.user.loaded ? "loaded" : "not found"})\n`,
  );
  ctx.stdout.write(`project configs: ${payload.project.paths.length}\n`);
  ctx.stdout.write(`locale: ${payload.effective.locale}\n`);
  ctx.stdout.write(`theme: ${payload.effective.theme}\n`);
  ctx.stdout.write(`permission mode: ${payload.effective.permissionMode}\n`);
  ctx.stdout.write(`session database: ${payload.effective.sessionDbPath}\n`);
  return 0;
}

export async function runSessionsCommand(
  ctx: RunContext,
  options: GlobalOptions,
  deps: RunDependencies,
  workingDirectory: string,
): Promise<number> {
  try {
    const listSessions = deps.listSessions ?? (await loadBootstrapModule()).listZCodeSessions;
    const sessions = await listSessions({ directory: workingDirectory, env: deps.env, limit: 50 });
    const rows = sessions.map((session) => ({
      id: String(session.id),
      updated: session.time.updated,
      model: "unavailable",
      title: session.title ?? "",
    }));
    if (options.json) {
      ctx.stdout.write(`${formatJson(rows)}\n`);
      return 0;
    }
    ctx.stdout.write("SESSION                         UPDATED                  MODEL\n");
    for (const row of rows) {
      ctx.stdout.write(
        `${row.id.padEnd(30)} ${new Date(row.updated).toISOString().padEnd(24)} ${row.model}\n`,
      );
    }
    return 0;
  } catch (error) {
    ctx.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export async function runModelsCommand(
  ctx: RunContext,
  options: GlobalOptions,
  deps: RunDependencies,
): Promise<number> {
  let registryRuntime:
    | Awaited<ReturnType<NonNullable<RunDependencies["startProcessProviderRegistryRuntime"]>>>
    | undefined;
  try {
    const startRegistry =
      deps.startProcessProviderRegistryRuntime ??
      (await loadBootstrapModule()).startProcessProviderRegistryRuntime;
    const registryOptions = deps.userConfigPath
      ? { standalone: { legacyCliUserConfigFilePath: deps.userConfigPath } }
      : { standalone: {} };
    registryRuntime = await startRegistry(deps.env ?? process.env, registryOptions);
    const models = registryRuntime.runtime.registryService.getView().providers.flatMap((provider) =>
      provider.models.map((model) => ({
        provider: provider.providerId,
        id: model.modelId,
        enabled: model.config.enabled,
        contextWindow: model.config.properties.contextWindow,
      })),
    );
    if (options.json) {
      ctx.stdout.write(`${formatJson(models)}\n`);
    } else {
      ctx.stdout.write("PROVIDER                 MODEL\n");
      for (const model of models) ctx.stdout.write(`${model.provider.padEnd(24)} ${model.id}\n`);
    }
    return 0;
  } catch (error) {
    ctx.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    registryRuntime?.dispose();
  }
}

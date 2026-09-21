import React from "react";
import type { ModelUsageSummary } from "@zcode/contracts";
import type { ContextUsage } from "./app-model.js";
import type { TuiSlashCommandSuggestion } from "./types.js";

const LOCAL_COMMANDS: TuiSlashCommandSuggestion[] = [
  { name: "clear", usage: "/clear", summary: "Clear the display without changing the session." },
  { name: "models", usage: "/models", summary: "List available models." },
  { name: "session", usage: "/session", summary: "Show the current session." },
  { name: "sessions", usage: "/sessions", summary: "Choose a saved session to resume." },
  { name: "status", usage: "/status", summary: "Show model, session, workspace and usage." },
  { name: "exit", usage: "/exit", summary: "Cancel any running turn and exit." },
];

export function terminalSlashCommands(
  commands: readonly TuiSlashCommandSuggestion[],
): TuiSlashCommandSuggestion[] {
  const names = new Set(LOCAL_COMMANDS.map(({ name }) => name));
  return [
    ...commands
      .filter(({ name }) => !names.has(name))
      .map((command) => ({
        ...command,
        // 旧的 clear 别名会创建会话；终端清屏现在只由显示层处理。
        aliases: command.aliases?.filter((alias) => alias !== "clear"),
      })),
    ...LOCAL_COMMANDS,
  ];
}

export function resolveTerminalAlias(text: string): string {
  if (text.toLowerCase() === "/models") return "/model list";
  if (text.toLowerCase() === "/sessions") return "/resume";
  return text;
}

export function handleTerminalCommand(
  text: string,
  input: {
    busy: boolean;
    model: string;
    sessionId?: string;
    workspaceDirectory?: string;
    contextUsage: ContextUsage;
    usage?: ModelUsageSummary;
    commands: readonly TuiSlashCommandSuggestion[];
    clear: () => void;
    clearDraft: () => void;
    show: (text: string) => void;
    cancel: () => void;
    exit: () => void;
  },
): boolean {
  const [name, ...args] = text.split(/\s+/u);
  const command = name.toLowerCase();
  if (!["/clear", "/status", "/session", "/exit", "/help"].includes(command)) return false;
  if (command === "/help" && args.length > 0) {
    const entry = LOCAL_COMMANDS.find(({ name }) => name === args[0].replace(/^\//u, ""));
    if (!entry) return false;
    input.show(`${entry.usage}: ${entry.summary}`);
    return true;
  }
  if (args.length > 0) {
    input.show(`Usage: ${command}`);
    return true;
  }
  if (command === "/clear") {
    if (input.busy) input.show("Cancel or finish the current turn before clearing the display.");
    else input.clear();
  } else if (command === "/exit") {
    input.cancel();
    input.exit();
  } else if (command === "/session") {
    input.show(`Session: ${input.sessionId ?? "unavailable"}`);
  } else if (command === "/help") {
    input.show(input.commands.map(({ usage, summary }) => `${usage}: ${summary}`).join("\n"));
  } else {
    const { contextUsed, contextWindow } = input.contextUsage;
    const context =
      contextUsed !== undefined && contextWindow !== undefined && contextWindow > 0
        ? `${contextUsed} / ${contextWindow} (${((contextUsed / contextWindow) * 100).toFixed(1)}%)`
        : "unavailable";
    input.show(
      [
        `Model: ${input.model || "unavailable"}`,
        `Session: ${input.sessionId ?? "unavailable"}`,
        `Workspace: ${input.workspaceDirectory ?? "unavailable"}`,
        `Context: ${context}`,
        `Tokens (last completed turn): ${input.usage?.totalTokens ?? "unavailable"}`,
      ].join("\n"),
    );
  }
  return true;
}

export function useTerminalCommandHandler(input: {
  busy: boolean;
  model: string;
  sessionId?: string;
  workspaceDirectory?: string;
  contextUsage: ContextUsage;
  usage?: ModelUsageSummary;
  commands: readonly TuiSlashCommandSuggestion[];
  clear: () => void;
  clearDraft: () => void;
  show: (text: string) => void;
  cancel: () => void;
  exit: () => void;
}): (text: string) => boolean {
  return React.useCallback((text) => handleTerminalCommand(text, input), [input]);
}

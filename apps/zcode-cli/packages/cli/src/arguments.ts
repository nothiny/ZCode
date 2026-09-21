import { parseArgs } from "node:util";

const parseRawGlobalArgs = (argv: string[]) =>
  parseArgs({
    allowPositionals: true,
    tokens: true,
    args: argv,
    options: {
      help: {
        short: "h",
        type: "boolean",
      },
      json: {
        type: "boolean",
      },
      "output-format": {
        type: "string",
      },
      "no-color": {
        type: "boolean",
      },
      "no-browser": {
        type: "boolean",
      },
      "no-tui": {
        type: "boolean",
      },
      "browser-use": {
        type: "string",
      },
      "browser-executable": {
        type: "string",
      },
      prompt: {
        short: "p",
        type: "string",
      },
      model: {
        type: "string",
      },
      "memory-bench": {
        type: "boolean",
      },
      "wait-background": {
        type: "boolean",
      },
      "no-wait-background": {
        type: "boolean",
      },
      attach: {
        multiple: true,
        type: "string",
      },
      cwd: {
        type: "string",
      },
      locale: {
        type: "string",
      },
      resume: {
        type: "string",
      },
      target: {
        type: "string",
      },
      "target-replace": {
        type: "boolean",
      },
      continue: {
        short: "c",
        type: "boolean",
      },
      force: {
        short: "f",
        type: "boolean",
      },
      "force-mcs": {
        type: "boolean",
      },
      mode: {
        type: "string",
      },
      verbose: {
        type: "boolean",
      },
      debug: {
        type: "boolean",
      },
      version: {
        short: "v",
        type: "boolean",
      },
      "prepare-storage": { type: "boolean" },
      stdio: {
        type: "boolean",
      },
      surface: {
        type: "string",
      },

      // 在全局注册，run.ts 收集后透传给 plugins-command，不污染其他命令的选项语义。
      all: {
        short: "a",
        type: "boolean",
      },
      available: {
        type: "boolean",
      },
      "keep-data": {
        type: "boolean",
      },
      scope: {
        short: "s",
        type: "string",
      },
      sparse: {
        multiple: true,
        type: "string",
      },
    },
    strict: true,
  });

const CLI_COMMANDS = new Set([
  "help",
  "version",
  "tui",
  "chat",
  "run",
  "resume",
  "sessions",
  "models",
  "config",
  "app-server",
  "agent-server",
  "doctor",
  "login",
  "logout",
  "commands",
  "plugin",
  "plugins",
  "skills",
  "hooks",
]);

/** 共用 Node 的选项 schema；手写扫描会把 output-format 等选项值吞进 prompt。 */
export function parseGlobalArgs(argv: string[]) {
  const parsed = parseRawGlobalArgs(argv);
  const { values, tokens } = parsed;
  const [first, ...rest] = parsed.positionals;
  const firstOperand = tokens.find((token) => token.kind === "positional");
  const terminator = tokens.find((token) => token.kind === "option-terminator");
  const literal = firstOperand && terminator && firstOperand.index > terminator.index;
  const command = !literal && first && CLI_COMMANDS.has(first) ? first : undefined;
  // 帮助必须能描述不完整命令，不能先创建 runtime 或要求 resume ID。
  if (values.help || values.version) return parsed;

  if (command === "run" || (first !== undefined && !command)) {
    const words = command === "run" ? rest : parsed.positionals;
    if (words.length && values.prompt !== undefined) {
      throw new Error("Use either a positional prompt or --prompt, not both.");
    }
    if (words.length) values.prompt = words.join(" ");
    if (!values.prompt?.trim()) throw new Error("Usage: zcode run <prompt>");
    parsed.positionals = [];
  } else if (command === "chat" || command === "tui" || command === "resume") {
    if (command === "resume") {
      if (rest.length !== 1 || !rest[0].trim()) throw new Error("Usage: zcode resume <session-id>");
      if (values.resume !== undefined) throw new Error("Specify the resume session only once.");
      values.resume = rest[0];
    } else if (rest.length) {
      throw new Error(`Usage: zcode ${command} [options]`);
    }
    if (values.prompt !== undefined || values.target !== undefined) {
      throw new Error(`${command} cannot be combined with --prompt or --target.`);
    }
    parsed.positionals = ["tui"];
  } else if (command && (values.prompt !== undefined || values.target !== undefined)) {
    throw new Error(`${command} cannot be combined with --prompt or --target.`);
  }
  if (values.resume !== undefined && values.continue) {
    throw new Error("--resume and --continue cannot be used together.");
  }
  if (values.prompt !== undefined && values.target !== undefined) {
    throw new Error("--target cannot be used with a prompt.");
  }
  if (values.model !== undefined && !values.model.trim())
    throw new Error("--model requires a model ID.");
  if (values["wait-background"] === true && values["no-wait-background"] === true) {
    throw new Error("--wait-background and --no-wait-background cannot be used together.");
  }
  return parsed;
}

/** 入口与命令路由复用同一参数定义，不能把 prompt/cwd 的值误当成协议命令。 */
export function isProtocolServerInvocation(argv: string[]): boolean {
  try {
    const parsed = parseGlobalArgs(argv);
    return (
      parsed.values.prompt === undefined &&
      parsed.values.target === undefined &&
      !parsed.values.help &&
      !parsed.values.version &&
      (parsed.positionals[0] === "app-server" || parsed.positionals[0] === "agent-server")
    );
  } catch {
    // 无效参数由 run 格式化；明确的协议命令仍保护 stdout。
    return argv[0] === "app-server" || argv[0] === "agent-server";
  }
}

const DISALLOWED_TOOLS_FLAGS = new Set(["--disallowedTools", "--disallowed-tools"]);

export const extractDisallowedToolsArgs = (
  argv: readonly string[],
): { args: string[]; toolDisallowlist?: readonly string[] } => {
  const args: string[] = [];
  const values: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    // -- 后的文本全部属于用户，不能继续提取工具限制选项。
    if (arg === "--") {
      args.push(...argv.slice(index));
      break;
    }
    const equalsMatch = arg.match(/^(--disallowedTools|--disallowed-tools)=(.*)$/);
    if (equalsMatch) {
      values.push(equalsMatch[2] ?? "");
      continue;
    }

    if (!DISALLOWED_TOOLS_FLAGS.has(arg)) {
      args.push(arg);
      continue;
    }

    let consumed = false;
    while (index + 1 < argv.length && !isCliOptionToken(argv[index + 1])) {
      values.push(argv[index + 1]);
      index += 1;
      consumed = true;
    }
    if (!consumed) {
      throw new Error(`${arg} requires at least one tool.`);
    }
  }

  return {
    args,
    toolDisallowlist: normalizeCliToolRuleList(values),
  };
};

const isCliOptionToken = (value: string): boolean => value === "--" || /^-[^-]?|^--/.test(value);

const normalizeCliToolRuleList = (values: readonly string[]): readonly string[] | undefined => {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    for (const part of splitCliToolRules(value)) {
      const rule = normalizeCliToolRule(part);
      if (!rule || seen.has(rule)) continue;
      seen.add(rule);
      normalized.push(rule);
    }
  }
  return normalized.length > 0 ? normalized : undefined;
};

const splitCliToolRules = (value: string): readonly string[] => {
  const rules: string[] = [];
  let current = "";
  let inToolArgs = false;
  const flush = () => {
    const rule = current.trim();
    if (rule) rules.push(rule);
    current = "";
  };

  for (const char of value) {
    switch (char) {
      case "(":
        inToolArgs = true;
        current += char;
        break;
      case ")":
        inToolArgs = false;
        current += char;
        break;
      case ",":
        if (inToolArgs) {
          current += char;
        } else {
          flush();
        }
        break;
      case " ":
        if (inToolArgs) {
          current += char;
        } else {
          flush();
        }
        break;
      default:
        current += char;
        break;
    }
  }
  flush();
  return rules;
};

const normalizeCliToolRule = (rule: string): string => {
  if (!rule) return "";
  if (rule === "web_search") return "WebSearch";
  if (rule.startsWith("web_search(")) return `WebSearch${rule.slice("web_search".length)}`;
  return rule;
};

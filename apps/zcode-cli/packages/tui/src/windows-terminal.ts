import { spawnSync } from "node:child_process";

const UTF8_CODE_PAGE = 65001;
const WINDOWS_PLATFORM = "win32";
const CODE_PAGE_PATTERN = /(\d+)\s*$/mu;

type SpawnResult = { status: number | null; stdout?: string | Buffer };
type Spawn = (command: string, args: readonly string[], options: Record<string, unknown>) => SpawnResult;

export type WindowsTerminalPreparation = {
  restore: () => void;
  changed: boolean;
};

export type WindowsTerminalOptions = {
  platform?: NodeJS.Platform;
  isTTY?: boolean;
  commandShell?: string;
  spawn?: Spawn;
};

// Windows 控制台可能仍使用 CP936，导致 OpenTUI 输出的 UTF-8 边框和中文乱码。
// 在 native renderer 初始化前切换代码页；VT 模式仍由 OpenTUI 自己管理。
export function prepareWindowsTerminal(options: WindowsTerminalOptions = {}): WindowsTerminalPreparation {
  const platform = options.platform ?? process.platform;
  if (platform !== WINDOWS_PLATFORM || options.isTTY !== true) {
    return { restore: () => undefined, changed: false };
  }

  const run = options.spawn ?? ((command, args, spawnOptions) => spawnSync(command, args, spawnOptions));
  const shell = options.commandShell ?? process.env.ComSpec ?? "cmd.exe";
  const current = readCodePage(run, shell);
  if (current === undefined || current === UTF8_CODE_PAGE) {
    return { restore: () => undefined, changed: false };
  }

  if (!setCodePage(run, shell, UTF8_CODE_PAGE)) {
    return { restore: () => undefined, changed: false };
  }

  let restored = false;
  return {
    changed: true,
    restore: () => {
      if (restored) return;
      restored = true;
      setCodePage(run, shell, current);
    },
  };
}

function readCodePage(run: Spawn, shell: string): number | undefined {
  const result = run(shell, ["/d", "/c", "chcp"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
  if (result.status !== 0) return undefined;
  const text = Buffer.isBuffer(result.stdout) ? result.stdout.toString("utf8") : result.stdout ?? "";
  const match = text.match(CODE_PAGE_PATTERN);
  const codePage = match?.[1] ? Number(match[1]) : Number.NaN;
  return Number.isInteger(codePage) ? codePage : undefined;
}

function setCodePage(run: Spawn, shell: string, codePage: number): boolean {
  // chcp 必须继承父控制台才能修改同一个代码页；隐藏窗口或管道会操作另一个控制台。
  // 固定命令只拼接经过整数校验的代码页，并丢弃状态行，避免污染 TUI 画面。
  const result = run(shell, ["/d", "/c", `chcp ${codePage} >nul`], {
    encoding: "utf8",
    stdio: "inherit",
    windowsHide: false,
  });
  return result.status === 0;
}

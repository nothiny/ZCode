# 让 ZCode CLI / TUI 接近 pi 的使用体验

本文是建议稿，不是规格。按 `AGENTS.md` 的要求，任何一条进入实现前，先改
`docs/cli-tui-spec.md` 里的对应契约，再动代码。

## 先给结论

对照 pi 之后，真正需要补的不是「模式」，而是三件具体的事：

1. **CLI 的模式其实已经比 pi 全**。ZCode 有 `--mode build|edit|plan|yolo`、
   `--output-format text|json|stream-json`、`--target`、`--attach`、只读的
   `sessions` / `models` / `config`；pi 多出来的是「非交互契约的细节」：管道 stdin、
   JSONL 首行 session header、工具/会话开关。这些是低成本高收益的补齐项。
2. **后台跑测试不该对标 pi**。pi 的 README 明确写着 *No background bash — use tmux*。
   ZCode 相反，`BackgroundTaskTracker`、`run_in_background`、超时自动转后台、
   `TaskOutput` / `TaskStop` 全都已经实现。所以这件事的正确做法是把已有能力
   **默认化并补上收尾保证**，而不是引入新机制。
3. **当前有一个真问题会让 CI 误判**：`-p` 会话在没有任何 dynamic-workflow 活动时，
   根本不等待后台任务就退出（`cli/src/prompt-command.ts:300` 的
   `observer.hasWorkflowActivity() && runtimeFacts` 是等待的唯一触发条件）。
   一旦「测试默认后台化」落地，这条路径会变成「启动测试 → 立刻退出 0」，
   恰好是最坏的失败模式。

## 一、现状对照

| 能力 | pi | ZCode 现状 | 结论 |
| --- | --- | --- | --- |
| 交互 TUI（无参启动） | 有 | 有（`zcode` 无参即 TUI） | 已对齐 |
| 一次性执行 | `-p/--print` 布尔开关 | `-p/--prompt <text>`、位置参数、`run <prompt>` | 已覆盖，语义更自然 |
| JSONL 事件流 | `--mode json`，首行 session header | `--output-format stream-json`，逐事件行 + 末尾 result 行 | 缺首行 header |
| 管道 stdin 合并进 prompt | `cat f \| pi -p "..."` | 不支持；非 TTY 下 `zcode` 直接报错退出 1 | 缺 |
| 工具过滤 | `--tools` / `--exclude-tools` / `--no-tools` | 只有 `--disallowedTools`（黑名单） | 缺白名单与只读模式 |
| 短命会话 | `--no-session` | 无 | 缺（CI 场景关键） |
| 项目信任开关 | `--approve` / `--no-approve` | 只有只读的 `workspaceHookTrust` 出现在 `--json` 输出里 | 缺开关 |
| 后台命令 | 明确不做 | `run_in_background` + 15s 超时自动转后台 + 任务通知 | 领先，但收尾有洞 |
| 会话浏览/导出 | `-r` 选择器、`--export` HTML | `zcode sessions`（含 JSON）+ TUI `/sessions` | 够用 |

## 二、CLI 建议（重点）

### P0-1 `-p` 必须等待本进程启动的后台任务

现状证据：

- 等待逻辑本身是对的，而且注释里写明了「谓词刻意宽于 dwf，并存的后台 Bash/subagent
  任务也会被等」（`cli/src/headless-workflow.ts:339-370`）。
- 但**触发条件**窄得多：`cli/src/prompt-command.ts:300` 只有观察到 workflow 活动才进等待。
- 结果是：`zcode -p "跑一下测试"` 若命令被转后台，进程会在测试结束前退出，
  退出码是 0。

建议：

- 把触发条件从「观察到 workflow 活动」放宽为「本进程登记过任一后台任务」。
  判据可以直接复用已经订阅着的 `SessionEventType.BackgroundTaskStarted`——
  现有代码正是用它作为「更早、更硬的证据」（`headless-workflow.ts:296-306`），
  只要去掉 `taskKind === "workflow"` 这一个限制即可，不需要新机制。
- 同时给 `--wait-background` / `--no-wait-background`（默认 wait），
  让需要「发射后不管」的调用方显式选择退出。
- 可选加固：进程退出前若仍有未完成后台任务，即使 `--no-wait-background`
  也应在 stderr 打出任务 ID 并以非零码退出，避免 CI 拿到假成功。

验收：一个 `-p` 运行里启动的后台 bash 任务，必须在进程退出前结算；
`--no-wait-background` 下必须以非零码退出并打印任务 ID。

### P0-2 测试类命令默认走后台（不再等 15 秒）

现状证据：

- 前台命令的自动转后台已存在，但要先占用 15 秒：
  `core/src/tool/handlers/bash-model-content.ts:11` 的
  `ASSISTANT_BLOCKING_BUDGET_MS = 15_000`。
- 资格判定只有一个函数，且只排除两件事：
  `core/src/tool/handlers/bash-background-policy.ts` 的
  `isBashAutoBackgroundEligible()`（排除显式 `run_in_background` 与 `sleep`）。
- 启动路径在 `core/src/tool/handlers/bash.ts:153-188`：`eligibleForAutoBackground`
  决定走 `{ mode: "auto_on_timeout" }` 还是纯前台。

建议：

- 在 `bash-background-policy.ts` 里新增 `isLikelyLongRunningCommand()`，
  与现有函数并列，保持「后台资格判定只有一个所有者」这个性质。
  命中 `pnpm test`、`pnpm -r test`、`turbo run test`、`vitest`、`jest`、
  `node --test`、`pytest`、`cargo test`、`go test`、`tsc -b`、`typecheck`、`lint`
  这类命令时，直接以新的 `mode: "auto_on_match"` 启动，**零阻塞**。
- 同步更新 `core/src/tool/handlers/bash-prompt.ts`，让模型知道测试命令会自动后台化，
  它会收到任务 ID 而不是输出——否则模型会反复重跑同一条命令。
- 两个必须保留的边界：
  - `offPeakTurn` 时禁用后台（`bash.ts:139-152`），这条不要为了「默认化」而放开。
  - 通知 turn 不带 `turnExecutionModel`，闲时 turn 结束后会落到用户自己的套餐上
    跑完整 agent loop（`bash.ts:136-138` 的注释）。后台任务越多，这个成本陷阱
    被触发的机会越多，建议在 P0-2 落地时一并确认该路径的计费归属，
    或在 UI 上把「后台任务完成会再起一轮」说清楚。

  ```mermaid
  sequenceDiagram
  participant M as 模型
  participant B as Bash 工具入口
  participant P as bash-background-policy
  participant T as BackgroundTaskTracker
  participant R as AgentRuntime
  M->>B: Bash(pnpm test)
  B->>P: isLikelyLongRunningCommand?
  P-->>B: true
  B->>T: 登记任务(auto_on_match)，立即返回 taskId
  B-->>M: status=backgrounded + taskId
  Note over M: 模型继续做别的事，不再阻塞 15s
  T->>R: BackgroundTaskCompleted
  R->>R: 入队 task-notification，另起通知 turn
  R-->>M: 通知 turn（无 turnExecutionModel，注意计费归属）
  ```

验收：`pnpm test` 类命令在交互与 `-p` 两种模式下都零阻塞转后台；
`Bash` 的返回文本里出现任务 ID；重复调用同一条测试命令时模型不会盲跑。

### P0-3 本仓库自己还没有「跑测试」的统一入口

这条与产品无关，但直接卡住「默认跑测试」这件事：

- 根 `package.json` 没有 `test` 脚本。
- `apps/zcode-cli/turbo.json` 没有 `test` 任务。
- 只有 `@zcode/cli` 与 `@zcode/tui` 两个包有
  `node --import tsx/esm --test test/*.test.mjs`（Node 内置测试器，无 vitest/jest）。
  其余包（core、contracts、adapters、bootstrap……）连 `test` 脚本都没有。

建议：`apps/zcode-cli/turbo.json` 增加 `test` 任务（`dependsOn: ["^build"]`），
根 `package.json` 增加 `test` → `turbo run test`，并把它接入 `verify:pre-push`。

### P1-1 支持管道 stdin，并在非 TTY 下给可操作的错误

现状：`tui.tsx` 在 `!stdin.isTTY || !stdout.isTTY` 时直接写
「TUI requires an interactive terminal.」并返回 1；`ctx.stdin` 只传给 TUI、
协议服务、dwf 子进程和插件卸载确认，从不进入 prompt 路径。

建议：

- `-p` 模式下若 `stdin` 非 TTY，读取全部内容并按 pi 的做法合并进初始 prompt。
  这让 `git diff | zcode -p "review 这段改动"` 这种用法成立。
- 非 TTY 且没有 prompt 时，错误信息里补一句「非交互环境请使用 `-p <prompt>`」，
  别让 CI 里的人对着「需要交互终端」发呆。

### P1-2 补 JSONL 契约的两个缺口

- **首行 session header**：pi 的 JSON 模式第一行是
  `{"type":"session","version":N,"id":...,"timestamp":...,"cwd":...}`，
  消费者不必等到末尾 result 行就能拿到身份。ZCode 的 `stream-json` 现在
  只有逐事件行 + 末尾 `{"type":"result",...}`，建议补一个等价的 header 行。
- **失败时没有结构化 result**：`prompt-command.ts` 的 catch 分支只往 stderr 写
  `Error: … (traceId: …)` 并返回 1；`--json` / `stream-json` 下的 stdout
  在失败时是**空的**，机器消费端只能靠退出码区分。建议失败时也在 stdout
  输出带 `is_error: true` 的 result 对象，人读的信息继续留在 stderr。

顺带确认（不是问题）：`stream-json` 已经带 token 级增量——
`bootstrap/src/zcode-protocol/session-mapper.ts:375-394` 保留了
`text_delta` / `reasoning_delta` / `tool_input_delta`，这一层不需要动。

### P1-3 工具 / 会话 / 信任开关

- `--tools <list>` 白名单与 `--no-tools`（只读模式）。现在只有
  `--disallowedTools`（`cli/src/arguments.ts:203-220`），CI 里想限权只能列举黑名单。
- `--no-session`：短命会话，不写 SQLite session store。这是「后台批量跑测试」
  最需要的开关，否则每次 CI 运行都会污染用户的会话列表。
- `--trust-workspace` / `--no-trust-workspace`：非交互模式不再有信任提示，
  需要显式开关，否则 hooks 在 CI 里被静默跳过（`--json` 里的
  `workspaceHookTrust` 目前只是只读告知）。

### P2-1 退出码表显式化

`shutdown.ts` 已有一套 `SIGNAL_EXIT_CODES` + `exitCodeForSignal`。建议在
`docs/cli-tui-spec.md` 里把 0 / 1 / 2(用法错误) / 130 / 143 写成契约并测到，
因为一旦 CLI 真的在 CI 里跑，退出码就是唯一可靠的信号。

## 三、TUI 建议（次要）

以下按「投入产出比」排序，证据都来自现有代码：

1. **后台任务面板**。`TuiOptions.cancelBackgroundTask` 已经在
   `tui/src/types.ts:317` 声明，但在 `src/` 里**没有任何引用**——能力接了没接线。
   配合 P0-2，TUI 需要看得到「哪些测试在跑、跑了多久、怎么取消」。
   复用 sidebar 的 Sections（`tui/src/app-sidebar-layout.ts`）即可。
2. **工具输出可展开**。现在 `app-tool-components.tsx` 最多显示 8 行，多余的
   直接 `[truncated N lines]`，而 thought 块和 workflow 卡片都能折叠展开。
   测试输出被截断是这个场景下最常遇到的痛点。
3. **transcript 翻页与搜索**。`scrollbox` 是 `focused: false`，没有
   PageUp/PageDown/Home/End 绑定，只能靠鼠标滚轮。
4. **Ctrl+R 重新分配**。现在被 `/compact` retry 占用（`app-keyboard.ts`），
   而 readline 惯例里这是反向历史搜索；建议 `/compact` retry 换键。
5. **常驻的 token / 成本状态行**。现在这些数字散在 composer 元数据行和
   dev-only 的 sidebar 区块里。
6. **回合完成提示**（bell / OSC 通知）。后台任务完成的通知 turn 结束时应该能提醒你。
7. **i18n 收尾**。approval 面板与 `app-terminal-commands.ts` 里仍有硬编码英文
   （"Ready."、"/clear" 的提示等），和 `copy` 目录的用法不一致。

## 四、不建议照抄 pi 的地方

- **不要因为 pi 没有后台 bash 就砍掉 ZCode 的后台任务**。pi 的立场是
  "use tmux"，那是它的取舍；ZCode 已经有 tracker、通知、`TaskOutput` / `TaskStop`
  和 subagent 复用，这是差异化优势，应该把 UI 侧补完整。
- **不要把 `-p` 改成 pi 的布尔 `--print`**。`-p <text>` 已经覆盖了 print 语义，
  改开关名只会破坏现有脚本。
- **不要引入第二套输出模式命名**。`--output-format` 比 pi 的 `--mode json|rpc`
  更清晰，保留它，只补契约细节。

## 五、落地顺序

1. 改 `docs/cli-tui-spec.md`：新增「后台任务与非交互收尾」一节（P0-1、P0-2 的契约）
   与「非交互输出契约」一节（P1-1、P1-2）。
2. P0-3（先把仓库自己的测试入口接上）→ P0-1（收尾保证）→ P0-2（默认后台化）。
   顺序不能反：收尾保证是默认后台化的前提，否则先落地 P0-2 会把假成功变成默认行为。
3. P1-1 / P1-2 / P1-3 可以并行，都是 `cli` 包的边界改动。
4. TUI 的第 1、2 项跟随 P0-2 一起做，否则默认后台化之后用户在 TUI 里看不见任何东西。

每一步都要按 `AGENTS.md`：改行为前先补测试（`node --import tsx/esm --test test/*.test.mjs`），
并实际跑 `pnpm typecheck` 与 `pnpm lint`。

## 六、需要你拍板的三件事

1. **P0-2 的默认范围**：只对测试/类型检查/构建类命令默认后台化，还是对
   所有超过某个阈值（比如 5 秒）的命令一律后台化？前者可预测，后者更省事。
2. **P0-1 的默认语义**：`-p` 默认等待后台任务（我建议这个），还是默认不等、
   由调用方显式 `--wait-background`？前者对 CI 安全，后者对脚本可控。
3. **成本归属**：后台任务完成会再起一轮通知 turn，而闲时 turn 不带执行模型
   配额。要不要在这种 turn 上加显式的提示或开关？

## 参考

- [pi-mono coding-agent README（镜像）](https://github.com/Perlence/pi-mono/blob/66c8ddfddd2077a0b01add34ca77bcbd1ca369f7/packages/coding-agent/README.md)
- [Print Mode, RPC Mode & SDK — DeepWiki](https://deepwiki.com/badlogic/pi-mono/4.11-print-mode-rpc-mode-and-sdk)
- [@mariozechner/pi-coding-agent 文档](https://mintlify.wiki/pt-act/pi-mono/packages/coding-agent)

# ZCode CLI / TUI architecture

## Current Agent Entry

`apps/zcode-cli/packages/cli/src/main.ts` is the process entrypoint. It installs
the stderr and shutdown boundaries, then delegates to `run()` in `run.ts`.
Headless prompts use `runPrompt()` in `prompt-command.ts`; the interactive path
uses `runTuiCommand()` and `@zcode/tui`'s `runTui()`.

## Current Model Interface

The CLI creates the application through `@zcode/bootstrap`'s
`createZCodeApp()`. Model access is owned by the process provider registry
(`startProcessProviderRegistryRuntime()`), which exposes validated provider and
model selections to the app runtime. The CLI never constructs an SDK model or
stores credentials itself.

## Current Tool Interface

Tools are registered by the bootstrap/core runtime and executed through the
app's `AgentRuntime`. Tool calls and results are emitted as `SessionEvent`
records. The TUI renders those records through its transcript and tool
components; it does not call tools directly.

## Current Session Model

Sessions are persisted by the SQLite session store selected by bootstrap. The
public `listZCodeSessions()` and `resolveLatestSession()` functions are the
single read path used by CLI session commands, TUI `/sessions`, and resume
logic. Session IDs are passed to `createZCodeApp({ sessionId, resume })`.

## Current Streaming Mechanism

`AgentRuntime` emits `SessionEvent` values while a turn is running. Headless
execution adapts them with `mapSessionEvent()` for `--output-format stream-json`.
The TUI subscribes through `TuiPromptHandler.subscribeSessionEvents()` and
feeds the same events into its transcript state. This keeps runtime state and
presentation state separate while preserving token and tool streaming.

## Current Config System

Environment, dotenv, provider configuration, locale, and user settings are
loaded by the CLI/bootstrap boundary. `--cwd` is resolved by `resolveCliCwd()`
and becomes the app workspace. The CLI aliases added here only normalize user
commands into the existing `--prompt`, `tui`, `--resume`, and bootstrap APIs.

## CLI integration point

`run()` is the command router. The aliases `run`, `chat`, and `resume`, plus a
positional prompt, are normalized before the existing strict argument parser.
`sessions` reads the existing session store API, `models` reads the existing
provider registry view, and `config` exposes an allowlisted view of resolved
settings and source metadata. No second runtime or persistence layer is
introduced.

## TUI integration point

`runTuiCommand()` owns the TUI lifecycle and wires `createTuiSubmitPrompt()` to
the OpenTUI renderer. `runTui()` owns terminal setup/restore, rendering, input,
slash commands, and event presentation. Ctrl-C, shutdown guards, and stderr
interception remain in the existing lifecycle boundary.

## Event and state ownership

```text
user input
    -> cli router / TUI submit handler
    -> createZCodeApp + AgentRuntime (single owner of execution/session state)
    -> SessionEvent stream
    -> headless observer OR TUI session-event relay
    -> rendered output
```

The new command aliases are therefore a presentation-layer change. They do not
duplicate model calls, tool registration, session writes, or streaming logic.

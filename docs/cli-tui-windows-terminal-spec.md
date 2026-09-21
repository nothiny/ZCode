# Windows terminal compatibility specification

## Problem

The TUI writes UTF-8 text and VT escape sequences through the OpenTUI renderer. A
Windows console left on the active legacy code page (for example CP936) decodes
the UTF-8 bytes as a local code page, so Chinese text is corrupted. A terminal
that has not enabled virtual terminal processing can also expose the renderer's
escape sequences as text.

## Ownership and boundary

`apps/zcode-cli/packages/tui/src/tui.tsx` owns the interactive terminal
lifecycle. A small platform adapter called by that lifecycle owns Windows
console preparation and restoration. The React TUI and Agent runtime do not
inspect code pages or call platform APIs.

## Rules

- On Windows and only for an interactive TTY, prepare UTF-8 output before
  creating the native renderer.
- Let OpenTUI's native `setupTerminal` own virtual terminal mode and its
  teardown; the adapter must not duplicate that state or write escape
  sequences itself.
- Restore every console setting changed by the adapter when the renderer is
  destroyed, including error and startup-failure paths.
- On macOS/Linux the adapter is a no-op.
- The adapter must be injectable/testable without changing Agent or session
  state.

## Acceptance scenarios

1. A Windows console using CP936 renders Chinese TUI text without mojibake.
2. VT-capable Windows Terminal consumes cursor/color sequences instead of
   displaying them literally.
3. Starting and exiting the TUI restores the previous code page; OpenTUI
   restores its own terminal mode.
4. A missing/denied Windows console API degrades to the renderer's normal
   startup path.

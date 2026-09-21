import type { KeyEvent } from "@mbears/opentui-core";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  CTRL_C_EXIT_PROMPT,
  PROMPT_DRAFT_CLEARED_STATUS,
  type CtrlCExitGuard,
  resetCtrlCExitGuard,
  resolveCtrlCAction,
} from "./app-keyboard-helpers.js";
import type { DraftAttachment } from "./app-model.js";

type CtrlCHandlerOptions = {
  abortControllerRef: MutableRefObject<AbortController | undefined>;
  consumeKey: (key: KeyEvent) => void;
  copyCurrentSelection: () => boolean;
  onExit: (code: number) => void;
  setDraftAttachments: Dispatch<SetStateAction<DraftAttachment[]>>;
  setDraftValue: (value: string) => void;
  setStatus: Dispatch<SetStateAction<string>>;
};

export function handleCtrlCKey(
  key: KeyEvent,
  busy: boolean,
  draftValue: string,
  guard: CtrlCExitGuard,
  options: CtrlCHandlerOptions,
): boolean {
  if (key.name !== "c" || !key.ctrl) return false;
  options.consumeKey(key);
  if (options.copyCurrentSelection()) {
    resetCtrlCExitGuard(guard);
    return true;
  }

  const action = resolveCtrlCAction({ busy, draftValue, guard, nowMs: Date.now() });
  if (action === "clear_draft") {
    options.setDraftValue("");
    options.setDraftAttachments([]);
    options.setStatus(PROMPT_DRAFT_CLEARED_STATUS);
  } else if (action === "cancel") {
    // 当前轮次的 AbortController 是唯一取消入口，复用传给 bootstrap/runtime 的信号。
    options.abortControllerRef.current?.abort();
    options.setStatus(CTRL_C_EXIT_PROMPT);
  } else if (action === "confirm_exit") {
    options.abortControllerRef.current?.abort();
    options.onExit(0);
  } else {
    options.setStatus(CTRL_C_EXIT_PROMPT);
  }
  return true;
}

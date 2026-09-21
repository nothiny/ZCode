import assert from "node:assert/strict";
import test from "node:test";
import { SessionEventType, createSessionEvent } from "@zcode/contracts";
import { applySessionEventToState } from "../src/app-events.ts";
import { applyTurnCompleteFallbackResponse } from "../src/app-turn-complete.ts";

function harness(initialMessages = []) {
  const state = {
    activeTurnId: undefined,
    cacheStats: undefined,
    contextUsage: {},
    lastError: undefined,
    liveModelText: "",
    messages: initialMessages,
    model: "provider/model",
    networkRequests: [],
    queuedInputs: [],
    status: "Ready",
    todos: [],
    usage: undefined,
    workflowMirror: undefined,
  };
  const update = (key) => (value) => {
    state[key] = typeof value === "function" ? value(state[key]) : value;
  };
  const handlers = {
    setActiveTurnId: update("activeTurnId"),
    setCacheStats: update("cacheStats"),
    setContextUsage: update("contextUsage"),
    setLastError: update("lastError"),
    setLiveModelText: update("liveModelText"),
    setMessages: update("messages"),
    setModel: update("model"),
    setNetworkRequests: update("networkRequests"),
    setQueuedInputs: update("queuedInputs"),
    setStatus: update("status"),
    setTodos: update("todos"),
    setUsage: update("usage"),
    setWorkflowMirror: update("workflowMirror"),
    assistantMessageIdsByToolCallId: new Map(),
    modifiedFileToolCallIds: new Set(),
    toolNamesById: new Map(),
  };
  return { state, handlers };
}

const event = (type, payload) => createSessionEvent(type, "session-event-test", payload);

test("model streaming is projected before completion and completion does not duplicate text", () => {
  const current = harness([{ content: "", id: "assistant-1", role: "agent", parts: [], streamProjected: true }]);
  applySessionEventToState(event(SessionEventType.ModelStreaming, {
    assistantMessageId: "assistant-1", delta: "answer", kind: "text_delta",
  }), current.handlers);
  assert.equal(current.state.messages[0].parts[0].text, "answer");
  applyTurnCompleteFallbackResponse({ response: "answer" }, current.handlers.setMessages);
  assert.equal(current.state.messages.length, 1);
  assert.equal(current.state.messages[0].parts.filter((part) => part.type === "text").length, 1);
});

test("tool lifecycle updates one card and exposes failures", () => {
  const current = harness();
  const base = { input: { file_path: "hello.txt" }, toolCallId: "read-1", toolName: "Read" };
  applySessionEventToState(event(SessionEventType.ToolCallScheduled, base), current.handlers);
  applySessionEventToState(event(SessionEventType.ToolCallStarted, base), current.handlers);
  applySessionEventToState(event(SessionEventType.ToolCallResult, {
    ...base, result: { content: "Hello from disk" },
  }), current.handlers);
  let parts = current.state.messages.flatMap((message) => message.parts ?? []);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].status, "completed");
  applySessionEventToState(event(SessionEventType.ToolCallError, {
    ...base, message: "permission denied",
  }), current.handlers);
  parts = current.state.messages.flatMap((message) => message.parts ?? []);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].status, "failed");
  assert.match(current.state.lastError, /permission denied/);
});

test("turn completion usage and errors remain visible in the projection", () => {
  const current = harness();
  applySessionEventToState(event(SessionEventType.TurnComplete, {
    response: "done",
    usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5, modelRequestCount: 1 },
  }), current.handlers);
  assert.equal(current.state.messages[0].content, "done");
  assert.equal(current.state.usage.totalTokens, 5);
  applySessionEventToState(event(SessionEventType.TurnError, { message: "model unavailable" }), current.handlers);
  assert.match(current.state.lastError, /model unavailable/);
  assert.match(current.state.messages.at(-1).content, /model unavailable/);
});

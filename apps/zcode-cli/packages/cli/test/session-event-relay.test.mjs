import assert from "node:assert/strict";
import test from "node:test";
import { SessionEventType, createSessionEvent } from "@zcode/contracts";
import { createTuiSessionEventRelay } from "../src/tui-session-event-relay.ts";

test("resident event relay follows the current runtime and detaches the old one", () => {
  let runtime = { name: "first" };
  const subscriptions = [];
  const relay = createTuiSessionEventRelay({
    currentRuntime: () => runtime,
    readSubscriber: (current) => ({ onSessionEvent }) => {
      const subscription = { current, detached: false, onSessionEvent };
      subscriptions.push(subscription);
      return () => { subscription.detached = true; };
    },
  });
  const seen = [];
  const remove = relay.addSink((event) => seen.push([event.sessionId, event.type]));
  assert.equal(relay.isAttached(), true);
  assert.equal(subscriptions[0].current, runtime);

  subscriptions[0].onSessionEvent(createSessionEvent(SessionEventType.TurnStarted, "relay-session", {}));
  assert.deepEqual(seen, [["relay-session", SessionEventType.TurnStarted]]);

  runtime = { name: "second" };
  relay.reattach();
  assert.equal(subscriptions[0].detached, true);
  assert.equal(subscriptions[1].current, runtime);
  // Upstream owns delivery after unsubscribe; only the new runtime callback is live.
  subscriptions[1].onSessionEvent(createSessionEvent(SessionEventType.TurnComplete, "new", {}));
  assert.deepEqual(seen, [
    ["relay-session", SessionEventType.TurnStarted],
    ["new", SessionEventType.TurnComplete],
  ]);

  remove();
  assert.equal(relay.isAttached(), false);
  assert.equal(subscriptions[1].detached, true);
});

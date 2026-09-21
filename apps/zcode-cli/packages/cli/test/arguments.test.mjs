import assert from "node:assert/strict";
import test from "node:test";
import {
  parseGlobalArgs,
  extractDisallowedToolsArgs,
  isProtocolServerInvocation,
} from "../src/arguments.ts";

const parse = (...args) => parseGlobalArgs(extractDisallowedToolsArgs(args).args);

test("positional and run prompts preserve option values in either order", () => {
  for (const args of [
    ["--model", "provider/model", "fix the tests", "--cwd", "/project"],
    ["run", "--cwd=/project", "fix the tests", "--model=provider/model"],
    ["--cwd", "/project", "run", "fix the tests", "--model", "provider/model"],
  ]) {
    const result = parse(...args);
    assert.equal(result.values.prompt, "fix the tests");
    assert.equal(result.values.cwd, "/project");
    assert.equal(result.values.model, "provider/model");
    assert.deepEqual(result.positionals, []);
  }
});

test("output-format values and explicit -p are never reinterpreted", () => {
  const result = parse("--output-format", "stream-json", "run", "hello");
  assert.equal(result.values.prompt, "hello");
  assert.equal(result.values["output-format"], "stream-json");
  assert.equal(parse("-phello").values.prompt, "hello");
  assert.equal(parse("run", "-p", "models").values.prompt, "models");
});

test("background wait flags have an explicit, mutually exclusive spelling", () => {
  assert.equal(parse("run", "hello", "--wait-background").values["wait-background"], true);
  assert.equal(parse("run", "hello", "--no-wait-background").values["no-wait-background"], true);
  assert.throws(() => parse("run", "hello", "--wait-background", "--no-wait-background"));
});

test("run can send command words and -- preserves literal option-looking text", () => {
  assert.equal(parse("run", "models").values.prompt, "models");
  assert.equal(parse("--", "models").values.prompt, "models");
  assert.equal(parse("run", "--", "--model", "literal").values.prompt, "--model literal");
  assert.equal(parse("--", "--disallowed-tools", "Bash").values.prompt, "--disallowed-tools Bash");
});

test("chat and resume share canonical TUI routing with options in either order", () => {
  for (const args of [
    ["chat", "--cwd", "/p"],
    ["--cwd", "/p", "chat"],
  ]) {
    assert.deepEqual(parse(...args).positionals, ["tui"]);
  }
  for (const args of [
    ["resume", "sess_x", "--cwd", "/p"],
    ["--cwd", "/p", "resume", "sess_x"],
  ]) {
    const result = parse(...args);
    assert.deepEqual(result.positionals, ["tui"]);
    assert.equal(result.values.resume, "sess_x");
  }
});

test("incomplete commands and conflicting prompt sources fail before runtime startup", () => {
  for (const args of [
    ["run"],
    ["run", " "],
    ["resume"],
    ["resume", "a", "b"],
    ["chat", "extra"],
    ["hello", "-p", "other"],
    ["run", "hello", "--target", "goal"],
    ["resume", "a", "--resume", "b"],
    ["--resume", "a", "--continue"],
  ]) {
    assert.throws(() => parse(...args), undefined, JSON.stringify(args));
  }
  assert.equal(parse("run", "--help").values.help, true);
});

test("protocol classification respects prompt and cwd option values", () => {
  assert.equal(isProtocolServerInvocation(["--cwd", "app-server"]), false);
  assert.equal(isProtocolServerInvocation(["-p", "app-server"]), false);
  assert.equal(isProtocolServerInvocation(["run", "app-server"]), false);
  assert.equal(isProtocolServerInvocation(["--", "app-server"]), false);
  assert.equal(isProtocolServerInvocation(["--cwd", "/p", "app-server"]), true);
});

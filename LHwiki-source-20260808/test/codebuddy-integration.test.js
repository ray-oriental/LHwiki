import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildCodeBuddyArgs,
  containsSensitiveContent,
  validateResponse,
} from "../scripts/codebuddy-review.mjs";

test("CodeBuddy reviewer is read-only, single-turn, and non-persistent", () => {
  const args = buildCodeBuddyArgs({ prompt: "review this code" });

  assert.deepEqual(args.slice(0, 5), ["-p", "--output-format", "text", "--tools", ""]);
  assert.equal(args[args.indexOf("--permission-mode") + 1], "dontAsk");
  assert.equal(args[args.indexOf("--max-turns") + 1], "1");
  assert.ok(args.includes("--no-session-persistence"));
  assert.equal(args.at(-1), "review this code");
});

test("CodeBuddy reviewer only selects a model when explicitly requested", () => {
  const automatic = buildCodeBuddyArgs({ prompt: "review" });
  const pinned = buildCodeBuddyArgs({ prompt: "review", model: "hy3" });

  assert.equal(automatic.includes("--model"), false);
  assert.equal(pinned[pinned.indexOf("--model") + 1], "hy3");
});

test("CodeBuddy false-success network responses are rejected", () => {
  assert.throws(
    () => validateResponse({ exitCode: 0, stdout: "502 连接被拒绝 (ECONNREFUSED)", stderr: "" }),
    /failed request/,
  );
  assert.throws(
    () => validateResponse({ exitCode: 0, stdout: "", stderr: "" }),
    /empty response/,
  );
  assert.equal(
    validateResponse({ exitCode: 0, stdout: "No actionable findings.\n", stderr: "" }),
    "No actionable findings.",
  );
});

test("CodeBuddy reviewer blocks known sensitive LHwiki inputs", () => {
  assert.equal(containsSensitiveContent("read campus-notes/backup/latest.json"), true);
  assert.equal(containsSensitiveContent("copy .dev.vars"), true);
  assert.equal(containsSensitiveContent("-----BEGIN PRIVATE KEY-----"), true);
  assert.equal(containsSensitiveContent("review public/app.js"), false);
});

test("CodeBuddy reviewer direct entry point rejects an empty prompt", () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const script = path.resolve(testDirectory, "../scripts/codebuddy-review.mjs");
  const result = spawnSync(process.execPath, [script], {
    cwd: path.dirname(testDirectory),
    encoding: "utf8",
    input: "",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Provide a prompt/);
});

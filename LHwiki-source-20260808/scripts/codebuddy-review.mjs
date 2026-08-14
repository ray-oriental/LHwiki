import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 90_000;
const FAILURE_PATTERN = /(?:ECONNREFUSED|连接被拒绝|request failed|network error|API Error|\b(?:401|403|429|5\d\d)\b.*(?:error|错误|拒绝|failed))/iu;
const SENSITIVE_PATTERN = /(?:campus-notes[\\/]backup(?:[\\/]|\b)|\.dev\.vars\b|(?:^|[\\/])\.env(?:\.|\b)|-----BEGIN [A-Z ]*PRIVATE KEY-----)/imu;

export function buildCodeBuddyArgs({ prompt, model = "", effort = "low" }) {
  const args = [
    "-p",
    "--output-format",
    "text",
    "--tools",
    "",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--max-turns",
    "1",
    "--effort",
    effort,
  ];

  if (model) args.push("--model", model);
  args.push(prompt);
  return args;
}

export function containsSensitiveContent(prompt) {
  return SENSITIVE_PATTERN.test(prompt);
}

export function validateResponse({ exitCode, stdout, stderr }) {
  const output = stdout.trim();
  const diagnostic = `${stderr}\n${stdout}`.trim();

  if (exitCode !== 0) {
    throw new Error(`CodeBuddy exited with code ${exitCode}: ${diagnostic || "no diagnostic output"}`);
  }
  if (!output) {
    throw new Error("CodeBuddy returned an empty response");
  }
  if (FAILURE_PATTERN.test(diagnostic)) {
    throw new Error(`CodeBuddy reported a failed request despite exit code 0: ${diagnostic}`);
  }
  return output;
}

export async function resolveCodeBuddyCommand(override = process.env.CODEBUDDY_BIN) {
  const candidates = [];
  if (override) candidates.push(override);
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "codebuddy", "bin", "codebuddy.exe"));
  }

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return { command: candidate, prefixArgs: [] };
    } catch {
      // Continue to the next portable discovery location.
    }
  }

  return { command: process.platform === "win32" ? "codebuddy.exe" : "codebuddy", prefixArgs: [] };
}

export function runCodeBuddy({ command, args, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`CodeBuddy timed out after ${timeoutMs} ms`));
        return;
      }
      resolve({ exitCode, stdout, stderr });
    });
  });
}

async function readPrompt(options) {
  if (options.promptFile) return readFile(options.promptFile, "utf8");
  if (options.prompt) return options.prompt;
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  }
  return "";
}

function parseArgs(argv) {
  const options = { effort: "low", model: "", timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--prompt") options.prompt = argv[++index];
    else if (arg === "--prompt-file") options.promptFile = argv[++index];
    else if (arg === "--model") options.model = argv[++index];
    else if (arg === "--effort") options.effort = argv[++index];
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (arg === "--codebuddy-bin") options.codeBuddyBin = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 300_000) {
    throw new Error("--timeout-ms must be an integer between 1000 and 300000");
  }
  if (!new Set(["minimal", "low", "medium"]).has(options.effort)) {
    throw new Error("--effort must be minimal, low, or medium for the reviewer workflow");
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const prompt = (await readPrompt(options)).trim();
  if (!prompt) throw new Error("Provide a prompt through stdin, --prompt, or --prompt-file");
  if (containsSensitiveContent(prompt)) {
    throw new Error("Refusing to send a prompt that appears to contain LHwiki backup, environment, or private-key data");
  }

  const { command, prefixArgs } = await resolveCodeBuddyCommand(options.codeBuddyBin);
  const args = [...prefixArgs, ...buildCodeBuddyArgs({ prompt, model: options.model, effort: options.effort })];
  const result = await runCodeBuddy({ command, args, timeoutMs: options.timeoutMs });
  process.stdout.write(`${validateResponse(result)}\n`);
}

const directPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const modulePath = fileURLToPath(import.meta.url);
const isDirectRun = process.platform === "win32"
  ? directPath.toLowerCase() === modulePath.toLowerCase()
  : directPath === modulePath;
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`codebuddy-review: ${error.message}\n`);
    process.exitCode = 1;
  });
}

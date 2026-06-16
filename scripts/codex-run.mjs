#!/usr/bin/env node
// codex-bridge — a thin, dependency-free wrapper around `codex exec`.
//
// Why this is enough: `codex exec` boots an in-process Codex app-server over the
// shared `codex-core` engine, so it produces the exact same results as the full
// `codex app-server` protocol — without any of its broker/lock machinery. Each
// invocation is its own OS process, so you can run as many concurrently as you
// like. There is nothing to serialize and nothing to "bypass".

import { spawn } from "node:child_process";
import process from "node:process";

const SANDBOX_MODES = new Set(["read-only", "workspace-write", "danger-full-access"]);
const EFFORT_LEVELS = new Set(["minimal", "low", "medium", "high", "xhigh"]);
const APPROVAL_POLICIES = new Set(["untrusted", "on-failure", "on-request", "never"]);
// Codex prints `session id: <uuid>` in its startup banner (on stderr).
const SESSION_ID_RE = /session id:\s*([0-9a-fA-F-]{8,})/i;

const HELP = `codex-run — call OpenAI Codex (gpt-5.x) via \`codex exec\`.

Usage:
  codex-run [options] "<prompt>"
  echo "<prompt>" | codex-run [options]

Options:
  -m, --model <id>       Model id (default: account/config default).
  -e, --effort <level>   Reasoning effort: ${[...EFFORT_LEVELS].join(" | ")}.
  -C, --cd <dir>         Working root for Codex (default: current directory).
  -s, --sandbox <mode>   ${[...SANDBOX_MODES].join(" | ")} (default: read-only).
  -w, --writable         Shortcut for --sandbox workspace-write (lets Codex edit files).
  -a, --approval <pol>   Approval policy: ${[...APPROVAL_POLICIES].join(" | ")} (default: Codex's own).
      --resume <id>      Continue a prior Codex session by id.
      --json             Stream raw JSONL events instead of just the final answer.
      --skip-git-check   Allow running outside a git repository.
  -h, --help             Show this help.

Codex streams progress to stderr and prints its final answer to stdout.
Each call is independent — run several in parallel safely.`;

function fail(msg) {
  process.stderr.write(`codex-run: ${msg}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = {
    model: null,
    effort: null,
    cd: null,
    sandbox: "read-only",
    approval: null,
    resume: null,
    json: false,
    skipGitCheck: false,
    promptParts: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) fail(`missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case "-h":
      case "--help":
        process.stdout.write(`${HELP}\n`);
        process.exit(0);
        break;
      case "-m":
      case "--model":
        opts.model = next();
        break;
      case "-e":
      case "--effort":
        opts.effort = next();
        break;
      case "-C":
      case "--cd":
        opts.cd = next();
        break;
      case "-s":
      case "--sandbox":
        opts.sandbox = next();
        break;
      case "-w":
      case "--writable":
        opts.sandbox = "workspace-write";
        break;
      case "-a":
      case "--approval":
        opts.approval = next();
        break;
      case "--resume":
        opts.resume = next();
        break;
      case "--json":
        opts.json = true;
        break;
      case "--skip-git-check":
        opts.skipGitCheck = true;
        break;
      case "--":
        opts.promptParts.push(...argv.slice(i + 1));
        i = argv.length;
        break;
      default:
        if (arg.startsWith("-") && arg !== "-") fail(`unknown option: ${arg}`);
        opts.promptParts.push(arg);
    }
  }
  if (!SANDBOX_MODES.has(opts.sandbox)) {
    fail(`invalid --sandbox '${opts.sandbox}' (expected: ${[...SANDBOX_MODES].join(", ")})`);
  }
  if (opts.effort && !EFFORT_LEVELS.has(opts.effort)) {
    fail(`invalid --effort '${opts.effort}' (expected: ${[...EFFORT_LEVELS].join(", ")})`);
  }
  if (opts.approval && !APPROVAL_POLICIES.has(opts.approval)) {
    fail(`invalid --approval '${opts.approval}' (expected: ${[...APPROVAL_POLICIES].join(", ")})`);
  }
  return opts;
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

function buildCodexArgs(opts, prompt) {
  const args = ["exec"];
  // `resume <id>` puts the session id in the first positional slot; the prompt
  // stays the trailing positional, so the flags in between are unambiguous.
  if (opts.resume) args.push("resume", opts.resume);
  // Drive sandbox/approval/effort via `-c key=value`: these overrides are valid
  // on both `codex exec` and `codex exec resume`, whereas the `-s`/`-a`/`-C`
  // flags are not all accepted by the resume subcommand.
  args.push("-c", `sandbox_mode=${opts.sandbox}`);
  if (opts.approval) args.push("-c", `approval_policy=${opts.approval}`);
  if (opts.effort) args.push("-c", `model_reasoning_effort=${opts.effort}`);
  if (opts.model) args.push("-m", opts.model);
  // --cd only applies to a fresh session; a resumed session keeps its own cwd.
  if (opts.cd && !opts.resume) args.push("-C", opts.cd);
  if (opts.skipGitCheck) args.push("--skip-git-repo-check");
  if (opts.json) args.push("--json");
  args.push(prompt);
  return args;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let prompt = opts.promptParts.join(" ").trim();
  if (!prompt) prompt = await readStdin();
  if (!prompt) fail("no prompt provided (pass it as an argument or pipe it via stdin)");

  // stdout stays clean (Codex's answer, or raw JSONL). stderr is piped so we can
  // pass progress through live AND scan the banner for the session id, then print
  // a one-line resume hint at the end.
  const child = spawn("codex", buildCodexArgs(opts, prompt), {
    stdio: ["ignore", "inherit", "pipe"],
  });

  let sessionId = null;
  let scanBuffer = "";
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    if (sessionId || scanBuffer.length > 65536) return;
    scanBuffer += chunk.toString("utf8");
    const match = scanBuffer.match(SESSION_ID_RE);
    if (match) sessionId = match[1];
  });

  child.on("error", (err) => {
    if (err.code === "ENOENT") {
      fail("`codex` not found on PATH. Install it with `npm i -g @openai/codex` and run `codex login`.");
    }
    fail(`failed to launch codex: ${err.message}`);
  });
  child.on("close", (code, signal) => {
    if (sessionId && !opts.json) {
      process.stderr.write(`\n[codex-bridge] session ${sessionId} — resume: --resume ${sessionId} "<next prompt>"\n`);
    }
    if (signal) {
      process.stderr.write(`codex-run: codex terminated by signal ${signal}\n`);
      process.exit(1);
    }
    process.exit(code ?? 0);
  });
}

main().catch((err) => fail(err?.stack || String(err)));

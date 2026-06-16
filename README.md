# codex-bridge

Call **OpenAI Codex** (gpt-5.x) from **Claude Code** — a clean, dependency-free
plugin built around a single primitive: `codex exec`.

It exists because the official [`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc)
wraps the experimental `codex app-server` protocol behind a broker that
serializes calls to **one Codex at a time**. This rebuild drops all of that.

## Why `codex exec` is enough

Codex has one shared engine (`codex-core`). Every surface is a facade over it:

```text
@openai/codex-sdk ──spawns──> codex exec ──boots──> in-process app-server ──> codex-core
codex (TUI) ─────────────────────────────────────> in-process app-server ──> codex-core
codex app-server ────────────────────────────────> codex-core   (the full protocol, lid off)
codex mcp-server ────────────────────────────────> codex-core   (parallel, exposes 2 tools)
```

So `codex exec` runs the **identical** agent/turn engine as the full
`codex app-server` — it just exposes a one-shot slice. The only things
`app-server` adds that `exec` does not are **token-level streaming**,
**mid-turn interactive approvals**, **steer/interrupt**, and **thread
fork/rollback/compact**. If you don't need those, `exec` is the same result
with none of the ceremony.

And because each `codex exec` is its own OS process, **concurrency is free** —
run as many as you want at once. There is no lock to bypass.

## Requirements

- [Codex CLI](https://developers.openai.com/codex) on your `PATH`
  (`npm i -g @openai/codex`), authenticated via `codex login`.
- Node.js ≥ 18.

## Install as a Claude Code plugin

Point Claude Code at this directory as a plugin (it auto-discovers the
`/codex` command and the `codex-runner` skill). Inside Claude Code:

- **`/codex <prompt>`** — delegate a task or question to Codex and get its answer.
- The **`codex-runner`** skill lets Claude delegate to Codex on its own,
  including running several Codex instances in parallel.

## Use the runner directly

```bash
# Ask Codex a question about the current repo (read-only)
node scripts/codex-run.mjs "Explain how auth is wired in this repo"

# Let Codex make changes
node scripts/codex-run.mjs --writable "Fix the failing test in tests/auth_test.py"

# Pick a model and effort; pipe the prompt in
echo "Review this diff for bugs" | node scripts/codex-run.mjs -m gpt-5.5 -e high

# Continue a previous Codex session.
# Every run prints a resume hint to stderr, e.g.:
#   [codex-bridge] session 019ec... — resume: --resume 019ec... "<next prompt>"
node scripts/codex-run.mjs --resume <session-id> "Now add tests for that fix"

# Raw event stream (JSONL) for progress / capturing the session id
node scripts/codex-run.mjs --json "Summarize the README"
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `-m, --model <id>` | account default | Model id |
| `-e, --effort <level>` | — | `minimal\|low\|medium\|high\|xhigh` |
| `-C, --cd <dir>` | cwd | Working root for Codex |
| `-s, --sandbox <mode>` | `read-only` | `read-only\|workspace-write\|danger-full-access` |
| `-w, --writable` | — | Shortcut for `--sandbox workspace-write` |
| `-a, --approval <pol>` | Codex default | `untrusted\|on-failure\|on-request\|never` |
| `--resume <id>` | — | Continue a prior session by id |
| `--json` | — | Stream raw JSONL events |
| `--skip-git-check` | — | Allow running outside a git repo |

Codex streams progress to **stderr** and prints its final answer to **stdout**.

## Design notes

- **Safe by default:** read-only sandbox; opt into writes explicitly.
- **No state, no daemon:** the runner spawns `codex exec` and exits. Session
  continuity is delegated to Codex's own `resume`.
- **Roadmap:** if live streaming / interactive approvals / cancel become
  needed, that's the one reason to build a thin `codex app-server` client —
  layered on top, never a broker.

## License

MIT

---
name: codex-runner
description: Use to delegate a coding or analysis task to OpenAI Codex (gpt-5.x) from Claude Code — for a second opinion, an independent implementation or diagnosis pass, or to parallelize work across multiple Codex instances. Trigger when the user asks to "run Codex", "ask Codex", "use Codex", get a Codex review, or hand a task to Codex.
---

# Codex runner

Invoke OpenAI Codex through the bundled runner. Each call is an independent
`codex exec` process driving the same `codex-core` engine as the full Codex
app-server — so you may run **several concurrently** (multiple Bash calls in one
message). There is no shared broker and no single-instance lock to work around.

## Invoke

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-run.mjs" [options] "<prompt>"
```

The prompt may be an argument or piped via stdin.

Options:
- `-C, --cd <dir>`      Working root for Codex. Usually pass the repo root.
- `-s, --sandbox <m>`   `read-only` (default) | `workspace-write` | `danger-full-access`.
- `-w, --writable`      Shortcut for `--sandbox workspace-write` (Codex may edit files in the working dir).
- `-m, --model <id>`    Model id (omit to use the account default).
- `-e, --effort <l>`    Reasoning effort: `minimal|low|medium|high|xhigh`.
- `--resume <id>`       Continue a prior Codex session by id.
- `--json`              Stream raw JSONL events (progress + session id) instead of just the final answer.
- `--skip-git-check`    Allow running outside a git repository.

## Rules

- **Default to read-only** for analysis, review, and diagnosis. Only add
  `--writable` when the task is explicitly to change files, and tell the user
  Codex will be editing their working tree.
- Codex prints progress to stderr and its **final answer to stdout**. Relay that
  answer attributed to Codex; never present Codex's edits or claims as your own,
  and surface anything you disagree with.
- **Fan out for independent work:** launch multiple runners in parallel (one Bash
  message, several calls), then synthesize the results yourself.
- If `codex` is missing, tell the user to run `npm i -g @openai/codex` and
  `codex login`.

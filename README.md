<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/looper-logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="./assets/looper-logo-light.png">
    <img alt="Looper" src="./assets/looper-logo-light.png" height="160" style="margin-bottom: 20px;">
  </picture>
</div>

<p align="center">
  <a href="https://www.npmjs.com/package/@0xtiby/looper"><img src="https://img.shields.io/npm/v/@0xtiby/looper" alt="npm version"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@0xtiby/looper" alt="license"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@0xtiby/looper" alt="node engine"></a>
  <a href="https://github.com/0xtiby/looper/actions/workflows/release.yml"><img src="https://github.com/0xtiby/looper/actions/workflows/release.yml/badge.svg" alt="CI status"></a>
</p>

## What Is Looper v2?

**Looper v2** is an ACP-native runtime for repeatedly invoking an **Agent**
against a prompt until a **Sentinel** ends the **Run**.

1. You give Looper a prompt and pick an **Agent** (`claude`, `codex`,
   `opencode`, or `pi`).
2. Looper executes the **Agent**, streams its output, and watches for a
   sentinel string in **assistant text**.
3. It starts a new ACP conversation each iteration until the sentinel
   fires, `maxIterations` is reached, or the Agent exits non-zero.

Looper is **stateless** — every iteration is a fresh spawn with no shared
conversation state. It has no opinions about specs, plans, trackers, git, or
project structure. The prompt is the instruction.

Under the hood, Looper drives Agents via [`@0xtiby/spawner`](https://github.com/0xtiby/spawner).

## Prerequisites

- Node.js **20+**
- At least one supported Agent installed and authenticated:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
  - [Codex CLI](https://github.com/openai/codex) (`codex`)
  - [OpenCode](https://github.com/sst/opencode) (`opencode`)
  - [pi](https://github.com/0xtiby/pi) (`pi`)

## Quick start

1. Install the package:

   ```sh
   pnpm add @0xtiby/looper
   # or: npm install @0xtiby/looper
   ```

2. Initialize `.looper/config.json` and pick a default Agent:

   ```sh
   looper init
   ```

3. Run a loop with an inline prompt:

   ```sh
   looper run -p "Refactor src/auth to remove dead code. Emit :::LOOPER_DONE::: when finished."
   ```

The package ships both a `looper` binary and a library
(`import { loop } from "@0xtiby/looper"`). Both ESM and CommonJS are
supported.

## CLI

### `looper init`

Creates `.looper/config.json`. In a TTY, presents an **Init picker** that
lists **Compatible Agents** first. In non-TTY mode, pass `--agent <id>`
explicitly.

### `looper agents`

Lists discovered Agents with **Agent metadata** and **Capability summary**.
Each row shows the **Agent id**, display name, status, compatibility, and
capabilities. **Compatible Agents** (AFK-safe) are shown first, followed by
incompatible or unavailable ones.

```sh
looper agents       # human-friendly listing
looper agents --json # detailed ACP metadata as JSON
```

### `looper run`

Runs a loop. Exits `0` on clean completion, non-zero on Agent error, and `130`
on SIGINT (Ctrl+C).

```sh
# Inline prompt, or a path to a file (auto-detected)
looper run -p ./plan.md --agent claude --max-iterations 5

# Or pipe in
cat plan.md | looper run --prompt-stdin
```

| Flag | Description |
| --- | --- |
| `-p, --prompt <value>` | Inline string OR path to an existing file (auto-detected). |
| `--prompt-stdin` | Read the prompt from stdin. |
| `--agent <id>` | One of `claude`, `codex`, `opencode`, `pi`. Overrides config. |
| `--model <name>` | Model override (e.g. `opus`, `sonnet`). |
| `--max-iterations <n>` | Cap the number of iterations. |
| `--sentinel <string>` | String the Agent must emit to stop the loop. |
| `--cwd <path>` | Working directory passed to the spawned Agent. |
| `--var KEY=VALUE` | Template variable (repeatable — see [Template variables](#template-variables)). |

### `looper resume`

Lists **Non-complete runs** or continues one from the next iteration.

```sh
looper resume           # lists non-complete runs
looper resume <run-id>  # resumes the specific run
```

Resume reuses the stored **Resolved prompt**, Agent, and model and runs the
remaining iterations (up to `maxIterations`). New iterations are appended to
both the run JSON and the transcript log. You may supply `--agent` or `--model`
to apply a **Resume override** without changing the configured default.

### `looper inspect`

Shows persisted context and full **Resume history** for a run.

```sh
looper inspect <run-id>
```

### `looper config`

Prints the resolved config (defaults merged with your file).

## Library usage

### Basic

```ts
import { loop } from "@0xtiby/looper";

const result = await loop({
  agent: "claude",
  prompt: `
    1. Run: gh issue list --repo {{REPO}} --state open --json
    2. Pick the next unblocked issue labeled "ready".
    3. Implement it: write code, tests, commit, open a PR,
    4. Exit.
    When no unblocked issues remain, emit :::DONE:::
  `.trim(),
  cwd: process.cwd(),
  maxIterations: 20,
  sentinel: ":::DONE:::",
  vars: { REPO: "0xtiby/looper" },
});

console.log(result.stopReason); // "sentinel" | "max_iterations" | "error" | "aborted"
```

The library is **stateless** and does no file I/O. Callers own persistence;
the `looper` CLI is a thin consumer of the library.

### All options

```ts
import { loop } from "@0xtiby/looper";

const result = await loop({
  agent: "claude",
  prompt: "Fix the failing tests. Emit :::DONE::: when finished.",
  cwd: process.cwd(),
  model: "opus",
  maxIterations: 5,
  sentinel: ":::DONE:::",
  vars: { PROJECT: "my-app" },
  onOutput: (chunk) => process.stdout.write(chunk),
  signal: AbortSignal.timeout(60_000),
});
```

#### `LoopOptions`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `agent` | `"claude" \| "codex" \| "opencode" \| "pi"` | — | **Required.** The Agent to execute. |
| `prompt` | `string` | — | **Required.** Prompt string passed to the Agent. |
| `cwd` | `string` | `process.cwd()` | Working directory for the spawned Agent. |
| `model` | `string` | — | Model override (e.g. `opus`, `sonnet`). |
| `maxIterations` | `number` | `10` | Hard cap on iterations. |
| `sentinel` | `string` | `":::LOOPER_DONE:::"` | String the Agent must emit to end the loop. |
| `vars` | `Record<string, string>` | `{}` | Template variables for `{{KEY}}` substitution. |
| `onOutput` | `(chunk: string) => void` | — | Streaming callback for raw Agent stdout. |
| `signal` | `AbortSignal` | — | Aborts the loop between or during iterations. |

#### `LoopResult`

| Field | Type | Description |
| --- | --- | --- |
| `iterations` | `IterationResult[]` | Per-iteration records, in order. |
| `stopReason` | `StopReason` | `"sentinel" \| "max_iterations" \| "error" \| "aborted"`. |

#### `IterationResult`

| Field | Type | Description |
| --- | --- | --- |
| `number` | `number` | 1-indexed iteration number. |
| `exitCode` | `number` | Exit code of the spawned Agent. |
| `sentinelDetected` | `boolean` | Whether the sentinel was observed in assistant text. |
| `stdout` | `string` | Full captured stdout for the iteration. |
| `startedAt` | `string` | ISO timestamp. |
| `durationMs` | `number` | Wall-clock duration. |
| `tokensIn` | `number` | Input tokens reported by the Agent. |
| `tokensOut` | `number` | Output tokens reported by the Agent. |

## Template variables

Prompts can reference `{{VAR}}` placeholders. Substitution is flat (values are
not themselves re-substituted). Unknown placeholders are left as-is.

Built-in variables:

| Name | Value |
| --- | --- |
| `ITERATION` | Current iteration number (1-indexed). |
| `MAX_ITERATIONS` | Configured `maxIterations`. |
| `RUN_ID` | UUID of the run (CLI only). |

Precedence (higher wins): `--var KEY=VALUE` CLI flag → config `vars` →
built-in.

## Config (`.looper/config.json`)

```json
{
  "agent": "claude",
  "model": "opus",
  "maxIterations": 10,
  "sentinel": ":::LOOPER_DONE:::",
  "vars": {}
}
```

All fields are optional. Missing fields fall back to the defaults shown above.
CLI flags on `looper run` override the resolved config.

## Runs

Each `looper run` (and `resume`) writes two files under `.looper/runs/`:

- `<short-id>_<timestamp>.json` — run metadata, per-iteration metrics, and
  **Resume history**.
- `<short-id>_<timestamp>.log` — raw Agent stdout, separated by
  `--- ITERATION N [ISO_TIMESTAMP] ---` markers.

Run state machine: `active` → `completed | interrupted`. Run files are never
auto-deleted.

Example run JSON:

```json
{
  "id": "…",
  "prompt": "./plan.md",
  "agent": "claude",
  "model": "opus",
  "maxIterations": 10,
  "state": "completed",
  "startedAt": "2026-04-16T18:00:00.000Z",
  "completedAt": "2026-04-16T18:07:42.000Z",
  "stopReason": "sentinel",
  "iterations": [
    {
      "number": 1,
      "exitCode": 0,
      "durationMs": 45000,
      "tokensIn": 8000,
      "tokensOut": 12000,
      "sentinelDetected": true
    }
  ]
}
```

## Migrating from v1

Looper v2 is a **hard break** from the v1 runtime. The codebase, config, and
CLI vocabulary have moved from spawned-CLI concepts to ACP-native concepts.

Key changes when migrating:

- Config field `cli` is replaced by `agent`. V1 configs fail fast with an
  explicit error — update `.looper/config.json` to use `agent`.
- The top-level execution record is now called a **Run**.
  Persisted files live under `.looper/runs/` (v1 used a different path).
- The default **Sentinel** remains `:::LOOPER_DONE:::`, but it now only
  triggers on **Assistant text**, not on tool output or errors.
- Each iteration starts a new ACP conversation with no carried state
  between iterations.
- **Resume** is available for any **Non-complete run**, not only interrupted
  ones. **Complete runs** are terminal.

For the full v1 documentation, see [`docs/v1/README.md`](./docs/v1/README.md).

## Pi integration

If you use [pi](https://github.com/mariozechner/pi), looper ships a built-in
extension for fire-and-forget background runs inside Zellij panes or tmux
contexts.

Install looper as a pi package:

```sh
pi install git:github.com/0xtiby/looper
```

Then in pi:

```
/looper-run
```

This opens an interactive wizard that walks you through picking a prompt (from
`.looper/*.md` or writing a new one), choosing the Agent, and spawning looper
in a background pane while you keep chatting with pi.

The LLM can also call the `looper_run` tool directly:

```json
{
  "name": "looper_run",
  "parameters": {
    "prompt": "Refactor auth module. Emit :::LOOPER_DONE::: when finished.",
    "cli": "claude",
    "maxIterations": 5
  }
}
```

**Features**
- Auto-detects Zellij (preferred) or tmux
- Scans `.looper/*.md` for reusable prompts
- Zellij: pane direction and floating mode support
- tmux: new detached contexts

## License

MIT

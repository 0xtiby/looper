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

## What Is Looper?

A standalone engine for looping an AI coding CLI against a prompt until it signals it's done:

1. You give Looper a prompt and pick a CLI (`claude`, `codex`, or `opencode`).
2. Looper spawns the CLI, streams its output, and watches for a sentinel string.
3. It re-spawns from scratch each iteration until the sentinel fires, `maxIterations` is reached, or the CLI exits non-zero.

Looper is **stateless** — every iteration is a fresh spawn with no shared conversation state. It has no opinions about specs, plans, trackers, git, or project structure. The prompt is the instruction.

Under the hood, Looper drives the CLIs via [`@0xtiby/spawner`](https://github.com/0xtiby/spawner).

## Prerequisites

- Node.js **20+**
- At least one supported AI CLI installed and authenticated:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
  - [Codex CLI](https://github.com/openai/codex) (`codex`)
  - [OpenCode](https://github.com/sst/opencode) (`opencode`)

## Quick start

1. Install the package:

   ```sh
   pnpm add @0xtiby/looper
   # or: npm install @0xtiby/looper
   ```

2. Scaffold a `.looper/config.json` with sensible defaults:

   ```sh
   looper init
   ```

3. Run a loop with an inline prompt:

   ```sh
   looper run -p "Refactor src/auth to remove dead code. Emit :::LOOPER_DONE::: when finished."
   ```

The package ships both a `looper` binary and a library (`import { loop } from "@0xtiby/looper"`). Both ESM and CommonJS are supported.

## CLI

### `looper init`

Creates `.looper/config.json` populated with the built-in defaults.

### `looper config`

Prints the resolved config (defaults merged with your file).

### `looper run`

Runs a loop. Exits `0` on clean completion, non-zero on CLI error, and `130` on SIGINT (Ctrl+C).

```sh
# Inline prompt, or a path to a file (auto-detected)
looper run -p ./plan.md --cli claude --max-iterations 5

# Or pipe in
cat plan.md | looper run --prompt-stdin
```

| Flag | Description |
| --- | --- |
| `-p, --prompt <value>` | Inline string OR path to an existing file (auto-detected). |
| `--prompt-stdin` | Read the prompt from stdin. |
| `--cli <name>` | One of `claude`, `codex`, `opencode`. Overrides config. |
| `--model <name>` | Model override (e.g. `opus`, `sonnet`). |
| `--max-iterations <n>` | Cap the number of iterations. |
| `--sentinel <string>` | String the AI must emit to stop the loop. |
| `--cwd <path>` | Working directory passed to the spawned CLI. |
| `--var KEY=VALUE` | Template variable (repeatable — see [Template variables](#template-variables)). |

### `looper resume`

If a session is aborted with Ctrl+C, the session file is marked `interrupted`. Continue it with:

```sh
looper resume              # lists interrupted sessions
looper resume <session-id> # resumes the specific session
```

Resume reuses the original prompt, CLI, and model and runs the remaining iterations (up to `maxIterations`). New iterations are appended to both the session JSON and the transcript log. Stdin-origin prompts cannot be resumed.

## Library usage

### Basic

```ts
import { loop } from "@0xtiby/looper";

const result = await loop({
  cli: "claude",
  prompt: `
    1. Run: gh issue list --repo {{REPO}} --state open --json
    2. Pick the next unblocked issue labeled "ready".
    3. Implement it: write code, tests, commit, open a PR,
    4. Exit.
    When no unblocked issues remain, emit :::DONE:::
  `.trim(),
  cwd: process.cwd(),
  maxIterations: 20,
});

console.log(result.stopReason); // "sentinel" | "max_iterations" | "error" | "aborted"
```

The library is **stateless** and does no file I/O. Callers own persistence; the `looper` CLI is a thin consumer of the library.

### All options

```ts
import { loop } from "@0xtiby/looper";

const result = await loop({
  cli: "claude",
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
| `cli` | `"claude" \| "codex" \| "opencode"` | — | **Required.** The AI CLI to spawn. |
| `prompt` | `string` | — | **Required.** Prompt string passed to the CLI. |
| `cwd` | `string` | `process.cwd()` | Working directory for the spawned CLI. |
| `model` | `string` | — | Model override (e.g. `opus`, `sonnet`). |
| `maxIterations` | `number` | `10` | Hard cap on iterations. |
| `sentinel` | `string` | `":::LOOPER_DONE:::"` | String the CLI must emit to end the loop. |
| `vars` | `Record<string, string>` | `{}` | Template variables for `{{KEY}}` substitution. |
| `onOutput` | `(chunk: string) => void` | — | Streaming callback for raw CLI stdout. |
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
| `exitCode` | `number` | Exit code of the spawned CLI. |
| `sentinelDetected` | `boolean` | Whether the sentinel was observed in stdout. |
| `stdout` | `string` | Full captured stdout for the iteration. |
| `startedAt` | `string` | ISO timestamp. |
| `durationMs` | `number` | Wall-clock duration. |
| `tokensIn` | `number` | Input tokens reported by the CLI. |
| `tokensOut` | `number` | Output tokens reported by the CLI. |

## Template variables

Prompts can reference `{{VAR}}` placeholders. Substitution is flat (values are not themselves re-substituted). Unknown placeholders are left as-is.

Built-in variables:

| Name | Value |
| --- | --- |
| `ITERATION` | Current iteration number (1-indexed). |
| `MAX_ITERATIONS` | Configured `maxIterations`. |
| `SESSION_ID` | UUID of the session (CLI only). |

Precedence (higher wins): `--var KEY=VALUE` CLI flag → config `vars` → built-in.

## Config (`.looper/config.json`)

```json
{
  "cli": "claude",
  "model": "opus",
  "maxIterations": 10,
  "sentinel": ":::LOOPER_DONE:::",
  "vars": {}
}
```

All fields are optional. Missing fields fall back to the defaults shown above. CLI flags on `looper run` override the resolved config.

## Sessions

Each `looper run` (and `resume`) writes two files under `.looper/sessions/<uuid>`:

- `<uuid>.json` — session metadata and per-iteration metrics.
- `<uuid>.log` — raw CLI stdout, separated by `--- ITERATION N [ISO_TIMESTAMP] ---` markers.

Session state machine: `active` → `completed | interrupted`. Session files are never auto-deleted.

Example session JSON:

```json
{
  "id": "…",
  "prompt": "./plan.md",
  "cli": "claude",
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

## License

MIT

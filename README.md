# @0xtiby/looper

Standalone AI loop orchestration engine.

Looper spawns an AI CLI (`claude`, `codex`, or `opencode` via [`@0xtiby/spawner`](https://github.com/0xtiby/spawner)) against a prompt and iterates until a configurable sentinel string appears in the output, `maxIterations` is reached, or the CLI exits non-zero. Each iteration is a fresh spawn — there is no shared conversation state between runs.

Looper has no opinions about specs, plans, trackers, git, or project structure. The prompt is the instruction.

## Install

```sh
pnpm add @0xtiby/looper
# or: npm install @0xtiby/looper
```

The package ships both a `looper` binary and a library (`import { loop } from "@0xtiby/looper"`). Both ESM and CommonJS are supported.

## CLI quickstart

```sh
# Create .looper/config.json with defaults.
looper init

# See the resolved config (defaults + your file).
looper config

# Run a loop with an inline prompt.
looper run -p "Refactor src/auth to remove dead code. Emit :::LOOPER_DONE::: when finished."

# Or point at a prompt file.
looper run -p ./plan.md --cli claude --max-iterations 5

# Or pipe a prompt in.
cat plan.md | looper run --prompt-stdin
```

### `looper run` flags

| Flag | Description |
| --- | --- |
| `-p, --prompt <value>` | Inline string OR path to an existing file (auto-detected). |
| `--prompt-stdin` | Read the prompt from stdin. |
| `--cli <name>` | One of `claude`, `codex`, `opencode`. Overrides config. |
| `--model <name>` | Model override (e.g. `opus`, `sonnet`). |
| `--max-iterations <n>` | Cap the number of iterations. |
| `--sentinel <string>` | String the AI must emit to stop the loop. |
| `--cwd <path>` | Working directory passed to the spawned CLI. |
| `--var KEY=VALUE` | Template variable (repeatable, see below). |

`looper run` exits `0` on clean completion, non-zero on CLI error, and `130` on SIGINT (Ctrl+C), mirroring the convention for signal-aborted programs.

### Resuming

If a session is aborted with Ctrl+C, the session file is marked `interrupted`. Continue it with:

```sh
looper resume              # lists interrupted sessions
looper resume <session-id> # resumes the specific session
```

Resume reuses the original prompt, CLI, and model and runs the remaining iterations (up to `maxIterations`). New iterations are appended to both the session JSON and the transcript log. Stdin-origin prompts cannot be resumed.

## Library usage

```ts
import { loop } from "@0xtiby/looper";

const result = await loop({
  cli: "claude",
  prompt: "Fix the failing tests. Emit :::DONE::: when finished.",
  cwd: process.cwd(),
  maxIterations: 5,
  sentinel: ":::DONE:::",
  vars: { PROJECT: "my-app" },
  onOutput: (chunk) => process.stdout.write(chunk),
  signal: AbortSignal.timeout(60_000),
});

console.log(result.stopReason); // "sentinel" | "max_iterations" | "error" | "aborted"
for (const iter of result.iterations) {
  console.log(iter.number, iter.exitCode, iter.durationMs, iter.sentinelDetected);
}
```

### Exported types

- `LoopOptions` — parameters for `loop()`.
- `LoopResult` — `{ iterations: IterationResult[]; stopReason: StopReason }`.
- `IterationResult` — per-iteration record: `number`, `exitCode`, `sentinelDetected`, `stdout`, `startedAt`, `durationMs`, `tokensIn`, `tokensOut`.
- `StopReason` — `"sentinel" | "max_iterations" | "error" | "aborted"`.

The library is **stateless** and does no file I/O. Callers own persistence; the `looper` CLI is a thin consumer of the library.

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

## Session files

Each `looper run` (and `resume`) writes two files alongside each other under `.looper/sessions/<uuid>`:

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

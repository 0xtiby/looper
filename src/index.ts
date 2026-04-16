import type { CliName, CliProcess, SpawnOptions } from "@0xtiby/spawner";
import { spawn as spawnCli } from "@0xtiby/spawner";
import { substitute } from "./template.js";

export type LoopStopReason =
  | "sentinel"
  | "max_iterations"
  | "error"
  | "aborted";

export interface LoopIteration {
  number: number;
  exitCode: number;
  sentinelDetected: boolean;
  stdout: string;
  startedAt: string;
  durationMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
}

export interface LoopResult {
  iterations: LoopIteration[];
  stopReason: LoopStopReason;
}

export interface LoopOptions {
  cli: CliName;
  prompt: string;
  cwd: string;
  maxIterations?: number;
  sentinel?: string;
  vars?: Record<string, string>;
  sessionId?: string;
  signal?: AbortSignal;
  startIteration?: number;
  onOutput?: (chunk: string) => void;
}

export type Spawner = (options: SpawnOptions) => CliProcess;

export interface LoopDeps {
  spawn?: Spawner;
}

const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_SENTINEL = ":::LOOPER_DONE:::";

export async function loop(
  options: LoopOptions,
  deps: LoopDeps = {},
): Promise<LoopResult> {
  const spawnFn = deps.spawn ?? spawnCli;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const sentinel = options.sentinel ?? DEFAULT_SENTINEL;
  const iterations: LoopIteration[] = [];

  const startIteration = options.startIteration ?? 1;
  for (let number = startIteration; number <= maxIterations; number++) {
    if (options.signal?.aborted) {
      return { iterations, stopReason: "aborted" };
    }
    const prompt = substitute(
      options.prompt,
      buildVars(number, maxIterations, options.sessionId, options.vars),
    );
    const iteration = await runIteration(
      spawnFn,
      {
        cli: options.cli,
        prompt,
        cwd: options.cwd,
      },
      {
        sentinel,
        number,
        onOutput: options.onOutput,
        signal: options.signal,
      },
    );
    iterations.push(iteration);
    if (options.signal?.aborted) {
      return { iterations, stopReason: "aborted" };
    }
    if (iteration.sentinelDetected) {
      return { iterations, stopReason: "sentinel" };
    }
    if (iteration.exitCode !== 0) {
      return { iterations, stopReason: "error" };
    }
  }
  return { iterations, stopReason: "max_iterations" };
}

interface IterationContext {
  sentinel: string;
  number: number;
  onOutput?: (chunk: string) => void;
  signal?: AbortSignal;
}

function buildVars(
  iteration: number,
  maxIterations: number,
  sessionId: string | undefined,
  userVars: Record<string, string> | undefined,
): Record<string, string> {
  const builtIns: Record<string, string> = {
    ITERATION: String(iteration),
    MAX_ITERATIONS: String(maxIterations),
  };
  if (sessionId !== undefined) builtIns.SESSION_ID = sessionId;
  return { ...builtIns, ...(userVars ?? {}) };
}

async function runIteration(
  spawnFn: Spawner,
  spawnOptions: SpawnOptions,
  ctx: IterationContext,
): Promise<LoopIteration> {
  const startedAt = new Date().toISOString();
  const proc = spawnFn(spawnOptions);
  const onAbort = () => {
    proc.interrupt().catch(() => {});
  };
  if (ctx.signal) {
    if (ctx.signal.aborted) onAbort();
    else ctx.signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    let stdout = "";
    let sentinelDetected = false;
    for await (const event of proc.events) {
      if (event.type !== "text" || typeof event.content !== "string") continue;
      stdout += event.content;
      ctx.onOutput?.(event.content);
      if (!sentinelDetected && stdout.includes(ctx.sentinel)) {
        sentinelDetected = true;
      }
    }
    const result = await proc.done;
    return {
      number: ctx.number,
      exitCode: result.exitCode,
      sentinelDetected,
      stdout,
      startedAt,
      durationMs: result.durationMs,
      tokensIn: result.usage?.inputTokens ?? null,
      tokensOut: result.usage?.outputTokens ?? null,
    };
  } finally {
    ctx.signal?.removeEventListener("abort", onAbort);
  }
}

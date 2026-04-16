import type { CliName, CliProcess, SpawnOptions } from "@0xtiby/spawner";
import { spawn as spawnCli } from "@0xtiby/spawner";

export type LoopStopReason = "sentinel" | "max_iterations" | "error";

export interface LoopIteration {
  number: number;
  exitCode: number;
  sentinelDetected: boolean;
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

  for (let number = 1; number <= maxIterations; number++) {
    const iteration = await runIteration(
      spawnFn,
      {
        cli: options.cli,
        prompt: options.prompt,
        cwd: options.cwd,
      },
      sentinel,
      number,
    );
    iterations.push(iteration);
    if (iteration.sentinelDetected) {
      return { iterations, stopReason: "sentinel" };
    }
    if (iteration.exitCode !== 0) {
      return { iterations, stopReason: "error" };
    }
  }
  return { iterations, stopReason: "max_iterations" };
}

async function runIteration(
  spawnFn: Spawner,
  spawnOptions: SpawnOptions,
  sentinel: string,
  number: number,
): Promise<LoopIteration> {
  const proc = spawnFn(spawnOptions);
  let captured = "";
  let sentinelDetected = false;
  for await (const event of proc.events) {
    if (event.type !== "text" || typeof event.content !== "string") continue;
    captured += event.content;
    if (!sentinelDetected && captured.includes(sentinel)) {
      sentinelDetected = true;
    }
  }
  const result = await proc.done;
  return { number, exitCode: result.exitCode, sentinelDetected };
}

import type {
  CliName,
  CliProcess,
  CliResult,
  SpawnOptions,
} from "@0xtiby/spawner";
import { spawn as spawnCli } from "@0xtiby/spawner";

export type LoopStopReason = "max_iterations" | "error";

export interface LoopIteration {
  number: number;
  result: CliResult;
}

export interface LoopResult {
  iterations: LoopIteration[];
  stopReason: LoopStopReason;
}

export interface LoopOptions {
  cli: CliName;
  prompt: string;
  cwd: string;
}

export type Spawner = (options: SpawnOptions) => CliProcess;

export interface LoopDeps {
  spawn?: Spawner;
}

export async function loop(
  options: LoopOptions,
  deps: LoopDeps = {},
): Promise<LoopResult> {
  const spawnFn = deps.spawn ?? spawnCli;
  const proc = spawnFn({
    cli: options.cli,
    prompt: options.prompt,
    cwd: options.cwd,
  });
  const result = await proc.done;
  const stopReason: LoopStopReason =
    result.exitCode === 0 ? "max_iterations" : "error";
  return {
    iterations: [{ number: 1, result }],
    stopReason,
  };
}

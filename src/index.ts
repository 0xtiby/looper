import type {
  CliEvent,
  CliName,
  CliProcess,
  SpawnOptions,
} from "@0xtiby/spawner";
import { spawn as spawnCli } from "@0xtiby/spawner";
import { substitute } from "./template.js";

type TranscriptChunk =
  | { type: "raw"; text: string }
  | { type: "line"; text: string };

function transcriptChunkForEvent(event: CliEvent): TranscriptChunk | null {
  if (event.type === "text" && typeof event.content === "string") {
    return { type: "raw", text: event.content };
  }
  if (event.type === "error" && typeof event.content === "string") {
    return { type: "line", text: `[error] ${event.content}` };
  }
  if (event.type === "tool_result" && event.toolResult?.error) {
    return {
      type: "line",
      text: `[tool ${event.toolResult.name} error] ${event.toolResult.error}`,
    };
  }
  return null;
}

function appendTranscriptChunk(stdout: string, chunk: TranscriptChunk): string {
  if (chunk.type === "raw") return chunk.text;
  return lineChunk(stdout, chunk.text);
}

function lineChunk(stdout: string, text: string): string {
  const prefix = stdout.length > 0 && !stdout.endsWith("\n") ? "\n" : "";
  const suffix = text.endsWith("\n") ? "" : "\n";
  return `${prefix}${text}${suffix}`;
}

export type StopReason = "sentinel" | "max_iterations" | "error" | "aborted";

export interface IterationError {
  code: string;
  message: string;
  raw: string;
}

export interface IterationResult {
  number: number;
  exitCode: number;
  sentinelDetected: boolean;
  stdout: string;
  startedAt: string;
  durationMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  error: IterationError | null;
}

export interface LoopResult {
  iterations: IterationResult[];
  stopReason: StopReason;
}

export interface LoopOptions {
  agent: CliName;
  prompt: string;
  cwd: string;
  model?: string;
  maxIterations?: number;
  sentinel?: string;
  vars?: Record<string, string>;
  runId?: string;
  signal?: AbortSignal;
  startIteration?: number;
  autoApprove?: boolean;
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
  const iterations: IterationResult[] = [];

  const startIteration = options.startIteration ?? 1;
  for (let number = startIteration; number <= maxIterations; number++) {
    if (options.signal?.aborted) {
      return { iterations, stopReason: "aborted" };
    }
    const prompt = substitute(
      options.prompt,
      buildVars(number, maxIterations, options.runId, options.vars),
    );
    const iteration = await runIteration(
      spawnFn,
      {
        cli: options.agent,
        prompt,
        cwd: options.cwd,
        model: options.model,
        autoApprove: options.autoApprove ?? true,
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
  runId: string | undefined,
  userVars: Record<string, string> | undefined,
): Record<string, string> {
  const builtIns: Record<string, string> = {
    ITERATION: String(iteration),
    MAX_ITERATIONS: String(maxIterations),
  };
  if (runId !== undefined) builtIns.RUN_ID = runId;
  return { ...builtIns, ...(userVars ?? {}) };
}

async function runIteration(
  spawnFn: Spawner,
  spawnOptions: SpawnOptions,
  ctx: IterationContext,
): Promise<IterationResult> {
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
    let assistantText = "";
    let sentinelDetected = false;
    for await (const event of proc.events) {
      const transcriptChunk = transcriptChunkForEvent(event);
      if (transcriptChunk === null) continue;
      const chunk = appendTranscriptChunk(stdout, transcriptChunk);
      stdout += chunk;
      ctx.onOutput?.(chunk);
      if (event.type === "text") {
        assistantText += event.content ?? "";
        if (!sentinelDetected && assistantText.includes(ctx.sentinel)) {
          sentinelDetected = true;
        }
      }
    }
    const result = await proc.done;
    const error: IterationError | null = result.error
      ? {
          code: result.error.code,
          message: result.error.message,
          raw: result.error.raw,
        }
      : null;
    if (error && !stdout.includes(error.message)) {
      const line = lineChunk(stdout, `[${error.code}] ${error.message}`);
      stdout += line;
      ctx.onOutput?.(line);
    }
    return {
      number: ctx.number,
      exitCode: result.exitCode,
      sentinelDetected,
      stdout,
      startedAt,
      durationMs: result.durationMs,
      tokensIn: result.usage?.inputTokens ?? null,
      tokensOut: result.usage?.outputTokens ?? null,
      error,
    };
  } finally {
    ctx.signal?.removeEventListener("abort", onAbort);
  }
}

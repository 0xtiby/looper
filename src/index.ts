import type {
  CliEvent,
  CliName,
  CliProcess,
  SpawnOptions,
} from "@0xtiby/spawner";
import { spawn as spawnCli } from "@0xtiby/spawner";
import {
  type AcpAgentServerLaunch,
  type AcpClient,
  type AcpClientFactory,
  type AcpClientInput,
  AcpProtocolError,
  type AcpSession,
  type AcpSessionConfigOption,
  type AcpSessionEvent,
  createAcpStdioClient,
} from "./acp.js";
import { substitute } from "./template.js";

export type { AcpClient, AcpClientFactory } from "./acp.js";

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
  agent: string;
  agentServer?: AcpAgentServerLaunch;
  prompt: string;
  cwd: string;
  model?: string;
  mode?: string;
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
  createAcpClient?: AcpClientFactory;
}

class UnsupportedLegacyAgentError extends Error {
  constructor(agent: string) {
    super(`Agent "${agent}" requires an ACP Agent Server configuration.`);
    this.name = "UnsupportedLegacyAgentError";
  }
}

const SPAWNER_CLI_NAMES = [
  "claude",
  "codex",
  "opencode",
  "pi",
] satisfies CliName[];
const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_SENTINEL = ":::LOOPER_DONE:::";

class MissingAcpConfigOptionError extends Error {
  constructor(category: string, value: string) {
    super(
      `ACP session does not expose a ${category} config option for override "${value}".`,
    );
    this.name = "MissingAcpConfigOptionError";
  }
}

class UnsupportedAcpConfigOptionValueError extends Error {
  constructor(category: string, value: string, option: AcpSessionConfigOption) {
    super(
      `${capitalize(category)} override "${value}" is not supported by ACP config option "${option.id}". Supported values: ${option.values.join(", ")}.`,
    );
    this.name = "UnsupportedAcpConfigOptionValueError";
  }
}

export async function loop(
  options: LoopOptions,
  deps: LoopDeps = {},
): Promise<LoopResult> {
  const spawnFn = deps.spawn ?? spawnCli;
  const createAcpClient = deps.createAcpClient ?? createAcpStdioClient;
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
    const iteration = options.agentServer
      ? await runAcpIteration(
          createAcpClient,
          {
            server: options.agentServer,
            cwd: options.cwd,
          },
          prompt,
          {
            sentinel,
            number,
            onOutput: options.onOutput,
            signal: options.signal,
            configOverrides: acpConfigOverridesFromOptions(options),
          },
        )
      : await runIteration(
          spawnFn,
          {
            cli: toCliName(options.agent),
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

interface AcpConfigOverride {
  category: "model" | "mode";
  value: string;
}

interface IterationContext {
  sentinel: string;
  number: number;
  onOutput?: (chunk: string) => void;
  signal?: AbortSignal;
  configOverrides?: AcpConfigOverride[];
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

async function runAcpIteration(
  createAcpClient: AcpClientFactory,
  input: AcpClientInput,
  prompt: string,
  ctx: IterationContext,
): Promise<IterationResult> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const client = createAcpClient(input);
  let stdout = "";
  let assistantText = "";
  let sentinelDetected = false;
  try {
    await client.initialize();
    const session = await client.newSession({ cwd: input.cwd });
    const configuredSession = await applyAcpSessionConfigOverrides(
      client,
      session,
      ctx.configOverrides ?? [],
    );
    for await (const event of client.prompt({
      sessionId: configuredSession.sessionId,
      content: [{ type: "text", text: prompt }],
    })) {
      const chunk = acpTranscriptChunk(event);
      stdout += chunk;
      ctx.onOutput?.(chunk);
      if (event.type === "assistant_text") {
        assistantText += event.text;
        if (!sentinelDetected && assistantText.includes(ctx.sentinel)) {
          sentinelDetected = true;
        }
      }
    }
    return {
      number: ctx.number,
      exitCode: 0,
      sentinelDetected,
      stdout,
      startedAt,
      durationMs: Date.now() - startMs,
      tokensIn: null,
      tokensOut: null,
      error: null,
    };
  } catch (err) {
    const error = iterationErrorFromUnknown(err);
    const line = lineChunk(stdout, `[${error.code}] ${error.message}`);
    stdout += line;
    ctx.onOutput?.(line);
    return {
      number: ctx.number,
      exitCode: 1,
      sentinelDetected: false,
      stdout,
      startedAt,
      durationMs: Date.now() - startMs,
      tokensIn: null,
      tokensOut: null,
      error,
    };
  } finally {
    await client.close();
  }
}

function acpConfigOverridesFromOptions(
  options: LoopOptions,
): AcpConfigOverride[] {
  const overrides: AcpConfigOverride[] = [];
  if (options.model !== undefined) {
    overrides.push({ category: "model", value: options.model });
  }
  if (options.mode !== undefined) {
    overrides.push({ category: "mode", value: options.mode });
  }
  return overrides;
}

async function applyAcpSessionConfigOverrides(
  client: AcpClient,
  session: AcpSession,
  overrides: AcpConfigOverride[],
): Promise<AcpSession> {
  let currentSession = session;
  for (const override of overrides) {
    currentSession = await applyAcpSessionConfigOverride(
      client,
      currentSession,
      override,
    );
  }
  return currentSession;
}

async function applyAcpSessionConfigOverride(
  client: AcpClient,
  session: AcpSession,
  override: AcpConfigOverride,
): Promise<AcpSession> {
  const option = session.configOptions.find(
    (candidate) => candidate.category === override.category,
  );
  if (!option) {
    throw new MissingAcpConfigOptionError(override.category, override.value);
  }
  if (!option.values.includes(override.value)) {
    throw new UnsupportedAcpConfigOptionValueError(
      override.category,
      override.value,
      option,
    );
  }
  if (!client.setConfigOption) {
    throw new AcpProtocolError(
      "ACP client does not support session/set_config_option",
    );
  }
  const result = await client.setConfigOption({
    sessionId: session.sessionId,
    optionId: option.id,
    value: override.value,
  });
  return {
    ...session,
    configOptions:
      result.configOptions.length > 0
        ? result.configOptions
        : session.configOptions,
  };
}

function capitalize(value: string): string {
  const [first, ...rest] = value;
  if (first === undefined) return value;
  return `${first.toUpperCase()}${rest.join("")}`;
}

function acpTranscriptChunk(event: AcpSessionEvent): string {
  return event.text;
}

function iterationErrorFromUnknown(err: unknown): IterationError {
  if (err instanceof Error) {
    return {
      code: err.name || "ACP_ERROR",
      message: err.message,
      raw: err.stack ?? err.message,
    };
  }
  return {
    code: "ACP_ERROR",
    message: String(err),
    raw: String(err),
  };
}

function toCliName(agent: string): CliName {
  const match = SPAWNER_CLI_NAMES.find((name) => name === agent);
  if (match) return match;
  throw new UnsupportedLegacyAgentError(agent);
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

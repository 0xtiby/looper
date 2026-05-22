import { spawn as spawnProcess } from "node:child_process";
import type { Writable } from "node:stream";
import { z } from "zod";

export interface AcpAgentServerLaunch {
  type: "custom";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AcpClientInput {
  server: AcpAgentServerLaunch;
  cwd: string;
}

export interface AcpSessionInput {
  cwd: string;
}

export interface AcpSession {
  sessionId: string;
}

export interface AcpTextContent {
  type: "text";
  text: string;
}

export interface AcpPromptInput {
  sessionId: string;
  content: AcpTextContent[];
}

export type AcpSessionEvent =
  | { type: "assistant_text"; text: string }
  | { type: "transcript"; text: string };

export interface AcpClient {
  initialize(): Promise<void>;
  newSession(input: AcpSessionInput): Promise<AcpSession>;
  prompt(input: AcpPromptInput): AsyncIterable<AcpSessionEvent>;
  close(): Promise<void>;
}

export type AcpClientFactory = (input: AcpClientInput) => AcpClient;

export class AcpProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcpProtocolError";
  }
}

interface AcpProcess {
  stdin: Writable;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "exit", listener: (code: number | null) => void): void;
  once(event: "error", listener: (error: Error) => void): void;
}

interface SpawnAcpProcessOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

type SpawnAcpProcess = (
  command: string,
  args: string[],
  options: SpawnAcpProcessOptions,
) => AcpProcess;

const JsonRpcResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number()]),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.number(),
        message: z.string(),
      })
      .optional(),
  })
  .passthrough();

const JsonRpcNotificationSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    method: z.string(),
    params: z.unknown().optional(),
  })
  .passthrough();

const SessionNewResultSchema = z
  .object({
    sessionId: z.string().optional(),
    session_id: z.string().optional(),
  })
  .passthrough();

const SessionUpdateParamsSchema = z
  .object({
    sessionUpdate: z.string(),
    content: z
      .object({
        type: z.literal("text"),
        text: z.string(),
      })
      .optional(),
  })
  .passthrough();

interface PendingRequest {
  resolve(result: unknown): void;
  reject(error: Error): void;
}

type PromptWinner =
  | { type: "event"; result: IteratorResult<AcpSessionEvent> }
  | { type: "done" };

interface QueueWaiter<T> {
  resolve(result: IteratorResult<T>): void;
  reject(error: Error): void;
}

class AsyncQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters: QueueWaiter<T>[] = [];
  private isClosed = false;
  private failure: Error | null = null;

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value });
      return;
    }
    this.values.push(value);
  }

  close(): void {
    this.isClosed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ done: true, value: undefined });
    }
  }

  fail(error: Error): void {
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error);
    }
  }

  next(): Promise<IteratorResult<T>> {
    if (this.failure) return Promise.reject(this.failure);
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve({ done: false, value });
    if (this.isClosed) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }
}

export function createAcpStdioClient(input: AcpClientInput): AcpClient {
  return new StdioAcpClient(input, spawnAcpProcess);
}

function spawnAcpProcess(
  command: string,
  args: string[],
  options: SpawnAcpProcessOptions,
): AcpProcess {
  return spawnProcess(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: "pipe",
  });
}

class StdioAcpClient implements AcpClient {
  private nextId = 1;
  private stdoutBuffer = "";
  private readonly pending = new Map<string, PendingRequest>();
  private readonly updates = new AsyncQueue<AcpSessionEvent>();
  private readonly proc: AcpProcess;

  constructor(input: AcpClientInput, spawn: SpawnAcpProcess) {
    this.proc = spawn(input.server.command, input.server.args ?? [], {
      cwd: input.cwd,
      env: { ...process.env, ...(input.server.env ?? {}) },
    });
    this.proc.stdout.on("data", (chunk: Buffer | string) => {
      this.consumeStdout(chunk.toString());
    });
    this.proc.stderr.on("data", (chunk: Buffer | string) => {
      this.updates.push({ type: "transcript", text: chunk.toString() });
    });
    this.proc.once("error", (error) => {
      this.rejectAll(error);
      this.updates.fail(error);
    });
    this.proc.once("exit", (code) => {
      if (code !== 0 && this.pending.size > 0) {
        this.rejectAll(new AcpProtocolError(`ACP Agent Server exited ${code}`));
      }
      this.updates.close();
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {});
  }

  async newSession(input: AcpSessionInput): Promise<AcpSession> {
    const result = await this.request("session/new", { cwd: input.cwd });
    const parsed = SessionNewResultSchema.safeParse(result);
    if (!parsed.success) {
      throw new AcpProtocolError("session/new returned an invalid session id");
    }
    const sessionId = parsed.data.sessionId ?? parsed.data.session_id;
    if (!sessionId) {
      throw new AcpProtocolError("session/new returned an invalid session id");
    }
    return { sessionId };
  }

  async *prompt(input: AcpPromptInput): AsyncGenerator<AcpSessionEvent> {
    const completed = this.request("session/prompt", input);
    let isDone = false;
    while (!isDone) {
      const winner = await Promise.race([
        this.updates.next().then(toPromptEventWinner),
        completed.then(toPromptDoneWinner),
      ]);
      if (winner.type === "done") {
        isDone = true;
        continue;
      }
      if (winner.result.done) {
        await completed;
        return;
      }
      yield winner.result.value;
    }
    await completed;
  }

  async close(): Promise<void> {
    this.proc.stdin.end();
    this.proc.kill("SIGTERM");
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    this.proc.stdin.write(`${payload}\n`);
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(String(id), { resolve, reject });
    });
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.length > 0) this.consumeProtocolLine(line);
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  private consumeProtocolLine(line: string): void {
    let decoded: unknown;
    try {
      decoded = JSON.parse(line);
    } catch {
      this.rejectAll(
        new AcpProtocolError("ACP Agent Server wrote non-JSON stdout"),
      );
      return;
    }

    const response = JsonRpcResponseSchema.safeParse(decoded);
    if (response.success) {
      this.resolveResponse(
        response.data.id,
        response.data.result,
        response.data.error,
      );
      return;
    }

    const notification = JsonRpcNotificationSchema.safeParse(decoded);
    if (notification.success) {
      this.consumeNotification(
        notification.data.method,
        notification.data.params,
      );
      return;
    }

    this.rejectAll(
      new AcpProtocolError("ACP Agent Server wrote invalid JSON-RPC"),
    );
  }

  private resolveResponse(
    id: string | number,
    result: unknown,
    error: { code: number; message: string } | undefined,
  ): void {
    const pending = this.pending.get(String(id));
    if (!pending) return;
    this.pending.delete(String(id));
    if (error) {
      pending.reject(new AcpProtocolError(error.message));
      return;
    }
    pending.resolve(result);
  }

  private consumeNotification(method: string, params: unknown): void {
    if (method !== "session/update") return;
    const parsed = SessionUpdateParamsSchema.safeParse(params);
    if (!parsed.success) return;
    const content = parsed.data.content;
    if (
      parsed.data.sessionUpdate === "agent_message_chunk" &&
      content !== undefined
    ) {
      this.updates.push({ type: "assistant_text", text: content.text });
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function toPromptEventWinner(
  result: IteratorResult<AcpSessionEvent>,
): PromptWinner {
  return { type: "event", result };
}

function toPromptDoneWinner(): PromptWinner {
  return { type: "done" };
}

import type {
  CliEvent,
  CliProcess,
  CliResult,
  SpawnOptions,
} from "@0xtiby/spawner";
import { describe, expect, it, vi } from "vitest";
import type { AcpSessionEvent } from "./acp.js";
import {
  type AcpClient,
  type AcpClientFactory,
  loop,
  type Spawner,
} from "./index.js";

async function* cliEvents(events: CliEvent[]): AsyncGenerator<CliEvent> {
  for (const event of events) {
    yield event;
  }
}

function textEvent(content: string): CliEvent {
  return { type: "text", timestamp: 0, content, raw: content };
}

function fakeProcess(result: CliResult, chunks: string[] = []): CliProcess {
  return fakeProcessWithEvents(result, chunks.map(textEvent));
}

function fakeProcessWithEvents(
  result: CliResult,
  events: CliEvent[],
): CliProcess {
  return {
    pid: 1,
    events: cliEvents(events),
    interrupt: async () => result,
    done: Promise.resolve(result),
  };
}

function okResult(): CliResult {
  return {
    exitCode: 0,
    sessionId: null,
    usage: null,
    model: null,
    error: null,
    durationMs: 0,
  };
}

async function* acpEvents(
  events: AcpSessionEvent[],
): AsyncGenerator<AcpSessionEvent> {
  for (const event of events) {
    yield event;
  }
}

describe("loop", () => {
  it("applies a supported Model override through ACP session config before prompting", async () => {
    const calls: string[] = [];
    const client = {
      initialize: async () => {
        calls.push("initialize");
      },
      newSession: async () => {
        calls.push("session/new");
        return {
          sessionId: "fresh-session-1",
          configOptions: [
            {
              id: "model-option",
              category: "model",
              values: ["sonnet", "opus"],
              value: "sonnet",
            },
          ],
        };
      },
      setConfigOption: async (input: {
        sessionId: string;
        optionId: string;
        value: string;
      }) => {
        calls.push(`set:${input.sessionId}:${input.optionId}:${input.value}`);
        return {
          configOptions: [
            {
              id: input.optionId,
              category: "model",
              values: ["sonnet", "opus"],
              value: input.value,
            },
          ],
        };
      },
      prompt: (input: { sessionId: string; content: { text: string }[] }) => {
        calls.push(`prompt:${input.sessionId}:${input.content[0]?.text}`);
        return acpEvents([{ type: "assistant_text", text: "done" }]);
      },
      close: async () => {
        calls.push("close");
      },
    };
    const createAcpClient: AcpClientFactory = () => client;

    await loop(
      {
        agent: "custom-agent",
        agentServer: { type: "custom", command: "agent" },
        prompt: "do the thing",
        cwd: "/work",
        model: "opus",
        maxIterations: 1,
      },
      { createAcpClient },
    );

    expect(calls).toEqual([
      "initialize",
      "session/new",
      "set:fresh-session-1:model-option:opus",
      "prompt:fresh-session-1:do the thing",
      "close",
    ]);
  });

  it("fails a Model override before prompting when ACP allowed values reject it", async () => {
    const calls: string[] = [];
    const createAcpClient: AcpClientFactory = () => ({
      initialize: async () => {
        calls.push("initialize");
      },
      newSession: async () => {
        calls.push("session/new");
        return {
          sessionId: "fresh-session-1",
          configOptions: [
            {
              id: "model-option",
              category: "model",
              values: ["sonnet", "opus"],
              value: "sonnet",
            },
          ],
        };
      },
      setConfigOption: async () => {
        calls.push("set");
        return { configOptions: [] };
      },
      prompt: () => {
        calls.push("prompt");
        return acpEvents([{ type: "assistant_text", text: "should not run" }]);
      },
      close: async () => {
        calls.push("close");
      },
    });

    const result = await loop(
      {
        agent: "custom-agent",
        agentServer: { type: "custom", command: "agent" },
        prompt: "do the thing",
        cwd: "/work",
        model: "haiku",
        maxIterations: 1,
      },
      { createAcpClient },
    );

    expect(calls).toEqual(["initialize", "session/new", "close"]);
    expect(result.stopReason).toBe("error");
    expect(result.iterations[0]?.error?.message).toContain(
      'Model override "haiku" is not supported',
    );
  });

  it("fails a Model override before prompting when the ACP session has no model config option", async () => {
    const calls: string[] = [];
    const createAcpClient: AcpClientFactory = () => ({
      initialize: async () => {
        calls.push("initialize");
      },
      newSession: async () => {
        calls.push("session/new");
        return {
          sessionId: "fresh-session-1",
          configOptions: [
            {
              id: "permission-mode",
              category: "mode",
              values: ["default"],
              value: "default",
            },
          ],
        };
      },
      setConfigOption: async () => {
        calls.push("set");
        return { configOptions: [] };
      },
      prompt: () => {
        calls.push("prompt");
        return acpEvents([{ type: "assistant_text", text: "should not run" }]);
      },
      close: async () => {
        calls.push("close");
      },
    });

    const result = await loop(
      {
        agent: "custom-agent",
        agentServer: { type: "custom", command: "agent" },
        prompt: "do the thing",
        cwd: "/work",
        model: "opus",
        maxIterations: 1,
      },
      { createAcpClient },
    );

    expect(calls).toEqual(["initialize", "session/new", "close"]);
    expect(result.stopReason).toBe("error");
    expect(result.iterations[0]?.error?.message).toContain(
      'ACP session does not expose a model config option for override "opus"',
    );
  });

  it("uses changed ACP config option state after setting a Model override", async () => {
    const calls: string[] = [];
    const client = {
      initialize: async () => {
        calls.push("initialize");
      },
      newSession: async () => {
        calls.push("session/new");
        return {
          sessionId: "fresh-session-1",
          configOptions: [
            {
              id: "model-option",
              category: "model",
              values: ["sonnet", "opus"],
              value: "sonnet",
            },
            {
              id: "mode-option",
              category: "mode",
              values: ["fast"],
              value: "fast",
            },
          ],
        };
      },
      setConfigOption: async (input: {
        sessionId: string;
        optionId: string;
        value: string;
      }) => {
        calls.push(`set:${input.optionId}:${input.value}`);
        if (input.optionId === "model-option") {
          return {
            configOptions: [
              {
                id: "model-option",
                category: "model",
                values: ["sonnet", "opus"],
                value: input.value,
              },
              {
                id: "mode-option",
                category: "mode",
                values: ["plan"],
                value: "fast",
              },
            ],
          };
        }
        return {
          configOptions: [
            {
              id: "model-option",
              category: "model",
              values: ["sonnet", "opus"],
              value: "opus",
            },
            {
              id: input.optionId,
              category: "mode",
              values: ["plan"],
              value: input.value,
            },
          ],
        };
      },
      prompt: (input: { sessionId: string; content: { text: string }[] }) => {
        calls.push(`prompt:${input.sessionId}:${input.content[0]?.text}`);
        return acpEvents([{ type: "assistant_text", text: "done" }]);
      },
      close: async () => {
        calls.push("close");
      },
    };
    const createAcpClient: AcpClientFactory = () => client;

    const result = await loop(
      {
        agent: "custom-agent",
        agentServer: { type: "custom", command: "agent" },
        prompt: "do the thing",
        cwd: "/work",
        model: "opus",
        mode: "plan",
        maxIterations: 1,
      },
      { createAcpClient },
    );

    expect(calls).toEqual([
      "initialize",
      "session/new",
      "set:model-option:opus",
      "set:mode-option:plan",
      "prompt:fresh-session-1:do the thing",
      "close",
    ]);
    expect(result.stopReason).toBe("max_iterations");
  });

  it("runs a Fresh ACP session for a custom Agent Server", async () => {
    const calls: string[] = [];
    const client: AcpClient = {
      initialize: async () => {
        calls.push("initialize");
      },
      newSession: async (input) => {
        calls.push(`session/new:${input.cwd}`);
        return { sessionId: "fresh-session-1", configOptions: [] };
      },
      prompt: (input) => {
        calls.push(
          `session/prompt:${input.sessionId}:${input.content[0]?.text}`,
        );
        return acpEvents([{ type: "assistant_text", text: "done" }]);
      },
      close: async () => {
        calls.push("close");
      },
    };
    const createAcpClient: AcpClientFactory = (input) => {
      calls.push(
        `launch:${input.server.command} ${(input.server.args ?? []).join(" ")}`,
      );
      return client;
    };

    const result = await loop(
      {
        agent: "custom-agent",
        agentServer: {
          type: "custom",
          command: "node",
          args: ["./agent-server.js"],
        },
        prompt: "do the thing",
        cwd: "/work",
        maxIterations: 1,
      },
      { createAcpClient },
    );

    expect(calls).toEqual([
      "launch:node ./agent-server.js",
      "initialize",
      "session/new:/work",
      "session/prompt:fresh-session-1:do the thing",
      "close",
    ]);
    expect(result.stopReason).toBe("max_iterations");
  });

  it("stops an ACP Run when the Sentinel appears in Assistant text", async () => {
    const createAcpClient = vi.fn<AcpClientFactory>(() => ({
      initialize: async () => {},
      newSession: async () => ({
        sessionId: "fresh-session-1",
        configOptions: [],
      }),
      prompt: () =>
        acpEvents([
          { type: "assistant_text", text: "complete :::LOOPER_DONE:::" },
        ]),
      close: async () => {},
    }));

    const result = await loop(
      {
        agent: "custom-agent",
        agentServer: { type: "custom", command: "agent" },
        prompt: "do the thing",
        cwd: "/work",
        maxIterations: 5,
      },
      { createAcpClient },
    );

    expect(createAcpClient).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe("sentinel");
    expect(result.iterations[0]?.sentinelDetected).toBe(true);
  });

  it("does not stop an ACP Run when the Sentinel appears in transcript progress", async () => {
    const createAcpClient: AcpClientFactory = () => ({
      initialize: async () => {},
      newSession: async () => ({
        sessionId: "fresh-session-1",
        configOptions: [],
      }),
      prompt: () =>
        acpEvents([
          { type: "transcript", text: "[acp tool_call] :::LOOPER_DONE:::" },
          { type: "transcript", text: "[stderr] :::LOOPER_DONE:::" },
          { type: "assistant_text", text: "still working" },
        ]),
      close: async () => {},
    });

    const result = await loop(
      {
        agent: "custom-agent",
        agentServer: { type: "custom", command: "agent" },
        prompt: "do the thing",
        cwd: "/work",
        maxIterations: 1,
      },
      { createAcpClient },
    );

    expect(result.stopReason).toBe("max_iterations");
    expect(result.iterations[0]?.sentinelDetected).toBe(false);
  });

  it("keeps ACP transcript progress in stdout without making it Sentinel-eligible", async () => {
    const createAcpClient: AcpClientFactory = () => ({
      initialize: async () => {},
      newSession: async () => ({
        sessionId: "fresh-session-1",
        configOptions: [],
      }),
      prompt: () =>
        acpEvents([
          { type: "transcript", text: "[acp tool_call] running tests\n" },
          { type: "assistant_text", text: "done" },
        ]),
      close: async () => {},
    });

    const result = await loop(
      {
        agent: "custom-agent",
        agentServer: { type: "custom", command: "agent" },
        prompt: "do the thing",
        cwd: "/work",
        maxIterations: 1,
      },
      { createAcpClient },
    );

    expect(result.iterations[0]?.stdout).toBe(
      "[acp tool_call] running tests\ndone",
    );
  });

  it("spawns the CLI with the given prompt, agent, and cwd", async () => {
    const spawn = vi.fn<(options: SpawnOptions) => CliProcess>(() =>
      fakeProcess(okResult()),
    );

    await loop(
      { agent: "claude", prompt: "do the thing", cwd: "/work" },
      { spawn },
    );

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        cli: "claude",
        prompt: "do the thing",
        cwd: "/work",
      }),
    );
  });

  it("iterates up to maxIterations when sentinel never fires and exits clean", async () => {
    const spawn = vi.fn<(options: SpawnOptions) => CliProcess>(() =>
      fakeProcess(okResult()),
    );

    const result = await loop(
      { agent: "claude", prompt: "x", cwd: "/w", maxIterations: 3 },
      { spawn },
    );

    expect(spawn).toHaveBeenCalledTimes(3);
    expect(result.iterations).toHaveLength(3);
    expect(result.iterations.map((it) => it.number)).toEqual([1, 2, 3]);
    expect(result.stopReason).toBe("max_iterations");
  });

  it("stops with stopReason 'sentinel' when sentinel appears in assistant text", async () => {
    const spawn = vi.fn<(options: SpawnOptions) => CliProcess>(() =>
      fakeProcess(okResult(), [
        "working...",
        "finishing up :::DONE:::",
        "trailing",
      ]),
    );

    const result = await loop(
      {
        agent: "claude",
        prompt: "x",
        cwd: "/w",
        maxIterations: 5,
        sentinel: ":::DONE:::",
      },
      { spawn },
    );

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe("sentinel");
    expect(result.iterations).toHaveLength(1);
    expect(result.iterations[0]?.sentinelDetected).toBe(true);
  });

  it("invokes onOutput with each text chunk exactly as received", async () => {
    const spawn: Spawner = () =>
      fakeProcess(okResult(), ["hel", "lo\n", "world"]);
    const received: string[] = [];

    await loop(
      {
        agent: "claude",
        prompt: "x",
        cwd: "/w",
        maxIterations: 1,
        onOutput: (c) => received.push(c),
      },
      { spawn },
    );

    expect(received).toEqual(["hel", "lo\n", "world"]);
  });

  it("captures streamed text without adding newlines between chunks", async () => {
    const spawn: Spawner = () =>
      fakeProcess(okResult(), ["/home", "/t", "iby"]);

    const result = await loop(
      { agent: "pi", prompt: "x", cwd: "/w", maxIterations: 1 },
      { spawn },
    );

    expect(result.iterations[0]?.stdout).toBe("/home/tiby");
  });

  it("detects sentinel split across streamed text chunks", async () => {
    const spawn: Spawner = () =>
      fakeProcess(okResult(), ["work ", ":::LO", "OPER_DONE", ":::"]);

    const result = await loop(
      { agent: "pi", prompt: "x", cwd: "/w", maxIterations: 2 },
      { spawn },
    );

    expect(result.stopReason).toBe("sentinel");
  });

  it("keeps error events line-oriented in stdout", async () => {
    const spawn: Spawner = () =>
      fakeProcessWithEvents(okResult(), [
        { type: "error", timestamp: 0, content: "boom", raw: "boom" },
        {
          type: "tool_result",
          timestamp: 0,
          toolResult: { name: "bash", error: "failed" },
          raw: "failed",
        },
      ]);

    const result = await loop(
      { agent: "claude", prompt: "x", cwd: "/w", maxIterations: 1 },
      { spawn },
    );

    expect(result.iterations[0]?.stdout).toBe(
      "[error] boom\n[tool bash error] failed\n",
    );
  });

  it("separates line-oriented events from preceding raw text chunks", async () => {
    const spawn: Spawner = () =>
      fakeProcessWithEvents(okResult(), [
        textEvent("partial"),
        { type: "error", timestamp: 0, content: "boom", raw: "boom" },
      ]);

    const result = await loop(
      { agent: "pi", prompt: "x", cwd: "/w", maxIterations: 1 },
      { spawn },
    );

    expect(result.iterations[0]?.stdout).toBe("partial\n[error] boom\n");
  });

  it("surfaces durationMs and token usage from the spawner", async () => {
    const spawn: Spawner = () =>
      fakeProcess({
        ...okResult(),
        durationMs: 1234,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          cost: null,
        },
      });

    const result = await loop(
      { agent: "claude", prompt: "x", cwd: "/w", maxIterations: 1 },
      { spawn },
    );

    expect(result.iterations[0]).toMatchObject({
      durationMs: 1234,
      tokensIn: 100,
      tokensOut: 50,
    });
  });

  it("substitutes built-in ITERATION in the prompt before each spawn", async () => {
    const spawn = vi.fn<(options: SpawnOptions) => CliProcess>(() =>
      fakeProcess(okResult()),
    );

    await loop(
      {
        agent: "claude",
        prompt: "i={{ITERATION}}/{{MAX_ITERATIONS}}",
        cwd: "/w",
        maxIterations: 3,
      },
      { spawn },
    );

    expect(spawn.mock.calls[0]?.[0].prompt).toBe("i=1/3");
    expect(spawn.mock.calls[1]?.[0].prompt).toBe("i=2/3");
    expect(spawn.mock.calls[2]?.[0].prompt).toBe("i=3/3");
  });

  it("substitutes built-in RUN_ID when runId is provided", async () => {
    const spawn = vi.fn<(options: SpawnOptions) => CliProcess>(() =>
      fakeProcess(okResult()),
    );

    await loop(
      {
        agent: "claude",
        prompt: "run={{RUN_ID}}",
        cwd: "/w",
        maxIterations: 1,
        runId: "abc-123",
      },
      { spawn },
    );

    expect(spawn.mock.calls[0]?.[0].prompt).toBe("run=abc-123");
  });

  it("applies user vars, letting them override built-ins", async () => {
    const spawn = vi.fn<(options: SpawnOptions) => CliProcess>(() =>
      fakeProcess(okResult()),
    );

    await loop(
      {
        agent: "claude",
        prompt: "it={{ITERATION}} mode={{MODE}}",
        cwd: "/w",
        maxIterations: 1,
        vars: { MODE: "fast", ITERATION: "overridden" },
      },
      { spawn },
    );

    expect(spawn.mock.calls[0]?.[0].prompt).toBe("it=overridden mode=fast");
  });

  it("stops with 'aborted' and calls proc.interrupt when signal fires mid-iteration", async () => {
    const controller = new AbortController();
    const interrupt = vi.fn(async (): Promise<CliResult> => okResult());
    const waitForAbort = async function* (): AsyncGenerator<CliEvent> {
      await new Promise<void>((resolve) => {
        if (controller.signal.aborted) resolve();
        else
          controller.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
      });
    };
    const spawn: Spawner = () => ({
      pid: 1,
      events: waitForAbort(),
      interrupt,
      done: Promise.resolve(okResult()),
    });
    setImmediate(() => controller.abort());

    const result = await loop(
      {
        agent: "claude",
        prompt: "x",
        cwd: "/w",
        maxIterations: 3,
        signal: controller.signal,
      },
      { spawn },
    );

    expect(interrupt).toHaveBeenCalled();
    expect(result.stopReason).toBe("aborted");
    expect(result.iterations).toHaveLength(1);
  });

  it("numbers iterations from startIteration when resuming", async () => {
    const spawn = vi.fn<(options: SpawnOptions) => CliProcess>(() =>
      fakeProcess(okResult()),
    );

    const result = await loop(
      {
        agent: "claude",
        prompt: "i={{ITERATION}}",
        cwd: "/w",
        maxIterations: 4,
        startIteration: 3,
      },
      { spawn },
    );

    expect(result.iterations.map((it) => it.number)).toEqual([3, 4]);
    expect(spawn.mock.calls[0]?.[0].prompt).toBe("i=3");
    expect(spawn.mock.calls[1]?.[0].prompt).toBe("i=4");
  });

  it("does not stop on sentinel inside tool_result or error events", async () => {
    const spawn: Spawner = () =>
      fakeProcessWithEvents(okResult(), [
        {
          type: "tool_result",
          timestamp: 0,
          toolResult: { name: "bash", output: ":::LOOPER_DONE:::" },
          raw: "tool",
        },
        {
          type: "error",
          timestamp: 0,
          content: ":::LOOPER_DONE:::",
          raw: "err",
        },
        textEvent("done"),
      ]);

    const result = await loop(
      { agent: "claude", prompt: "x", cwd: "/w", maxIterations: 1 },
      { spawn },
    );

    expect(result.stopReason).toBe("max_iterations");
    expect(result.iterations[0]?.sentinelDetected).toBe(false);
  });

  it("reports stopReason 'error' when the CLI exits non-zero", async () => {
    const failing: CliResult = { ...okResult(), exitCode: 2 };
    const spawn: Spawner = () => fakeProcess(failing);

    const result = await loop(
      { agent: "claude", prompt: "x", cwd: "/work" },
      { spawn },
    );

    expect(result.stopReason).toBe("error");
    expect(result.iterations).toHaveLength(1);
    expect(result.iterations[0]?.exitCode).toBe(2);
    expect(result.iterations[0]?.sentinelDetected).toBe(false);
  });
});

import type {
  CliEvent,
  CliProcess,
  CliResult,
  SpawnOptions,
} from "@0xtiby/spawner";
import { describe, expect, it, vi } from "vitest";
import { loop, type Spawner } from "./index.js";

async function* textEvents(chunks: string[]): AsyncGenerator<CliEvent> {
  for (const content of chunks) {
    yield { type: "text", timestamp: 0, content, raw: content };
  }
}

function fakeProcess(result: CliResult, chunks: string[] = []): CliProcess {
  return {
    pid: 1,
    events: textEvents(chunks),
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

describe("loop", () => {
  it("spawns the CLI with the given prompt, cli, and cwd", async () => {
    const spawn = vi.fn<(options: SpawnOptions) => CliProcess>(() =>
      fakeProcess(okResult()),
    );

    await loop(
      { cli: "claude", prompt: "do the thing", cwd: "/work" },
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
      { cli: "claude", prompt: "x", cwd: "/w", maxIterations: 3 },
      { spawn },
    );

    expect(spawn).toHaveBeenCalledTimes(3);
    expect(result.iterations).toHaveLength(3);
    expect(result.iterations.map((it) => it.number)).toEqual([1, 2, 3]);
    expect(result.stopReason).toBe("max_iterations");
  });

  it("stops with stopReason 'sentinel' when sentinel appears in CLI output", async () => {
    const spawn = vi.fn<(options: SpawnOptions) => CliProcess>(() =>
      fakeProcess(okResult(), [
        "working...",
        "finishing up :::DONE:::",
        "trailing",
      ]),
    );

    const result = await loop(
      {
        cli: "claude",
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

  it("invokes onOutput with each text chunk in order", async () => {
    const chunks = ["hello ", "world", "!"];
    const spawn: Spawner = () => fakeProcess(okResult(), chunks);
    const received: string[] = [];

    await loop(
      {
        cli: "claude",
        prompt: "x",
        cwd: "/w",
        maxIterations: 1,
        onOutput: (c) => received.push(c),
      },
      { spawn },
    );

    expect(received).toEqual(chunks);
  });

  it("captures per-iteration stdout in the result", async () => {
    const chunks = ["alpha", "beta"];
    const spawn: Spawner = () => fakeProcess(okResult(), chunks);

    const result = await loop(
      { cli: "claude", prompt: "x", cwd: "/w", maxIterations: 1 },
      { spawn },
    );

    expect(result.iterations[0]?.stdout).toBe("alphabeta");
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
      { cli: "claude", prompt: "x", cwd: "/w", maxIterations: 1 },
      { spawn },
    );

    expect(result.iterations[0]).toMatchObject({
      durationMs: 1234,
      tokensIn: 100,
      tokensOut: 50,
    });
  });

  it("reports stopReason 'error' when the CLI exits non-zero", async () => {
    const failing: CliResult = { ...okResult(), exitCode: 2 };
    const spawn: Spawner = () => fakeProcess(failing);

    const result = await loop(
      { cli: "claude", prompt: "x", cwd: "/work" },
      { spawn },
    );

    expect(result.stopReason).toBe("error");
    expect(result.iterations).toHaveLength(1);
    expect(result.iterations[0]?.exitCode).toBe(2);
    expect(result.iterations[0]?.sentinelDetected).toBe(false);
  });
});

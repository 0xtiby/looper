import type { CliProcess, CliResult, SpawnOptions } from "@0xtiby/spawner";
import { describe, expect, it, vi } from "vitest";
import { loop, type Spawner } from "./index.js";

function fakeProcess(result: CliResult): CliProcess {
  return {
    pid: 1,
    events: (async function* () {})(),
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

  it("reports stopReason 'error' when the CLI exits non-zero", async () => {
    const failing: CliResult = { ...okResult(), exitCode: 2 };
    const spawn: Spawner = () => fakeProcess(failing);

    const result = await loop(
      { cli: "claude", prompt: "x", cwd: "/work" },
      { spawn },
    );

    expect(result.stopReason).toBe("error");
    expect(result.iterations).toHaveLength(1);
    expect(result.iterations[0]?.result.exitCode).toBe(2);
  });
});

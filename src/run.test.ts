import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  finalizeRun,
  type IterationRecord,
  listInterruptedRuns,
  newActiveRun,
  RunSchema,
  readRun,
  runBasename,
  writeRun,
} from "./run.js";

describe("run", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "looper-run-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("newActiveRun builds a valid active run", () => {
    const run = newActiveRun({
      id: "abc",
      prompt: "./p.md",
      agent: "claude",
      model: "opus",
      maxIterations: 5,
    });

    expect(run.state).toBe("active");
    expect(run.iterations).toEqual([]);
    expect(run.completedAt).toBeNull();
    expect(run.stopReason).toBeNull();
    expect(RunSchema.safeParse(run).success).toBe(true);
  });

  it("finalizeRun with 'aborted' transitions to interrupted", () => {
    const active = newActiveRun({
      id: "abc",
      prompt: "p",
      agent: "claude",
      model: null,
      maxIterations: 3,
    });
    const finalized = finalizeRun(active, "aborted", []);
    expect(finalized.state).toBe("interrupted");
    expect(finalized.stopReason).toBe("aborted");
    expect(RunSchema.safeParse(finalized).success).toBe(true);
  });

  it("finalizeRun transitions to completed and records iterations", () => {
    const active = newActiveRun({
      id: "abc",
      prompt: "p",
      agent: "claude",
      model: null,
      maxIterations: 3,
    });
    const iterations: IterationRecord[] = [
      {
        number: 1,
        exitCode: 0,
        durationMs: 100,
        tokensIn: 10,
        tokensOut: 20,
        sentinelDetected: true,
        error: null,
      },
    ];

    const completed = finalizeRun(active, "sentinel", iterations);

    expect(completed.state).toBe("completed");
    expect(completed.stopReason).toBe("sentinel");
    expect(completed.iterations).toEqual(iterations);
    expect(completed.completedAt).not.toBeNull();
    expect(RunSchema.safeParse(completed).success).toBe(true);
  });

  it("writeRun persists a JSON file that round-trips through the schema", async () => {
    const run = newActiveRun({
      id: "abc-123",
      prompt: "p",
      agent: "claude",
      model: null,
      maxIterations: 2,
    });

    await writeRun(run, workDir);

    const raw = await readFile(
      path.join(workDir, ".looper", "runs", `${runBasename(run)}.json`),
      "utf8",
    );
    const parsed = RunSchema.parse(JSON.parse(raw));
    expect(parsed).toEqual(run);
  });

  it("runBasename uses a short id and a readable timestamp", () => {
    const run = {
      id: "4fbf870e-8488-45da-93d2-b1bb2d84b0e7",
      startedAt: "2026-04-16T19:39:01.000Z",
    };
    expect(runBasename(run)).toBe("4fbf870e_2026-04-16-T19-39-01");
  });

  it("readRun returns the persisted run", async () => {
    const run = newActiveRun({
      id: "xyz",
      prompt: "p",
      agent: "claude",
      model: null,
      maxIterations: 1,
    });
    await writeRun(run, workDir);
    const read = await readRun(workDir, "xyz");
    expect(read).toEqual(run);
  });

  it("readRun returns null when the run file is missing", async () => {
    expect(await readRun(workDir, "does-not-exist")).toBeNull();
  });

  it("listInterruptedRuns returns only runs whose state is 'interrupted'", async () => {
    const active = newActiveRun({
      id: "active-1",
      prompt: "p",
      agent: "claude",
      model: null,
      maxIterations: 1,
    });
    const completed = finalizeRun(
      newActiveRun({
        id: "completed-1",
        prompt: "p",
        agent: "claude",
        model: null,
        maxIterations: 1,
      }),
      "sentinel",
      [],
    );
    const interrupted = finalizeRun(
      newActiveRun({
        id: "interrupted-1",
        prompt: "p",
        agent: "claude",
        model: null,
        maxIterations: 2,
      }),
      "aborted",
      [],
    );
    await writeRun(active, workDir);
    await writeRun(completed, workDir);
    await writeRun(interrupted, workDir);

    const list = await listInterruptedRuns(workDir);
    expect(list.map((r) => r.id)).toEqual(["interrupted-1"]);
  });

  it("RunSchema rejects invalid state values", () => {
    const result = RunSchema.safeParse({
      id: "x",
      prompt: "p",
      agent: "claude",
      model: null,
      maxIterations: 1,
      state: "bogus",
      startedAt: new Date().toISOString(),
      completedAt: null,
      stopReason: null,
      iterations: [],
    });
    expect(result.success).toBe(false);
  });
});

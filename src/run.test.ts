import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyResumeOverride,
  finalizeRun,
  hasResumeHistory,
  type IterationRecord,
  listNonCompleteRuns,
  newActiveRun,
  RunSchema,
  readRun,
  runBasename,
  snapshotAcpAgentServer,
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

  it("newActiveRun persists custom ACP Agent Server context and Resolved prompt", () => {
    const agentServer = snapshotAcpAgentServer({
      id: "my-custom-agent",
      config: {
        type: "custom",
        command: "node",
        args: ["./agent.js", "--acp"],
        env: { NODE_ENV: "test" },
      },
      launch: {
        type: "custom",
        command: "node",
        args: ["./agent.js", "--acp"],
        env: { NODE_ENV: "test" },
      },
    });

    const run = newActiveRun({
      id: "custom-run",
      prompt: "Resolved prompt from stdin",
      agent: "my-custom-agent",
      agentServer,
      model: null,
      maxIterations: 2,
    });

    expect(run.resolvedPrompt).toBe("Resolved prompt from stdin");
    expect(run.agentServer).toEqual({
      id: "my-custom-agent",
      sourceType: "custom",
      config: {
        type: "custom",
        command: "node",
        args: ["./agent.js", "--acp"],
        env: { NODE_ENV: "test" },
      },
      launch: {
        type: "custom",
        command: "node",
        args: ["./agent.js", "--acp"],
        env: { NODE_ENV: "test" },
      },
    });
    expect(RunSchema.parse(run).agentServer).toEqual(run.agentServer);
  });

  it("newActiveRun persists registry-backed ACP Agent Server context", () => {
    const agentServer = snapshotAcpAgentServer({
      id: "zed-agent",
      config: {
        type: "registry",
        id: "zed-agent",
        registryUrl: "https://registry.example.test/registry.json",
      },
      launch: {
        type: "registry",
        command: "npx",
        args: ["-y", "@zed/agent"],
      },
    });

    const run = newActiveRun({
      id: "registry-run",
      prompt: "Build from the PRD",
      agent: "zed-agent",
      agentServer,
      model: "sonnet",
      maxIterations: 3,
    });

    expect(run.agentServer?.sourceType).toBe("registry");
    expect(run.agentServer?.config).toEqual({
      type: "registry",
      id: "zed-agent",
      registryUrl: "https://registry.example.test/registry.json",
    });
    expect(run.agentServer?.launch).toEqual({
      type: "registry",
      command: "npx",
      args: ["-y", "@zed/agent"],
    });
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

  it("finalizeRun with 'error' transitions to interrupted", () => {
    const active = newActiveRun({
      id: "abc",
      prompt: "p",
      agent: "claude",
      model: null,
      maxIterations: 3,
    });
    const finalized = finalizeRun(active, "error", []);
    expect(finalized.state).toBe("interrupted");
    expect(finalized.stopReason).toBe("error");
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

  it("listNonCompleteRuns returns runs whose state is not 'completed'", async () => {
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
    const errored = finalizeRun(
      newActiveRun({
        id: "errored-1",
        prompt: "p",
        agent: "claude",
        model: null,
        maxIterations: 2,
      }),
      "error",
      [],
    );
    await writeRun(active, workDir);
    await writeRun(completed, workDir);
    await writeRun(interrupted, workDir);
    await writeRun(errored, workDir);

    const list = await listNonCompleteRuns(workDir);
    const ids = list.map((r) => r.id).sort();
    expect(ids).toEqual(["active-1", "errored-1", "interrupted-1"]);
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

  it("RunSchema parses old runs without resumeHistory", () => {
    const run = {
      id: "legacy",
      prompt: "p",
      agent: "claude",
      model: null,
      maxIterations: 1,
      state: "active",
      startedAt: new Date().toISOString(),
      completedAt: null,
      stopReason: null,
      iterations: [],
    };
    const parsed = RunSchema.safeParse(run);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.resumeHistory).toEqual([]);
  });

  it("RunSchema backfills Resolved prompt from legacy prompt records", () => {
    const parsed = RunSchema.parse({
      id: "legacy",
      prompt: "persisted prompt body",
      agent: "claude",
      model: null,
      maxIterations: 1,
      state: "active",
      startedAt: new Date().toISOString(),
      completedAt: null,
      stopReason: null,
      iterations: [],
    });

    expect(parsed.resolvedPrompt).toBe("persisted prompt body");
  });

  it("RunSchema parses runs with resumeHistory", () => {
    const run = {
      id: "legacy",
      prompt: "p",
      agent: "codex",
      model: null,
      maxIterations: 1,
      state: "interrupted",
      startedAt: new Date().toISOString(),
      completedAt: null,
      stopReason: "error",
      iterations: [],
      resumeHistory: [
        {
          resumedAt: "2026-05-21T10:00:00.000Z",
          fromIteration: 3,
          previousAgent: "claude",
          newAgent: "codex",
        },
      ],
    };
    const parsed = RunSchema.safeParse(run);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.resumeHistory).toHaveLength(1);
    expect(parsed.data?.resumeHistory[0]?.newAgent).toBe("codex");
  });

  it("applyResumeOverride returns the same run when override is empty", () => {
    const run = newActiveRun({
      id: "abc",
      prompt: "p",
      agent: "claude",
      model: null,
      maxIterations: 3,
    });
    const updated = applyResumeOverride(run, {});
    expect(updated).toBe(run);
  });

  it("applyResumeOverride updates agent and records history entry", () => {
    const run = newActiveRun({
      id: "abc",
      prompt: "p",
      agent: "claude",
      model: null,
      maxIterations: 3,
    });
    run.iterations = [
      {
        number: 1,
        exitCode: 0,
        durationMs: 100,
        tokensIn: 10,
        tokensOut: 20,
        sentinelDetected: false,
        error: null,
      },
    ];

    const updated = applyResumeOverride(run, { agent: "codex" });

    expect(updated.agent).toBe("codex");
    expect(updated.model).toBeNull();
    expect(updated.resumeHistory).toHaveLength(1);
    expect(updated.resumeHistory[0]).toMatchObject({
      fromIteration: 2,
      previousAgent: "claude",
      newAgent: "codex",
    });
  });

  it("applyResumeOverride updates model and records history entry", () => {
    const run = newActiveRun({
      id: "abc",
      prompt: "p",
      agent: "claude",
      model: "sonnet",
      maxIterations: 3,
    });
    run.iterations = [
      {
        number: 1,
        exitCode: 0,
        durationMs: 100,
        tokensIn: 10,
        tokensOut: 20,
        sentinelDetected: false,
        error: null,
      },
    ];

    const updated = applyResumeOverride(run, { model: "opus" });

    expect(updated.agent).toBe("claude");
    expect(updated.model).toBe("opus");
    expect(updated.resumeHistory).toHaveLength(1);
    expect(updated.resumeHistory[0]).toMatchObject({
      fromIteration: 2,
      previousModel: "sonnet",
      newModel: "opus",
    });
  });

  it("applyResumeOverride updates both agent and model in a single history entry", () => {
    const run = newActiveRun({
      id: "abc",
      prompt: "p",
      agent: "claude",
      model: "sonnet",
      maxIterations: 3,
    });
    run.iterations = [
      {
        number: 1,
        exitCode: 0,
        durationMs: 100,
        tokensIn: 10,
        tokensOut: 20,
        sentinelDetected: false,
        error: null,
      },
    ];

    const updated = applyResumeOverride(run, { agent: "codex", model: "o3" });

    expect(updated.agent).toBe("codex");
    expect(updated.model).toBe("o3");
    expect(updated.resumeHistory).toHaveLength(1);
    expect(updated.resumeHistory[0]).toMatchObject({
      fromIteration: 2,
      previousAgent: "claude",
      previousModel: "sonnet",
      newAgent: "codex",
      newModel: "o3",
    });
  });

  it("applyResumeOverride switches ACP Agent Server snapshot for a Resume override", () => {
    const originalAgentServer = snapshotAcpAgentServer({
      id: "local-agent",
      config: { type: "custom", command: "node", args: ["./local.js"] },
      launch: { type: "custom", command: "node", args: ["./local.js"] },
    });
    const registryAgentServer = snapshotAcpAgentServer({
      id: "registry-agent",
      config: { type: "registry", id: "registry-agent" },
      launch: {
        type: "registry",
        command: "npx",
        args: ["-y", "@acp/registry-agent"],
      },
    });
    const run = newActiveRun({
      id: "abc",
      prompt: "p",
      agent: "local-agent",
      agentServer: originalAgentServer,
      model: "sonnet",
      maxIterations: 3,
    });
    run.iterations = [
      {
        number: 1,
        exitCode: 0,
        durationMs: 100,
        tokensIn: 10,
        tokensOut: 20,
        sentinelDetected: false,
        error: null,
      },
    ];

    const updated = applyResumeOverride(run, {
      agent: "registry-agent",
      agentServer: registryAgentServer,
      model: "opus",
    });

    expect(updated.agentServer).toEqual(registryAgentServer);
    expect(updated.resumeHistory[0]).toMatchObject({
      fromIteration: 2,
      previousAgent: "local-agent",
      newAgent: "registry-agent",
      previousModel: "sonnet",
      newModel: "opus",
      previousAgentServer: originalAgentServer,
      newAgentServer: registryAgentServer,
    });
  });

  it("applyResumeOverride appends to existing resume history", () => {
    const run = newActiveRun({
      id: "abc",
      prompt: "p",
      agent: "codex",
      model: null,
      maxIterations: 5,
    });
    run.iterations = [
      {
        number: 1,
        exitCode: 0,
        durationMs: 100,
        tokensIn: 10,
        tokensOut: 20,
        sentinelDetected: false,
        error: null,
      },
      {
        number: 2,
        exitCode: 0,
        durationMs: 100,
        tokensIn: 10,
        tokensOut: 20,
        sentinelDetected: false,
        error: null,
      },
    ];
    run.resumeHistory = [
      {
        resumedAt: "2026-05-21T09:00:00.000Z",
        fromIteration: 2,
        previousAgent: "claude",
        newAgent: "codex",
      },
    ];

    const updated = applyResumeOverride(run, { model: "o3" });

    expect(updated.agent).toBe("codex");
    expect(updated.model).toBe("o3");
    expect(updated.resumeHistory).toHaveLength(2);
    expect(updated.resumeHistory[1]).toMatchObject({
      fromIteration: 3,
      newModel: "o3",
    });
  });

  it("hasResumeHistory returns false for a run with empty history", () => {
    const run = newActiveRun({
      id: "abc",
      prompt: "p",
      agent: "claude",
      model: null,
      maxIterations: 3,
    });
    expect(hasResumeHistory(run)).toBe(false);
  });

  it("hasResumeHistory returns true for a run with history entries", () => {
    const run = newActiveRun({
      id: "abc",
      prompt: "p",
      agent: "claude",
      model: null,
      maxIterations: 3,
    });
    run.resumeHistory = [
      {
        resumedAt: "2026-05-21T10:00:00.000Z",
        fromIteration: 2,
        previousAgent: "claude",
        newAgent: "codex",
      },
    ];
    expect(hasResumeHistory(run)).toBe(true);
  });
});

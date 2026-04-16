import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  finalizeSession,
  type IterationRecord,
  listInterruptedSessions,
  newActiveSession,
  readSession,
  SessionSchema,
  sessionBasename,
  writeSession,
} from "./session.js";

describe("session", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "looper-session-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("newActiveSession builds a valid active session", () => {
    const session = newActiveSession({
      id: "abc",
      prompt: "./p.md",
      cli: "claude",
      model: "opus",
      maxIterations: 5,
    });

    expect(session.state).toBe("active");
    expect(session.iterations).toEqual([]);
    expect(session.completedAt).toBeNull();
    expect(session.stopReason).toBeNull();
    expect(SessionSchema.safeParse(session).success).toBe(true);
  });

  it("finalizeSession with 'aborted' transitions to interrupted", () => {
    const active = newActiveSession({
      id: "abc",
      prompt: "p",
      cli: "claude",
      model: null,
      maxIterations: 3,
    });
    const finalized = finalizeSession(active, "aborted", []);
    expect(finalized.state).toBe("interrupted");
    expect(finalized.stopReason).toBe("aborted");
    expect(SessionSchema.safeParse(finalized).success).toBe(true);
  });

  it("finalizeSession transitions to completed and records iterations", () => {
    const active = newActiveSession({
      id: "abc",
      prompt: "p",
      cli: "claude",
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
      },
    ];

    const completed = finalizeSession(active, "sentinel", iterations);

    expect(completed.state).toBe("completed");
    expect(completed.stopReason).toBe("sentinel");
    expect(completed.iterations).toEqual(iterations);
    expect(completed.completedAt).not.toBeNull();
    expect(SessionSchema.safeParse(completed).success).toBe(true);
  });

  it("writeSession persists a JSON file that round-trips through the schema", async () => {
    const session = newActiveSession({
      id: "abc-123",
      prompt: "p",
      cli: "claude",
      model: null,
      maxIterations: 2,
    });

    await writeSession(session, workDir);

    const raw = await readFile(
      path.join(
        workDir,
        ".looper",
        "sessions",
        `${sessionBasename(session)}.json`,
      ),
      "utf8",
    );
    const parsed = SessionSchema.parse(JSON.parse(raw));
    expect(parsed).toEqual(session);
  });

  it("sessionBasename uses a short id and a readable timestamp", () => {
    const session = {
      id: "4fbf870e-8488-45da-93d2-b1bb2d84b0e7",
      startedAt: "2026-04-16T19:39:01.000Z",
    };
    expect(sessionBasename(session)).toBe("4fbf870e_2026-04-16-T19-39-01");
  });

  it("readSession returns the persisted session", async () => {
    const session = newActiveSession({
      id: "xyz",
      prompt: "p",
      cli: "claude",
      model: null,
      maxIterations: 1,
    });
    await writeSession(session, workDir);
    const read = await readSession(workDir, "xyz");
    expect(read).toEqual(session);
  });

  it("readSession returns null when the session file is missing", async () => {
    expect(await readSession(workDir, "does-not-exist")).toBeNull();
  });

  it("listInterruptedSessions returns only sessions whose state is 'interrupted'", async () => {
    const active = newActiveSession({
      id: "active-1",
      prompt: "p",
      cli: "claude",
      model: null,
      maxIterations: 1,
    });
    const completed = finalizeSession(
      newActiveSession({
        id: "completed-1",
        prompt: "p",
        cli: "claude",
        model: null,
        maxIterations: 1,
      }),
      "sentinel",
      [],
    );
    const interrupted = finalizeSession(
      newActiveSession({
        id: "interrupted-1",
        prompt: "p",
        cli: "claude",
        model: null,
        maxIterations: 2,
      }),
      "aborted",
      [],
    );
    await writeSession(active, workDir);
    await writeSession(completed, workDir);
    await writeSession(interrupted, workDir);

    const list = await listInterruptedSessions(workDir);
    expect(list.map((s) => s.id)).toEqual(["interrupted-1"]);
  });

  it("SessionSchema rejects invalid state values", () => {
    const result = SessionSchema.safeParse({
      id: "x",
      prompt: "p",
      cli: "claude",
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

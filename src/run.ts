import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const AgentIdSchema = z.string().min(1);

export const IterationErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  raw: z.string(),
});

export const IterationRecordSchema = z.object({
  number: z.number().int().positive(),
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  tokensIn: z.number().int().nullable(),
  tokensOut: z.number().int().nullable(),
  sentinelDetected: z.boolean(),
  error: IterationErrorSchema.nullable().default(null),
});

export type IterationRecord = z.infer<typeof IterationRecordSchema>;

export const ResumeHistoryEntrySchema = z.object({
  resumedAt: z.string(),
  fromIteration: z.number().int().positive(),
  previousAgent: z.string().optional(),
  previousModel: z.string().nullable().optional(),
  newAgent: z.string().optional(),
  newModel: z.string().nullable().optional(),
});

export type ResumeHistoryEntry = z.infer<typeof ResumeHistoryEntrySchema>;

export const RunStateSchema = z.enum(["active", "completed", "interrupted"]);
export type RunState = z.infer<typeof RunStateSchema>;

export const RunStopReasonSchema = z.enum([
  "sentinel",
  "max_iterations",
  "error",
  "aborted",
]);
export type RunStopReason = z.infer<typeof RunStopReasonSchema>;

export const RunSchema = z.object({
  id: z.string().min(1),
  prompt: z.string(),
  agent: AgentIdSchema,
  model: z.string().nullable(),
  maxIterations: z.number().int().positive(),
  vars: z.record(z.string(), z.string()).default({}),
  state: RunStateSchema,
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  stopReason: RunStopReasonSchema.nullable(),
  iterations: z.array(IterationRecordSchema),
  resumeHistory: z.array(ResumeHistoryEntrySchema).default([]),
});

export type Run = z.infer<typeof RunSchema>;

export interface NewRunInput {
  id: string;
  prompt: string;
  agent: z.infer<typeof AgentIdSchema>;
  model: string | null;
  maxIterations: number;
  vars?: Record<string, string>;
}

export interface ResumeOverride {
  agent?: z.infer<typeof AgentIdSchema>;
  model?: string | null;
}

export function newActiveRun(input: NewRunInput): Run {
  return {
    id: input.id,
    prompt: input.prompt,
    agent: input.agent,
    model: input.model,
    maxIterations: input.maxIterations,
    vars: input.vars ?? {},
    state: "active",
    startedAt: new Date().toISOString(),
    completedAt: null,
    stopReason: null,
    iterations: [],
    resumeHistory: [],
  };
}

export function applyResumeOverride(run: Run, override: ResumeOverride): Run {
  const agentChanged =
    override.agent !== undefined && override.agent !== run.agent;
  const modelChanged =
    override.model !== undefined && override.model !== run.model;

  if (!agentChanged && !modelChanged) {
    return run;
  }

  const fromIteration = run.iterations.length + 1;

  const entry: ResumeHistoryEntry = {
    resumedAt: new Date().toISOString(),
    fromIteration,
    ...(agentChanged
      ? { previousAgent: run.agent, newAgent: override.agent }
      : {}),
    ...(modelChanged
      ? { previousModel: run.model, newModel: override.model }
      : {}),
  };

  return {
    ...run,
    agent: override.agent ?? run.agent,
    model: override.model ?? run.model,
    resumeHistory: [...run.resumeHistory, entry],
  };
}

export function hasResumeHistory(run: Run): boolean {
  return run.resumeHistory.length > 0;
}

export function finalizeRun(
  run: Run,
  stopReason: RunStopReason,
  iterations: IterationRecord[],
): Run {
  const isComplete =
    stopReason === "sentinel" || stopReason === "max_iterations";
  return {
    ...run,
    state: isComplete ? "completed" : "interrupted",
    completedAt: new Date().toISOString(),
    stopReason,
    iterations,
  };
}

const SHORT_ID_LENGTH = 8;

export function runBasename(run: Pick<Run, "id" | "startedAt">): string {
  const shortId = run.id.slice(0, SHORT_ID_LENGTH);
  const ts = run.startedAt
    .replace(/\.\d+Z$/, "")
    .replace(/Z$/, "")
    .replace(/:/g, "-")
    .replace("T", "-T");
  return `${shortId}_${ts}`;
}

export async function writeRun(run: Run, cwd: string): Promise<string> {
  const dir = path.join(cwd, ".looper", "runs");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${runBasename(run)}.json`);
  await writeFile(file, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  return file;
}

export async function readRun(cwd: string, id: string): Promise<Run | null> {
  const dir = path.join(cwd, ".looper", "runs");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if (isFileNotFound(err)) return null;
    throw err;
  }
  const short = id.slice(0, SHORT_ID_LENGTH);
  const match = files.find(
    (f) =>
      f.endsWith(".json") &&
      (f === `${id}.json` ||
        f.startsWith(`${id}_`) ||
        f.startsWith(`${short}_`)),
  );
  if (!match) return null;
  const raw = await readFile(path.join(dir, match), "utf8");
  return RunSchema.parse(JSON.parse(raw));
}

export async function listNonCompleteRuns(cwd: string): Promise<Run[]> {
  const dir = path.join(cwd, ".looper", "runs");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if (isFileNotFound(err)) return [];
    throw err;
  }
  const runs: Run[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const raw = await readFile(path.join(dir, f), "utf8");
    const parsed = RunSchema.safeParse(JSON.parse(raw));
    if (parsed.success && parsed.data.state !== "completed") {
      runs.push(parsed.data);
    }
  }
  return runs;
}

function isFileNotFound(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "ENOENT";
}

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const IterationRecordSchema = z.object({
  number: z.number().int().positive(),
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  tokensIn: z.number().int().nullable(),
  tokensOut: z.number().int().nullable(),
  sentinelDetected: z.boolean(),
});

export type IterationRecord = z.infer<typeof IterationRecordSchema>;

export const SessionStateSchema = z.enum([
  "active",
  "completed",
  "interrupted",
]);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const SessionStopReasonSchema = z.enum([
  "sentinel",
  "max_iterations",
  "error",
  "aborted",
]);
export type SessionStopReason = z.infer<typeof SessionStopReasonSchema>;

export const SessionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string(),
  cli: z.string(),
  model: z.string().nullable(),
  maxIterations: z.number().int().positive(),
  state: SessionStateSchema,
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  stopReason: SessionStopReasonSchema.nullable(),
  iterations: z.array(IterationRecordSchema),
});

export type Session = z.infer<typeof SessionSchema>;

export interface NewSessionInput {
  id: string;
  prompt: string;
  cli: string;
  model: string | null;
  maxIterations: number;
}

export function newActiveSession(input: NewSessionInput): Session {
  return {
    id: input.id,
    prompt: input.prompt,
    cli: input.cli,
    model: input.model,
    maxIterations: input.maxIterations,
    state: "active",
    startedAt: new Date().toISOString(),
    completedAt: null,
    stopReason: null,
    iterations: [],
  };
}

export function finalizeSession(
  session: Session,
  stopReason: SessionStopReason,
  iterations: IterationRecord[],
): Session {
  return {
    ...session,
    state: stopReason === "aborted" ? "interrupted" : "completed",
    completedAt: new Date().toISOString(),
    stopReason,
    iterations,
  };
}

export async function writeSession(
  session: Session,
  cwd: string,
): Promise<string> {
  const dir = path.join(cwd, ".looper", "sessions");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${session.id}.json`);
  await writeFile(file, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  return file;
}

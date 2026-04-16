import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CliNameSchema } from "./config.js";

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
  cli: CliNameSchema,
  model: z.string().nullable(),
  maxIterations: z.number().int().positive(),
  vars: z.record(z.string(), z.string()).default({}),
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
  cli: z.infer<typeof CliNameSchema>;
  model: string | null;
  maxIterations: number;
  vars?: Record<string, string>;
}

export function newActiveSession(input: NewSessionInput): Session {
  return {
    id: input.id,
    prompt: input.prompt,
    cli: input.cli,
    model: input.model,
    maxIterations: input.maxIterations,
    vars: input.vars ?? {},
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

const SHORT_ID_LENGTH = 8;

export function sessionBasename(
  session: Pick<Session, "id" | "startedAt">,
): string {
  const shortId = session.id.slice(0, SHORT_ID_LENGTH);
  const ts = session.startedAt
    .replace(/\.\d+Z$/, "")
    .replace(/Z$/, "")
    .replace(/:/g, "-")
    .replace("T", "-T");
  return `${shortId}_${ts}`;
}

export async function writeSession(
  session: Session,
  cwd: string,
): Promise<string> {
  const dir = path.join(cwd, ".looper", "sessions");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${sessionBasename(session)}.json`);
  await writeFile(file, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  return file;
}

export async function readSession(
  cwd: string,
  id: string,
): Promise<Session | null> {
  const dir = path.join(cwd, ".looper", "sessions");
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
  return SessionSchema.parse(JSON.parse(raw));
}

export async function listInterruptedSessions(cwd: string): Promise<Session[]> {
  const dir = path.join(cwd, ".looper", "sessions");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if (isFileNotFound(err)) return [];
    throw err;
  }
  const sessions: Session[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const raw = await readFile(path.join(dir, f), "utf8");
    const parsed = SessionSchema.safeParse(JSON.parse(raw));
    if (parsed.success && parsed.data.state === "interrupted") {
      sessions.push(parsed.data);
    }
  }
  return sessions;
}

function isFileNotFound(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "ENOENT";
}

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CliName } from "@0xtiby/spawner";
import { Command, InvalidArgumentError, Option } from "commander";
import { type LoopResult, loop } from "./index.js";
import {
  completeSession,
  type IterationRecord,
  newActiveSession,
  writeSession,
} from "./session.js";

const SUPPORTED_CLIS: CliName[] = ["claude", "codex", "opencode"];
const DEFAULT_MAX_ITERATIONS = 10;

interface RunCommandOptions {
  prompt: string;
  cli: CliName;
  maxIterations?: number;
  sentinel?: string;
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || String(parsed) !== value) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return parsed;
}

function formatTranscript(result: LoopResult): string {
  const parts: string[] = [];
  for (const iter of result.iterations) {
    parts.push(`--- ITERATION ${iter.number} [${iter.startedAt}] ---\n`);
    parts.push(iter.stdout);
    if (!iter.stdout.endsWith("\n")) parts.push("\n");
  }
  return parts.join("");
}

async function writeTranscript(
  sessionId: string,
  result: LoopResult,
  cwd: string,
): Promise<void> {
  const sessionsDir = path.join(cwd, ".looper", "sessions");
  await mkdir(sessionsDir, { recursive: true });
  const logPath = path.join(sessionsDir, `${sessionId}.log`);
  await writeFile(logPath, formatTranscript(result), "utf8");
}

function toIterationRecords(result: LoopResult): IterationRecord[] {
  return result.iterations.map((it) => ({
    number: it.number,
    exitCode: it.exitCode,
    durationMs: it.durationMs,
    tokensIn: it.tokensIn,
    tokensOut: it.tokensOut,
    sentinelDetected: it.sentinelDetected,
  }));
}

const program = new Command();

program
  .name("looper")
  .description("Standalone AI loop orchestration engine")
  .version("0.0.0");

program
  .command("run")
  .description("Run the loop against an AI CLI")
  .requiredOption("-p, --prompt <string>", "inline prompt string")
  .addOption(
    new Option("--cli <name>", "AI CLI to spawn")
      .choices(SUPPORTED_CLIS)
      .makeOptionMandatory(true),
  )
  .option(
    "--max-iterations <n>",
    "maximum iterations before stopping",
    parsePositiveInt,
  )
  .option("--sentinel <string>", "string that marks loop completion in output")
  .action(async (options: RunCommandOptions) => {
    const cwd = process.cwd();
    const sessionId = randomUUID();
    const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

    const session = newActiveSession({
      id: sessionId,
      prompt: options.prompt,
      cli: options.cli,
      model: null,
      maxIterations,
    });
    await writeSession(session, cwd);

    const result = await loop({
      cli: options.cli,
      prompt: options.prompt,
      cwd,
      maxIterations,
      sentinel: options.sentinel,
      onOutput: (chunk) => {
        process.stdout.write(chunk);
      },
    });

    const completed = completeSession(
      session,
      result.stopReason,
      toIterationRecords(result),
    );
    await writeSession(completed, cwd);
    await writeTranscript(sessionId, result, cwd);

    if (result.stopReason === "error") {
      const exitCode = result.iterations.at(-1)?.exitCode ?? 1;
      process.exit(exitCode === 0 ? 1 : exitCode);
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

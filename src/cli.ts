import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CliName } from "@0xtiby/spawner";
import { Command, InvalidArgumentError, Option } from "commander";
import { type LoopResult, loop } from "./index.js";

const SUPPORTED_CLIS: CliName[] = ["claude", "codex", "opencode"];

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
): Promise<void> {
  const sessionsDir = path.join(process.cwd(), ".looper", "sessions");
  await mkdir(sessionsDir, { recursive: true });
  const logPath = path.join(sessionsDir, `${sessionId}.log`);
  await writeFile(logPath, formatTranscript(result), "utf8");
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
    const sessionId = randomUUID();
    const result = await loop({
      cli: options.cli,
      prompt: options.prompt,
      cwd: process.cwd(),
      maxIterations: options.maxIterations,
      sentinel: options.sentinel,
      onOutput: (chunk) => {
        process.stdout.write(chunk);
      },
    });
    await writeTranscript(sessionId, result);
    if (result.stopReason === "error") {
      const exitCode = result.iterations.at(-1)?.exitCode ?? 1;
      process.exit(exitCode === 0 ? 1 : exitCode);
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

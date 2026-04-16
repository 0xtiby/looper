import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CliName } from "@0xtiby/spawner";
import { Command, InvalidArgumentError, Option } from "commander";
import {
  applyOverrides,
  loadConfig,
  resolveConfig,
  writeDefaultConfig,
} from "./config.js";
import { type LoopResult, loop } from "./index.js";
import {
  completeSession,
  type IterationRecord,
  newActiveSession,
  writeSession,
} from "./session.js";
import { loadPrompt } from "./template.js";

const SUPPORTED_CLIS: CliName[] = ["claude", "codex", "opencode"];

interface RunCommandOptions {
  prompt?: string;
  promptStdin?: boolean;
  cli?: CliName;
  model?: string;
  maxIterations?: number;
  sentinel?: string;
  var?: Record<string, string>;
  cwd?: string;
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || String(parsed) !== value) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return parsed;
}

function collectVar(
  value: string,
  previous: Record<string, string> = {},
): Record<string, string> {
  const eq = value.indexOf("=");
  if (eq <= 0) {
    throw new InvalidArgumentError("expected KEY=VALUE");
  }
  const key = value.slice(0, eq);
  const val = value.slice(eq + 1);
  return { ...previous, [key]: val };
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

function describePromptSource(options: RunCommandOptions): string {
  if (options.promptStdin) return "<stdin>";
  return options.prompt ?? "";
}

const program = new Command();

program
  .name("looper")
  .description("Standalone AI loop orchestration engine")
  .version("0.0.0");

program
  .command("run")
  .description("Run the loop against an AI CLI")
  .option("-p, --prompt <value>", "inline string or path to a prompt file")
  .option("--prompt-stdin", "read the prompt from stdin")
  .addOption(
    new Option("--cli <name>", "AI CLI to spawn").choices(SUPPORTED_CLIS),
  )
  .option("--model <name>", "model override")
  .option(
    "--max-iterations <n>",
    "maximum iterations before stopping",
    parsePositiveInt,
  )
  .option("--sentinel <string>", "string that marks loop completion in output")
  .option("--cwd <path>", "working directory for the spawned CLI")
  .option("--var <KEY=VALUE>", "template variable (repeatable)", collectVar)
  .action(async (options: RunCommandOptions) => {
    if (!options.prompt && !options.promptStdin) {
      console.error("Provide a prompt via -p/--prompt or --prompt-stdin");
      process.exit(1);
    }

    const hostCwd = process.cwd();
    const spawnerCwd = options.cwd
      ? path.resolve(hostCwd, options.cwd)
      : hostCwd;

    const fileConfig = await loadConfig(hostCwd);
    const resolved = applyOverrides(resolveConfig(fileConfig), {
      cli: options.cli,
      model: options.model,
      maxIterations: options.maxIterations,
      sentinel: options.sentinel,
    });

    const prompt = await loadPrompt({
      value: options.prompt,
      fromStdin: options.promptStdin,
      stdin: process.stdin,
    });

    const sessionId = randomUUID();
    const session = newActiveSession({
      id: sessionId,
      prompt: describePromptSource(options),
      cli: resolved.cli,
      model: resolved.model,
      maxIterations: resolved.maxIterations,
    });
    await writeSession(session, hostCwd);

    const vars = { ...resolved.vars, ...(options.var ?? {}) };

    const result = await loop({
      cli: resolved.cli,
      prompt,
      cwd: spawnerCwd,
      maxIterations: resolved.maxIterations,
      sentinel: resolved.sentinel,
      vars,
      sessionId,
      onOutput: (chunk) => {
        process.stdout.write(chunk);
      },
    });

    const completed = completeSession(
      session,
      result.stopReason,
      toIterationRecords(result),
    );
    await writeSession(completed, hostCwd);
    await writeTranscript(sessionId, result, hostCwd);

    if (result.stopReason === "error") {
      const exitCode = result.iterations.at(-1)?.exitCode ?? 1;
      process.exit(exitCode === 0 ? 1 : exitCode);
    }
  });

program
  .command("init")
  .description("Write a default .looper/config.json (no overwrite)")
  .action(async () => {
    try {
      const file = await writeDefaultConfig(process.cwd());
      console.log(`Wrote ${file}`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("config")
  .description("Print the current resolved config (file + defaults)")
  .action(async () => {
    const fileConfig = await loadConfig(process.cwd());
    const resolved = resolveConfig(fileConfig);
    console.log(JSON.stringify(resolved, null, 2));
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

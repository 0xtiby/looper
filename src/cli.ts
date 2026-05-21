import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CliName } from "@0xtiby/spawner";
import { Command, InvalidArgumentError, Option } from "commander";
import {
  discoverAcpAgents,
  formatAgentListingJson,
  formatAgentListingText,
  listAgents,
} from "./agents.js";
import {
  applyOverrides,
  CliNameSchema,
  loadConfig,
  resolveConfig,
  writeDefaultConfig,
} from "./config.js";
import { type LoopResult, loop } from "./index.js";
import {
  finalizeRun,
  type IterationRecord,
  listInterruptedRuns,
  newActiveRun,
  type Run,
  readRun,
  runBasename,
  writeRun,
} from "./run.js";
import { loadPrompt } from "./template.js";

const SUPPORTED_AGENTS: CliName[] = [...CliNameSchema.options];

interface RunCommandOptions {
  prompt?: string;
  promptStdin?: boolean;
  agent?: CliName;
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
    if (iter.error) {
      parts.push(
        `--- ERROR [${iter.error.code}] exit=${iter.exitCode}: ${iter.error.message} ---\n`,
      );
    } else if (iter.exitCode !== 0) {
      parts.push(`--- EXIT ${iter.exitCode} (no error details) ---\n`);
    }
  }
  return parts.join("");
}

async function persistTranscript(
  run: Pick<Run, "id" | "startedAt">,
  result: LoopResult,
  cwd: string,
  mode: "write" | "append",
): Promise<void> {
  const runsDir = path.join(cwd, ".looper", "runs");
  await mkdir(runsDir, { recursive: true });
  const logPath = path.join(runsDir, `${runBasename(run)}.log`);
  const body = formatTranscript(result);
  if (mode === "append") {
    await appendFile(logPath, body, "utf8");
  } else {
    await writeFile(logPath, body, "utf8");
  }
}

function toIterationRecords(result: LoopResult): IterationRecord[] {
  return result.iterations.map((it) => ({
    number: it.number,
    exitCode: it.exitCode,
    durationMs: it.durationMs,
    tokensIn: it.tokensIn,
    tokensOut: it.tokensOut,
    sentinelDetected: it.sentinelDetected,
    error: it.error,
  }));
}

function describePromptSource(options: RunCommandOptions): string {
  if (options.promptStdin) return "<stdin>";
  return options.prompt ?? "";
}

function resolveModel(model: string | null | undefined): string | undefined {
  if (!model || model === "default") return undefined;
  return model;
}

function exitCodeForResult(result: LoopResult): number {
  if (result.stopReason === "aborted") return 130;
  if (result.stopReason === "error") {
    const tail = result.iterations.at(-1)?.exitCode ?? 1;
    return tail === 0 ? 1 : tail;
  }
  return 0;
}

const program = new Command();

program
  .name("looper")
  .description("Standalone AI loop orchestration engine")
  .version("0.0.0");

program
  .command("agents")
  .description("List discovered ACP Agents")
  .option("--json", "print detailed Agent metadata as JSON")
  .action(async (options: { json?: boolean }) => {
    const agents = await listAgents(discoverAcpAgents);
    if (options.json) {
      process.stdout.write(formatAgentListingJson(agents));
      return;
    }
    console.log(formatAgentListingText(agents));
  });

program
  .command("run")
  .description("Run the loop against an AI Agent")
  .option("-p, --prompt <value>", "inline string or path to a prompt file")
  .option("--prompt-stdin", "read the prompt from stdin")
  .addOption(
    new Option("--agent <id>", "Agent id to run").choices(SUPPORTED_AGENTS),
  )
  .option("--model <name>", "model override")
  .option(
    "--max-iterations <n>",
    "maximum iterations before stopping",
    parsePositiveInt,
  )
  .option("--sentinel <string>", "string that marks loop completion in output")
  .option("--cwd <path>", "working directory for the spawned Agent")
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
      cli: options.agent,
      model: options.model,
      maxIterations: options.maxIterations,
      sentinel: options.sentinel,
    });

    const prompt = await loadPrompt({
      value: options.prompt,
      fromStdin: options.promptStdin,
      stdin: process.stdin,
    });

    const vars = { ...resolved.vars, ...(options.var ?? {}) };

    const runId = randomUUID();
    const run = newActiveRun({
      id: runId,
      prompt: describePromptSource(options),
      agent: resolved.cli,
      model: resolved.model,
      maxIterations: resolved.maxIterations,
      vars,
    });
    await writeRun(run, hostCwd);

    const controller = new AbortController();
    const onSigint = () => controller.abort();
    process.on("SIGINT", onSigint);

    let result: LoopResult;
    try {
      result = await loop({
        agent: resolved.cli,
        prompt,
        cwd: spawnerCwd,
        model: resolveModel(resolved.model),
        maxIterations: resolved.maxIterations,
        sentinel: resolved.sentinel,
        vars,
        runId,
        signal: controller.signal,
        onOutput: (chunk) => {
          process.stdout.write(chunk);
        },
      });
    } finally {
      process.off("SIGINT", onSigint);
    }

    const finalized = finalizeRun(
      run,
      result.stopReason,
      toIterationRecords(result),
    );
    await writeRun(finalized, hostCwd);
    await persistTranscript(run, result, hostCwd, "write");

    const code = exitCodeForResult(result);
    if (code !== 0) process.exit(code);
  });

program
  .command("resume [run-id]")
  .description("Resume an interrupted run (or list them with no id)")
  .action(async (runId?: string) => {
    const cwd = process.cwd();

    if (!runId) {
      const runs = await listInterruptedRuns(cwd);
      if (runs.length === 0) {
        console.log("No interrupted runs.");
        return;
      }
      for (const r of runs) {
        const preview =
          r.prompt.length > 60 ? `${r.prompt.slice(0, 60)}…` : r.prompt;
        const shortId = r.id.slice(0, 8);
        console.log(
          `${shortId}  ${r.startedAt}  (${r.iterations.length} done)  ${preview}`,
        );
      }
      return;
    }

    const run = await readRun(cwd, runId);
    if (!run) {
      console.error(`Run ${runId} not found`);
      process.exit(1);
    }
    if (run.state !== "interrupted") {
      console.error(`Run ${runId} is ${run.state}, not interrupted`);
      process.exit(1);
    }
    if (run.prompt === "<stdin>") {
      console.error("Cannot resume runs whose prompt came from stdin");
      process.exit(1);
    }

    const fileConfig = await loadConfig(cwd);
    const resolved = resolveConfig(fileConfig);
    const prompt = await loadPrompt({ value: run.prompt });

    const controller = new AbortController();
    const onSigint = () => controller.abort();
    process.on("SIGINT", onSigint);

    let result: LoopResult;
    try {
      result = await loop({
        agent: run.agent,
        prompt,
        cwd,
        model: resolveModel(run.model ?? resolved.model),
        maxIterations: run.maxIterations,
        sentinel: resolved.sentinel,
        vars: { ...resolved.vars, ...run.vars },
        runId: run.id,
        signal: controller.signal,
        startIteration: run.iterations.length + 1,
        onOutput: (chunk) => {
          process.stdout.write(chunk);
        },
      });
    } finally {
      process.off("SIGINT", onSigint);
    }

    const mergedIterations = [...run.iterations, ...toIterationRecords(result)];
    const finalized = finalizeRun(run, result.stopReason, mergedIterations);
    await writeRun(finalized, cwd);
    await persistTranscript(run, result, cwd, "append");

    const code = exitCodeForResult(result);
    if (code !== 0) process.exit(code);
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

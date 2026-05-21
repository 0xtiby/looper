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
  finalizeSession,
  type IterationRecord,
  listInterruptedSessions,
  newActiveSession,
  readSession,
  type Session,
  sessionBasename,
  writeSession,
} from "./session.js";
import { loadPrompt } from "./template.js";

const SUPPORTED_CLIS: CliName[] = [...CliNameSchema.options];

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
  session: Pick<Session, "id" | "startedAt">,
  result: LoopResult,
  cwd: string,
  mode: "write" | "append",
): Promise<void> {
  const sessionsDir = path.join(cwd, ".looper", "sessions");
  await mkdir(sessionsDir, { recursive: true });
  const logPath = path.join(sessionsDir, `${sessionBasename(session)}.log`);
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

    const vars = { ...resolved.vars, ...(options.var ?? {}) };

    const sessionId = randomUUID();
    const session = newActiveSession({
      id: sessionId,
      prompt: describePromptSource(options),
      cli: resolved.cli,
      model: resolved.model,
      maxIterations: resolved.maxIterations,
      vars,
    });
    await writeSession(session, hostCwd);

    const controller = new AbortController();
    const onSigint = () => controller.abort();
    process.on("SIGINT", onSigint);

    let result: LoopResult;
    try {
      result = await loop({
        cli: resolved.cli,
        prompt,
        cwd: spawnerCwd,
        model: resolveModel(resolved.model),
        maxIterations: resolved.maxIterations,
        sentinel: resolved.sentinel,
        vars,
        sessionId,
        signal: controller.signal,
        onOutput: (chunk) => {
          process.stdout.write(chunk);
        },
      });
    } finally {
      process.off("SIGINT", onSigint);
    }

    const finalized = finalizeSession(
      session,
      result.stopReason,
      toIterationRecords(result),
    );
    await writeSession(finalized, hostCwd);
    await persistTranscript(session, result, hostCwd, "write");

    const code = exitCodeForResult(result);
    if (code !== 0) process.exit(code);
  });

program
  .command("resume [session-id]")
  .description("Resume an interrupted session (or list them with no id)")
  .action(async (sessionId?: string) => {
    const cwd = process.cwd();

    if (!sessionId) {
      const sessions = await listInterruptedSessions(cwd);
      if (sessions.length === 0) {
        console.log("No interrupted sessions.");
        return;
      }
      for (const s of sessions) {
        const preview =
          s.prompt.length > 60 ? `${s.prompt.slice(0, 60)}…` : s.prompt;
        const shortId = s.id.slice(0, 8);
        console.log(
          `${shortId}  ${s.startedAt}  (${s.iterations.length} done)  ${preview}`,
        );
      }
      return;
    }

    const session = await readSession(cwd, sessionId);
    if (!session) {
      console.error(`Session ${sessionId} not found`);
      process.exit(1);
    }
    if (session.state !== "interrupted") {
      console.error(
        `Session ${sessionId} is ${session.state}, not interrupted`,
      );
      process.exit(1);
    }
    if (session.prompt === "<stdin>") {
      console.error("Cannot resume sessions whose prompt came from stdin");
      process.exit(1);
    }

    const fileConfig = await loadConfig(cwd);
    const resolved = resolveConfig(fileConfig);
    const prompt = await loadPrompt({ value: session.prompt });

    const controller = new AbortController();
    const onSigint = () => controller.abort();
    process.on("SIGINT", onSigint);

    let result: LoopResult;
    try {
      result = await loop({
        cli: session.cli,
        prompt,
        cwd,
        model: resolveModel(session.model ?? resolved.model),
        maxIterations: session.maxIterations,
        sentinel: resolved.sentinel,
        vars: { ...resolved.vars, ...session.vars },
        sessionId: session.id,
        signal: controller.signal,
        startIteration: session.iterations.length + 1,
        onOutput: (chunk) => {
          process.stdout.write(chunk);
        },
      });
    } finally {
      process.off("SIGINT", onSigint);
    }

    const mergedIterations = [
      ...session.iterations,
      ...toIterationRecords(result),
    ];
    const finalized = finalizeSession(
      session,
      result.stopReason,
      mergedIterations,
    );
    await writeSession(finalized, cwd);
    await persistTranscript(session, result, cwd, "append");

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

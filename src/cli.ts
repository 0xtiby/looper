import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { Command, InvalidArgumentError, Option } from "commander";
import type { AcpAgentServerLaunch } from "./acp.js";
import {
  discoverAcpAgents,
  discoverConfiguredAgents,
  formatAgentListingJson,
  formatAgentListingText,
  type ListedAgent,
  listAgents,
} from "./agents.js";
import {
  type AgentId,
  AgentIdSchema,
  applyOverrides,
  BuiltInAgentIdSchema,
  DEFAULT_CONFIG,
  loadConfig,
  type ResolvedConfig,
  resolveConfig,
  writeConfig,
} from "./config.js";
import { type LoopResult, loop } from "./index.js";
import {
  IncompatibleAgentError,
  NonInteractiveInitError,
  resolveInitAgent,
  UnknownAgentError,
} from "./init.js";
import { formatRunInspectionJson } from "./inspect.js";
import {
  MissingAgentError,
  IncompatibleAgentError as PreflightIncompatibleAgentError,
  preflight,
  UnavailableAgentError,
} from "./preflight.js";
import { resolveRegistryAgentServer } from "./registry.js";
import {
  type AcpAgentServerSnapshot,
  applyResumeOverride,
  finalizeRun,
  hasResumeHistory,
  type IterationRecord,
  listNonCompleteRuns,
  newActiveRun,
  type Run,
  readRun,
  runBasename,
  snapshotAcpAgentServer,
  writeRun,
} from "./run.js";
import { loadPrompt } from "./template.js";

const SUPPORTED_AGENTS = [...BuiltInAgentIdSchema.options];

interface RunCommandOptions {
  prompt?: string;
  promptStdin?: boolean;
  agent?: AgentId;
  model?: string;
  maxIterations?: number;
  sentinel?: string;
  var?: Record<string, string>;
  cwd?: string;
}

interface ResumeCommandOptions {
  agent?: AgentId;
  model?: string;
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

async function ttySelectAgent(agents: ListedAgent[]): Promise<AgentId> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log("Compatible agents:");
    agents.forEach((agent, i) => {
      console.log(`  ${i + 1}. ${agent.displayName} (${agent.id})`);
    });

    rl.question(`Select an agent (1-${agents.length}): `, (answer) => {
      rl.close();
      const index = Number.parseInt(answer, 10) - 1;
      const selected = agents[index];
      if (selected) {
        resolve(AgentIdSchema.parse(selected.id));
      } else {
        reject(new Error("Invalid selection"));
      }
    });
  });
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

class ConfiguredAgentServerError extends Error {
  constructor(agent: string) {
    super(`Agent "${agent}" is not configured in agent_servers.`);
    this.name = "ConfiguredAgentServerError";
  }
}

interface ResolvedAgentServerContext {
  snapshot: AcpAgentServerSnapshot;
  launch: AcpAgentServerLaunch;
}

async function resolveAgentServer(
  config: ResolvedConfig,
): Promise<ResolvedAgentServerContext> {
  const agentServer = config.agentServers[config.agent];
  if (!agentServer) throw new ConfiguredAgentServerError(config.agent);
  const launch =
    agentServer.type === "custom"
      ? agentServer
      : (await resolveRegistryAgentServer(agentServer, undefined, config.agent))
          .launch;
  return {
    snapshot: snapshotAcpAgentServer({
      id: config.agent,
      config: agentServer,
      launch,
    }),
    launch,
  };
}

async function preflightBuiltInAgent(config: ResolvedConfig): Promise<void> {
  if (!BuiltInAgentIdSchema.safeParse(config.agent).success) return;
  await preflight(config.agent, config.model, {
    discoverAgents: discoverAcpAgents,
  });
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
    const fileConfig = await loadConfig(process.cwd());
    const agents = await listAgents(() => {
      if (fileConfig?.agent_servers) {
        return discoverConfiguredAgents(fileConfig.agent_servers);
      }
      return discoverAcpAgents();
    });
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
  .addOption(new Option("--agent <id>", "Agent id to run"))
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
      agent: options.agent,
      model: options.model,
      maxIterations: options.maxIterations,
      sentinel: options.sentinel,
    });

    const agentServer = await resolveAgentServer(resolved);

    try {
      await preflightBuiltInAgent(resolved);
    } catch (err) {
      if (
        err instanceof MissingAgentError ||
        err instanceof UnavailableAgentError ||
        err instanceof PreflightIncompatibleAgentError
      ) {
        console.error(err.message);
        process.exit(1);
      }
      throw err;
    }

    const prompt = await loadPrompt({
      value: options.prompt,
      fromStdin: options.promptStdin,
      stdin: process.stdin,
    });

    const vars = { ...resolved.vars, ...(options.var ?? {}) };

    const runId = randomUUID();
    const run = newActiveRun({
      id: runId,
      prompt,
      agent: resolved.agent,
      agentServer: agentServer.snapshot,
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
        agent: resolved.agent,
        agentServer: agentServer.launch,
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
  .addOption(new Option("--agent <id>", "Agent override for the resumed run"))
  .option("--model <name>", "model override for the resumed run")
  .action(async (runId: string | undefined, options: ResumeCommandOptions) => {
    const cwd = process.cwd();

    if (!runId) {
      const runs = await listNonCompleteRuns(cwd);
      if (runs.length === 0) {
        console.log("No non-complete runs.");
        return;
      }
      for (const r of runs) {
        const shortId = r.id.slice(0, 8);
        const stopReason = r.stopReason ?? "active";
        const progress = `${r.iterations.length}/${r.maxIterations}`;
        const historyIndicator = hasResumeHistory(r) ? " [resumed]" : "";
        console.log(
          `${shortId}  ${r.startedAt}  ${stopReason}  ${r.agent}${historyIndicator}  ${progress}`,
        );
      }
      return;
    }

    const run = await readRun(cwd, runId);
    if (!run) {
      console.error(`Run ${runId} not found`);
      process.exit(1);
    }
    if (run.state === "completed") {
      console.error(`Run ${runId} is already complete`);
      process.exit(1);
    }

    const fileConfig = await loadConfig(cwd);
    const resolved = resolveConfig(fileConfig);
    const overrideAgentServer = options.agent
      ? await resolveAgentServer({
          ...resolved,
          agent: options.agent,
          model: options.model ?? resolved.model,
        })
      : null;
    const resumedRun = applyResumeOverride(run, {
      agent: options.agent,
      agentServer: overrideAgentServer?.snapshot,
      model: options.model,
    });

    const agentServer =
      resumedRun.agentServer?.launch ??
      (
        await resolveAgentServer({
          ...resolved,
          agent: resumedRun.agent,
          model: resumedRun.model ?? resolved.model,
        })
      ).launch;

    try {
      await preflightBuiltInAgent({
        ...resolved,
        agent: resumedRun.agent,
        model: resumedRun.model ?? resolved.model,
      });
    } catch (err) {
      if (
        err instanceof MissingAgentError ||
        err instanceof UnavailableAgentError ||
        err instanceof PreflightIncompatibleAgentError
      ) {
        console.error(err.message);
        process.exit(1);
      }
      throw err;
    }

    const prompt = resumedRun.resolvedPrompt;

    const controller = new AbortController();
    const onSigint = () => controller.abort();
    process.on("SIGINT", onSigint);

    let result: LoopResult;
    try {
      result = await loop({
        agent: resumedRun.agent,
        agentServer,
        prompt,
        cwd,
        model: resolveModel(resumedRun.model),
        maxIterations: resumedRun.maxIterations,
        sentinel: resolved.sentinel,
        vars: { ...resolved.vars, ...resumedRun.vars },
        runId: resumedRun.id,
        signal: controller.signal,
        startIteration: resumedRun.iterations.length + 1,
        onOutput: (chunk) => {
          process.stdout.write(chunk);
        },
      });
    } finally {
      process.off("SIGINT", onSigint);
    }

    const mergedIterations = [
      ...resumedRun.iterations,
      ...toIterationRecords(result),
    ];
    const finalized = finalizeRun(
      resumedRun,
      result.stopReason,
      mergedIterations,
    );
    await writeRun(finalized, cwd);
    await persistTranscript(resumedRun, result, cwd, "append");

    const code = exitCodeForResult(result);
    if (code !== 0) process.exit(code);
  });

program
  .command("inspect <run-id>")
  .description("Show persisted context and resume history for a run")
  .action(async (runId: string) => {
    const cwd = process.cwd();
    const run = await readRun(cwd, runId);
    if (!run) {
      console.error(`Run ${runId} not found`);
      process.exit(1);
    }
    process.stdout.write(formatRunInspectionJson(run));
  });

program
  .command("init")
  .description("Initialize .looper/config.json with a configured agent")
  .addOption(
    new Option(
      "--agent <id>",
      "Agent id to set as default (non-interactive)",
    ).choices(SUPPORTED_AGENTS),
  )
  .action(async (options: { agent?: AgentId }) => {
    const cwd = process.cwd();

    const existing = await loadConfig(cwd);
    if (existing !== null) {
      console.error("Config file already exists");
      process.exit(1);
    }

    try {
      const agent = await resolveInitAgent({
        agent: options.agent,
        deps: {
          isTty: process.stdin.isTTY === true,
          listAgents: async () => listAgents(discoverAcpAgents),
          selectAgent: ttySelectAgent,
        },
      });
      const file = await writeConfig(cwd, {
        agent,
        model: DEFAULT_CONFIG.model,
        maxIterations: DEFAULT_CONFIG.maxIterations,
        sentinel: DEFAULT_CONFIG.sentinel,
        vars: DEFAULT_CONFIG.vars,
      });
      console.log(`Wrote ${file}`);
    } catch (err) {
      if (
        err instanceof IncompatibleAgentError ||
        err instanceof NonInteractiveInitError ||
        err instanceof UnknownAgentError
      ) {
        console.error(err.message);
        process.exit(1);
      }
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

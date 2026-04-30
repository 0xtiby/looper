import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_SENTINEL = ":::LOOPER_DONE:::";
const DEFAULT_MAX_ITERATIONS = 10;
const TMP_CLEANUP_DELAY_MS = 5000;

type Multiplexer = "zellij" | "tmux";
type Direction = "right" | "down" | "left" | "up";
type LooperCLI = "claude" | "codex" | "opencode";

const LOOPER_CLIS = ["claude", "codex", "opencode"] as const;
const DIRECTIONS = ["right", "down", "left", "up"] as const;

type ToolUpdate = { content: Array<{ type: string; text: string }> };
type OnUpdate = (u: ToolUpdate) => void;

interface SpawnCtx {
  pi: ExtensionAPI;
  onUpdate?: OnUpdate;
}

interface PaneOptions {
  name: string;
  cwd: string;
  command: string[];
  direction?: Direction;
  floating?: boolean;
}

interface SpawnResult {
  paneName: string;
  command: string;
}

interface MuxAvailability {
  zellij: boolean;
  tmux: boolean;
  preferred: Multiplexer | null;
}

function makePaneName(): string {
  const ts = Date.now().toString(36).slice(-4);
  const rand = Math.random().toString(36).slice(2, 5);
  return `looper-${ts}-${rand}`;
}

async function detectMultiplexers(pi: ExtensionAPI): Promise<MuxAvailability> {
  const [zellij, tmux] = await Promise.all([
    pi.exec("which", ["zellij"]).then((r) => r.code === 0),
    pi.exec("which", ["tmux"]).then((r) => r.code === 0),
  ]);
  const preferred: Multiplexer | null = zellij
    ? "zellij"
    : tmux
      ? "tmux"
      : null;
  return { zellij, tmux, preferred };
}

function isInZellij(): boolean {
  return process.env.ZELLIJ !== undefined || !!process.env.ZELLIJ_SESSION_NAME;
}

async function listPromptFiles(cwd: string): Promise<string[]> {
  const looperDir = join(cwd, ".looper");
  try {
    const entries = await readdir(looperDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => join(looperDir, e.name));
  } catch {
    return [];
  }
}

function parseMaxIterations(input: string | undefined): number {
  const parsed = Number.parseInt(input ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_ITERATIONS;
}

const muxArgs: Record<Multiplexer, (o: PaneOptions) => string[]> = {
  zellij: (o) => [
    "run",
    "--name",
    o.name,
    "--close-on-exit",
    "--cwd",
    o.cwd,
    ...(o.direction ? ["--direction", o.direction] : []),
    ...(o.floating ? ["--floating"] : []),
    "--",
    ...o.command,
  ],
  tmux: (o) => ["new-session", "-d", "-s", o.name, "-c", o.cwd, ...o.command],
};

async function spawnPane(
  ctx: SpawnCtx,
  mux: Multiplexer,
  opts: PaneOptions,
): Promise<SpawnResult> {
  const label = mux === "zellij" ? "pane" : "session";
  ctx.onUpdate?.({
    content: [
      { type: "text", text: `Spawning ${mux} ${label} \`${opts.name}\`...` },
    ],
  });
  const result = await ctx.pi.exec(mux, muxArgs[mux](opts));
  if (result.code !== 0) {
    throw new Error(
      `${mux} failed (exit ${result.code}): ${result.stderr || result.stdout}`,
    );
  }
  return { paneName: opts.name, command: opts.command.join(" ") };
}

interface LooperOptions {
  prompt: string;
  promptFile?: string;
  cli: LooperCLI;
  cwd: string;
  model?: string;
  maxIterations: number;
  sentinel: string;
  vars?: Record<string, string>;
  direction?: Direction;
  floating: boolean;
}

async function runLooper(
  pi: ExtensionAPI,
  mux: Multiplexer,
  opts: LooperOptions,
  onUpdate?: OnUpdate,
): Promise<{
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
}> {
  const paneName = makePaneName();

  let promptPath: string;
  let tmpDir: string | undefined;

  if (opts.promptFile) {
    promptPath = resolve(opts.promptFile);
  } else {
    tmpDir = await mkdtemp(join(tmpdir(), "pi-looper-"));
    promptPath = join(tmpDir, "prompt.md");
    await writeFile(promptPath, opts.prompt, "utf8");
  }

  const looperArgs = [
    "run",
    "-p",
    promptPath,
    "--cli",
    opts.cli,
    "--cwd",
    opts.cwd,
    "--max-iterations",
    String(opts.maxIterations),
    "--sentinel",
    opts.sentinel,
  ];
  if (opts.model) looperArgs.push("--model", opts.model);
  if (opts.vars) {
    for (const [k, v] of Object.entries(opts.vars)) {
      looperArgs.push("--var", `${k}=${v}`);
    }
  }

  const result = await spawnPane({ pi, onUpdate }, mux, {
    name: paneName,
    cwd: opts.cwd,
    command: ["looper", ...looperArgs],
    direction: opts.direction,
    floating: opts.floating,
  });

  if (tmpDir) {
    const dirToRemove = tmpDir;
    setTimeout(() => {
      rm(dirToRemove, { recursive: true, force: true }).catch((err) => {
        onUpdate?.({
          content: [
            {
              type: "text",
              text: `Warning: failed to clean up tmp prompt dir ${dirToRemove}: ${err?.message ?? err}`,
            },
          ],
        });
      });
    }, TMP_CLEANUP_DELAY_MS).unref?.();
  }

  const muxLabel = mux === "zellij" ? "pane" : "session";
  const attachCmd =
    mux === "zellij"
      ? `Use Zellij keybindings to navigate to it.`
      : `Attach: tmux attach -t ${paneName}`;

  return {
    content: [
      {
        type: "text",
        text:
          `✓ Looper spawned in ${mux} ${muxLabel} **\`${paneName}\`**\n\n` +
          `- CLI: ${opts.cli}\n` +
          `- CWD: ${opts.cwd}\n` +
          `- Max iterations: ${opts.maxIterations}\n` +
          `- Sentinel: \`${opts.sentinel}\`\n\n` +
          attachCmd,
      },
    ],
    details: { paneName, multiplexer: mux, command: result.command },
  };
}

type PromptChoice = { prompt: string; promptFile?: string };

async function pickPrompt(ctx: {
  ui: any;
  cwd: string;
}): Promise<PromptChoice | null> {
  const promptFiles = await listPromptFiles(ctx.cwd);

  if (promptFiles.length > 0) {
    const NEW_PROMPT_LABEL = "✎  Write new prompt...";
    const fileLabels = promptFiles.map((p) => p.replace(`${ctx.cwd}/`, ""));
    const labels = [...fileLabels, NEW_PROMPT_LABEL];
    const choice = await ctx.ui.select("Choose prompt:", labels);
    if (!choice) return null;
    const idx = fileLabels.indexOf(choice);
    if (idx >= 0) {
      const promptFile = promptFiles[idx];
      const prompt = await readFile(promptFile, "utf8");
      return { prompt, promptFile };
    }
  }

  const text = await ctx.ui.editor("Task prompt for looper:", "");
  if (!text) return null;
  return { prompt: text };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "looper_run",
    label: "Looper Run",
    description:
      "Spawn a looper run in a new Zellij pane or tmux session. Auto-detects the available multiplexer.",
    promptSnippet:
      "Run looper in a background pane/session for long-running tasks",
    promptGuidelines: [
      "Use looper_run when the user wants to delegate a long task to looper while continuing the pi conversation.",
      "Confirm the CLI and key options with the user before starting.",
    ],
    parameters: Type.Object({
      prompt: Type.String({ description: "Task prompt passed to looper" }),
      cli: StringEnum(LOOPER_CLIS),
      cwd: Type.Optional(
        Type.String({
          description: "Working directory (default: current cwd)",
        }),
      ),
      model: Type.Optional(
        Type.String({
          description: "Model override (e.g. opus, sonnet)",
        }),
      ),
      maxIterations: Type.Optional(
        Type.Number({
          default: DEFAULT_MAX_ITERATIONS,
          description: "Maximum iterations",
        }),
      ),
      sentinel: Type.Optional(
        Type.String({
          default: DEFAULT_SENTINEL,
          description: "String that signals completion",
        }),
      ),
      vars: Type.Optional(
        Type.Record(Type.String(), Type.String(), {
          description: "Template variables (KEY=VALUE)",
        }),
      ),
      multiplexer: Type.Optional(
        StringEnum(["zellij", "tmux"] as const, {
          description: "Force zellij or tmux (default: auto-detect)",
        }),
      ),
      direction: Type.Optional(
        StringEnum(DIRECTIONS, {
          description: "Pane direction (zellij only)",
        }),
      ),
      floating: Type.Optional(Type.Boolean({ default: false })),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const mux =
        params.multiplexer ?? (await detectMultiplexers(pi)).preferred;
      if (!mux) {
        throw new Error("No multiplexer found. Install zellij or tmux first.");
      }

      if (mux === "zellij" && !isInZellij()) {
        throw new Error(
          "Zellij detected but pi is not running inside a Zellij session. " +
            "Start pi from within Zellij, or force tmux with multiplexer: 'tmux'.",
        );
      }

      return runLooper(
        pi,
        mux,
        {
          prompt: params.prompt,
          cli: params.cli as LooperCLI,
          cwd: resolve(params.cwd ?? ctx.cwd),
          model: params.model,
          maxIterations: params.maxIterations ?? DEFAULT_MAX_ITERATIONS,
          sentinel: params.sentinel ?? DEFAULT_SENTINEL,
          vars: params.vars,
          direction: params.direction as Direction | undefined,
          floating: params.floating ?? false,
        },
        onUpdate,
      );
    },
  });

  pi.registerCommand("looper-run", {
    description: "Interactively start a looper run in a new pane or session",
    handler: async (_args, ctx) => {
      const avail = await detectMultiplexers(pi);
      if (!avail.preferred) {
        ctx.ui.notify(
          "No multiplexer found. Install zellij or tmux first.",
          "error",
        );
        return;
      }

      const cwd = ctx.cwd;

      const picked = await pickPrompt({ ui: ctx.ui, cwd });
      if (!picked) return;

      let chosenMux: Multiplexer = avail.preferred;
      if (avail.zellij && avail.tmux) {
        const muxLabels: Record<Multiplexer, string> = {
          zellij: "zellij (pane in current session)",
          tmux: "tmux (new detached session)",
        };
        const pick = await ctx.ui.select("Multiplexer:", [
          muxLabels.zellij,
          muxLabels.tmux,
        ]);
        if (pick === muxLabels.zellij) chosenMux = "zellij";
        else if (pick === muxLabels.tmux) chosenMux = "tmux";
      }

      if (chosenMux === "zellij" && !isInZellij()) {
        ctx.ui.notify(
          "Zellij chosen but pi is not inside a Zellij session. " +
            "Use tmux instead, or restart pi from Zellij.",
          "error",
        );
        return;
      }

      const cli = (await ctx.ui.select("Pick AI CLI:", [...LOOPER_CLIS])) as
        | LooperCLI
        | undefined;
      if (!cli) return;

      const model =
        (await ctx.ui.input(
          "Model override (optional, e.g. opus, sonnet):",
          "",
        )) || undefined;

      const maxIterStr = await ctx.ui.input(
        "Max iterations:",
        String(DEFAULT_MAX_ITERATIONS),
      );
      const maxIterations = parseMaxIterations(maxIterStr);

      const sentinel =
        (await ctx.ui.input("Sentinel:", DEFAULT_SENTINEL)) || DEFAULT_SENTINEL;

      let direction: Direction | undefined;
      let floating = false;

      if (chosenMux === "zellij") {
        const dirLabels: Record<Direction, string> = {
          right: "right →",
          down: "down ↓",
          left: "left ←",
          up: "up ↑",
        };
        const dirPick = await ctx.ui.select("Pane direction:", [
          dirLabels.right,
          dirLabels.down,
          dirLabels.left,
          dirLabels.up,
        ]);
        direction = (Object.keys(dirLabels) as Direction[]).find(
          (k) => dirLabels[k] === dirPick,
        );
        floating =
          (await ctx.ui.confirm(
            "Floating pane?",
            "Open as floating window?",
          )) ?? false;
      }

      ctx.ui.notify("Spawning...", "info");

      try {
        await runLooper(pi, chosenMux, {
          prompt: picked.prompt,
          promptFile: picked.promptFile,
          cli,
          cwd,
          model,
          maxIterations,
          sentinel,
          direction,
          floating,
        });

        ctx.ui.notify(
          `✓ Looper ${chosenMux} pane/session spawned with ${cli}`,
          "success",
        );
      } catch (e: any) {
        ctx.ui.notify(e?.message ?? String(e), "error");
      }
    },
  });
}

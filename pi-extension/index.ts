import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import {
  mkdtemp,
  writeFile,
  rm,
  readdir,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────────

type Multiplexer = "zellij" | "tmux";

interface SpawnCtx {
  pi: ExtensionAPI;
  onUpdate?: (update: { content: Array<{ type: string; text: string }> }) => void;
}

interface PaneOptions {
  name: string;
  cwd: string;
  command: string[];
  direction?: string;
  floating?: boolean;
}

interface SpawnResult {
  paneName: string;
  command: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePaneName(): string {
  const ts = Date.now().toString(36).slice(-4);
  const rand = Math.random().toString(36).slice(2, 5);
  return `looper-${ts}-${rand}`;
}

async function whichMultiplexer(pi: ExtensionAPI): Promise<Multiplexer | null> {
  const [zellij, tmux] = await Promise.all([
    pi.exec("which", ["zellij"]).then((r) => r.code === 0),
    pi.exec("which", ["tmux"]).then((r) => r.code === 0),
  ]);
  if (zellij && process.env.ZELLIJ === "0") return "zellij";
  if (zellij) return "zellij";
  if (tmux) return "tmux";
  return null;
}

function isInZellij(): boolean {
  return process.env.ZELLIJ === "0" || !!process.env.ZELLIJ_SESSION_NAME;
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

// ─── Multiplexer backends ────────────────────────────────────────────────────

async function spawnZellij(
  { pi, onUpdate }: SpawnCtx,
  opts: PaneOptions
): Promise<SpawnResult> {
  const args = [
    "run",
    "--name",
    opts.name,
    "--close-on-exit",
    "--cwd",
    opts.cwd,
  ];
  if (opts.direction) args.push("--direction", opts.direction);
  if (opts.floating) args.push("--floating");
  args.push("--", ...opts.command);

  onUpdate?.({
    content: [{ type: "text", text: `Spawning Zellij pane \`${opts.name}\`...` }],
  });

  const result = await pi.exec("zellij", args);
  if (result.code !== 0) {
    throw new Error(
      `zellij run failed (exit ${result.code}): ${result.stderr || result.stdout}`
    );
  }

  return { paneName: opts.name, command: opts.command.join(" ") };
}

async function spawnTmux(
  { pi, onUpdate }: SpawnCtx,
  opts: PaneOptions
): Promise<SpawnResult> {
  const args = [
    "new-session",
    "-d",
    "-s",
    opts.name,
    "-c",
    opts.cwd,
    ...opts.command,
  ];

  onUpdate?.({
    content: [{ type: "text", text: `Spawning tmux session \`${opts.name}\`...` }],
  });

  const result = await pi.exec("tmux", args);
  if (result.code !== 0) {
    throw new Error(
      `tmux new-session failed (exit ${result.code}): ${result.stderr || result.stdout}`
    );
  }

  return { paneName: opts.name, command: opts.command.join(" ") };
}

async function spawnPane(
  ctx: SpawnCtx,
  mux: Multiplexer,
  opts: PaneOptions
): Promise<SpawnResult> {
  if (mux === "zellij") return spawnZellij(ctx, opts);
  return spawnTmux(ctx, opts);
}

// ─── Looper orchestration ────────────────────────────────────────────────────

interface LooperOptions {
  prompt: string;
  promptFile?: string;
  cli: string;
  cwd: string;
  model?: string;
  maxIterations: number;
  sentinel: string;
  vars?: Record<string, string>;
  direction?: string;
  floating: boolean;
}

async function runLooper(
  pi: ExtensionAPI,
  mux: Multiplexer,
  opts: LooperOptions,
  onUpdate?: SpawnCtx["onUpdate"]
): Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown> }> {
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

  const result = await spawnPane(
    { pi, onUpdate },
    mux,
    {
      name: paneName,
      cwd: opts.cwd,
      command: ["looper", ...looperArgs],
      direction: opts.direction,
      floating: opts.floating,
    }
  );

  if (tmpDir) {
    rm(tmpDir, { recursive: true, force: true }).catch(() => {});
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

// ─── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ─── Tool: looper_run ─────────────────────────────────────────────────────
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
      cli: StringEnum(["claude", "codex", "opencode"] as const),
      cwd: Type.Optional(Type.String({
        description: "Working directory (default: current cwd)",
      })),
      model: Type.Optional(Type.String({
        description: "Model override (e.g. opus, sonnet)",
      })),
      maxIterations: Type.Optional(
        Type.Number({ default: 10, description: "Maximum iterations" })
      ),
      sentinel: Type.Optional(
        Type.String({
          default: ":::LOOPER_DONE:::",
          description: "String that signals completion",
        })
      ),
      vars: Type.Optional(
        Type.Record(Type.String(), Type.String(), {
          description: "Template variables (KEY=VALUE)",
        })
      ),
      multiplexer: Type.Optional(
        StringEnum(["zellij", "tmux"] as const, {
          description: "Force zellij or tmux (default: auto-detect)",
        })
      ),
      direction: Type.Optional(
        StringEnum(["right", "down", "left", "up"] as const, {
          description: "Pane direction (zellij only)",
        })
      ),
      floating: Type.Optional(Type.Boolean({ default: false })),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const mux = params.multiplexer ?? (await whichMultiplexer(pi));
      if (!mux) {
        throw new Error(
          "No multiplexer found. Install zellij or tmux first."
        );
      }

      if (mux === "zellij" && !isInZellij()) {
        throw new Error(
          "Zellij detected but pi is not running inside a Zellij session. " +
            "Start pi from within Zellij, or force tmux with multiplexer: 'tmux'."
        );
      }

      return runLooper(
        pi,
        mux,
        {
          prompt: params.prompt,
          cli: params.cli,
          cwd: resolve(params.cwd ?? ctx.cwd),
          model: params.model,
          maxIterations: params.maxIterations ?? 10,
          sentinel: params.sentinel ?? ":::LOOPER_DONE:::",
          vars: params.vars,
          direction: params.direction,
          floating: params.floating ?? false,
        },
        onUpdate
      );
    },
  });

  // ─── Command: /looper-run ─────────────────────────────────────────────────
  pi.registerCommand("looper-run", {
    description: "Interactively start a looper run in a new pane or session",
    handler: async (_args, ctx) => {
      const mux = await whichMultiplexer(pi);
      if (!mux) {
        ctx.ui.notify(
          "No multiplexer found. Install zellij or tmux first.",
          "error"
        );
        return;
      }

      const cwd = ctx.cwd;

      // ─ 1. Pick prompt ─────────────────────────────────────────────────────
      const promptFiles = await listPromptFiles(cwd);
      let prompt: string | undefined;
      let promptFile: string | undefined;

      if (promptFiles.length > 0) {
        const choices = [
          ...promptFiles.map((p) => ({
            value: `file:${p}`,
            label: p.replace(`${cwd}/`, ""),
          })),
          { value: "__new__", label: "✎  Write new prompt..." },
        ];

        const choice = await ctx.ui.select("Choose prompt:", choices);
        if (!choice) return;

        if (choice.startsWith("file:")) {
          promptFile = choice.slice(5);
          prompt = await readFile(promptFile, "utf8");
        } else {
          const text = await ctx.ui.editor("Task prompt for looper:", "");
          if (!text) return;
          prompt = text;
        }
      } else {
        const text = await ctx.ui.editor("Task prompt for looper:", "");
        if (!text) return;
        prompt = text;
      }

      // ─ 2. Pick multiplexer (if both available) ────────────────────────────
      let chosenMux: Multiplexer = mux;
      const hasBoth =
        (await pi.exec("which", ["zellij"]).then((r) => r.code === 0)) &&
        (await pi.exec("which", ["tmux"]).then((r) => r.code === 0));

      if (hasBoth) {
        const pick = await ctx.ui.select("Multiplexer:", [
          { value: "zellij", label: "zellij (pane in current session)" },
          { value: "tmux", label: "tmux (new detached session)" },
        ]);
        if (pick) chosenMux = pick as Multiplexer;
      }

      if (chosenMux === "zellij" && !isInZellij()) {
        ctx.ui.notify(
          "Zellij chosen but pi is not inside a Zellij session. " +
            "Use tmux instead, or restart pi from Zellij.",
          "error"
        );
        return;
      }

      // ─ 3. Pick CLI ────────────────────────────────────────────────────────
      const cli = await ctx.ui.select("Pick AI CLI:", [
        "claude",
        "codex",
        "opencode",
      ]);
      if (!cli) return;

      // ─ 4. Max iterations ──────────────────────────────────────────────────
      const maxIterStr = await ctx.ui.input("Max iterations:", "10");
      const maxIterations = Number(maxIterStr) || 10;

      // ─ 5. Sentinel ────────────────────────────────────────────────────────
      const sentinel =
        (await ctx.ui.input("Sentinel:", ":::LOOPER_DONE:::")) ||
        ":::LOOPER_DONE:::";

      // ─ 6. Direction / floating (zellij only) ──────────────────────────────
      let direction: string | undefined;
      let floating = false;

      if (chosenMux === "zellij") {
        direction = await ctx.ui.select("Pane direction:", [
          { value: "right", label: "right →" },
          { value: "down", label: "down ↓" },
          { value: "left", label: "left ←" },
          { value: "up", label: "up ↑" },
        ]);
        floating = (await ctx.ui.confirm(
          "Floating pane?",
          "Open as floating window?"
        )) ?? false;
      }

      ctx.ui.notify("Spawning...", "info");

      try {
        await runLooper(pi, chosenMux, {
          prompt: prompt!,
          promptFile,
          cli,
          cwd,
          maxIterations,
          sentinel,
          direction: direction ?? undefined,
          floating,
        });

        ctx.ui.notify(
          `✓ Looper ${chosenMux} pane/session spawned with ${cli}`,
          "success"
        );
      } catch (e: any) {
        ctx.ui.notify(e?.message ?? String(e), "error");
      }
    },
  });
}

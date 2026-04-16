import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CliName } from "@0xtiby/spawner";
import { z } from "zod";

export const CliNameSchema = z.enum(["claude", "codex", "opencode"]);

export const ConfigSchema = z.object({
  cli: CliNameSchema.optional(),
  model: z.string().optional(),
  maxIterations: z.number().int().positive().optional(),
  sentinel: z.string().optional(),
  vars: z.record(z.string(), z.string()).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export interface ResolvedConfig {
  cli: CliName;
  model: string;
  maxIterations: number;
  sentinel: string;
  vars: Record<string, string>;
}

export const DEFAULT_CONFIG: ResolvedConfig = {
  cli: "claude",
  model: "opus",
  maxIterations: 10,
  sentinel: ":::LOOPER_DONE:::",
  vars: {},
};

export interface ConfigOverrides {
  cli?: CliName;
  model?: string;
  maxIterations?: number;
  sentinel?: string;
}

const CONFIG_PATH = [".looper", "config.json"] as const;

export function resolveConfig(config: Config | null): ResolvedConfig {
  if (!config) return { ...DEFAULT_CONFIG };
  return {
    cli: config.cli ?? DEFAULT_CONFIG.cli,
    model: config.model ?? DEFAULT_CONFIG.model,
    maxIterations: config.maxIterations ?? DEFAULT_CONFIG.maxIterations,
    sentinel: config.sentinel ?? DEFAULT_CONFIG.sentinel,
    vars: config.vars ?? { ...DEFAULT_CONFIG.vars },
  };
}

export function applyOverrides(
  base: ResolvedConfig,
  overrides: ConfigOverrides,
): ResolvedConfig {
  return {
    cli: overrides.cli ?? base.cli,
    model: overrides.model ?? base.model,
    maxIterations: overrides.maxIterations ?? base.maxIterations,
    sentinel: overrides.sentinel ?? base.sentinel,
    vars: base.vars,
  };
}

export async function loadConfig(cwd: string): Promise<Config | null> {
  const file = path.join(cwd, ...CONFIG_PATH);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if (isFileNotFound(err)) return null;
    throw err;
  }
  return ConfigSchema.parse(JSON.parse(raw));
}

export async function writeDefaultConfig(cwd: string): Promise<string> {
  const file = path.join(cwd, ...CONFIG_PATH);
  await mkdir(path.dirname(file), { recursive: true });
  const body = `${JSON.stringify(
    {
      cli: DEFAULT_CONFIG.cli,
      model: DEFAULT_CONFIG.model,
      maxIterations: DEFAULT_CONFIG.maxIterations,
      sentinel: DEFAULT_CONFIG.sentinel,
      vars: DEFAULT_CONFIG.vars,
    },
    null,
    2,
  )}\n`;
  try {
    await writeFile(file, body, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if (isFileExists(err)) {
      throw new Error(`Config file already exists at ${file}`);
    }
    throw err;
  }
  return file;
}

function isFileNotFound(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "ENOENT";
}

function isFileExists(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "EEXIST";
}

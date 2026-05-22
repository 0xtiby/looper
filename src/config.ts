import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const AgentIdSchema = z.string().min(1);
export const BuiltInAgentIdSchema = z.enum([
  "claude",
  "codex",
  "opencode",
  "pi",
]);

export const CustomAgentServerSchema = z
  .object({
    type: z.literal("custom"),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const AgentServersSchema = z.record(
  z.string().min(1),
  CustomAgentServerSchema,
);

const ConfigObjectSchema = z.object({
  agent: AgentIdSchema.optional(),
  agent_servers: AgentServersSchema.optional(),
  model: z.string().optional(),
  maxIterations: z.number().int().positive().optional(),
  sentinel: z.string().optional(),
  vars: z.record(z.string(), z.string()).optional(),
});

export const ConfigSchema = ConfigObjectSchema.superRefine((config, ctx) => {
  if (config.agent_servers === undefined) return;
  if (config.agent === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["agent"],
      message: "agent is required when agent_servers is configured",
    });
    return;
  }
  if (config.agent in config.agent_servers) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["agent"],
    message: `agent must reference a configured Agent Server id: ${config.agent}`,
  });
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentServerConfig = z.infer<typeof CustomAgentServerSchema>;

export type AgentId = z.infer<typeof AgentIdSchema>;

export interface ResolvedConfig {
  agent: AgentId;
  agentServers: Record<string, AgentServerConfig>;
  model: string;
  maxIterations: number;
  sentinel: string;
  vars: Record<string, string>;
}

export const DEFAULT_AGENT_SERVERS: Record<string, AgentServerConfig> = {
  claude: { type: "custom", command: "claude" },
  codex: { type: "custom", command: "codex" },
  opencode: { type: "custom", command: "opencode" },
  pi: { type: "custom", command: "pi" },
};

export const DEFAULT_CONFIG: ResolvedConfig = {
  agent: "claude",
  agentServers: DEFAULT_AGENT_SERVERS,
  model: "default",
  maxIterations: 10,
  sentinel: ":::LOOPER_DONE:::",
  vars: {},
};

export interface ConfigOverrides {
  agent?: AgentId;
  model?: string;
  maxIterations?: number;
  sentinel?: string;
}

const CONFIG_PATH = [".looper", "config.json"] as const;

export class V1ConfigError extends Error {
  constructor() {
    super(
      "V1 config detected: 'cli' is no longer supported. Use 'agent' instead.",
    );
    this.name = "V1ConfigError";
  }
}

export class ConfigExistsError extends Error {
  constructor(file: string) {
    super(`Config file already exists at ${file}`);
    this.name = "ConfigExistsError";
  }
}

export function resolveConfig(config: Config | null): ResolvedConfig {
  if (!config) return cloneDefaultConfig();
  return {
    agent: config.agent ?? DEFAULT_CONFIG.agent,
    agentServers: config.agent_servers ?? DEFAULT_CONFIG.agentServers,
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
    agent: overrides.agent ?? base.agent,
    agentServers: base.agentServers,
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
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if ("cli" in parsed) {
    throw new V1ConfigError();
  }
  return ConfigSchema.parse(parsed);
}

export async function writeConfig(
  cwd: string,
  config: Config,
): Promise<string> {
  const file = path.join(cwd, ...CONFIG_PATH);
  await mkdir(path.dirname(file), { recursive: true });
  const body = `${JSON.stringify(config, null, 2)}\n`;
  try {
    await writeFile(file, body, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if (isFileExists(err)) {
      throw new ConfigExistsError(file);
    }
    throw err;
  }
  return file;
}

export async function writeDefaultConfig(cwd: string): Promise<string> {
  return writeConfig(cwd, {
    agent: DEFAULT_CONFIG.agent,
    agent_servers: DEFAULT_CONFIG.agentServers,
    model: DEFAULT_CONFIG.model,
    maxIterations: DEFAULT_CONFIG.maxIterations,
    sentinel: DEFAULT_CONFIG.sentinel,
    vars: DEFAULT_CONFIG.vars,
  });
}

function cloneDefaultConfig(): ResolvedConfig {
  return {
    ...DEFAULT_CONFIG,
    agentServers: { ...DEFAULT_CONFIG.agentServers },
    vars: { ...DEFAULT_CONFIG.vars },
  };
}

function isFileNotFound(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "ENOENT";
}

function isFileExists(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "EEXIST";
}

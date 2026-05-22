import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentIdSchema,
  applyOverrides,
  BuiltInAgentIdSchema,
  ConfigExistsError,
  ConfigSchema,
  DEFAULT_CONFIG,
  loadConfig,
  resolveConfig,
  V1ConfigError,
  writeConfig,
  writeDefaultConfig,
} from "./config.js";

describe("config", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "looper-config-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("resolveConfig returns the full defaults when no file config is provided", () => {
    const resolved = resolveConfig(null);
    expect(resolved).toEqual(DEFAULT_CONFIG);
  });

  it("resolveConfig merges file values over defaults", () => {
    const resolved = resolveConfig({
      agent: "codex",
      model: "sonnet",
      maxIterations: 3,
    });
    expect(resolved.agent).toBe("codex");
    expect(resolved.model).toBe("sonnet");
    expect(resolved.maxIterations).toBe(3);
    expect(resolved.sentinel).toBe(DEFAULT_CONFIG.sentinel);
  });

  it("resolveConfig keeps the selected custom Agent Server catalog", () => {
    const resolved = resolveConfig({
      agent: "my-custom-agent",
      agent_servers: {
        "my-custom-agent": {
          type: "custom",
          command: "node",
          args: ["./agent.js", "--acp"],
        },
      },
    });

    expect(resolved.agentServers[resolved.agent]).toEqual({
      type: "custom",
      command: "node",
      args: ["./agent.js", "--acp"],
    });
  });

  it("ConfigSchema accepts supported agent values", () => {
    const result = ConfigSchema.safeParse({ agent: "claude" });
    expect(result.success).toBe(true);
    expect(result.data).toEqual(expect.objectContaining({ agent: "claude" }));
  });

  it("ConfigSchema accepts custom Agent ids", () => {
    const result = ConfigSchema.safeParse({ agent: "my-custom-agent" });
    expect(result.success).toBe(true);
  });

  it("AgentIdSchema requires a non-empty Agent id", () => {
    expect(AgentIdSchema.safeParse("my-custom-agent").success).toBe(true);
    expect(AgentIdSchema.safeParse("").success).toBe(false);
  });

  it("BuiltInAgentIdSchema allows all currently bundled v2 Agents", () => {
    for (const id of ["claude", "codex", "opencode", "pi"] as const) {
      expect(BuiltInAgentIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it("applyOverrides lets CLI flags win over resolved config", () => {
    const resolved = resolveConfig({
      agent: "claude",
      model: "sonnet",
      maxIterations: 3,
    });
    const merged = applyOverrides(resolved, {
      agent: "codex",
      model: "opus",
      maxIterations: 7,
    });
    expect(merged.agent).toBe("codex");
    expect(merged.model).toBe("opus");
    expect(merged.maxIterations).toBe(7);
    expect(merged.sentinel).toBe(resolved.sentinel);
  });

  it("loadConfig reads a valid v2 config from .looper/config.json", async () => {
    await mkdir(path.join(workDir, ".looper"), { recursive: true });
    await writeFile(
      path.join(workDir, ".looper", "config.json"),
      JSON.stringify({ agent: "codex", model: "o3" }),
      "utf8",
    );
    const config = await loadConfig(workDir);
    expect(config).toEqual({ agent: "codex", model: "o3" });
  });

  it("loadConfig accepts a configured custom ACP Agent Server", async () => {
    await mkdir(path.join(workDir, ".looper"), { recursive: true });
    await writeFile(
      path.join(workDir, ".looper", "config.json"),
      JSON.stringify({
        agent: "my-custom-agent",
        agent_servers: {
          "my-custom-agent": {
            type: "custom",
            command: "node",
            args: ["./agent.js", "--acp"],
            env: { NODE_ENV: "test" },
          },
        },
        maxIterations: 10,
        sentinel: ":::LOOPER_DONE:::",
      }),
      "utf8",
    );

    const config = await loadConfig(workDir);

    expect(config).toEqual({
      agent: "my-custom-agent",
      agent_servers: {
        "my-custom-agent": {
          type: "custom",
          command: "node",
          args: ["./agent.js", "--acp"],
          env: { NODE_ENV: "test" },
        },
      },
      maxIterations: 10,
      sentinel: ":::LOOPER_DONE:::",
    });
  });

  it("loadConfig fails fast when agent_servers has no selected Agent", async () => {
    await mkdir(path.join(workDir, ".looper"), { recursive: true });
    await writeFile(
      path.join(workDir, ".looper", "config.json"),
      JSON.stringify({
        agent_servers: {
          "my-custom-agent": {
            type: "custom",
            command: "node",
          },
        },
      }),
      "utf8",
    );

    await expect(loadConfig(workDir)).rejects.toThrow(
      "agent is required when agent_servers is configured",
    );
  });

  it("loadConfig fails fast when the selected Agent Server id is unknown", async () => {
    await mkdir(path.join(workDir, ".looper"), { recursive: true });
    await writeFile(
      path.join(workDir, ".looper", "config.json"),
      JSON.stringify({
        agent: "missing-agent",
        agent_servers: {
          "my-custom-agent": {
            type: "custom",
            command: "node",
          },
        },
      }),
      "utf8",
    );

    await expect(loadConfig(workDir)).rejects.toThrow(
      "agent must reference a configured Agent Server id: missing-agent",
    );
  });

  it("ConfigSchema rejects invalid custom Agent Server definitions", () => {
    const configs = [
      {
        agent: "my-custom-agent",
        agent_servers: {
          "my-custom-agent": { type: "custom" },
        },
      },
      {
        agent: "my-custom-agent",
        agent_servers: {
          "my-custom-agent": { type: "custom", command: "" },
        },
      },
      {
        agent: "my-custom-agent",
        agent_servers: {
          "my-custom-agent": { type: "legacy", command: "node" },
        },
      },
      {
        agent: "my-custom-agent",
        agent_servers: {
          "my-custom-agent": { type: "custom", command: "node", args: [1] },
        },
      },
    ];

    for (const config of configs) {
      expect(ConfigSchema.safeParse(config).success).toBe(false);
    }
  });

  it("loadConfig returns null when the file does not exist", async () => {
    const config = await loadConfig(workDir);
    expect(config).toBeNull();
  });

  it("loadConfig throws V1ConfigError when config contains the legacy cli field", async () => {
    await mkdir(path.join(workDir, ".looper"), { recursive: true });
    await writeFile(
      path.join(workDir, ".looper", "config.json"),
      JSON.stringify({ cli: "claude", model: "o3" }),
      "utf8",
    );
    await expect(loadConfig(workDir)).rejects.toThrow(V1ConfigError);
  });

  it("writeConfig writes the provided config and refuses to overwrite", async () => {
    const file = await writeConfig(workDir, { agent: "pi", model: "custom" });
    const raw = await readFile(file, "utf8");
    expect(JSON.parse(raw)).toEqual({ agent: "pi", model: "custom" });

    await expect(writeConfig(workDir, { agent: "claude" })).rejects.toThrow(
      ConfigExistsError,
    );
  });

  it("writeDefaultConfig writes v2 defaults and refuses to overwrite", async () => {
    const first = await writeDefaultConfig(workDir);
    const raw = await readFile(first, "utf8");
    expect(JSON.parse(raw)).toEqual({
      agent: DEFAULT_CONFIG.agent,
      agent_servers: DEFAULT_CONFIG.agentServers,
      model: DEFAULT_CONFIG.model,
      maxIterations: DEFAULT_CONFIG.maxIterations,
      sentinel: DEFAULT_CONFIG.sentinel,
      vars: DEFAULT_CONFIG.vars,
    });

    await expect(writeDefaultConfig(workDir)).rejects.toThrow(
      ConfigExistsError,
    );
  });
});

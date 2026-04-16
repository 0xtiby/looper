import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyOverrides,
  ConfigSchema,
  DEFAULT_CONFIG,
  loadConfig,
  resolveConfig,
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
    const resolved = resolveConfig({ model: "sonnet", maxIterations: 3 });
    expect(resolved.model).toBe("sonnet");
    expect(resolved.maxIterations).toBe(3);
    expect(resolved.cli).toBe(DEFAULT_CONFIG.cli);
    expect(resolved.sentinel).toBe(DEFAULT_CONFIG.sentinel);
  });

  it("ConfigSchema rejects unsupported cli values", () => {
    const result = ConfigSchema.safeParse({ cli: "gpt" });
    expect(result.success).toBe(false);
  });

  it("applyOverrides lets CLI flags win over resolved config", () => {
    const resolved = resolveConfig({ model: "sonnet", maxIterations: 3 });
    const merged = applyOverrides(resolved, {
      model: "opus",
      maxIterations: 7,
    });
    expect(merged.model).toBe("opus");
    expect(merged.maxIterations).toBe(7);
    expect(merged.cli).toBe(resolved.cli);
  });

  it("loadConfig reads a valid file from .looper/config.json", async () => {
    await mkdir(path.join(workDir, ".looper"), { recursive: true });
    await writeFile(
      path.join(workDir, ".looper", "config.json"),
      JSON.stringify({ cli: "codex", model: "o3" }),
      "utf8",
    );
    const config = await loadConfig(workDir);
    expect(config).toEqual({ cli: "codex", model: "o3" });
  });

  it("loadConfig returns null when the file does not exist", async () => {
    const config = await loadConfig(workDir);
    expect(config).toBeNull();
  });

  it("writeDefaultConfig writes defaults and refuses to overwrite", async () => {
    const first = await writeDefaultConfig(workDir);
    const raw = await readFile(first, "utf8");
    expect(JSON.parse(raw)).toEqual({
      cli: DEFAULT_CONFIG.cli,
      model: DEFAULT_CONFIG.model,
      maxIterations: DEFAULT_CONFIG.maxIterations,
      sentinel: DEFAULT_CONFIG.sentinel,
      vars: DEFAULT_CONFIG.vars,
    });

    await expect(writeDefaultConfig(workDir)).rejects.toThrow(/exists/i);
  });
});

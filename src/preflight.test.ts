import { describe, expect, it } from "vitest";
import type { AcpAgent } from "./agents.js";
import {
  IncompatibleAgentError,
  MissingAgentError,
  preflight,
  UnavailableAgentError,
  UnsupportedModelError,
} from "./preflight.js";

function agent(overrides: Partial<AcpAgent> & Pick<AcpAgent, "id">): AcpAgent {
  return {
    id: overrides.id,
    displayName: overrides.displayName ?? overrides.id,
    status: overrides.status ?? "available",
    isAfkSafe: overrides.isAfkSafe ?? true,
    capabilitySummary: overrides.capabilitySummary ?? "Runs unattended",
    supportedModels: overrides.supportedModels ?? ["default", "sonnet"],
    acpMetadata: overrides.acpMetadata ?? {},
  };
}

describe("preflight", () => {
  it("throws MissingAgentError when the agent is not discovered", async () => {
    await expect(
      preflight("claude", "default", {
        discoverAgents: async () => [],
      }),
    ).rejects.toThrow(MissingAgentError);
  });

  it("throws UnavailableAgentError when the agent is not installed", async () => {
    await expect(
      preflight("claude", "default", {
        discoverAgents: async () => [
          agent({ id: "claude", status: "unavailable" }),
        ],
      }),
    ).rejects.toThrow(UnavailableAgentError);
  });

  it("throws IncompatibleAgentError when the agent is not AFK-safe", async () => {
    await expect(
      preflight("opencode", "default", {
        discoverAgents: async () => [
          agent({ id: "opencode", isAfkSafe: false }),
        ],
      }),
    ).rejects.toThrow(IncompatibleAgentError);
  });

  it("throws UnsupportedModelError when the model is not in the agent's supported list", async () => {
    await expect(
      preflight("claude", "bogus-model", {
        discoverAgents: async () => [
          agent({
            id: "claude",
            supportedModels: ["default", "sonnet", "opus"],
          }),
        ],
      }),
    ).rejects.toThrow(UnsupportedModelError);
  });

  it("passes when agent is available, compatible, and model is 'default'", async () => {
    await expect(
      preflight("claude", "default", {
        discoverAgents: async () => [agent({ id: "claude" })],
      }),
    ).resolves.toBeUndefined();
  });

  it("passes when agent is available, compatible, and model is supported", async () => {
    await expect(
      preflight("claude", "sonnet", {
        discoverAgents: async () => [
          agent({
            id: "claude",
            supportedModels: ["default", "sonnet", "opus"],
          }),
        ],
      }),
    ).resolves.toBeUndefined();
  });

  it("passes when no model is provided", async () => {
    await expect(
      preflight("claude", undefined, {
        discoverAgents: async () => [agent({ id: "claude" })],
      }),
    ).resolves.toBeUndefined();
  });
});

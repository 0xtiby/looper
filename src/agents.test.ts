import { type DetectResult, detectAll } from "@0xtiby/spawner";
import { describe, expect, it, vi } from "vitest";
import {
  type AcpAgent,
  discoverAcpAgents,
  formatAgentListingJson,
  formatAgentListingText,
  listAgents,
} from "./agents.js";

vi.mock("@0xtiby/spawner", () => ({
  detectAll: vi.fn(),
}));

function agent(overrides: Partial<AcpAgent> & Pick<AcpAgent, "id">): AcpAgent {
  return {
    id: overrides.id,
    displayName: overrides.displayName ?? overrides.id,
    status: overrides.status ?? "available",
    isAfkSafe: overrides.isAfkSafe ?? true,
    capabilitySummary: overrides.capabilitySummary ?? "Runs unattended",
    acpMetadata: overrides.acpMetadata ?? {},
  };
}

function detection(installed: boolean): DetectResult {
  return {
    installed,
    version: installed ? "1.0.0" : null,
    authenticated: installed,
    binaryPath: installed ? "/bin/agent" : null,
  };
}

describe("Agent listing", () => {
  it("lists discovered Agents in compatibility and availability order", async () => {
    const agents = await listAgents(async () => [
      agent({
        id: "incompatible-unavailable",
        status: "unavailable",
        isAfkSafe: false,
      }),
      agent({
        id: "compatible-unavailable",
        status: "unavailable",
        isAfkSafe: true,
      }),
      agent({
        id: "incompatible-available",
        status: "available",
        isAfkSafe: false,
      }),
      agent({
        id: "compatible-available",
        status: "available",
        isAfkSafe: true,
      }),
    ]);

    expect(agents.map((item) => item.id)).toEqual([
      "compatible-available",
      "compatible-unavailable",
      "incompatible-available",
      "incompatible-unavailable",
    ]);
  });

  it("formats default output with Capability summaries instead of raw ACP metadata", async () => {
    const agents = await listAgents(async () => [
      agent({
        id: "pi",
        displayName: "Pi",
        capabilitySummary: "Headless coding Agent; model override supported",
        acpMetadata: { protocol: { nested: "raw" } },
      }),
    ]);

    const output = formatAgentListingText(agents);

    expect(output).toContain("Agent id");
    expect(output).toContain("Headless coding Agent; model override supported");
    expect(output).not.toContain("protocol");
  });

  it("formats JSON output with detailed ACP metadata", async () => {
    const agents = await listAgents(async () => [
      agent({
        id: "claude",
        acpMetadata: {
          protocol: "acp",
          models: ["sonnet", "opus"],
          permissions: { afkSafe: true },
        },
      }),
    ]);

    const parsed = JSON.parse(formatAgentListingJson(agents));

    expect(parsed).toEqual([
      expect.objectContaining({
        id: "claude",
        acpMetadata: {
          protocol: "acp",
          models: ["sonnet", "opus"],
          permissions: { afkSafe: true },
        },
      }),
    ]);
  });

  it("discovers ACP Agents from the spawner detection boundary", async () => {
    vi.mocked(detectAll).mockResolvedValue({
      claude: detection(true),
      codex: detection(false),
      opencode: detection(true),
      pi: detection(true),
    });

    const agents = await discoverAcpAgents();

    expect(agents).toEqual([
      expect.objectContaining({
        id: "claude",
        displayName: "Claude Code",
        status: "available",
        isAfkSafe: true,
      }),
      expect.objectContaining({
        id: "codex",
        displayName: "Codex CLI",
        status: "unavailable",
        isAfkSafe: true,
      }),
      expect.objectContaining({
        id: "opencode",
        displayName: "OpenCode",
        status: "available",
        isAfkSafe: false,
      }),
      expect.objectContaining({
        id: "pi",
        displayName: "Pi",
        status: "available",
        isAfkSafe: true,
      }),
    ]);
  });
});

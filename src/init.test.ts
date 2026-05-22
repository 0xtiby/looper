import { describe, expect, it } from "vitest";
import type { ListedAgent } from "./agents.js";
import {
  IncompatibleAgentError,
  NonInteractiveInitError,
  resolveInitAgent,
  UnknownAgentError,
} from "./init.js";

function listedAgent(
  overrides: Partial<ListedAgent> & Pick<ListedAgent, "id">,
): ListedAgent {
  return {
    id: overrides.id,
    displayName: overrides.displayName ?? overrides.id,
    status: overrides.status ?? "available",
    compatibility: overrides.compatibility ?? "compatible",
    capabilitySummary: overrides.capabilitySummary ?? "Runs unattended",
    supportedModels: overrides.supportedModels ?? ["default"],
    acpMetadata: overrides.acpMetadata ?? {},
  };
}

describe("resolveInitAgent", () => {
  it("returns the explicit agent in non-interactive mode when it is compatible", async () => {
    const agent = await resolveInitAgent({
      agent: "claude",
      deps: {
        isTty: false,
        listAgents: async () => [
          listedAgent({ id: "claude", compatibility: "compatible" }),
        ],
      },
    });
    expect(agent).toBe("claude");
  });

  it("throws NonInteractiveInitError when no agent is provided outside a TTY", async () => {
    await expect(
      resolveInitAgent({
        deps: {
          isTty: false,
          listAgents: async () => [],
        },
      }),
    ).rejects.toThrow(NonInteractiveInitError);
  });

  it("throws UnknownAgentError for an unrecognized agent id", async () => {
    await expect(
      resolveInitAgent({
        agent: "pi",
        deps: {
          isTty: false,
          listAgents: async () => [
            listedAgent({ id: "claude", compatibility: "compatible" }),
          ],
        },
      }),
    ).rejects.toThrow(UnknownAgentError);
  });

  it("throws IncompatibleAgentError when the explicit agent is not AFK-safe", async () => {
    await expect(
      resolveInitAgent({
        agent: "opencode",
        deps: {
          isTty: false,
          listAgents: async () => [
            listedAgent({ id: "opencode", compatibility: "incompatible" }),
          ],
        },
      }),
    ).rejects.toThrow(IncompatibleAgentError);
  });

  it("delegates to selectAgent with only compatible agents in interactive mode", async () => {
    const selected = await resolveInitAgent({
      deps: {
        isTty: true,
        listAgents: async () => [
          listedAgent({ id: "claude", compatibility: "compatible" }),
          listedAgent({ id: "opencode", compatibility: "incompatible" }),
        ],
        selectAgent: async (agents) => {
          expect(agents).toHaveLength(1);
          expect(agents[0]?.id).toBe("claude");
          return "claude";
        },
      },
    });
    expect(selected).toBe("claude");
  });

  it("throws when no compatible agents are available in interactive mode", async () => {
    await expect(
      resolveInitAgent({
        deps: {
          isTty: true,
          listAgents: async () => [
            listedAgent({ id: "opencode", compatibility: "incompatible" }),
          ],
        },
      }),
    ).rejects.toThrow(/No compatible agents/);
  });
});

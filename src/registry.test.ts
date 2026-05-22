import { describe, expect, it } from "vitest";
import {
  fetchAcpRegistry,
  MissingRegistryAgentError,
  resolveRegistryAgentServer,
} from "./registry.js";

describe("ACP Registry", () => {
  it("fetches and parses ACP Registry Agent metadata from an injected source", async () => {
    const registry = await fetchAcpRegistry({
      type: "inline",
      registry: {
        version: "1.0.0",
        agents: [
          {
            id: "claude-acp",
            name: "Claude Agent",
            version: "0.37.0",
            description: "ACP wrapper for Claude",
            distribution: {
              npx: { package: "@agentclientprotocol/claude-agent-acp@0.37.0" },
            },
          },
        ],
      },
    });

    expect(registry.agents[0]).toEqual(
      expect.objectContaining({
        id: "claude-acp",
        name: "Claude Agent",
        distribution: {
          npx: { package: "@agentclientprotocol/claude-agent-acp@0.37.0" },
        },
      }),
    );
  });

  it("resolves a registry-backed Agent Server by configured registry Agent id", async () => {
    const resolved = await resolveRegistryAgentServer(
      { type: "registry" },
      {
        type: "inline",
        registry: {
          agents: [
            {
              id: "claude-acp",
              name: "Claude Agent",
              description: "ACP wrapper for Claude",
              distribution: {
                npx: {
                  package: "@agentclientprotocol/claude-agent-acp@0.37.0",
                },
              },
            },
          ],
        },
      },
      "claude-acp",
    );

    expect(resolved.agent).toEqual(
      expect.objectContaining({
        id: "claude-acp",
        name: "Claude Agent",
      }),
    );
  });

  it("converts an npx registry distribution into an ACP stdio launch command", async () => {
    const resolved = await resolveRegistryAgentServer(
      { type: "registry", id: "claude-acp" },
      {
        type: "inline",
        registry: {
          agents: [
            {
              id: "claude-acp",
              name: "Claude Agent",
              distribution: {
                npx: {
                  package: "@agentclientprotocol/claude-agent-acp@0.37.0",
                  args: ["--debug"],
                  env: { ACP_LOG: "1" },
                },
              },
            },
          ],
        },
      },
    );

    expect(resolved.launch).toEqual({
      type: "registry",
      command: "npx",
      args: ["-y", "@agentclientprotocol/claude-agent-acp@0.37.0", "--debug"],
      env: { ACP_LOG: "1" },
    });
  });

  it("fails explicitly when a configured registry Agent id is missing", async () => {
    await expect(
      resolveRegistryAgentServer(
        { type: "registry", id: "missing-acp" },
        {
          type: "inline",
          registry: {
            agents: [
              {
                id: "claude-acp",
                name: "Claude Agent",
                distribution: {
                  npx: {
                    package: "@agentclientprotocol/claude-agent-acp@0.37.0",
                  },
                },
              },
            ],
          },
        },
      ),
    ).rejects.toThrow(MissingRegistryAgentError);
  });
});

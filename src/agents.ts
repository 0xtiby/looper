import { type CliName, type DetectResult, detectAll } from "@0xtiby/spawner";
import type { AgentServerConfig } from "./config.js";
import {
  type AcpRegistrySource,
  MissingRegistryAgentError,
  resolveRegistryAgentServer,
  UnsupportedRegistryDistributionError,
} from "./registry.js";

export type AgentStatus = "available" | "unavailable";
export type AgentCompatibility = "compatible" | "incompatible";

export interface AcpAgent {
  id: string;
  displayName: string;
  status: AgentStatus;
  isAfkSafe: boolean;
  capabilitySummary: string;
  supportedModels: string[];
  acpMetadata: Record<string, unknown>;
}

export interface ListedAgent {
  id: string;
  displayName: string;
  status: AgentStatus;
  compatibility: AgentCompatibility;
  capabilitySummary: string;
  supportedModels: string[];
  acpMetadata: Record<string, unknown>;
}

export type DiscoverAgents = () => Promise<AcpAgent[]>;

export interface DiscoverConfiguredAgentsOptions {
  registrySource?: AcpRegistrySource;
}

interface SupportedAcpAgent {
  id: CliName;
  displayName: string;
  isAfkSafe: boolean;
  capabilitySummary: string;
  supportedModels: string[];
}

const SUPPORTED_ACP_AGENTS: SupportedAcpAgent[] = [
  {
    id: "claude",
    displayName: "Claude Code",
    isAfkSafe: true,
    capabilitySummary: "AFK-safe coding Agent with permission bypass support",
    supportedModels: ["default", "sonnet", "opus", "haiku"],
  },
  {
    id: "codex",
    displayName: "Codex CLI",
    isAfkSafe: true,
    capabilitySummary: "AFK-safe coding Agent with sandbox bypass support",
    supportedModels: ["default", "o3", "o4-mini", "gpt-4o"],
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    isAfkSafe: false,
    capabilitySummary: "Visible Agent; approval bypass is not available",
    supportedModels: ["default", "gpt-4o", "claude-sonnet"],
  },
  {
    id: "pi",
    displayName: "Pi",
    isAfkSafe: true,
    capabilitySummary: "Headless coding Agent in JSON mode",
    supportedModels: ["default", "pi-v1"],
  },
];

export async function discoverAcpAgents(): Promise<AcpAgent[]> {
  const detections = await detectAll();
  return SUPPORTED_ACP_AGENTS.map((agent) =>
    toAcpAgent(agent, detections[agent.id]),
  );
}

export async function discoverConfiguredAgents(
  agentServers: Record<string, AgentServerConfig>,
  options: DiscoverConfiguredAgentsOptions = {},
): Promise<AcpAgent[]> {
  const agents: AcpAgent[] = [];
  for (const [id, config] of Object.entries(agentServers)) {
    agents.push(await configuredAgentFromServer(id, config, options));
  }
  return agents;
}

export async function listAgents(
  discoverAgents: DiscoverAgents,
): Promise<ListedAgent[]> {
  const agents = await discoverAgents();
  return agents.map(toListedAgent).sort(compareListedAgents);
}

export function formatAgentListingText(agents: ListedAgent[]): string {
  const rows = agents.map(
    (agent) =>
      `${agent.id}\t${agent.displayName}\t${sourceForAgent(agent)}\t${agent.status}\t${agent.compatibility}\t${agent.capabilitySummary}`,
  );
  return [
    "Agent id\tName\tSource\tStatus\tCompatibility\tCapability summary",
    ...rows,
  ].join("\n");
}

export function formatAgentListingJson(agents: ListedAgent[]): string {
  return `${JSON.stringify(agents, null, 2)}\n`;
}

async function configuredAgentFromServer(
  id: string,
  config: AgentServerConfig,
  options: DiscoverConfiguredAgentsOptions,
): Promise<AcpAgent> {
  if (config.type === "custom") {
    return {
      id,
      displayName: id,
      status: "available",
      isAfkSafe: true,
      capabilitySummary: "Configured custom ACP Agent Server",
      supportedModels: ["default"],
      acpMetadata: {
        source: "custom",
        command: config.command,
        args: config.args ?? [],
      },
    };
  }

  try {
    const resolved = await resolveRegistryAgentServer(
      config,
      options.registrySource,
      id,
    );
    return {
      id,
      displayName: resolved.agent.name,
      status: "available",
      isAfkSafe: true,
      capabilitySummary:
        resolved.agent.description ?? "Registry-backed ACP Agent Server",
      supportedModels: ["default"],
      acpMetadata: {
        source: "registry",
        registryAgentId: resolved.agent.id,
        launch: resolved.launch,
        version: resolved.agent.version,
      },
    };
  } catch (err) {
    if (
      err instanceof MissingRegistryAgentError ||
      err instanceof UnsupportedRegistryDistributionError
    ) {
      return {
        id,
        displayName: config.id ?? id,
        status: "unavailable",
        isAfkSafe: true,
        capabilitySummary: err.message,
        supportedModels: ["default"],
        acpMetadata: {
          source: "registry",
          registryAgentId: config.id ?? id,
          statusDetail: err.message,
        },
      };
    }
    throw err;
  }
}

function sourceForAgent(agent: ListedAgent): string {
  const source = agent.acpMetadata.source;
  if (typeof source === "string") return source;
  return "discovered";
}

function toAcpAgent(
  agent: SupportedAcpAgent,
  detection: DetectResult,
): AcpAgent {
  return {
    id: agent.id,
    displayName: agent.displayName,
    status: detection.installed ? "available" : "unavailable",
    isAfkSafe: agent.isAfkSafe,
    capabilitySummary: agent.capabilitySummary,
    supportedModels: agent.supportedModels,
    acpMetadata: {
      protocol: "acp",
      source: "@0xtiby/spawner",
      cli: agent.id,
      detection,
    },
  };
}

function toListedAgent(agent: AcpAgent): ListedAgent {
  return {
    id: agent.id,
    displayName: agent.displayName,
    status: agent.status,
    compatibility: agent.isAfkSafe ? "compatible" : "incompatible",
    capabilitySummary: agent.capabilitySummary,
    supportedModels: agent.supportedModels,
    acpMetadata: agent.acpMetadata,
  };
}

function compareListedAgents(left: ListedAgent, right: ListedAgent): number {
  const rankDelta = listingRank(left) - listingRank(right);
  if (rankDelta !== 0) return rankDelta;
  const nameDelta = left.displayName.localeCompare(right.displayName);
  if (nameDelta !== 0) return nameDelta;
  return left.id.localeCompare(right.id);
}

function listingRank(agent: ListedAgent): number {
  if (agent.compatibility === "compatible" && agent.status === "available") {
    return 0;
  }
  if (agent.compatibility === "compatible") return 1;
  if (agent.status === "available") return 2;
  return 3;
}

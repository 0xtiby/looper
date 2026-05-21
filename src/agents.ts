import { type CliName, type DetectResult, detectAll } from "@0xtiby/spawner";

export type AgentStatus = "available" | "unavailable";
export type AgentCompatibility = "compatible" | "incompatible";

export interface AcpAgent {
  id: string;
  displayName: string;
  status: AgentStatus;
  isAfkSafe: boolean;
  capabilitySummary: string;
  acpMetadata: Record<string, unknown>;
}

export interface ListedAgent {
  id: string;
  displayName: string;
  status: AgentStatus;
  compatibility: AgentCompatibility;
  capabilitySummary: string;
  acpMetadata: Record<string, unknown>;
}

export type DiscoverAgents = () => Promise<AcpAgent[]>;

interface SupportedAcpAgent {
  id: CliName;
  displayName: string;
  isAfkSafe: boolean;
  capabilitySummary: string;
}

const SUPPORTED_ACP_AGENTS: SupportedAcpAgent[] = [
  {
    id: "claude",
    displayName: "Claude Code",
    isAfkSafe: true,
    capabilitySummary: "AFK-safe coding Agent with permission bypass support",
  },
  {
    id: "codex",
    displayName: "Codex CLI",
    isAfkSafe: true,
    capabilitySummary: "AFK-safe coding Agent with sandbox bypass support",
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    isAfkSafe: false,
    capabilitySummary: "Visible Agent; approval bypass is not available",
  },
  {
    id: "pi",
    displayName: "Pi",
    isAfkSafe: true,
    capabilitySummary: "Headless coding Agent in JSON mode",
  },
];

export async function discoverAcpAgents(): Promise<AcpAgent[]> {
  const detections = await detectAll();
  return SUPPORTED_ACP_AGENTS.map((agent) =>
    toAcpAgent(agent, detections[agent.id]),
  );
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
      `${agent.id}\t${agent.displayName}\t${agent.status}\t${agent.compatibility}\t${agent.capabilitySummary}`,
  );
  return [
    "Agent id\tName\tStatus\tCompatibility\tCapability summary",
    ...rows,
  ].join("\n");
}

export function formatAgentListingJson(agents: ListedAgent[]): string {
  return `${JSON.stringify(agents, null, 2)}\n`;
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

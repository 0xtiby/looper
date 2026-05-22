import type { ListedAgent } from "./agents.js";
import type { AgentId } from "./config.js";

export interface InitDeps {
  listAgents: () => Promise<ListedAgent[]>;
  isTty: boolean;
  selectAgent?: (agents: ListedAgent[]) => Promise<AgentId>;
}

export class IncompatibleAgentError extends Error {
  constructor(agentId: string) {
    super(
      `Agent ${agentId} is not AFK-safe and cannot be set as the configured default.`,
    );
    this.name = "IncompatibleAgentError";
  }
}

export class UnknownAgentError extends Error {
  constructor(agentId: string) {
    super(`Unknown agent: ${agentId}`);
    this.name = "UnknownAgentError";
  }
}

export class NonInteractiveInitError extends Error {
  constructor() {
    super("Non-interactive init requires --agent");
    this.name = "NonInteractiveInitError";
  }
}

export interface InitOptions {
  agent?: AgentId;
  deps: InitDeps;
}

export async function resolveInitAgent(options: InitOptions): Promise<AgentId> {
  const agents = await options.deps.listAgents();

  if (!options.deps.isTty) {
    if (!options.agent) {
      throw new NonInteractiveInitError();
    }
    const chosen = agents.find((a) => a.id === options.agent);
    if (!chosen) throw new UnknownAgentError(options.agent);
    if (chosen.compatibility !== "compatible") {
      throw new IncompatibleAgentError(options.agent);
    }
    return options.agent;
  }

  const compatible = agents.filter((a) => a.compatibility === "compatible");
  if (compatible.length === 0) {
    throw new Error("No compatible agents available for selection.");
  }
  if (!options.deps.selectAgent) {
    throw new Error("selectAgent is required for interactive init");
  }
  return options.deps.selectAgent(compatible);
}

import type { AcpAgent } from "./agents.js";

export class MissingAgentError extends Error {
  constructor(agentId: string) {
    super(
      `Agent "${agentId}" is not available. Use 'looper agents' to list available Agents.`,
    );
    this.name = "MissingAgentError";
  }
}

export class UnavailableAgentError extends Error {
  constructor(agentId: string) {
    super(
      `Agent "${agentId}" is not installed or not available. Check that it is installed and on PATH.`,
    );
    this.name = "UnavailableAgentError";
  }
}

export class IncompatibleAgentError extends Error {
  constructor(agentId: string) {
    super(
      `Agent "${agentId}" is not AFK-safe and cannot be used for standard Runs. Use 'looper agents' to see compatible Agents.`,
    );
    this.name = "IncompatibleAgentError";
  }
}

export interface PreflightDeps {
  discoverAgents: () => Promise<AcpAgent[]>;
}

export async function preflight(
  agentId: string,
  _model: string | undefined,
  deps: PreflightDeps,
): Promise<void> {
  const agents = await deps.discoverAgents();
  const agent = agents.find((a) => a.id === agentId);

  if (!agent) {
    throw new MissingAgentError(agentId);
  }

  if (agent.status !== "available") {
    throw new UnavailableAgentError(agentId);
  }

  if (!agent.isAfkSafe) {
    throw new IncompatibleAgentError(agentId);
  }
}

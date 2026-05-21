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

export class UnsupportedModelError extends Error {
  constructor(agentId: string, model: string, supportedModels: string[]) {
    super(
      `Model "${model}" is not supported by Agent "${agentId}". Supported models: ${supportedModels.join(", ")}.`,
    );
    this.name = "UnsupportedModelError";
  }
}

export interface PreflightDeps {
  discoverAgents: () => Promise<AcpAgent[]>;
}

export async function preflight(
  agentId: string,
  model: string | undefined,
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

  if (model && model !== "default" && !agent.supportedModels.includes(model)) {
    throw new UnsupportedModelError(agentId, model, agent.supportedModels);
  }
}

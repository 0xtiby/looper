import { z } from "zod";
import type { AcpAgentServerLaunch } from "./acp.js";

export const DEFAULT_ACP_REGISTRY_URL =
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

const RegistryPackageDistributionSchema = z
  .object({
    package: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const RegistryAgentDistributionSchema = z
  .object({
    npx: RegistryPackageDistributionSchema.optional(),
    uvx: RegistryPackageDistributionSchema.optional(),
  })
  .passthrough();

const RegistryAgentSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().optional(),
    description: z.string().optional(),
    distribution: RegistryAgentDistributionSchema,
  })
  .passthrough();

const AcpRegistrySchema = z
  .object({
    version: z.string().optional(),
    agents: z.array(RegistryAgentSchema),
  })
  .passthrough();

export type AcpRegistry = z.infer<typeof AcpRegistrySchema>;
export type AcpRegistryAgent = z.infer<typeof RegistryAgentSchema>;

export interface RegistryAgentServerConfig {
  type: "registry";
  id?: string;
  registryUrl?: string;
}

export class MissingRegistryAgentError extends Error {
  constructor(agentId: string) {
    super(`ACP Registry Agent "${agentId}" was not found.`);
    this.name = "MissingRegistryAgentError";
  }
}

export class UnsupportedRegistryDistributionError extends Error {
  constructor(agentId: string) {
    super(
      `ACP Registry Agent "${agentId}" does not provide an npx or uvx distribution.`,
    );
    this.name = "UnsupportedRegistryDistributionError";
  }
}

export interface ResolvedRegistryAgentServer {
  agent: AcpRegistryAgent;
  launch: AcpAgentServerLaunch;
}

export type AcpRegistrySource =
  | { type: "inline"; registry: unknown }
  | {
      type: "url";
      url?: string;
      fetchJson?: (url: string) => Promise<unknown>;
    };

const defaultRegistrySource: AcpRegistrySource = {
  type: "url",
  url: DEFAULT_ACP_REGISTRY_URL,
};

export async function resolveRegistryAgentServer(
  config: RegistryAgentServerConfig,
  source: AcpRegistrySource = sourceFromConfig(config),
  configuredAgentId?: string,
): Promise<ResolvedRegistryAgentServer> {
  const registry = await fetchAcpRegistry(source);
  const agentId = config.id ?? configuredAgentId;
  if (agentId === undefined) {
    throw new MissingRegistryAgentError("");
  }
  const agent = registry.agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    throw new MissingRegistryAgentError(agentId);
  }
  return { agent, launch: launchFromRegistryAgent(agent) };
}

export async function fetchAcpRegistry(
  source: AcpRegistrySource = defaultRegistrySource,
): Promise<AcpRegistry> {
  if (source.type === "inline") {
    return AcpRegistrySchema.parse(source.registry);
  }

  const url = source.url ?? DEFAULT_ACP_REGISTRY_URL;
  const payload = source.fetchJson
    ? await source.fetchJson(url)
    : await fetchRegistryJson(url);
  return AcpRegistrySchema.parse(payload);
}

function launchFromRegistryAgent(
  agent: AcpRegistryAgent,
): AcpAgentServerLaunch {
  const npx = agent.distribution.npx;
  if (npx) {
    return {
      type: "registry",
      command: "npx",
      args: ["-y", npx.package, ...(npx.args ?? [])],
      env: npx.env,
    };
  }

  const uvx = agent.distribution.uvx;
  if (uvx) {
    return {
      type: "registry",
      command: "uvx",
      args: [uvx.package, ...(uvx.args ?? [])],
      env: uvx.env,
    };
  }

  throw new UnsupportedRegistryDistributionError(agent.id);
}

function sourceFromConfig(
  config: RegistryAgentServerConfig,
): AcpRegistrySource {
  return { type: "url", url: config.registryUrl ?? DEFAULT_ACP_REGISTRY_URL };
}

async function fetchRegistryJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  return response.json();
}

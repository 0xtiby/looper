import type { Run } from "./run.js";

export interface RunInspection {
  id: string;
  state: Run["state"];
  stopReason: Run["stopReason"];
  startedAt: string;
  completedAt: string | null;
  resolvedPrompt: string;
  effectiveAgent: {
    id: string;
    model: string | null;
  };
  agentServer: Run["agentServer"];
  maxIterations: number;
  iterationCount: number;
  iterations: Run["iterations"];
  resumeHistory: Run["resumeHistory"];
}

export function buildRunInspection(run: Run): RunInspection {
  return {
    id: run.id,
    state: run.state,
    stopReason: run.stopReason,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    resolvedPrompt: run.resolvedPrompt,
    effectiveAgent: {
      id: run.agent,
      model: run.model,
    },
    agentServer: run.agentServer,
    maxIterations: run.maxIterations,
    iterationCount: run.iterations.length,
    iterations: run.iterations,
    resumeHistory: run.resumeHistory,
  };
}

export function formatRunInspectionJson(run: Run): string {
  return `${JSON.stringify(buildRunInspection(run), null, 2)}\n`;
}

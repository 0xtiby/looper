import { describe, expect, it } from "vitest";
import { formatRunInspectionJson } from "./inspect.js";
import {
  applyResumeOverride,
  newActiveRun,
  snapshotAcpAgentServer,
} from "./run.js";

describe("run inspection", () => {
  it("shows ACP Agent Server context and Resume history in the inspection shape", () => {
    const originalAgentServer = snapshotAcpAgentServer({
      id: "custom-agent",
      config: { type: "custom", command: "node", args: ["./agent.js"] },
      launch: { type: "custom", command: "node", args: ["./agent.js"] },
    });
    const overrideAgentServer = snapshotAcpAgentServer({
      id: "registry-agent",
      config: { type: "registry", id: "registry-agent" },
      launch: {
        type: "registry",
        command: "npx",
        args: ["-y", "@acp/registry-agent"],
      },
    });
    const run = newActiveRun({
      id: "run-1",
      prompt: "Resolved prompt",
      agent: "custom-agent",
      agentServer: originalAgentServer,
      model: "sonnet",
      maxIterations: 3,
    });
    const resumedRun = applyResumeOverride(run, {
      agent: "registry-agent",
      agentServer: overrideAgentServer,
      model: "opus",
    });

    const inspection = JSON.parse(formatRunInspectionJson(resumedRun));

    expect(inspection).toMatchObject({
      id: "run-1",
      resolvedPrompt: "Resolved prompt",
      effectiveAgent: {
        id: "registry-agent",
        model: "opus",
      },
      agentServer: {
        id: "registry-agent",
        sourceType: "registry",
        config: { type: "registry", id: "registry-agent" },
        launch: {
          type: "registry",
          command: "npx",
          args: ["-y", "@acp/registry-agent"],
        },
      },
      resumeHistory: [
        {
          fromIteration: 1,
          previousAgent: "custom-agent",
          newAgent: "registry-agent",
          previousModel: "sonnet",
          newModel: "opus",
        },
      ],
    });
  });
});

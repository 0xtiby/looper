import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("v2 documentation surface", () => {
  it("CONTEXT defines ACP client, server, registry, and Zed-style server catalog terms", async () => {
    const context = await readFile("docs/CONTEXT.md", "utf8");

    expect(context).toContain("**ACP Client**");
    expect(context).toContain("**ACP Agent Server**");
    expect(context).toContain("**ACP Registry**");
    expect(context).toContain("**Zed-style `agent_servers`**");
  });

  it("ADR-0001 names ACP JSON-RPC as the v2 runtime contract", async () => {
    const adr = await readFile("docs/adr/0001-looper-v2-acp-native.md", "utf8");

    expect(adr).toContain("ACP JSON-RPC is the runtime contract");
    expect(adr).toContain("not CLI stdout parsing");
    expect(adr).toContain("not `@0xtiby/spawner` semantics");
  });

  it("CONTEXT maps Fresh sessions, Assistant text, and Sentinel to ACP events", async () => {
    const context = await readFile("docs/CONTEXT.md", "utf8");

    expect(context).toContain("Fresh session maps to ACP `session/new`");
    expect(context).toContain(
      "Assistant text maps to ACP `agent_message_chunk` text content",
    );
    expect(context).toContain(
      "Sentinel ignores tool output, permission prompts, stderr logs, raw transport data, and non-text content",
    );
  });

  it("documentation says users can configure ACP Agent Servers without built-in adapters", async () => {
    const context = await readFile("docs/CONTEXT.md", "utf8");
    const readme = await readFile("README.md", "utf8");

    expect(`${context}\n${readme}`).toContain(
      "Users can configure their own ACP Agent Servers rather than waiting for Looper-maintained built-in adapters",
    );
  });

  it("README describes the product as Looper v2", async () => {
    const readme = await readFile("README.md", "utf8");
    expect(readme).toContain("Looper v2");
  });

  it("README uses Run vocabulary instead of session for the top-level artifact", async () => {
    const readme = await readFile("README.md", "utf8");
    expect(readme).toContain("Run");
    expect(readme).not.toContain("session");
    expect(readme).not.toContain("Session");
  });

  it("README uses Agent vocabulary instead of CLI for the execution target", async () => {
    const readme = await readFile("README.md", "utf8");
    expect(readme).toContain("Agent");
    expect(readme).toMatch(/agent id|Agent id/);
  });

  it("README contains migration guidance from v1 to v2", async () => {
    const readme = await readFile("README.md", "utf8");
    expect(readme).toContain("Migrating from v1");
    expect(readme).toContain("hard break");
    expect(readme).toContain("`cli`");
    expect(readme).toContain("`agent`");
  });

  it("README shows a Zed-style custom ACP Agent Server config", async () => {
    const readme = await readFile("README.md", "utf8");
    expect(readme).toContain('"agent_servers"');
    expect(readme).toContain('"type": "custom"');
    expect(readme).toContain('"command": "node"');
  });

  it("archives v1 documentation under docs/v1/", async () => {
    const v1Readme = await readFile("docs/v1/README.md", "utf8");
    expect(v1Readme).toContain("Looper");
    expect(v1Readme).toContain("session");
    expect(v1Readme).toContain("CLI");
  });
});

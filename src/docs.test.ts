import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("v2 documentation surface", () => {
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

  it("archives v1 documentation under docs/v1/", async () => {
    const v1Readme = await readFile("docs/v1/README.md", "utf8");
    expect(v1Readme).toContain("Looper");
    expect(v1Readme).toContain("session");
    expect(v1Readme).toContain("CLI");
  });
});

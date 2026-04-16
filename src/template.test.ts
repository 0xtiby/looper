import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPrompt, readStream, substitute } from "./template.js";

describe("substitute", () => {
  it("replaces {{KEY}} placeholders with matching var values", () => {
    expect(substitute("hello {{NAME}}!", { NAME: "world" })).toBe(
      "hello world!",
    );
  });

  it("replaces all occurrences of a key", () => {
    expect(substitute("{{X}} and {{X}}", { X: "42" })).toBe("42 and 42");
  });

  it("leaves unknown placeholders intact", () => {
    expect(substitute("known={{A}} unknown={{B}}", { A: "1" })).toBe(
      "known=1 unknown={{B}}",
    );
  });

  it("is strictly flat: values are not themselves substituted", () => {
    expect(substitute("{{A}}", { A: "{{B}}", B: "never" })).toBe("{{B}}");
  });
});

describe("loadPrompt", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "looper-template-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("returns an inline string verbatim when no file exists at that path", async () => {
    const out = await loadPrompt({ value: "this is a literal prompt" });
    expect(out).toBe("this is a literal prompt");
  });

  it("reads file contents when value points to an existing file", async () => {
    const file = path.join(workDir, "plan.md");
    await writeFile(file, "file-contents", "utf8");
    const out = await loadPrompt({ value: file });
    expect(out).toBe("file-contents");
  });

  it("reads from the provided stdin stream when fromStdin is true", async () => {
    const stream = Readable.from(["piped ", "prompt"]);
    const out = await loadPrompt({ fromStdin: true, stdin: stream });
    expect(out).toBe("piped prompt");
  });
});

describe("readStream", () => {
  it("concatenates stream chunks into a string", async () => {
    const stream = Readable.from(["a", "b", "c"]);
    expect(await readStream(stream)).toBe("abc");
  });
});

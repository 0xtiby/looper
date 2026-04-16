import { readFile, stat } from "node:fs/promises";
import type { Readable } from "node:stream";

const PLACEHOLDER = /\{\{([A-Za-z0-9_]+)\}\}/g;

export function substitute(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(PLACEHOLDER, (match, key: string) => {
    if (Object.hasOwn(vars, key)) return vars[key] ?? "";
    const upper = key.toUpperCase();
    if (upper !== key && Object.hasOwn(vars, upper)) return vars[upper] ?? "";
    return match;
  });
}

export interface LoadPromptOptions {
  value?: string;
  fromStdin?: boolean;
  stdin?: Readable;
}

export async function loadPrompt(options: LoadPromptOptions): Promise<string> {
  if (options.fromStdin) {
    if (!options.stdin)
      throw new Error("stdin stream required when fromStdin is set");
    return readStream(options.stdin);
  }
  if (typeof options.value !== "string") {
    throw new Error("prompt value required when not reading from stdin");
  }
  if (await fileExists(options.value)) {
    return readFile(options.value, "utf8");
  }
  return options.value;
}

export async function readStream(stream: Readable): Promise<string> {
  const chunks: string[] = [];
  stream.setEncoding("utf8");
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? chunk : String(chunk));
  }
  return chunks.join("");
}

async function fileExists(candidate: string): Promise<boolean> {
  try {
    const info = await stat(candidate);
    return info.isFile();
  } catch {
    return false;
  }
}

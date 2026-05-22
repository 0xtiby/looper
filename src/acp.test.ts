import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AcpProtocolError, createAcpStdioClient } from "./acp.js";

describe("ACP stdio client", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "looper-acp-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("exchanges initialize, session/new, and session/prompt over JSON-RPC", async () => {
    const client = createAcpStdioClient({
      server: {
        type: "custom",
        command: process.execPath,
        args: ["-e", fakeAgentServerScript()],
      },
      cwd: workDir,
    });

    await client.initialize();
    const session = await client.newSession({ cwd: workDir });
    const received: string[] = [];

    for await (const event of client.prompt({
      sessionId: session.sessionId,
      content: [{ type: "text", text: "build the slice" }],
    })) {
      if (event.type === "assistant_text") received.push(event.text);
    }
    await client.close();

    expect(session.sessionId).toBe("fresh-session-1");
    expect(received).toEqual(["Agent saw: build the slice"]);
  });

  it("rejects ordinary process stdout because stdout is ACP messages only", async () => {
    const client = createAcpStdioClient({
      server: {
        type: "custom",
        command: process.execPath,
        args: [
          "-e",
          "process.stdin.once('data', () => process.stdout.write('ordinary stdout\\n'))",
        ],
      },
      cwd: workDir,
    });

    await expect(client.initialize()).rejects.toThrow(AcpProtocolError);
    await client.close();
  });
});

function fakeAgentServerScript(): string {
  return `
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  let newline = buffer.indexOf('\\n');
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim().length > 0) handle(JSON.parse(line));
    newline = buffer.indexOf('\\n');
  }
});
function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}
function handle(request) {
  if (request.method === 'initialize') {
    send({ jsonrpc: '2.0', id: request.id, result: {} });
    return;
  }
  if (request.method === 'session/new') {
    send({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'fresh-session-1' } });
    return;
  }
  if (request.method === 'session/prompt') {
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Agent saw: ' + request.params.content[0].text }
      }
    });
    send({ jsonrpc: '2.0', id: request.id, result: {} });
  }
}
`;
}

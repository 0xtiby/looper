import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AcpProtocolError,
  type AcpSessionEvent,
  createAcpStdioClient,
} from "./acp.js";

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

  it("emits Assistant text only for agent_message_chunk text updates", async () => {
    const client = createAcpStdioClient({
      server: {
        type: "custom",
        command: process.execPath,
        args: ["-e", fakeMixedSessionUpdateServerScript()],
      },
      cwd: workDir,
    });

    await client.initialize();
    const session = await client.newSession({ cwd: workDir });
    const events: AcpSessionEvent[] = [];

    for await (const event of client.prompt({
      sessionId: session.sessionId,
      content: [{ type: "text", text: "run" }],
    })) {
      events.push(event);
    }
    await client.close();

    const assistantEvents = events.filter(
      (event) => event.type === "assistant_text",
    );
    expect(assistantEvents).toEqual([
      { type: "assistant_text", text: "assistant :::LOOPER_DONE::: text" },
    ]);
  });

  it("records tool and stderr progress as transcript events", async () => {
    const client = createAcpStdioClient({
      server: {
        type: "custom",
        command: process.execPath,
        args: ["-e", fakeMixedSessionUpdateServerScript()],
      },
      cwd: workDir,
    });

    await client.initialize();
    const session = await client.newSession({ cwd: workDir });
    const events: AcpSessionEvent[] = [];

    for await (const event of client.prompt({
      sessionId: session.sessionId,
      content: [{ type: "text", text: "run" }],
    })) {
      events.push(event);
    }
    await client.close();

    expect(events).toContainEqual({
      type: "transcript",
      text: "[acp tool_call] tool call :::LOOPER_DONE::: input\n",
    });
    expect(events).toContainEqual({
      type: "transcript",
      text: "[acp tool_call_result] tool :::LOOPER_DONE::: output\n",
    });
    expect(events).toContainEqual({
      type: "transcript",
      text: "[stderr] stderr :::LOOPER_DONE::: log\n",
    });
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

function fakeMixedSessionUpdateServerScript(): string {
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
function update(sessionUpdate, content) {
  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionUpdate, content }
  });
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
    update('tool_call', { type: 'text', text: 'tool call :::LOOPER_DONE::: input' });
    update('tool_call_result', { type: 'text', text: 'tool :::LOOPER_DONE::: output' });
    update('user_message_chunk', { type: 'text', text: 'user :::LOOPER_DONE::: text' });
    update('thought', { type: 'text', text: 'thought :::LOOPER_DONE::: text' });
    update('agent_message_chunk', { type: 'image', data: ':::LOOPER_DONE:::' });
    send({ jsonrpc: '2.0', id: 'permission-1', method: 'session/request_permission', params: { reason: ':::LOOPER_DONE:::' } });
    send({ jsonrpc: '2.0', method: 'window/logMessage', params: { message: 'raw :::LOOPER_DONE::: envelope' } });
    update('agent_message_chunk', { type: 'text', text: 'assistant :::LOOPER_DONE::: text' });
    process.stderr.write('stderr :::LOOPER_DONE::: log\\n');
    setTimeout(() => send({ jsonrpc: '2.0', id: request.id, result: {} }), 10);
  }
}
`;
}

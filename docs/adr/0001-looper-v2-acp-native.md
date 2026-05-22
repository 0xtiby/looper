# 0001. Looper v2 is ACP-native and does not support v1 compatibility

Date: 2026-05-21
Status: Proposed

Looper v2 remains the next major version of the same product, but it is redefined as an ACP-native agent loop runtime rather than a spawned-CLI wrapper. V2 keeps Looper's core loop semantics — fresh session per iteration, sentinel-driven loop completion, AFK-safe execution, resume from the next iteration, and project-local state under `.looper/` — while changing the config and execution model around ACP Agents identified by `agent`. V2 does not attempt to read, emulate, or preserve v1 CLI/config compatibility; old `cli`-based configuration should fail fast rather than dragging legacy semantics into the new runtime.

ACP JSON-RPC is the runtime contract for v2 Agent execution: Looper is an **ACP Client** that speaks protocol methods such as `initialize`, `session/new`, `session/prompt`, and `session/update` with a configured **ACP Agent Server**. The contract is not CLI stdout parsing and not `@0xtiby/spawner` semantics, even if a subprocess helper is still used internally to manage stdio transport.

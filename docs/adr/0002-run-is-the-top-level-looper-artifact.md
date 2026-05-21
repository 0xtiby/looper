# 0002. Run is the top-level Looper artifact

Date: 2026-05-21
Status: Proposed

Looper v2 uses **Run** for the top-level persisted execution record and reserves **session** for the per-iteration ACP conversation. This replaces the v1 habit of calling the top-level artifact a session, because ACP is inherently session-oriented and reusing that term at both levels would be ambiguous in the CLI, persisted state, and code. V2 should therefore rename the persisted artifact and related filesystem vocabulary from session-oriented names to run-oriented names.

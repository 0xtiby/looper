# @0xtiby/looper

TypeScript CLI + library that iterates an AI CLI (claude, codex, opencode via `@0xtiby/spawner`) against a prompt until a sentinel is detected, max iterations are hit, or an error occurs. Zero opinions on specs, plans, trackers, git, or project structure — the prompt is the instruction.

See [README.md](./README.md) for the user-facing pitch and [issue #1](https://github.com/0xtiby/looper/issues/1) for the full PRD.

## Commands

Always use `./scripts/run_silent` for build/test/lint/typecheck — do NOT run these commands directly.

- `./scripts/run_silent "build" pnpm build` — bundle to `dist/`
- `./scripts/run_silent "test" pnpm test` — vitest, bails on first failure
- `./scripts/run_silent "lint" pnpm lint` — biome check
- `./scripts/run_silent "typecheck" pnpm typecheck` — `tsc --noEmit`
- `pnpm format` — biome format (auto-fix, run directly when iterating)
- `pnpm build` directly is fine if you need the raw tsup output

Pre-commit (`prek`) runs lint + typecheck + test on every commit. All three must pass.

## Architecture

- `src/cli.ts` — Commander entry; the published bin. Thin wiring only.
- `src/index.ts` — library entry. The `loop()` function and types live here.
- Modules planned (see PRD): `loop` (core engine, stateless), `config` (zod-validated `.looper/config.json`), `template` (prompt + `{{VAR}}` substitution), `session` (uuid-named files in `.looper/sessions/`), `transcript` (raw stdout log).
- Build: tsup produces two entries — `dist/index.js` (library) and `dist/cli.js` (bin, with shebang).
- The library API is primary; the CLI is a thin consumer of the library.

## Conventions

- Read `docs/coding-standard.md` before writing any code — TDD, typed errors, no `any`, no barrel files, early returns.
- File I/O and persistence live in the CLI layer, never in `loop()`. `loop()` is stateless.
- Mock `@0xtiby/spawner` in tests; never mock our own code.
- Each iteration is independent — no shared conversation state between spawns.

## Do NOT

- Do NOT pipe command output to `head`, `tail`, or `/dev/null` — use `./scripts/run_silent` instead.
- Do NOT add retry logic on spawner errors. Stop the loop immediately and let the user resume.
- Do NOT auto-inject sentinel instructions into prompts. The prompt author controls completion signaling.
- Do NOT add session continuity between iterations. Each spawn is fresh by design.
- Do NOT let `loop()` touch the filesystem. Session/transcript writes belong in the CLI command layer.

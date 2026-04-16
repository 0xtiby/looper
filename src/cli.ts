import type { CliName } from "@0xtiby/spawner";
import { Command, Option } from "commander";
import { loop } from "./index.js";

const SUPPORTED_CLIS: CliName[] = ["claude", "codex", "opencode"];

interface RunCommandOptions {
  prompt: string;
  cli: CliName;
}

const program = new Command();

program
  .name("looper")
  .description("Standalone AI loop orchestration engine")
  .version("0.0.0");

program
  .command("run")
  .description("Run the loop once against an AI CLI")
  .requiredOption("-p, --prompt <string>", "inline prompt string")
  .addOption(
    new Option("--cli <name>", "AI CLI to spawn")
      .choices(SUPPORTED_CLIS)
      .makeOptionMandatory(true),
  )
  .action(async (options: RunCommandOptions) => {
    const result = await loop({
      cli: options.cli,
      prompt: options.prompt,
      cwd: process.cwd(),
    });
    if (result.stopReason === "error") {
      const exitCode = result.iterations.at(-1)?.result.exitCode ?? 1;
      process.exit(exitCode === 0 ? 1 : exitCode);
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

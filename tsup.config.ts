import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    target: "node20",
    platform: "node",
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: false,
    shims: false,
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    target: "node20",
    platform: "node",
    dts: false,
    clean: false,
    sourcemap: true,
    splitting: false,
    shims: false,
    banner: { js: "#!/usr/bin/env node" },
  },
]);

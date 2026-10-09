import { build as bundle } from "esbuild";
import { build as renderer } from "vite";
await renderer();
await bundle({
  entryPoints: {
    main: "src/main/main.ts",
    preload: "src/main/preload.ts",
    worker: "src/engine/worker.ts",
  },
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron", "node:sqlite"],
  sourcemap: false,
});
